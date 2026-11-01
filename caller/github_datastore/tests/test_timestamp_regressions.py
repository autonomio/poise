import copy
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from github_datastore.db import add_user, connect, get_state, init_db
from github_datastore.github_api import GitHubClient, GitHubOrgReader
from github_datastore.store import init_org, store_expanded, sync_once
from tests.test_initialization import InitializationReader, expansion, stub
from tests.test_store import initialize_sync_state, repo_row


STORED = "2026-11-01T09:56:33Z"
CORRECTED = "2026-11-01T09:46:12Z"
WATERMARK = "2026-11-01T09:00:00Z"
SYNC_TIME = "2026-11-01T10:10:00Z"


def item(repo: dict, item_id: int, number: int, kind: str, updated: str, body: str) -> dict:
    value = expansion(repo, item_id, number, updated)
    value["issue"]["body"] = body
    value["is_pr"] = kind == "pr"
    if value["is_pr"]:
        value["pull"] = copy.deepcopy(value["issue"])
    value["comments"] = [{
        "id": item_id + 1000, "node_id": f"C_{item_id}",
        "user": {"login": "commenter"}, "body": body,
        "created_at": WATERMARK, "updated_at": updated,
    }]
    return value


class RegressionReader(InitializationReader):
    def list_repos_changed_items(self, names: list[str], since: str, stored: dict,
                                 *, include_issues: bool = True) -> dict:
        result = {}
        selector = GitHubOrgReader(GitHubClient())
        for name in names:
            pulls = [{"fullDatabaseId": str(value["issue"]["id"]),
                      "id": value["issue"]["node_id"], "number": value["issue"]["number"],
                      "updatedAt": value["issue"]["updated_at"]}
                     for value in self.items[name] if value["is_pr"]]
            changed_ids = {int(node["fullDatabaseId"]) for node in
                           selector._changed_pull_nodes(name, pulls, stored[name])}
            result[name] = [stub(value) for value in self.items[name]
                            if value["issue"]["id"] in changed_ids or
                            (include_issues and not value["is_pr"] and
                             value["issue"]["updated_at"] >= since)]
        return result


