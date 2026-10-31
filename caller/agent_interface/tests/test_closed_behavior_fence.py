"""Native correlation fencing, not live workflow acceptance."""
import json
import os
import sqlite3
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Barrier
from unittest import TestCase
from unittest.mock import patch

import agent_interface as api


class ClosedBehaviorFence(TestCase):
    def setUp(self):
        self.work = TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        root = Path(self.work.name)
        for target in (patch.object(api, "DB", root / "calls.sqlite3"),
                       patch.object(api, "RESPONSES", root / "responses")):
            target.start()
            self.addCleanup(target.stop)
        api.init_db()
        self.args = dict(model="original-model", actor="author", repository="example/repo", number=17,
                         behavior="repair_pr", correlation_id="original-correlation", expected_head="a" * 40)

    def fence(self, **overrides):
        return api.fence_closed_behavior(**{**self.args, **overrides})

    def rows(self):
        with api.db() as conn:
            return [dict(row) for row in conn.execute("select * from calls")]

    def track(self, **overrides):
        args = dict(model="original-model", prompt="", actor="author", repo="example/repo", pr_id="17",
                    behavior="repair_pr", source="poise:behavior-chain", correlation_id="original-correlation", expected_head="a" * 40)
        return api.track(**{**args, **overrides})

    def test_fences_one_native_identity_without_a_worker_or_catalog_lookup(self):
        with patch.object(api.subprocess, "run") as run, patch.object(api, "CATALOG") as catalog:
            result = self.fence()
        self.assertEqual(result["outcome"], "fenced")
        row, = self.rows()
        self.assertEqual(row["id"], result["id"])
        self.assertEqual((row["status"], row["action"], row["outcome"], row["source"], row["pid"]),
                         ("superseded", "not_started", "target_closed", "poise:behavior-chain", None))
        self.assertIsNotNone(row["resources_settled_at"])
        self.assertEqual(json.loads(row["artifact"])["phase"], "admission_fenced")
        run.assert_not_called()
        self.assertEqual(catalog.mock_calls, [])
        with self.assertRaises(sqlite3.IntegrityError):
            self.track()

    def test_duplicate_fence_keeps_the_same_receipt_and_settlement_time(self):
        first = self.fence()
        before = self.rows()
        second = self.fence()
        self.assertEqual((first["id"], second["id"]), (before[0]["id"], before[0]["id"]))
        self.assertEqual(self.rows(), before)

    def test_original_call_wins_without_any_overwrite_or_resource_release(self):
        call = self.track()
        before = self.rows()
        result = self.fence()
        self.assertEqual((result["id"], result["outcome"]), (call, "existing"))
        self.assertEqual(self.rows(), before)
        self.assertIsNone(before[0]["resources_settled_at"])

    def test_conflicting_original_identity_is_not_adopted_or_overwritten(self):
        self.track(actor="other-author")
        before = self.rows()
        with self.assertRaisesRegex(ValueError, "different native invocation"):
            self.fence()
        self.assertEqual(self.rows(), before)

    def test_racing_original_and_fence_have_one_winner(self):
        barrier = Barrier(2)

        def original():
            barrier.wait()
            try:
                return self.track()
            except sqlite3.IntegrityError:
                return None

        def fence():
            barrier.wait()
            return self.fence()

        with ThreadPoolExecutor(max_workers=2) as pool:
            tracked = pool.submit(original)
            fenced = pool.submit(fence)
            call, result = tracked.result(), fenced.result()
        row, = self.rows()
        self.assertEqual(row["id"], result["id"])
        if call:
            self.assertEqual((row["id"], row["status"], result["outcome"]), (call, "running", "existing"))
            self.assertIsNone(row["resources_settled_at"])
        else:
            self.assertEqual((row["status"], result["outcome"]), ("superseded", "fenced"))

    def test_rejects_unpinned_or_invalid_native_identity(self):
        for overrides in ({"behavior": "chat"}, {"number": 0}, {"repository": "a/b/c"},
                          {"actor": "bad actor"}, {"correlation_id": "bad id"}, {"model": ""},
                          {"expected_head": None}, {"expected_head": "bad"}):
            with self.subTest(overrides), self.assertRaises(ValueError):
                self.fence(**overrides)
        self.assertEqual(self.rows(), [])

    def test_cli_has_no_provider_path_and_preserves_original_identity(self):
        result = self.cli("--fence-closed-behavior", "--model", "original-model", "--actor", "author",
                          "--repo", "example/repo", "--number", "17", "--behavior", "repair_pr",
                          "--correlation-id", "original-correlation", "--expected-head", "a" * 40)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["outcome"], "fenced")
        self.assertEqual(len(self.rows()), 1)

    def cli(self, *args):
        env = {"PATH": "", "HOME": self.work.name, "AGENT_INTERFACE_DATA_DIR": self.work.name,
               "PYTHONPATH": str(Path(__file__).resolve().parents[1]), "PYTHONDONTWRITEBYTECODE": "1"}
        return subprocess.run([sys.executable, "-c", "from agent_interface import main; main()", *args],
                              cwd=self.work.name, env=env, capture_output=True, text=True, timeout=30)

    def test_actual_native_log_bytes_settle_the_original_journal_without_quarantine(self):
        repo = Path(__file__).resolve().parents[3]
        output = repo / "test-results"
        output.mkdir(exist_ok=True)
        with TemporaryDirectory(prefix="native-fence-contract-", dir=output) as work:
            root = Path(work)
            environment = {"PATH": os.environ["PATH"], "HOME": self.work.name, "TMPDIR": work}
            build = subprocess.run([str(repo / "node_modules/esbuild/bin/esbuild"),
                                    str(repo / "tests/fixtures/behavior-fence-contract.ts"), "--bundle", "--platform=node",
                                    "--packages=external", "--format=esm", "--target=node22", f"--outfile={root / 'contract.mjs'}"],
                                   cwd=repo, env=environment, capture_output=True, text=True, timeout=30)
            self.assertEqual(build.returncode, 0, build.stderr)
            for behavior in ("issue_review", "implement_issue", "repair_pr", "pr_review", "pr_approve"):
                with self.subTest(behavior):
                    actor = "author" if behavior in {"implement_issue", "repair_pr"} else "reviewer"
                    args = ["--fence-closed-behavior", "--model", "original-model", "--actor", actor,
                            "--repo", "example/repo", "--number", "7" if behavior in {"issue_review", "implement_issue"} else "17",
                            "--behavior", behavior, "--correlation-id", behavior]
                    if behavior not in {"issue_review", "implement_issue"}:
                        args += ["--expected-head", "a" * 40]
                    made = self.cli(*args)
                    self.assertEqual(made.returncode, 0, made.stderr)
                    selected = self.cli("--logs", "--select", json.dumps({"latest": [], "ids": [], "correlations": [behavior]}))
                    self.assertEqual(selected.returncode, 0, selected.stderr)
                    wire = root / "native.json"
                    wire.write_text(selected.stdout)
                    consumed = subprocess.run(["node", str(root / "contract.mjs"), str(wire)], cwd=repo, env=environment,
                                              capture_output=True, text=True, timeout=30)
                    self.assertEqual(consumed.returncode, 0, consumed.stderr)
                    self.assertEqual(json.loads(consumed.stdout), {"accepted": 1, "settled": 1, "reservations": 0})
