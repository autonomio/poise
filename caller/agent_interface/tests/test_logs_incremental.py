"""Incremental Caller log reads: indexed running-only query, bounded pages.

Whole-log `--logs` dumps (14.2 MB, ~8 s) saturated Poise's main thread and
timed behaviors out. Current queries must stay flat as history grows: the
running-only read is indexed, history walks back in bounded pages behind a
stable cursor, one kind's rows page on their own, and exact ids resolve
behind a single call.
"""
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

import agent_interface

ROOT = Path(__file__).resolve().parents[1]

# Today's retained history (~6,276 rows) times ten, per the issue.
TEN_X_ROWS = 62760


class LogsIncrementalCase(TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        self.data = Path(self.work.name)
        for target in (
            patch.object(agent_interface, "DATA_DIR", self.data),
            patch.object(agent_interface, "DB", self.data / "calls.sqlite3"),
            patch.object(agent_interface, "RESPONSES", self.data / "responses"),
        ):
            target.start()
            self.addCleanup(target.stop)
        agent_interface.init_db()

    KINDS = (
        ("pr_review", "poise:review-new-prs"),
        ("pr_approve", "poise:approve-prs"),
        ("chat", "poise:chat"),
    )

    def seed(self, count, running=0):
        with agent_interface.db() as conn:
            conn.executemany(
                "insert into calls (id, model, prompt, started_at, ended_at, status, behavior, source)"
                " values (?,?,?,?,?,?,?,?)",
                [
                    (
                        f"{n:032x}",
                        "opus-5-max",
                        f"prompt {n}",
                        1761000000.0 + n,
                        None if n >= count - running else 1761000060.0 + n,
                        "running" if n >= count - running else "completed",
                        self.KINDS[n % len(self.KINDS)][0],
                        self.KINDS[n % len(self.KINDS)][1],
                    )
                    for n in range(count)
                ],
            )

    def cli(self, *args: str) -> subprocess.CompletedProcess:
        env = {
            "AGENT_INTERFACE_DATA_DIR": str(self.data),
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONPATH": str(ROOT),
            "PATH": "",
            "HOME": self.work.name,
        }
        return subprocess.run(
            [sys.executable, "-c", "from agent_interface import main; main()", *args],
            text=True, capture_output=True, env=env, cwd=self.work.name, timeout=120,
        )

    def test_running_read_returns_only_running_rows(self):
        self.seed(5, running=2)
        rows = agent_interface.logs(status="running")
        self.assertEqual([r["status"] for r in rows], ["running", "running"])
        self.assertEqual([r["prompt"] for r in rows], ["prompt 3", "prompt 4"])
        done = self.cli("--logs", "--status", "running")
        self.assertEqual((done.returncode, done.stderr), (0, ""), done.stderr)
        self.assertEqual(json.loads(done.stdout), rows)

    def test_current_reads_use_indexes_not_scans(self):
        self.seed(10, running=1)
        with agent_interface.db() as conn:
            running = conn.execute(
                "explain query plan select id from calls"
                " where status='running' order by started_at"
            ).fetchall()
            page = conn.execute(
                "explain query plan select rowid from calls"
                " where started_at < 1761000005.0"
                " order by started_at desc, rowid desc limit 3"
            ).fetchall()
            kind = conn.execute(
                "explain query plan select rowid from calls"
                " where behavior='pr_review' and source='poise:review-new-prs'"
                " order by started_at desc, rowid desc limit 3"
            ).fetchall()
            point = conn.execute(
                "explain query plan select id from calls where id in ('a','b')"
            ).fetchall()
        for plan, index in (
            (running, "calls_status_started"),
            (page, "calls_started"),
            (kind, "calls_behavior_source_started"),
            (point, "sqlite_autoindex_calls_1"),
        ):
            self.assertTrue(any(index in r[3] for r in plan), plan)
            self.assertFalse(any("SCAN" in r[3] for r in plan), plan)

    def test_current_reads_stay_flat_at_ten_x_history(self):
        self.seed(TEN_X_ROWS, running=5)
        started = time.monotonic()
        rows = agent_interface.logs(status="running")
        running_elapsed = time.monotonic() - started
        self.assertEqual(len(rows), 5)
        self.assertLess(running_elapsed, 2, f"running read took {running_elapsed:.2f}s")
        started = time.monotonic()
        page = agent_interface.logs_page(500)
        page_elapsed = time.monotonic() - started
        self.assertEqual(len(page["rows"]), 500)
        self.assertLess(page_elapsed, 2, f"paged read took {page_elapsed:.2f}s")
        started = time.monotonic()
        kind = agent_interface.logs_page(500, behavior="pr_review", source="poise:review-new-prs")
        kind_elapsed = time.monotonic() - started
        self.assertEqual(len(kind["rows"]), 500)
        self.assertLess(kind_elapsed, 2, f"kind read took {kind_elapsed:.2f}s")
        started = time.monotonic()
        point = agent_interface.logs_rows([f"{0:032x}", f"{TEN_X_ROWS - 1:032x}"])
        point_elapsed = time.monotonic() - started
        self.assertEqual(len(point["rows"]), 2)
        self.assertLess(point_elapsed, 2, f"point read took {point_elapsed:.2f}s")

    def test_pages_walk_newest_first_with_a_stable_cursor(self):
        self.seed(5)
        seen: list[str] = []
        cursor = None
        while True:
            page = agent_interface.logs_page(2, cursor)
            prompts = [r["prompt"] for r in page["rows"]]
            self.assertEqual(prompts, sorted(prompts), "rows stay oldest-first in the page")
            seen.extend(r["id"] for r in page["rows"])
            cursor = page["nextCursor"]
            if cursor is None:
                break
        full = agent_interface.logs()
        self.assertEqual(sorted(seen), sorted(r["id"] for r in full))
        self.assertEqual(len(seen), len(set(seen)), "every row is visited exactly once")
        # A cursor past the oldest row ends the walk without an empty page.
        empty = agent_interface.logs_page(2, "1761000000.0|1")
        self.assertEqual((empty["rows"], empty["nextCursor"]), ([], None))

    def test_appends_during_a_walk_do_not_shift_older_pages(self):
        self.seed(4)
        first = agent_interface.logs_page(2)
        self.assertEqual([r["prompt"] for r in first["rows"]], ["prompt 2", "prompt 3"])
        with agent_interface.db() as conn:
            conn.execute(
                "insert into calls (id, model, prompt, started_at, ended_at, status)"
                " values (?,?,?,?,?,?)",
                ("f" * 32, "opus-5-max", "prompt 4", 1761000004.0, 1761000064.0, "completed"),
            )
        second = agent_interface.logs_page(2, first["nextCursor"])
        self.assertEqual([r["prompt"] for r in second["rows"]], ["prompt 0", "prompt 1"])
        self.assertIsNone(second["nextCursor"])

    def test_paged_cli_returns_an_envelope(self):
        self.seed(3)
        done = self.cli("--logs", "--limit", "2")
        self.assertEqual((done.returncode, done.stderr), (0, ""), done.stderr)
        page = json.loads(done.stdout)
        self.assertEqual([r["prompt"] for r in page["rows"]], ["prompt 1", "prompt 2"])
        self.assertEqual(page["nextCursor"], "1761000001.0|2")
        followed = self.cli("--logs", "--limit", "2", "--cursor", page["nextCursor"])
        self.assertEqual((followed.returncode, followed.stderr), (0, ""), followed.stderr)
        tail = json.loads(followed.stdout)
        self.assertEqual([r["prompt"] for r in tail["rows"]], ["prompt 0"])
        self.assertIsNone(tail["nextCursor"])

    def test_pages_follow_start_time_not_insertion_order(self):
        self.seed(3)
        with agent_interface.db() as conn:
            conn.execute(
                "insert into calls (id, model, prompt, started_at, ended_at, status, behavior, source)"
                " values (?,?,?,?,?,?,?,?)",
                ("e" * 32, "opus-5-max", "prompt late", 1761000000.5, 1761000060.5, "completed",
                 "pr_review", "poise:review-new-prs"),
            )
        newest_first: list[str] = []
        cursor = None
        while True:
            page = agent_interface.logs_page(2, cursor)
            newest_first.extend(r["prompt"] for r in reversed(page["rows"]))
            cursor = page["nextCursor"]
            if cursor is None:
                break
        # The late insert started between prompts 0 and 1: recency order,
        # not rowid order, decides what the first match is.
        self.assertEqual(newest_first, ["prompt 2", "prompt 1", "prompt late", "prompt 0"])

    def test_kind_pages_narrow_to_one_behavior_and_source(self):
        self.seed(6)
        page = agent_interface.logs_page(10, behavior="pr_review", source="poise:review-new-prs")
        self.assertEqual([r["prompt"] for r in page["rows"]], ["prompt 0", "prompt 3"])
        self.assertIsNone(page["nextCursor"])
        only_behavior = agent_interface.logs_page(10, behavior="chat")
        self.assertEqual([r["prompt"] for r in only_behavior["rows"]], ["prompt 2", "prompt 5"])
        # A kind that never ran proves its absence with one empty page.
        missing = agent_interface.logs_page(10, behavior="issue_review", source="poise:review-new-issues")
        self.assertEqual((missing["rows"], missing["nextCursor"]), ([], None))
        done = self.cli("--logs", "--limit", "10", "--behavior", "pr_review", "--source", "poise:review-new-prs")
        self.assertEqual((done.returncode, done.stderr), (0, ""), done.stderr)
        self.assertEqual(json.loads(done.stdout), page)

    def test_ids_returns_exact_rows_and_skips_missing(self):
        self.seed(3)
        point = agent_interface.logs_rows([f"{2:032x}", "a" * 32, f"{0:032x}"])
        self.assertEqual([r["prompt"] for r in point["rows"]], ["prompt 0", "prompt 2"])
        self.assertIsNone(point["nextCursor"])
        done = self.cli("--logs", "--ids", f"{2:032x}," + "f" * 32)
        self.assertEqual((done.returncode, done.stderr), (0, ""), done.stderr)
        cli_page = json.loads(done.stdout)
        self.assertEqual([r["prompt"] for r in cli_page["rows"]], ["prompt 2"])
        self.assertIsNone(cli_page["nextCursor"])

    def test_logs_rejects_bad_filters_and_limits(self):
        self.seed(2)
        for args, message in (
            (("--logs", "--status", "completed"), "--status must be running"),
            (("--logs", "--status", "running", "--limit", "2"), "--status running cannot combine"),
            (("--logs", "--status", "running", "--behavior", "chat"), "--status running cannot combine"),
            (("--logs", "--cursor", "2"), "--cursor requires --limit"),
            (("--logs", "--behavior", "chat"), "--behavior and --source require --limit"),
            (("--logs", "--ids", "a" * 32, "--limit", "2"), "--ids cannot combine with other flags"),
            (("--logs", "--limit", "0"), "logs page limit must be 1..1000"),
            (("--logs", "--limit", "1001"), "logs page limit must be 1..1000"),
            (("--logs", "--limit", "many"), "--limit must be an integer"),
            (("--logs", "--limit", "2", "--cursor", "oldest"), "logs page cursor is invalid"),
            (("--logs", "--limit", "2", "--cursor", "2"), "logs page cursor is invalid"),
            (("--logs", "--limit", "2", "--behavior", "chat room"), "logs page behavior is invalid"),
            (("--logs", "--ids", "xyz"), "logs row id is invalid"),
            (("--logs", "--ids", ""), "logs row id is invalid"),
        ):
            done = self.cli(*args)
            self.assertEqual(done.returncode, 2, args)
            self.assertIn(message, done.stderr, args)
        unknown = self.cli("--logs", "--since", "yesterday")
        self.assertEqual(unknown.returncode, 2)
        self.assertIn("usage: agent-interface", unknown.stderr)
        with self.assertRaises(ValueError):
            agent_interface.logs(status="completed")
        with self.assertRaises(ValueError):
            agent_interface.logs_page(0)
        with self.assertRaises(ValueError):
            agent_interface.logs_page(1001)
        with self.assertRaises(ValueError):
            agent_interface.logs_page(2, cursor="oldest")
        with self.assertRaises(ValueError):
            agent_interface.logs_page(2, behavior="chat room")
        with self.assertRaises(ValueError):
            agent_interface.logs_rows([])
        with self.assertRaises(ValueError):
            agent_interface.logs_rows(["xyz"])
