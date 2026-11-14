"""Retire a running first implementation against its publication checkpoint."""
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

import agent_interface as api
from agent_interface import review_receipt

CALL = "b" * 32
HEAD = "c" * 40


class RetireClosedImplementation(TestCase):
    def setUp(self):
        self.work = TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        root = Path(self.work.name)
        for target in (patch.object(api, "DB", root / "calls.sqlite3"),
                       patch.object(api, "RESPONSES", root / "responses")):
            target.start()
            self.addCleanup(target.stop)
        api.init_db()

    def running(self, *, behavior="implement_issue", artifact=None, error_code=None, pid=None):
        call = api.track("original-model", "", "7", "example/repo", actor="author",
                         behavior=behavior, source="poise:behavior-chain",
                         correlation_id="original-implementation", expected_head=None)
        with api.db() as conn:
            conn.execute("update calls set artifact=?, error_code=?, pid=? where id=?",
                         (json.dumps(artifact or {"phase": "executing"}), error_code, pid, call))
        return call

    def row(self, call):
        with api.db() as conn:
            row = conn.execute("select status,error_code,artifact,action_plan from calls where id=?", (call,)).fetchone()
        return {"status": row["status"], "error_code": row["error_code"],
                "artifact": json.loads(row["artifact"] or "{}"), "action_plan": row["action_plan"]}

    def test_retire_fences_before_publication_and_blocks_the_checkpoint(self):
        call = self.running()
        before = self.row(call)
        with patch.object(api.process_identity, "pinned") as pinned:
            result = api.retire_closed_implementation(call)
        self.assertEqual(result["outcome"], "retiring")
        pinned.assert_not_called()
        after = self.row(call)
        self.assertEqual((after["status"], after["error_code"]), ("running", None))
        self.assertEqual(after["artifact"]["retirement"]["cause"], "target_closed")
        self.assertEqual(after["artifact"]["phase"], "executing")
        # The worker advances to its publication plan with the fence retained,
        # exactly as record() merges the durable artifact.
        with api.db() as conn:
            conn.execute("update calls set artifact=?, action_plan=? where id=?",
                         (json.dumps({**after["artifact"], "phase": "preparing_publication",
                                     "plan_sha": "d" * 64}), '{"kind":"atomic_work"}', call))
        with patch.dict(os.environ, {"AGENT_INTERFACE_RECEIPT_DB": str(api.DB),
                                     "AGENT_INTERFACE_RECEIPT_CALL": call}):
            with self.assertRaisesRegex(RuntimeError, "fenced by verified target closure"):
                review_receipt.work_publication(HEAD)
            with self.assertRaisesRegex(RuntimeError, "fenced by verified target closure"):
                review_receipt.work_publication(HEAD, start_replies=True)
        fenced = self.row(call)
        self.assertEqual(fenced["artifact"]["phase"], "preparing_publication")
        self.assertNotIn("publication_head", fenced["artifact"])
        self.assertEqual(before["artifact"]["phase"], "executing")

    def test_publication_checkpoint_wins_when_it_commits_first(self):
        call = self.running()
        with api.db() as conn:
            conn.execute("update calls set artifact=?, action_plan=? where id=?",
                         (json.dumps({"phase": "preparing_publication", "plan_sha": "d" * 64}),
                          '{"kind":"atomic_work"}', call))
        with patch.dict(os.environ, {"AGENT_INTERFACE_RECEIPT_DB": str(api.DB),
                                     "AGENT_INTERFACE_RECEIPT_CALL": call}):
            review_receipt.work_publication(HEAD)
        published = self.row(call)
        self.assertEqual((published["artifact"]["phase"], published["artifact"]["publication_head"]),
                         ("publishing", HEAD))
        result = api.retire_closed_implementation(call)
        self.assertEqual(result["outcome"], "refused")
        after = self.row(call)
        self.assertEqual(after, published)
        self.assertNotIn("retirement", after["artifact"])

    def test_retire_refuses_beyond_boundary_without_changing_the_row(self):
        cases = [
            {"behavior": "repair_pr"},
            {"artifact": {"phase": "publishing", "plan_sha": "d" * 64, "publication_head": HEAD}},
            {"artifact": {"phase": "executing", "plan_sha": "d" * 64}},
            {"artifact": {"phase": "executing", "publication_head": HEAD}},
            {"artifact": {"phase": "executing", "publication": {"title": "t"}}},
            {"artifact": {"phase": "executing", "result": {"outcome": "published"}}},
            {"artifact": {"phase": "executing", "resource_error": "resources_unknown"}},
            {"artifact": {"phase": "preparing_publication", "plan_sha": "d" * 64}},
            {"error_code": "stopping"},
        ]
        for overrides in cases:
            with self.subTest(overrides=overrides):
                with api.db() as conn:
                    conn.execute("delete from calls")
                call = self.running(**overrides)
                before = self.row(call)
                self.assertEqual(api.retire_closed_implementation(call)["outcome"], "refused")
                self.assertEqual(self.row(call), before)

    def test_retire_signals_the_verified_supervisor_without_a_user_stop(self):
        import signal as native_signal
        import subprocess
        import sys
        process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"],
                                   start_new_session=True)
        self.addCleanup(process.wait)
        self.addCleanup(lambda: process.poll() is None and process.kill())
        call = self.running(pid=str(process.pid))
        with api.db() as conn:
            conn.execute("update calls set process_identity=? where id=?",
                         (api.process_identity.capture(process.pid), call))
        result = api.retire_closed_implementation(call)
        self.assertEqual(result["outcome"], "retiring")
        self.assertIsNotNone(process.wait(timeout=5))
        after = self.row(call)
        self.assertEqual((after["status"], after["error_code"]), ("running", None))
        self.assertEqual(after["artifact"]["retirement"]["cause"], "target_closed")
