import errno
import json
import os
import signal
from unittest import TestCase
from unittest.mock import patch

from agent_interface import process_identity


class ProcessIdentityCase(TestCase):
    def setUp(self):
        self.epoch = {"boot": "boot-a", "init_start": "10", "namespace_dev": 1, "namespace_ino": 2}
        self.encoded = json.dumps({"version": 1, "pid": 42, "start": "123", "epoch": self.epoch})

    def test_epoch_is_an_identity_not_wall_clock_order(self):
        with patch.object(process_identity, "epoch", return_value=self.epoch), \
                patch.object(process_identity, "_start", return_value="123"):
            self.assertEqual(process_identity.state(self.encoded, 42), "alive")
        with patch.object(process_identity, "epoch", return_value={**self.epoch, "init_start": "11"}), \
                patch.object(process_identity, "_start") as start:
            self.assertEqual(process_identity.state(self.encoded, 42), "different")
            start.assert_not_called()

    def test_unreadable_epoch_or_process_never_means_gone(self):
        for failure in (PermissionError("denied"), FileNotFoundError("epoch unavailable")):
            with self.subTest(error=type(failure).__name__), \
                    patch.object(process_identity, "epoch", side_effect=failure), \
                    self.assertRaisesRegex(RuntimeError, "epoch cannot be verified"):
                process_identity.state(self.encoded, 42)
        with patch.object(process_identity, "epoch", return_value=self.epoch), \
                patch.object(process_identity, "_start", side_effect=PermissionError("denied")), \
                self.assertRaisesRegex(RuntimeError, "identity cannot be verified"):
            process_identity.state(self.encoded, 42)
        with patch.object(process_identity, "epoch", return_value=self.epoch), \
                patch.object(process_identity, "_start", side_effect=FileNotFoundError("gone")):
            self.assertEqual(process_identity.state(self.encoded, 42), "gone")

    def test_pin_precedes_identity_check_and_signal_uses_only_the_handle(self):
        events = []
        with patch.object(os, "pidfd_open", side_effect=lambda pid: events.append(("open", pid)) or 77, create=True), \
                patch.object(process_identity, "state", side_effect=lambda *args: events.append(("verify", 42)) or "alive"), \
                patch.object(signal, "pidfd_send_signal", side_effect=lambda fd, sig: events.append(("signal", fd, sig)), create=True), \
                patch.object(os, "close", side_effect=lambda fd: events.append(("close", fd))), \
                patch.object(os, "kill") as kill, patch.object(os, "killpg") as killpg:
            with process_identity.pinned(self.encoded, 42) as process:
                process.signal(signal.SIGTERM)
            kill.assert_not_called()
            killpg.assert_not_called()
        self.assertEqual(events, [("open", 42), ("verify", 42), ("signal", 77, signal.SIGTERM), ("close", 77)])

    def test_reuse_after_open_closes_handle_without_signalling(self):
        with patch.object(os, "pidfd_open", return_value=77, create=True), \
                patch.object(process_identity, "state", return_value="different"), \
                patch.object(signal, "pidfd_send_signal", create=True) as send, \
                patch.object(os, "close") as close, \
                self.assertRaisesRegex(RuntimeError, "another process or epoch"):
            with process_identity.pinned(self.encoded, 42):
                self.fail("a changed identity has no pinned signal authority")
        send.assert_not_called()
        close.assert_called_once_with(77)

    def test_capability_failure_has_no_numeric_signal_fallback(self):
        with patch.object(os, "pidfd_open", side_effect=OSError(errno.ENOSYS, "unavailable"), create=True), \
                patch.object(signal, "pidfd_send_signal", create=True), \
                patch.object(os, "kill") as kill, patch.object(os, "killpg") as killpg, \
                self.assertRaisesRegex(RuntimeError, "pidfd is unsupported"):
            with process_identity.pinned(self.encoded, 42):
                self.fail("unsupported handles cannot authorize a signal")
        kill.assert_not_called()
        killpg.assert_not_called()

    def test_older_missing_or_unverified_identity_does_not_open_a_handle(self):
        for encoded in (None, "{}", "not json", '{"version":1,"pid":42,"unverified":"no /proc"}',
                        self.encoded.replace('"pid": 42', '"pid": 43')):
            with self.subTest(encoded=encoded), \
                    patch.object(os, "pidfd_open", create=True) as opened, \
                    self.assertRaises(RuntimeError):
                with process_identity.pinned(encoded, 42):
                    self.fail("missing identity cannot authorize a signal")
            opened.assert_not_called()
