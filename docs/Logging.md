# Diagnostic data contract

The shared diagnostic primitives live in `gateway/src/diagnostics/`. They use
Node and Poise's existing SQLite dependency. `normalize` produces immutable
version 1 records; `DiagnosticStore` owns bounded persistence and authorized
queries; `DiagnosticRuntime` owns buffering and independent collection health.

## Events and identity

Each record has an event ID, incident ID, source event time (null when unknown),
ingestion time, normalized severity, original source level, component, operation,
phase, target and available workspace/container/release/account/repository/PR/
behavior/reviewer/call/request/correlation identity. Absent facts remain null.
Cause chains, stderr, stacks, process outcomes and resource observations are
bounded. A multiline exception is one occurrence. Incident identity includes
the workspace, access scope, operation, target and cause. Event IDs carry a
scope digest, preventing another workspace from claiming an existing event.
Event identity is independent of source/ingestion time and container replacement.
Duplicate delivery is idempotent; expired IDs cannot resurrect pruned evidence; contradictory content for an existing ID is
reported rather than overwriting evidence.

Fatal, Critical, Crit, Emerg, Alert and Panic map to Critical; Error and Err to
Error; Warning and Warn to Warning. Syslog priorities 0–2, 3 and 4 map to those
same three levels. Notice, Info, Debug and Trace (priorities 5–7) produce no
Logging event. Unknown levels or invalid source timestamps produce visible
collection warnings with the original source identity. Notification colors and
successful change-request reviews do not determine technical severity.

Credentials, encoded Git authentication, authorization/cookie headers and
credential-bearing URLs are redacted before persistence. Context excludes
prompts, content, responses, stdout, arguments, environment and conversation
fields recursively. Strings and nested context are bounded; truncation is
explicit. The source adapters select Caller metadata without reading prompt or
response fields, and preserve its exact process evidence when available.

## Retention and queries

Defaults are **up to 30 days**, **64 MiB of accounted event storage**, and **50,000 events**;
the earliest bound reached expires evidence. Age and eviction use ingestion time,
so an untrusted future source timestamp cannot pin a record. Accounting includes the searchable
projection and an index allowance. Expiry tombstones retain only ID and scope
for up to one further retention period, capped at twice the event count limit.
Unknown and inaccessible IDs share one response; expiry is reported only from
an authorized tombstone. SQLite's page budget, cache and
journal are also bounded. Records remain after a source or container disappears.
Source coverage and its unavailable intervals are separate from event counts.
The collection runtime has a separate coverage journal and in-memory health
path, so a broken event sink does not turn failed reads into an empty result.

Queries accept Critical/Error/Warning selections, time, source, component,
workspace, account, repository, call/correlation/incident IDs and redacted text.
Counts name events; occurrence counts name retained records in the incident.
Pages contain at most 100 records, newest first, with stable identity ordering.
AES-GCM encrypted cursors bind authorization, filters and an ingestion boundary,
without exposing the shared ingestion sequence. A scoped watermark supports
`after` queries for later ingestions, including backdated source events. Later
arrivals cannot displace the remaining pages. Event lookup distinguishes found,
outside retention, and unavailable evidence without exposing other workspaces.

A trusted server supplies `LogAccess`: an ordinary workspace scope cannot be
widened by a query, event ID or cursor. Operator scope is an explicit server
authorization for infrastructure events. It never widens access to another
workspace's application or Caller records. A safely attributable infrastructure
event can be read by its workspace owner and the operator; unassigned host
evidence is operator-only. Shared coverage hides operator-only cause details from ordinary
workspace queries. Collection buffers default to at most 1,000 events or 2 MiB;
sink failures and drops remain visible while active work continues. Invalid input,
query validation, coverage-journal and reporting failures remain distinct from sink
outages. Shutdown drains queued batches within two seconds, then records any loss.
Coverage preserves prior drops and open outage intervals across restart.

## Collection and operation

The application starts a dedicated `logging.db` beside `POISE_DB` (otherwise
`~/.poise/logging.db`). This is independent of alerts, dismissal and recovery.
An adjacent private journal retains collection gaps and loss across restart.
The bounded Caller completion stream is polled every 15 seconds without
opening prompts or response/reasoning artifacts. Process capture excludes argv,
stdout and environments; credential commands also exclude stderr. Sync phases,
input admission limits, model-discovery outcomes, lock acquisition failures and
temporary-filesystem pressure retain measurements known at the source.

