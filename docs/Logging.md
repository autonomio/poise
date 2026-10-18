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
Duplicate delivery is idempotent; contradictory content for an existing ID is
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

Defaults are **up to 30 days**, **64 MiB of event payloads**, and **50,000 events**;
the earliest bound reached expires evidence. SQLite's page budget, cache and
journal are also bounded. Records remain after a source or container disappears.
Source coverage and its unavailable intervals are separate from event counts.
The collection runtime has a separate coverage journal and in-memory health
path, so a broken event sink does not turn failed reads into an empty result.

Queries accept Critical/Error/Warning selections, time, source, component,
workspace, account, repository, call/correlation/incident IDs and redacted text.
Counts name events; occurrence counts name retained records in the incident.
Pages contain at most 100 records, newest first, with stable identity ordering.
A cursor binds authorization, filters and an ingestion boundary, so later
arrivals cannot displace the remaining pages. Event lookup distinguishes found,
outside retention, and unavailable evidence without exposing other workspaces.

A trusted server supplies `LogAccess`: an ordinary workspace scope cannot be
widened by a query, event ID or cursor. Operator scope is an explicit server
authorization. Shared coverage hides operator-only cause details from ordinary
workspace queries. Collection buffers default to at most 1,000 events or 2 MiB;
sink failures and drops remain visible while active work continues.
