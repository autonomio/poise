import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from github_datastore.db import connect, get_state, set_state
from github_datastore.store import RECONCILE_PROGRESS_KEY, sync_once
from tests.test_store import BatchReader, base_expanded, initialize_sync_state, repo_row


class ResumeReader(BatchReader):
    def __init__(self) -> None:
        self.repos = [repo_row()]
        self.items = [100, 101, 102]
        self.versions: dict[int, str] = {}
        self.expanded: list[int] = []
        self.enumerated: list[str] = []
        self.fail_on: int | None = None

    def list_org_repos(self, org: str) -> list[dict]:
        return self.repos

    def list_repo_issues(self, name: str) -> list[dict]:
        self.enumerated.append(name)
        return [{"id": item, "number": item, "item_kind": "issue",
                 "updated_at": self.versions.get(item, "2026-01-02T00:00:00Z")}
                for item in self.items]

    def list_repo_changed_items(self, *args: object) -> list[dict]:
        return []

    def expand_issue_or_pr(self, repo: dict, item: dict) -> dict:
        if item["id"] == self.fail_on:
            raise RuntimeError("interrupted expansion")
        self.expanded.append(item["id"])
        result = base_expanded(str(item["id"]), [])
        result["repo"] = repo
        result["issue"].update(id=item["id"], node_id=f'I_{item["id"]}',
                               number=item["number"], updated_at=item["updated_at"])
        return result


class ReconcileResumeTest(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "github.sqlite"
        initialize_sync_state(self.path, "2026-01-01T00:00:00Z")
        self.reader = ResumeReader()
        self.patch = patch("github_datastore.store.GitHubOrgReader", return_value=self.reader)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def state(self, key: str, scope: str = "org") -> str | None:
        conn = connect(self.path)
        try:
            return get_state(conn, scope, key)
        finally:
            conn.close()

    def chunk(self) -> bool:
        with patch("github_datastore.store.time.monotonic", side_effect=[0, 2]):
            return sync_once(self.path, workers=1, reconcile=True, reconcile_max_seconds=1)

    def test_budget_yields_without_false_completion_and_delta_can_run_between_chunks(self) -> None:
        self.assertFalse(self.chunk())
        self.assertEqual(self.reader.expanded, [100])
        self.assertIsNone(self.state("last_reconcile_at"))
        self.assertEqual(self.state("last_sync_at"), "2026-01-01T00:00:00Z")
        self.assertEqual(self.state("full_build_complete", "repo:10"), "1")
        self.assertTrue(sync_once(self.path, workers=1))
        self.assertEqual(self.reader.enumerated, ["Vaquum/Test"])
        self.assertTrue(sync_once(self.path, workers=1, reconcile=True))
        self.assertEqual(self.reader.expanded, [100, 101, 102])
        self.assertIsNone(self.state(RECONCILE_PROGRESS_KEY))
        self.assertIsNotNone(self.state("last_reconcile_at"))
        self.reader.expanded.clear()
        self.assertTrue(sync_once(self.path, workers=1, reconcile=True))
        self.assertEqual(self.reader.expanded, [100, 101, 102])

    def test_resume_reenumerates_edits_additions_and_removals_with_exact_membership(self) -> None:
        self.assertFalse(self.chunk())
        self.reader.items = [100, 102, 103]
        self.reader.versions[100] = "2026-01-03T00:00:00Z"
        self.assertTrue(sync_once(self.path, workers=1, reconcile=True))
        self.assertEqual(self.reader.expanded, [100, 100, 102, 103])
        conn = connect(self.path)
        try:
            self.assertEqual([row[0] for row in conn.execute("SELECT item_id FROM items ORDER BY item_id")], [100, 102, 103])
            self.assertEqual(conn.execute("SELECT updated_at FROM items WHERE item_id = 100").fetchone()[0], self.reader.versions[100])
        finally:
            conn.close()

    def test_exception_and_legacy_retry_markers_resume_mid_repository(self) -> None:
        conn = connect(self.path)
        with conn:
            set_state(conn, "repo:10", "full_build_retry_required", "1")
        conn.close()
        self.reader.fail_on = 101
        with self.assertRaisesRegex(RuntimeError, "interrupted expansion"):
            sync_once(self.path, workers=1)
        self.assertEqual(self.reader.expanded, [100])
        self.reader.fail_on = None
        self.assertTrue(sync_once(self.path, workers=1))
        self.assertEqual(self.reader.expanded, [100, 101, 102])
        self.assertIsNone(self.state("full_build_retry_required", "repo:10"))

    def test_completed_repository_is_not_repeated_after_budget_yields(self) -> None:
        self.reader.items = []
        self.reader.repos.append(dict(repo_row(), id=20, node_id="R_20", name="Second", full_name="Vaquum/Second"))
        self.assertFalse(self.chunk())
        self.assertEqual(json.loads(self.state(RECONCILE_PROGRESS_KEY))["remaining"], ["20"])
        self.assertTrue(sync_once(self.path, workers=1, reconcile=True))
        self.assertEqual(self.reader.enumerated, ["Vaquum/Test", "Vaquum/Second"])

    def test_resume_does_not_trust_checkpoint_if_local_item_was_removed(self) -> None:
        self.assertFalse(self.chunk())
        conn = connect(self.path)
        with conn:
            conn.execute("DELETE FROM items WHERE item_id = 100")
        conn.close()
        self.assertTrue(sync_once(self.path, workers=1, reconcile=True))
        self.assertEqual(self.reader.expanded, [100, 100, 101, 102])

    def test_invalid_budget_and_corrupt_progress_fail_explicitly(self) -> None:
        for value in [0, -1, float("nan"), float("inf")]:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "positive finite"):
                sync_once(self.path, reconcile=True, reconcile_max_seconds=value)
        with self.assertRaisesRegex(ValueError, "requires reconcile"):
            sync_once(self.path, reconcile_max_seconds=1)
        conn = connect(self.path)
        with conn:
            set_state(conn, "org", RECONCILE_PROGRESS_KEY, '{"remaining": []}')
        conn.close()
        with self.assertRaisesRegex(RuntimeError, "invalid reconciliation progress"):
            sync_once(self.path, workers=1, reconcile=True)