The gateway retains its separate central `logging.db` in `poise-gateway-data`.
Existing volume backup/restore snapshots it with the other SQLite databases.
Gateway warnings/errors are redacted before Docker stdout and retained directly.
Every 15 seconds the independent collector reads bounded Docker logs/lifecycle
windows for managed workspaces, Poise Compose services and release-install
tasks. Only validated structured workspace envelopes enter private history;
unstructured output is excluded and its coverage limitation is explicit.
Docker OOM, nonzero exit and unhealthy events use native lifecycle meanings.
Workspace backfill reads three durable events per authenticated maintenance
page and commits its checkpoint only with central persistence. Replacement or
removal of the source does not delete central records. Query/collection outages
never become empty successful reads.

The gateway reads native host kernel and `docker.service` Warning-or-higher
journal records using `journalctl`, with a durable native cursor. Compose mounts
only the journal directories and machine ID read-only; workspaces receive no
journal, Docker socket or central-store mount. Missing journals, insufficient
permissions, unavailable Docker, incompatible old workspaces and excluded
unstructured logs remain explicit source coverage gaps. The first observation
is not a claim of complete history before installation. Polling bounds can
limit historical replay; Docker's own retained native event history is finite.

When a workspace cannot open, the host operator can investigate with:

```sh
docker exec poise-gateway node dist/diagnostics/cli.js health
docker exec poise-gateway node dist/diagnostics/cli.js query '{"severities":["error","critical"]}'
docker exec poise-gateway node dist/diagnostics/cli.js event EVENT_ID
docker exec poise-gateway node dist/diagnostics/cli.js export '{"limit":100}'
```

Export is paged NDJSON with metadata, bounds and a continuation cursor. It
includes infrastructure/operator records, never another owner's private Caller
or application history. External proxy installations may send one native JSON
record through `docker exec -i poise-gateway node dist/diagnostics/cli.js ingress`.
The command requires a request host inside `POISE_DOMAIN`, bounds input to
64 KiB, excludes headers/query/payload context and acknowledges the event ID
only after persistence. The operator owns delivery/retry and must not forward
unrelated business-service logs. No public or workspace ingestion endpoint is
added. Unconfigured external ingress coverage remains unknown, not healthy.

Production starts capture after secure environment validation and before the
application database modules load. An uncaught process failure retains a
Critical event and then exits with the existing failure status. Structured
stderr forwarding is capped by backpressure; local durable backfill remains
independent. Source records beyond Docker/window or native-line bounds produce
explicit historical gaps and do not pin later collection behind poison input.

Incident identity hashes the full redacted material cause, independently of the
short displayed summary and changing attempt/release/resource context. Native
journal collection uses `--all` with a bounded field projection and `--no-tail`,
so journalctl's default 4 KiB null substitution and ten-record follow tail do
not silently discard replayable evidence. See the upstream
[journalctl contract](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html).

Operators configure `POISE_LOG_RETENTION_DAYS` (1–365), `POISE_LOG_MAX_BYTES`
(4 KiB–1 GiB), `POISE_LOG_MAX_EVENTS` (1–1,000,000),
`POISE_LOG_QUEUE_EVENTS` (1–10,000) and `POISE_LOG_QUEUE_BYTES`
(64 KiB–16 MiB). Defaults are 30 days / 64 MiB / 50,000 retained events and
1,000 events / 2 MiB queued. The first reached bound applies. Invalid values
name the configuration error at startup. These settings govern the central
store and, when supplied to a local application, its separate store.

The operator health command reads the independent coverage journal even when
SQLite is unavailable. Query/detail/export open the existing store read-only;
a missing store is an explicit error. Local development reports Docker, kernel
and ingress as not configured. External proxy record delivery remains partial
coverage unless a continuous observation boundary is established; a received
record does not prove complete proxy history.

Native container faults retain a bounded post-event inspection of actual
memory/CPU/PID limits and Docker's OOM state when available. The measurement is
labeled as post-event container state; it never substitutes a later usage
reading for usage at the incident. Removed containers or an exhausted inspection
budget leave explicit unavailable resource evidence. Exit 137 alone does not
establish an OOM cause.
