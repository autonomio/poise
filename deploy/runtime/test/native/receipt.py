"""Actual Caller/kernel/SQLite resource boundary with a no-effect test body.
This does not execute or validate a provider or a GitHub behavior workflow.
"""
import hashlib
import json
import os
import platform
import signal
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from unittest.mock import patch

os.environ['AGENT_INTERFACE_DATA_DIR'] = '/tmp/isolated-call-resource-proof'
import agent_interface as api
from agent_interface import native_namespace, resource_ownership

signal.alarm(30)
server = subprocess.Popen(['node', '/contract/control.mjs'], stdin=subprocess.PIPE,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
address = json.loads(server.stdout.readline())
os.environ['POISE_NATIVE_CONTROL'] = json.dumps(address)
foreign = Path('/tmp/neighbor-user-evidence')
foreign.write_text('retained neighbor/user/evidence sentinel')
foreign_hash = hashlib.sha256(foreign.read_bytes()).hexdigest()
correlation = 'kernel-call-original'

def no_effect_body():
    call = api.track('native-action', 'no-effect resource component', '21', 'example/repo', 'reviewer', 'native_action',
                     expected_head='a' * 40, source='poise:behavior-chain', correlation_id=correlation)
    assert os.getpid() == 2 and native_namespace.active().key['callId'] == call
    root = resource_ownership.allocate(api.DB, call, resource_ownership.call_directory(api.DB, call))
    (root / 'disposable-build-output').write_text('owned component output')
    api.finish(call, 'failed', error='Explicit no-effect component body; no provider or GitHub action started',
               outcome='preflight_failed', action='not_started', error_code='component_no_effect')

try:
    argv = ['agent-interface', '--native-action', '--source', 'poise:behavior-chain', '--correlation-id', correlation]
    with patch.object(sys, 'argv', argv), patch.object(api, '_main', side_effect=no_effect_body):
        try:
            api.main()
        except SystemExit as result:
            if native_namespace.active() is not None:
                os._exit(result.code)
            assert result.code == 0, result.code
        if native_namespace.active() is not None:
            os._exit(0)
    rows = api.logs_selected({'latest': [], 'ids': [], 'correlations': [correlation]})
    assert len(rows) == 1
    row = rows[0]
    owned = row['resource_ownership']
    assert owned['version'] == 2 and owned['namespace']['state'] == 'settled', rows
    assert owned['namespace']['callId'] == row['id'] and owned['namespace']['correlation'] == correlation
    assert len(owned['roots']) == 1 and owned['roots'][0]['state'] == 'reclaimed'
    assert not Path(owned['roots'][0]['path']).exists()
    assert row['resources_settled_at'] and resource_ownership.released(owned)
    assert row['status'] == 'failed' and row['action'] == 'not_started'
    assert hashlib.sha256(foreign.read_bytes()).hexdigest() == foreign_hash
    with api.db() as database:
        original = database.execute('select namespace_control,resources_settled_at from calls where id=?', (row['id'],)).fetchone()
    private = json.loads(original[0])
    encoded = json.dumps(rows)
    assert private['token'] not in encoded and private['address']['path'] not in encoded
    assert native_namespace.control_request(address, 'hello')['witnesses'] == 0
    assert server.poll() is None
    print(json.dumps({'kind': 'actual-call-resource-component', 'kernel': platform.release(), 'architecture': platform.machine(),
        'caller_rows': rows, 'foreign_sentinel_unchanged': True, 'provider_or_workflow_acceptance': False}))
finally:
    server.stdin.close()
    stdout, stderr = server.communicate(timeout=5)
    assert server.returncode == 0 and not stdout and not stderr, (server.returncode, stdout, stderr)