class TimestampRegressionTest(unittest.TestCase):
    def test_backward_item_does_not_block_sync_or_initialization_resume(self) -> None:
        for kind in ("pr", "issue"):
            for mode in ("delta", "full", "reconcile", "resume"):
                with self.subTest(kind=kind, mode=mode), tempfile.TemporaryDirectory() as tmp:
                    path = Path(tmp) / "db.sqlite"
                    repo = repo_row()
                    other = dict(repo, id=20, node_id="R_20", name="Other", full_name="Vaquum/Other")
                    previous = item(repo, 100, 1, kind, STORED, "previous @old-user")
                    current = item(repo, 100, 1, kind, CORRECTED, "merged @new-user")
                    current["issue"]["state"] = "closed"
                    current["issue"]["closed_at"] = CORRECTED
                    if current["is_pr"]:
                        current["pull"].update(state="closed", merged_at=CORRECTED)
                    sibling = item(repo, 101, 2, kind, SYNC_TIME, "sibling")
                    other_item = item(other, 200, 1, kind, SYNC_TIME, "other repository")
                    conn = connect(path)
                    init_db(conn)
                    with conn:
                        add_user(conn, "old-user")
                        add_user(conn, "new-user")
                    conn.close()
                    if mode == "resume":
                        first = RegressionReader([repo, other], {
                            repo["full_name"]: [previous, sibling], other["full_name"]: [other_item],
                        })
                        first.fail_item = 101
                        with patch("github_datastore.store.GitHubOrgReader", return_value=first):
                            with self.assertRaisesRegex(RuntimeError, "rate limit during expansion"):
                                init_org("Vaquum", path, workers=1)
                    else:
                        initialize_sync_state(path, WATERMARK, complete=mode != "full")
                        conn = connect(path)
                        store_expanded(conn, previous)
                        conn.close()
                    # Simulate an existing database from before diagnostics were added.
                    conn = connect(path)
                    with conn:
                        conn.execute("DROP TABLE IF EXISTS timestamp_regressions")
                    conn.close()
                    reader = RegressionReader([repo, other], {
                        repo["full_name"]: [current, sibling], other["full_name"]: [other_item],
                    })
                    with (
                        patch("github_datastore.store.GitHubOrgReader", return_value=reader),
                        patch("github_datastore.store.utc_now", return_value=SYNC_TIME),
                        self.assertLogs("github_datastore.store", level="WARNING") as logs,
                    ):
                        if mode == "resume":
                            init_org("Vaquum", path, workers=1, resume=True)
                        else:
                            self.assertTrue(sync_once(path, workers=1, reconcile=mode == "reconcile"))
                        # The next ordinary sync succeeds with no intervention and
                        # does not create a duplicate anomaly for the same correction.
                        self.assertTrue(sync_once(path, workers=1))
                    self.assertEqual(len(logs.output), 1)
                    self.assertIn(f"{STORED} -> {CORRECTED}", logs.output[0])
                    conn = connect(path)
                    try:
                        rows = conn.execute("SELECT * FROM items ORDER BY item_id").fetchall()
                        self.assertEqual([row["item_id"] for row in rows], [100, 101, 200])
                        self.assertEqual(json.loads(rows[0]["expanded_json"]), current)
                        diagnostic = conn.execute("SELECT * FROM timestamp_regressions").fetchall()
                        self.assertEqual(len(diagnostic), 1)
                        self.assertEqual(diagnostic[0]["item_id"], 100)
                        self.assertEqual(diagnostic[0]["repo_full_name"], repo["full_name"])
                        self.assertEqual(diagnostic[0]["stored_updated_at"], STORED)
                        self.assertEqual(diagnostic[0]["received_updated_at"], CORRECTED)
                        self.assertEqual(json.loads(diagnostic[0]["previous_expanded_json"]), previous)
                        self.assertEqual(diagnostic[0]["recorded_at"], SYNC_TIME)
                        comment = conn.execute("SELECT body FROM comments WHERE item_id=100").fetchone()
                        self.assertEqual(comment[0], current["comments"][0]["body"])
                        associations = conn.execute(
                            "SELECT DISTINCT username FROM associations WHERE item_id=100"
                        ).fetchall()
                        self.assertEqual([row[0] for row in associations], ["new-user"])
                        self.assertEqual(get_state(conn, "org", "last_sync_at"), SYNC_TIME)
                    finally:
                        conn.close()

    def test_rejected_expansion_rolls_back_diagnostic_and_prior_graph(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "db.sqlite"
            initialize_sync_state(path, WATERMARK)
            conn = connect(path)
            try:
                previous = item(repo_row(), 100, 1, "pr", STORED, "previous")
                store_expanded(conn, previous)
                broken = item(repo_row(), 100, 1, "pr", CORRECTED, "replacement")
                broken["comments"].append(copy.deepcopy(broken["comments"][0]))
                with self.assertRaises(sqlite3.IntegrityError):
                    store_expanded(conn, broken)
                self.assertEqual(conn.execute("SELECT body FROM items").fetchone()[0], "previous")
                self.assertEqual(conn.execute("SELECT body FROM comments").fetchone()[0], "previous")
                self.assertEqual(conn.execute("SELECT count(*) FROM timestamp_regressions").fetchone()[0], 0)
            finally:
                conn.close()

    def test_existing_full_reconciliation_can_unfreeze_an_account(self) -> None:
        # Also run against the unfixed implementation: reconciliation must replace
        # the skewed source version before the next normal delta comparison.
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "db.sqlite"
            repo = repo_row()
            previous = item(repo, 100, 1, "pr", STORED, "previous")
            current = item(repo, 100, 1, "pr", CORRECTED, "merged")
            initialize_sync_state(path, WATERMARK)
            conn = connect(path)
            store_expanded(conn, previous)
            conn.close()
            reader = RegressionReader([repo], {repo["full_name"]: [current]})
            with patch("github_datastore.store.GitHubOrgReader", return_value=reader):
                self.assertTrue(sync_once(path, workers=1, reconcile=True))
                self.assertTrue(sync_once(path, workers=1))
            conn = connect(path)
            try:
                self.assertEqual(conn.execute("SELECT updated_at FROM items").fetchone()[0], CORRECTED)
                self.assertNotEqual(get_state(conn, "org", "last_sync_at"), WATERMARK)
            finally:
                conn.close()
