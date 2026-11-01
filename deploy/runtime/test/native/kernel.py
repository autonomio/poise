"""Production Namespace/IPC kernel component proof; no workflow or provider."""
import ctypes
import json
import os
import platform
import select
import signal
import subprocess
import statistics
import sys
import threading
import time
from pathlib import Path
from uuid import uuid4

os.environ['AGENT_INTERFACE_DATA_DIR'] = '/tmp/isolated-caller-component'
from agent_interface import native_namespace as native


def exited(fd):
    poll = select.poll()
    poll.register(fd, select.POLLIN)
    return bool(poll.poll(0))


def report(**value):
    payload = (json.dumps(value) + '\n').encode()
    assert len(payload) < 4096 and os.write(1, payload) == len(payload)


def leaf(scope, variant):
    outer = int(os.readlink(f'/proc/self/fd/{scope.outer_proc}/self'))
    report(kind='leaf', variant=variant, pid=os.getpid(), outer_pid=outer)
    os.chdir('/')
    os.environ.clear()
    os.closerange(0, 1024)
    time.sleep(60)
    os._exit(0)


def body(scope, mode):
    assert os.getpid() == 2
    assert 'CapEff:\t0000000000000000' in Path('/proc/self/status').read_text()
    asan = subprocess.run(['/tmp/native-fixtures/sanitizer'], capture_output=True, text=True)
    assert asan.returncode == 0 and not asan.stderr, (asan.returncode, asan.stderr)
    # The ordinary subprocess result must not be stolen by PID 1's reaper.
    assert subprocess.run(['/bin/sh', '-c', 'exit 23']).returncode == 23
    if mode in ('stop-ignored', 'timeout'):
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
    if os.fork() == 0:
        os.setsid()
        if os.fork():
            os._exit(0)
        leaf(scope, 'double-fork-setsid')
    library = native._libc()
    library.syscall.restype = ctypes.c_long
    clone = {'aarch64': 220, 'x86_64': 56}[platform.machine()]
    child = library.syscall(ctypes.c_long(clone), ctypes.c_ulong(0x800000 | signal.SIGCHLD), 0, 0, 0, 0)
    if child == -1:
        raise OSError(ctypes.get_errno(), 'CLONE_UNTRACED fixture')
    if child == 0:
        os.setsid()
        leaf(scope, 'clone-untraced')
    if os.fork() == 0:
        uid, gid = os.getuid(), os.getgid()
        native._checked(library.unshare(0x10000000), 'nested user namespace')
        Path('/proc/self/setgroups').write_text('deny')
        Path('/proc/self/uid_map').write_text(f'{uid} {uid} 1\n')
        Path('/proc/self/gid_map').write_text(f'{gid} {gid} 1\n')
        native._checked(library.unshare(0x20000000 | 0x20000), 'nested PID/mount namespace')
        nested = os.fork()
        if nested == 0:
            native._checked(library.mount(None, b'/', None, (1 << 18) | (1 << 14), None), 'nested private mounts')
            native._checked(library.mount(b'proc', b'/proc', b'proc', 2 | 4 | 8, None), 'nested proc')
            native._drop_capabilities(library)
            leaf(scope, 'nested-pidns')
        os.waitpid(nested, 0)
        os._exit(0)
    subprocess.Popen(['/tmp/native-fixtures/thread-leader', '1', str(scope.outer_proc)], pass_fds=(scope.outer_proc,))
    assert os.read(0, 1) == b'E'
    os._exit(0)


if len(sys.argv) == 3 and sys.argv[1] == 'invocation':
    mode = sys.argv[2]
    scope = native.Namespace(uuid4().hex, f'component-{mode}')
    def registered(receipt):
        report(kind='registered', receipt=receipt)
        if mode == 'owner-before-go':
            assert os.read(0, 1) == b'G'
    try:
        if scope.start(registered, timeout_seconds=3 if mode == 'timeout' else 20):
            body(scope, mode)
        report(kind='ended', code=scope.exit_code, empty=scope.read()['empty'])
        scope.release()
    except Exception as error:
        if mode == 'controller-loss':
            report(kind='unavailable', error=str(error))
        else:
            scope.await_empty()
            report(kind='failure-settled', error=str(error), empty=scope.read()['empty'])
            scope.release()
    raise SystemExit(0)


