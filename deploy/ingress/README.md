# External Caddy diagnostics

This optional reader runs on the operator-owned Docker host serving the external
Poise proxy. It sends only Poise-host native Warning/Error/Critical records to
the existing gateway operator command. It adds no listener or workspace access.
The normal one-record `ingress` command remains available for manual diagnosis.

The reader requires Python 3.10+, Docker CLI and OpenSSH. It polls every 15 seconds,
replays the oldest retained native record within 30 days, and resumes its centrally
committed window after restart. Backfill continues at one-second intervals until
current; a source with no retained records starts with a five-minute window.
Initial coverage makes no claim about earlier history. A replaced
container or a cursor older than the oldest retained Docker record leaves an
explicit historical uncertainty interval. Docker rotation cannot recover deleted
records. Restore/replay never removes historical gaps.

Reads have a 1 MiB/1,000-native-record bound, at most 100 projected diagnostics
per transaction, and a 12-second total replay budget. Large
windows are halved; an irreducible one-second window is recorded as incomplete
and advanced. Unavailable sources never advance the checkpoint. Native routine
and unstructured output are excluded by policy. The reader sends no request URI,
headers, body or unrelated host records. The gateway checks the domain again and
applies canonical redaction before committing. Events, coverage and the source
checkpoint share one transaction; acknowledgements follow that commit. Current
health expires after 90 seconds without a report, independently of process health.

## Install

First deploy a reviewed gateway containing `ingress-stream`. On the edge host,
create `/etc/poise-ingress` mode 0700 and generate a dedicated key there:

```sh
ssh-keygen -t ed25519 -N '' -f /etc/poise-ingress/id_ed25519
```

Keep the private key on the edge host. Install only its public key into the
gateway host operator's `authorized_keys`, prefixed by:

```text
restrict,command="/usr/bin/docker exec -i poise-gateway node dist/diagnostics/cli.js ingress-stream"
```

The command path/container must match the actual installation. Restrict the key
to the edge source address with `from="ADDRESS",` where that address is stable.
Do not reuse a login/deployment key. The account already owns Docker; this key
must not grant a shell, forwarding, PTY or arbitrary Docker commands.

Obtain the gateway host key over an already verified administrative connection;
put it into `/etc/poise-ingress/known_hosts`. The reader refuses unknown/changed
keys, SSH-agent identities and user SSH configuration. Write mode-0600
`/etc/poise-ingress/config.json` using the actual installation values:

```json
{
  "domain": "poise.example.org",
  "container": "external-caddy",
  "target": "poise@gateway-host",
  "identity": "/etc/poise-ingress/id_ed25519",
  "known_hosts": "/etc/poise-ingress/known_hosts"
}
```

Install this directory's `reporter.py` into `/opt/poise-ingress/reporter.py` and
`poise-ingress.service` into `/etc/systemd/system/`. Run a bounded initial proof:

```sh
python3 /opt/poise-ingress/reporter.py --config /etc/poise-ingress/config.json --once
systemctl daemon-reload
systemctl enable --now poise-ingress.service
```

Inspect `external-ingress` in the gateway operator `health` output or Logging's
Data control: `currentStatus` must be connected and `observationExpiresAt` must
advance. `status: partial` may retain earlier gaps; inspect those separately.
Verify an actual retained Poise proxy diagnostic using operator `query`/`event`.
Use journal output for collector failures; never dump raw shared proxy logs.
Stopping/removing the unit and its one public-key line revokes this integration.
