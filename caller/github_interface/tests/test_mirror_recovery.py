import os
import fcntl
import signal
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
import tempfile
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from github_interface.atoms import local, mirror_recovery


class TestMirrorRecovery(TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.parent = Path(self.temporary.name)
        self.mirror = self.parent / "repo.git"

    def create(self):
        (self.mirror / "objects" / "pack").mkdir(parents=True)
        (self.mirror / "objects" / "pack" / "tmp_pack_test").write_bytes(b"x" * 4096)
        return os.open(self.mirror, mirror_recovery.FLAGS)

    def test_interrupted_removal_is_resumed_before_the_next_checkout(self):
        # Replay both sides of rename and repeated interrupted removal.
        for failure in ("before-rename", "after-rename", "partial"):
            for _ in range(30):
                descriptor = self.create()
                try:
                    if failure == "before-rename":
                        target, name = mirror_recovery.os, "rename"
                    elif failure == "after-rename":
                        target, name = mirror_recovery, "_remove"
                    else:
                        target, name = mirror_recovery.shutil, "rmtree"
                    with patch.object(target, name, side_effect=OSError("interrupted")):
                        with self.assertRaises(OSError):
                            mirror_recovery.discard(self.mirror, descriptor)
                finally:
                    os.close(descriptor)
                mirror_recovery.recover(self.mirror)
                self.assertEqual(list(self.parent.iterdir()), [])

    def test_replacement_and_unproved_directories_are_preserved(self):
        descriptor = self.create()
        with patch.object(mirror_recovery, "_remove", side_effect=OSError("interrupted")):
            with self.assertRaises(OSError):
                mirror_recovery.discard(self.mirror, descriptor)
        os.close(descriptor)
        discard = next(self.parent.glob("*.discard-*"))
        if not discard.is_dir():
            discard = next(path for path in self.parent.glob("*.discard-*") if path.is_dir())
        original = self.parent / "saved-original"
        discard.rename(original)
        discard.mkdir()
        (discard / "user-work").write_text("keep")
        unknown = self.parent / ("repo.git.discard-" + "a" * 32)
        unknown.mkdir()
        (unknown / "user-work").write_text("keep")
        with self.assertRaisesRegex(RuntimeError, "mirror recovery held"):
            mirror_recovery.recover(self.mirror)
        with patch.object(local, "_run") as run:
            with self.assertRaisesRegex(RuntimeError, "mirror recovery held"):
                local.checkout_repo(self.parent.name, "repo", "main", "token", self.parent / "checkout",
                                    root=self.parent.parent, remote="unused")
            run.assert_not_called()
        self.assertFalse((self.parent / "checkout").exists())
        self.assertEqual((discard / "user-work").read_text(), "keep")
        self.assertEqual((unknown / "user-work").read_text(), "keep")
        self.assertTrue((original / "objects" / "pack" / "tmp_pack_test").exists())

    def test_existing_mirror_replacement_is_not_marked_or_removed(self):
        descriptor = self.create()
        old = self.parent / "old"
        self.mirror.rename(old)
        self.mirror.mkdir()
        (self.mirror / "user-work").write_text("keep")
        try:
            self.assertFalse(mirror_recovery.discard(self.mirror, descriptor))
        finally:
            os.close(descriptor)
        self.assertEqual((self.mirror / "user-work").read_text(), "keep")
        self.assertEqual(sorted(path.name for path in old.iterdir()), ["objects"])

    def test_missing_generation_retains_evidence_then_allows_a_new_mirror(self):
        descriptor = self.create()
        try:
            with patch.object(mirror_recovery.os, "rename", side_effect=OSError("interrupted")):
                with self.assertRaises(OSError):
                    mirror_recovery.discard(self.mirror, descriptor)
        finally:
            os.close(descriptor)
        shutil.rmtree(self.mirror)
        unlink = os.unlink
        def interrupted_unlink(name, **kwargs):
            if str(name).endswith(".receipt"):
                raise OSError("interrupted")
            return unlink(name, **kwargs)
        with patch.object(mirror_recovery.os, "unlink", side_effect=interrupted_unlink):
            with self.assertRaisesRegex(RuntimeError, "mirror recovery held"):
                mirror_recovery.recover(self.mirror)
        with self.assertRaisesRegex(RuntimeError, "mirror recovery held"):
            mirror_recovery.recover(self.mirror)
        self.assertEqual(len(list(self.parent.glob("*.receipt.missing"))), 1)
        mirror_recovery.recover(self.mirror)
        descriptor = self.create()
        try:
            self.assertTrue(mirror_recovery.discard(self.mirror, descriptor))
        finally:
            os.close(descriptor)
        self.assertEqual(len(list(self.parent.glob("*.receipt.missing"))), 1)

    def test_process_killed_at_each_removal_boundary_is_recovered(self):
        script = """
import os, signal, sys
from pathlib import Path
from github_interface.atoms import mirror_recovery as recovery
path, stage = Path(sys.argv[1]), sys.argv[2]
fd = os.open(path, recovery.FLAGS)
rename, unlink, rmdir, link = os.rename, os.unlink, os.rmdir, os.link
def stop():
    os.kill(os.getpid(), signal.SIGKILL)
def after_rename(source, destination, **kwargs):
    result = rename(source, destination, **kwargs)
    if stage == 'renamed':
        stop()
    return result
def after_unlink(name, **kwargs):
    result = unlink(name, **kwargs)
    if stage == 'marker' and str(name).startswith('.poise-discard-'):
        stop()
    return result
def after_rmdir(name, **kwargs):
    result = rmdir(name, **kwargs)
    if stage == 'directory' and '.discard-' in str(name):
        stop()
    return result
def before_link(source, destination, **kwargs):
    if stage == 'receipt':
        stop()
    return link(source, destination, **kwargs)
os.rename, os.unlink, os.rmdir, os.link = after_rename, after_unlink, after_rmdir, before_link
recovery.discard(path, fd)
"""
        for stage in ("receipt", "renamed", "marker", "directory"):
            for _ in range(5):
                descriptor = self.create()
                os.close(descriptor)
                result = subprocess.run([sys.executable, "-c", script, str(self.mirror), stage], check=False)
                self.assertEqual(result.returncode, -signal.SIGKILL)
                mirror_recovery.recover(self.mirror)
                if stage == "receipt":
                    # The mirror still owns the pack, so a retry can safely
                    # record and remove it; the incomplete temp is tiny.
                    descriptor = os.open(self.mirror, mirror_recovery.FLAGS)
                    try:
                        mirror_recovery.discard(self.mirror, descriptor)
                    finally:
                        os.close(descriptor)
                    for pending in self.parent.glob("*.pending"):
                        pending.unlink()
                self.assertEqual(list(self.parent.iterdir()), [])

    def test_live_git_child_retains_mirror_lock_if_caller_is_killed(self):
        lock = self.parent / "repo.lock"
        child_pid = self.parent / "child.pid"
        worker = "import os,sys,time; open(sys.argv[1], 'w').write(str(os.getpid())); time.sleep(30)"
        script = """
import fcntl, os, sys
from github_interface.atoms import local
lock = open(sys.argv[1], 'w')
fcntl.flock(lock, fcntl.LOCK_EX)
local._MIRROR_LOCK.set(lock.fileno())
local._run([sys.executable, '-c', sys.argv[2], sys.argv[3]], 'fixture')
"""
        parent = subprocess.Popen([sys.executable, "-c", script, str(lock), worker, str(child_pid)])
        pid = None
        try:
            deadline = time.monotonic() + 10
            while not child_pid.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(child_pid.exists())
            pid = int(child_pid.read_text())
            parent.kill()
            parent.wait(timeout=5)
            with open(lock) as contender:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(contender, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            if parent.poll() is None:
                parent.kill()
                parent.wait(timeout=5)
            if pid is not None:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass

    def test_git_passes_mirror_lock_to_its_transport(self):
        lock = self.parent / "repo.lock"
        evidence = self.parent / "transport-fds"
        transport = self.parent / "ssh"
        transport.write_text(f"""#!{sys.executable}
import os
from pathlib import Path
expected = Path(os.environ["MIRROR_TEST_LOCK"]).stat()
found = []
for fd in range(3, 128):
    try:
        info = os.fstat(fd)
        if (info.st_dev, info.st_ino) == (expected.st_dev, expected.st_ino):
            found.append(fd)
    except OSError:
        pass
Path(os.environ["MIRROR_TEST_EVIDENCE"]).write_text(str(found))
raise SystemExit(1)
""")
        transport.chmod(0o700)
        with open(lock, "w") as file:
            fcntl.flock(file, fcntl.LOCK_EX)
            token = local._MIRROR_LOCK.set(file.fileno())
            try:
                with patch.dict(os.environ, {"GIT_SSH_COMMAND": str(transport), "MIRROR_TEST_LOCK": str(lock),
                                             "MIRROR_TEST_EVIDENCE": str(evidence)}):
                    with self.assertRaises(RuntimeError):
                        local._run(["git", "ls-remote", "ssh://example.invalid/test"], "fixture")
            finally:
                local._MIRROR_LOCK.reset(token)
        self.assertNotEqual(evidence.read_text(), "[]")

    def test_credential_cache_daemon_does_not_retain_the_mirror_lock(self):
        source, cache = self.parent / "source", self.parent / "mirrors"
        source.mkdir()
        def git(*args):
            subprocess.run(["git", "-C", str(source), *args], check=True, capture_output=True)
        git("init", "-q", "-b", "main")
        git("config", "user.name", "Fixture")
        git("config", "user.email", "fixture@example.invalid")
        (source / "readme").write_text("first")
        git("add", "readme")
        git("commit", "-qm", "first")
        environment = {**os.environ, "HOME": str(self.parent), "XDG_CACHE_HOME": str(self.parent / "cache"),
                       "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull}
        marker = self.parent / "hook-ran"
        try:
            with patch.dict(os.environ, environment, clear=True):
                local.checkout_repo("owner", "repo", "main", "fixture", self.parent / "first", cache, str(source))
                hook = cache / "owner" / "repo.git" / "hooks" / "reference-transaction"
                hook.write_text('#!/bin/sh\ntouch "' + str(marker) + '"\n'
                                'printf "protocol=https\\nhost=example.invalid\\nusername=fixture\\npassword=fixture\\n\\n"'
                                ' | git -c "credential.helper=cache --timeout=30" credential approve\n')
                hook.chmod(0o700)
                (source / "readme").write_text("second")
                git("add", "readme")
                git("commit", "-qm", "second")
                local.checkout_repo("owner", "repo", "main", "fixture", self.parent / "second", cache, str(source))
                self.assertTrue(marker.exists())
                with open(cache / "owner" / "repo.lock") as contender:
                    fcntl.flock(contender, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            subprocess.run(["git", "credential-cache", "exit"], env=environment, capture_output=True, timeout=10)

    def test_recovery_waits_for_transport_that_outlived_git(self):
        source = self.parent / "source"
        source.mkdir()
        subprocess.run(["git", "init", "-q", "-b", "main", str(source)], check=True)
        subprocess.run(["git", "-C", str(source), "config", "user.email", "fixture@example.invalid"], check=True)
        subprocess.run(["git", "-C", str(source), "config", "user.name", "Fixture"], check=True)
        (source / "readme").write_text("fixture")
        subprocess.run(["git", "-C", str(source), "add", "readme"], check=True)
        subprocess.run(["git", "-C", str(source), "commit", "-qm", "fixture"], check=True)
        ready, release = self.parent / "ready", self.parent / "release"
        root, path = self.parent / "mirrors", self.parent / "checkout"
        original = local._run
        child = None

        def run(command, token, *secrets):
            nonlocal child
            if "--bare" in command and child is None:
                script = ("import sys,time; from pathlib import Path; "
                          "Path(sys.argv[1]).touch(); "
                          "exec('while not Path(sys.argv[2]).exists():\\n time.sleep(0.01)')")
                child = subprocess.Popen([sys.executable, "-c", script, str(ready), str(release)],
                                         pass_fds=(local._MIRROR_LOCK.get(),))
                deadline = time.monotonic() + 10
                while not ready.exists() and child.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.01)
                if not ready.exists():
                    raise RuntimeError("transport fixture did not start")
                raise RuntimeError("Git exited while transport remained alive")
            return original(command, token, *secrets)

        try:
            with patch.object(local, "_run", side_effect=run), ThreadPoolExecutor(max_workers=1) as pool:
                pending = pool.submit(local.checkout_repo, "owner", "repo", "main", "fixture", path, root, str(source))
                deadline = time.monotonic() + 10
                while (not ready.exists() or path.exists()) and time.monotonic() < deadline:
                    time.sleep(0.01)
                try:
                    self.assertTrue(ready.exists())
                    self.assertFalse(path.exists())
                    self.assertFalse(pending.done())
                    with open(root / "owner" / "repo.lock") as contender:
                        with self.assertRaises(BlockingIOError):
                            fcntl.flock(contender, fcntl.LOCK_EX | fcntl.LOCK_NB)
                finally:
                    release.touch()
                result = pending.result(timeout=10)
                self.assertEqual((path / "readme").read_text(), "fixture")
                self.assertEqual(len(result["head_sha"]), 40)
        finally:
            release.touch()
            if child is not None:
                child.wait(timeout=10)
