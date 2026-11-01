import subprocess
import sys
import tempfile
from pathlib import Path
from time import time
from unittest import TestCase, skipUnless
from unittest.mock import patch

import agent_interface


class TestStopCall(TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        data = Path(self.work.name)
        for target in (
            patch.object(agent_interface, "DATA_DIR", data),
            patch.object(agent_interface, "DB", data / "calls.sqlite3"),
            patch.object(agent_interface, "RESPONSES", data / "responses"),
            patch.object(agent_interface, "STOP_COMMAND_MARK", "time.sleep"),
            patch.object(agent_interface, "STOP_GRACE_SECONDS", 2.0),
        ):
            target.start()
            self.addCleanup(target.stop)
        agent_interface.init_db()

    def running(self, pid: int, *, bind: bool = True) -> str:
        id_ = agent_interface.track("opus-5-max", "prompt")
        with agent_interface.db() as conn:
            if bind:
                conn.execute("update calls set pid=?,process_identity=? where id=?",
                             (str(pid), agent_interface.process_identity.capture(pid), id_))
            else:
                conn.execute("update calls set pid=? where id=?", (str(pid), id_))
        return id_

    def sleeper(self) -> subprocess.Popen:
        process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"], start_new_session=True)
        self.addCleanup(process.wait)
        self.addCleanup(lambda: process.poll() is None and process.kill())
        return process

    def test_track_records_the_process_id(self):
        id_ = agent_interface.track("opus-5-max", "prompt")
        with agent_interface.db() as conn:
            row = conn.execute("select pid, status from calls where id=?", (id_,)).fetchone()
        self.assertEqual((row["pid"], row["status"]), (str(agent_interface.os.getpid()), "running"))

    @skipUnless(sys.platform == "linux", "kernel-pinned Stop is a Linux capability")
    def test_stops_the_verified_supervisor_without_access_to_init_namespace(self):
        process = self.sleeper()
        original_stat = Path.stat

        def stat(path, *args, **kwargs):
            if str(path) == "/proc/1/ns/pid":
                raise PermissionError("init belongs to another user")
            return original_stat(path, *args, **kwargs)

        with patch.object(Path, "stat", new=stat):
            id_ = self.running(process.pid)
            agent_interface.process_identity.decode(
                agent_interface.process_identity.capture(process.pid), process.pid)
            started = time()
            result = agent_interface.stop_call(id_)
        self.assertEqual(result, {"id": id_, "stopped": True, "status": "failed", "error_code": "stopped"})
        self.assertIsNotNone(process.wait(timeout=5))
        with agent_interface.db() as conn:
            row = conn.execute("select status, error, error_code, ended_at from calls where id=?", (id_,)).fetchone()
        self.assertEqual((row["status"], row["error"], row["error_code"]), ("failed", "Stopped by user", "stopped"))
        self.assertGreaterEqual(row["ended_at"], started)

    def test_a_finished_call_is_left_alone(self):
        id_ = agent_interface.track("opus-5-max", "prompt")
        agent_interface.finish(id_, "completed", response="done")
        self.assertEqual(agent_interface.stop_call(id_), {"id": id_, "stopped": False, "status": "completed"})

    def test_a_reused_pid_is_never_signalled(self):
        process = self.sleeper()
        id_ = self.running(process.pid, bind=False)
        with self.assertRaisesRegex(RuntimeError, "verified process identity"):
            agent_interface.stop_call(id_)
        self.assertIsNone(process.poll())
        with agent_interface.db() as conn:
            self.assertEqual(conn.execute("select status from calls where id=?", (id_,)).fetchone()["status"], "running")

    @skipUnless(sys.platform == "linux", "kernel-pinned Stop is a Linux capability")
    def test_a_vanished_process_still_closes_the_row(self):
        process = self.sleeper()
        id_ = self.running(process.pid)
        process.kill()
        process.wait()
        result = agent_interface.stop_call(id_)
        self.assertEqual(result["stopped"], True)
        self.assertEqual(result["status"], "failed")

    def test_unknown_and_pidless_calls_are_errors(self):
        with self.assertRaisesRegex(ValueError, "unknown call id"):
            agent_interface.stop_call("f" * 32)
        id_ = agent_interface.track("opus-5-max", "prompt")
        with agent_interface.db() as conn:
            conn.execute("update calls set pid=null where id=?", (id_,))
        with self.assertRaisesRegex(RuntimeError, "recorded no process id"):
            agent_interface.stop_call(id_)

    def test_a_native_same_name_replacement_is_not_the_original_process(self):
        process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)", "agent-interface", "--logs"],
                                   start_new_session=True)
        self.addCleanup(process.wait)
        self.addCleanup(lambda: process.poll() is None and process.kill())
        id_ = agent_interface.track("fixture-model", "original native admission", repo="acme/app", pr_id="7",
                                    actor="reviewer", behavior="pr_review", expected_head="a" * 40,
                                    source="poise:behavior-chain", correlation_id="original-native-stop")
        with agent_interface.db() as conn:
            conn.execute("update calls set pid=? where id=?", (str(process.pid), id_))
        with patch.object(agent_interface, "STOP_COMMAND_MARK", "agent-interface"):
            with self.assertRaises(RuntimeError):
                agent_interface.stop_call(id_)
        self.assertIsNone(process.poll(), "a same-name foreign process is outside this Call's authority")
        with agent_interface.db() as conn:
            self.assertEqual(conn.execute("select status,error_code from calls where id=?", (id_,)).fetchone()["status"], "running")

    def test_native_history_without_process_identity_does_not_signal_a_same_name_process(self):
        process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)", "agent-interface", "--logs"],
                                   start_new_session=True)
        self.addCleanup(process.wait)
        self.addCleanup(lambda: process.poll() is None and process.kill())
        id_ = "d" * 32
        with agent_interface.db() as conn:
            conn.execute("insert into calls(id,model,prompt,started_at,status,source,pid,behavior,repo,pr_id,actor,expected_head) "
                         "values(?, 'fixture-model','historical native admission',?,'running','poise:behavior-chain',?,"
                         "'pr_review','acme/app','7','reviewer',?)", (id_, time() - 3600, str(process.pid), "a" * 40))
        with patch.object(agent_interface, "STOP_COMMAND_MARK", "agent-interface"):
            with self.assertRaises(RuntimeError):
                agent_interface.stop_call(id_)
        self.assertIsNone(process.poll())
        with agent_interface.db() as conn:
            self.assertEqual(conn.execute("select status from calls where id=?", (id_,)).fetchone()["status"], "running")
