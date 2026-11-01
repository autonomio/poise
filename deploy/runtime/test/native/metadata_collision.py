"""Real private-PID collision for a fresh Caller metadata reader; no work actions."""
import errno
import fcntl
import json
import os
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path


def validate():
    store = json.loads(os.environ['POISE_NATIVE_CONTROL'])['store']
    target = store['pid']
    targets = {store['directoryFd'], store['responsesFd']}
    assert os.getpid() == 2 and 1 < target <= 128, (os.getpid(), target)
    minimum = max(targets) + 16

    def preserve(fd):
        return fcntl.fcntl(fd, fcntl.F_DUPFD_CLOEXEC, minimum)

    def pipe():
        original = os.pipe()
        try:
            return tuple(preserve(fd) for fd in original)
        finally:
            for fd in original:
                os.close(fd)

    with tempfile.TemporaryDirectory(prefix='foreign-metadata-collision-') as foreign:
        @contextmanager
        def collision():
            opened = os.open(foreign, os.O_RDONLY | os.O_DIRECTORY)
            try:
                foreign_fd = preserve(opened)
            finally:
                os.close(opened)
            saved = {}
            try:
                for fd in targets:
                    try:
                        saved[fd] = preserve(fd)
                    except OSError as error:
                        if error.errno != errno.EBADF:
                            raise
                        saved[fd] = None
                    os.dup2(foreign_fd, fd, inheritable=False)
                yield
            finally:
                for fd, original in saved.items():
                    if original is None:
                        os.close(fd)
                    else:
                        os.dup2(original, fd, inheritable=False)
                        os.close(original)
                os.close(foreign_fd)

        def read():
            import agent_interface as api
            for entry in ('import agent_interface as api; connection = api.caller_store.connect(api.DB); ',
                          f'import sys, os; from pathlib import Path; sys.path.insert(0, {str(Path(api.__file__).parent)!r}); '
                          'import caller_store; connection = caller_store.connect(Path(os.environ["AGENT_INTERFACE_DATA_DIR"]) / "calls.sqlite3"); '):
                result = subprocess.run([sys.executable, '-c', entry +
                                         'assert connection.execute("select count(*) from calls").fetchone()[0] > 0; '
                                         'connection.close(); print("original-metadata-read")'],
                                        capture_output=True, text=True, timeout=10)
                assert result.returncode == 0 and result.stdout == 'original-metadata-read\n' and not result.stderr, result

        if target == os.getpid():
            with collision():
                read()
        else:
            ready_r, ready_w = pipe()
            stop_r, stop_w = pipe()
            child = None
            try:
                while True:
                    pid = os.fork()
                    if pid == 0:
                        if os.getpid() != target:
                            os._exit(0)
                        with collision():
                            os.write(ready_w, b'R')
                            os.read(stop_r, 1)
                        os._exit(0)
                    if pid < target:
                        assert os.waitpid(pid, 0)[1] == 0
                        continue
                    assert pid == target, ('target PID was already consumed', pid, target)
                    child = pid
                    break
                assert os.read(ready_r, 1) == b'R'
                read()
            finally:
                if child is not None:
                    os.write(stop_w, b'X')
                    assert os.waitpid(child, 0)[1] == 0
                for fd in (ready_r, ready_w, stop_r, stop_w):
                    os.close(fd)
