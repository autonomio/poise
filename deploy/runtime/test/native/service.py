"""Read the real service gate and its original supervisor's private address.
No setting, work item, behavior or provider is started by this test.
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

expected = sys.argv[1]
assert expected in ('supported', 'unsupported')
deadline = time.monotonic() + 30
while True:
    with urllib.request.urlopen('http://127.0.0.1:5555/api/behavior-chains', timeout=5) as response:
        result = json.load(response)
    support = result['cutover']['support']
    if support['status'] != 'checking':
        break
    assert time.monotonic() < deadline, support
    time.sleep(0.1)
assert support['status'] == expected, result
assert result['cutover']['mode'] == 'v1' and result['chains'] == []

# This lookup only obtains configuration for the internal capability command.
# Process disappearance is never used as resource-settlement evidence.
addresses = set()
for entry in Path('/proc').iterdir():
    if not entry.name.isdecimal():
        continue
    try:
        arguments = (entry / 'cmdline').read_bytes().split(b'\0')
        if b'/opt/poise/dist/server.js' not in arguments:
            continue
        environment = (entry / 'environ').read_bytes().split(b'\0')
    except (FileNotFoundError, ProcessLookupError):
        continue
    addresses.update(value.partition(b'=')[2].decode() for value in environment if value.startswith(b'POISE_NATIVE_CONTROL='))
assert len(addresses) == 1, addresses
environment = {**os.environ, 'POISE_NATIVE_CONTROL': addresses.pop(), 'AGENT_INTERFACE_DATA_DIR': '/tmp/setup-component'}
for _ in range(2):
    completed = subprocess.run(['agent-interface', '--native-capability'], env=environment,
                               capture_output=True, text=True, timeout=15, check=True)
    assert not completed.stderr, completed.stderr
    assert json.loads(completed.stdout)['supported'] is (expected == 'supported')
print(json.dumps({'kind': 'actual-service-native-gate', 'status': expected, 'mode': result['cutover']['mode'],
                  'provider_or_workflow_acceptance': False}))