signal.alarm(105)
server = subprocess.Popen(['node', '/contract/control.mjs'], stdin=subprocess.PIPE,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
address = json.loads(server.stdout.readline())
os.environ['POISE_NATIVE_CONTROL'] = json.dumps(address)
foreign = subprocess.Popen(['/bin/sleep', '110'])
results = []
before = len(list(Path(f'/proc/{server.pid}/fd').iterdir()))
before_targets = {p.name: os.readlink(p) for p in Path(f'/proc/{server.pid}/fd').iterdir()}


def fork_thread_work():
    child = os.fork()
    if child == 0:
        os._exit(0)
    assert os.waitpid(child, 0)[1] == 0
    result = []
    thread = threading.Thread(target=lambda: result.append(sum(range(10000))))
    thread.start()
    thread.join()
    assert result == [49995000]


def rss(pid):
    fields = dict(line.split(':', 1) for line in Path(f'/proc/{pid}/status').read_text().splitlines() if ':' in line)
    return int(fields['VmRSS'].split()[0]) * 1024


try:
    baseline, contained = [], []
    controller_rss_before = rss(server.pid)
    for _ in range(20):
        began = time.monotonic()
        fork_thread_work()
        baseline.append(time.monotonic() - began)
        began = time.monotonic()
        scope = native.Namespace(uuid4().hex, f'fork-thread-{uuid4().hex}')
        if scope.start(lambda receipt: None, timeout_seconds=5):
            fork_thread_work()
            os._exit(0)
        assert scope.exit_code == 0 and scope.read()['empty']
        scope.release()
        contained.append(time.monotonic() - began)
    report(kind='fork-thread-cost', repetitions=20,
           baseline_median_ms=statistics.median(baseline) * 1000,
           contained_median_ms=statistics.median(contained) * 1000,
           contained_max_ms=max(contained) * 1000,
           controller_rss_before=controller_rss_before, controller_rss_after=rss(server.pid))
    for mode in ('normal', 'stop', 'stop-ignored', 'timeout', 'owner-loss', 'holder-loss', 'init-loss', 'owner-before-go', 'controller-loss'):
        worker = subprocess.Popen([sys.executable, '-u', __file__, 'invocation', mode],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        handles = []
        try:
            first = json.loads(worker.stdout.readline())
            assert first['kind'] == 'registered', first
            receipt = first['receipt']
            key = {name: receipt[name] for name in ('callId', 'correlation', 'token')}
            binding = receipt['binding']
            if mode != 'owner-before-go':
                variants = set()
                for _ in range(4):
                    row = json.loads(worker.stdout.readline())
                    assert row['kind'] == 'leaf' and row['variant'] not in variants, row
                    variants.add(row['variant'])
                    fd = os.pidfd_open(row['outer_pid'])
                    handles.append(fd)
                assert variants == {'double-fork-setsid', 'clone-untraced', 'nested-pidns', 'thread-leader-exited'}
                assert all(not exited(fd) for fd in handles), 'fixture member ended before trigger'
            else:
                handles.extend(os.pidfd_open(binding[name]['pid']) for name in ('owner', 'holder'))
                handles.append(os.pidfd_open(binding['pid']))
            began = time.monotonic()
            helper_rss = None
            if mode == 'normal':
                helper_rss = {name: rss(pid) for name, pid in {
                    'original': binding['owner']['pid'], 'holder': binding['holder']['pid'],
                    'reaper': binding['pid']}.items()}
            if mode == 'normal':
                worker.stdin.write('E'); worker.stdin.flush()
            elif mode in ('stop', 'stop-ignored'):
                worker.send_signal(signal.SIGTERM)
            elif mode in ('owner-loss', 'owner-before-go'):
                worker.kill()
            elif mode in ('holder-loss', 'init-loss'):
                pid = binding['holder']['pid'] if mode == 'holder-loss' else binding['pid']
                fd = os.pidfd_open(pid)
                try:
                    expected = binding['holder'] if mode == 'holder-loss' else {'pid': binding['pid'], 'start': binding['start']}
                    assert native.task_identity(pid) == expected
                    signal.pidfd_send_signal(fd, signal.SIGKILL)
                finally:
                    os.close(fd)
            elif mode == 'controller-loss':
                server.kill(); server.wait(timeout=3)
                worker.stdin.write('E'); worker.stdin.flush()
            tail = worker.stdout.read()
            error = worker.stderr.read()
            code = worker.wait(timeout=15)
            worker.stdin.close()
            assert not error, (mode, error)
            if mode in ('owner-loss', 'owner-before-go'):
                assert code == -signal.SIGKILL, (mode, code)
            else:
                assert code == 0, (mode, code, tail)
                result = json.loads(tail)
                assert result['kind'] == ('unavailable' if mode == 'controller-loss' else 'failure-settled' if mode in ('stop-ignored', 'timeout', 'holder-loss') else 'ended'), result
                if mode == 'init-loss':
                    assert result['code'] == -signal.SIGKILL, result
                if mode != 'controller-loss':
                    assert result['empty'] is True
            if mode != 'controller-loss':
                # A lost Caller's original witness remains readable by the
                # existing observer; no replacement process is a new authority.
                if mode in ('owner-loss', 'owner-before-go'):
                    deadline = began + native.SETTLE_SECONDS
                    while True:
                        remaining = deadline - time.monotonic()
                        assert remaining > 0, 'original namespace settlement exceeded two seconds'
                        evidence = native.control_request(address, 'read', timeout_seconds=min(remaining, 1), **key)
                        assert evidence['binding'] == binding and evidence['callId'] == key['callId']
                        if evidence['empty']:
                            assert not evidence['pids']
                            break
                        time.sleep(0.005)
                    assert native.control_request(address, 'release', **key)['released'] is True
                assert all(exited(fd) for fd in handles), 'empty proof preceded an independently pinned member exit'
                assert native.control_request(address, 'hello')['witnesses'] == 0
                # A completed RPC can leave its closing socket briefly in a
                # cross-process FD sample. This measures bounded controller
                # quiescence, separately from the unchanged two-second kernel
                # member deadline and independent pidfds above.
                close_deadline = time.monotonic() + native.CONTROL_SECONDS
                while True:
                    after_targets, closed_during_sample = {}, []
                    for descriptor in Path(f'/proc/{server.pid}/fd').iterdir():
                        try:
                            after_targets[descriptor.name] = os.readlink(descriptor)
                        except FileNotFoundError:
                            closed_during_sample.append(descriptor.name)
                    if len(after_targets) == before:
                        break
                    assert time.monotonic() < close_deadline, {'mode': mode, 'before': before_targets,
                        'after': after_targets, 'closed_during_sample': closed_during_sample}
                    time.sleep(0.005)
            assert foreign.poll() is None, 'neighbor was affected'
            results.append({'mode': mode, 'seconds': round(time.monotonic() - began, 3), 'pinned_members': len(handles),
                            'settlement': 'unavailable' if mode == 'controller-loss' else 'positive-empty', 'foreign_alive': True,
                            **({'process_rss_bytes': helper_rss} if helper_rss is not None else {})})
            report(kind='case', **results[-1])
        finally:
            if worker.poll() is None:
                worker.kill(); worker.wait(timeout=5)
            for fd in handles:
                os.close(fd)
    report(kind='component-proof', kernel=platform.release(), architecture=platform.machine(), results=results,
           provider_or_workflow_acceptance=False)
finally:
    foreign.terminate(); foreign.wait(timeout=3)
    if server.poll() is None:
        server.stdin.close()
    stdout, stderr = server.communicate(timeout=5)
    assert not stdout and not stderr, (stdout, stderr)
