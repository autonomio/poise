# Poise MCP work trail

The gateway exposes a stateless Streamable HTTP endpoint at the installation's
HTTPS apex `/mcp` only when `POISE_MCP_ENABLED=1`. The default is disabled,
including discovery and grant pages. Production activation requires a recorded
clean Codex desktop install and OAuth sign-in against staging, followed by a
delayed issue and a completed chain traced through the staged plugin. Keep the
production variable unset until that evidence is recorded on #979.

New workspace containers receive `POISE_WORKSPACE_OWNER_ID` from the gateway's
verified owner record. Older containers without that immutable binding reject
MCP assertions while retaining their ordinary browser/Link behavior. Before
testing an existing staging workspace, replace it through the normal drained
container lifecycle so it receives this binding; enabling MCP alone does not
force replacement or change existing work.

Build an installation-specific private plugin locally:

```bash
node scripts/build-poise-plugin.mjs https://poise.example.com /tmp/poise-private-plugin
```

The output contains the supported Codex compatibility manifest
`.codex-plugin/plugin.json`, `.mcp.json` and `skills/poise-manager/SKILL.md`.
It contains the installation URL and no credentials. Install that folder through
the desktop's private/local plugin source. This build does not publish or install
anything. The format follows [OpenAI's plugin packaging documentation](https://developers.openai.com/plugins/build/plugins).

The protected-resource document is
`/.well-known/oauth-protected-resource/mcp`; the authorization-server document
is `/.well-known/oauth-authorization-server`. Public clients register exact
redirect URIs at `/mcp/register` (HTTPS, or HTTP loopback for desktop clients),
then use authorization code with S256 PKCE and resource equal to the exact
apex `/mcp` URL. The only scope is `poise:read`. Existing GitHub-backed Poise
sign-in leads to explicit consent naming the client, redirect and owner's
workspace. Another owner's workspace cannot be selected. Consent requires the
live owner's session, exact Origin and CSRF proof.

Access tokens last ten minutes. Refresh grants last thirty days and rotate
on use; reusing an old refresh token fails. Only token hashes persist in
gateway-data `mcp.db`, included in the existing data-volume backup. Authorization
codes last sixty seconds, are single-use and do not survive gateway restart.
Registered clients expire after thirty days; registration is capped at 256,
and retained grants at 100 per owner. The apex home links to **Connected agents**
(`/mcp/grants`), where the owner can inspect and revoke grants. Revocation,
disablement or access removal rejects subsequent reads and refreshes, including
results still in flight. Admin access does not grant another owner's content.

The endpoint implements initialize, ping, tools/list, tools/call and initialization
or cancellation notifications. It needs no session ID or server event stream;
GET returns 405. It advertises protocol 2025-11-25, 2025-06-18 and 2025-03-26.
Requests are capped at 16 KiB, workspace replies at 128 KiB, and reads at two
in flight and sixty per minute per grant. A workspace read has a 35-second
deadline. Public tokens, cookies and client identity headers are replaced by
the dedicated sixty-second Ed25519 MCP assertion on the private workspace hop.

`poise_describe` reports workspace, release (null on a development build), grant,
the two allowed tools, sources, source retention and supported links.
`poise_work` accepts either `{repository, issue}` or
`{repository, label, limit?, cursor?}`. Pages contain at most ten open labelled
issues, including third-party issues with no account involvement, chain or Call.
The datastore repo/label/keyset selectors read at most limit+1 issues. Each row
joins one exact chain and at most three ledger records; no intake, Current
involvement query, open-PR inventory or live GitHub fan-out runs. Chain summaries
retain at most five invocations. Existing chain status policy projects the
current-head checks and queue. Reads do not admit, launch or alter work.

Cursors preserve datastore repository case and issue-number order, survive
gateway restart and are signed over owner, workspace, resource, grant and query
(including page size). Reuse the same query. A cursor is a continuation rather
than a snapshot: changed labels can enter or leave subsequent pages, and restarting
the query is necessary to observe earlier keys again.

Every row reports source coverage and observation time. GitHub mirror health
uses the existing 120-second gate; stale mirrors remain distinct from missing
Caller/ledger evidence. Ledger gaps, retention and truncated evidence are partial;
an unavailable source remains unavailable. Missing records under incomplete
coverage leave the stage unknown. A delayed chain retains its wait or hold
reason; an uncertain invocation retains its missing receipt. A GitHub merge SHA
does not establish Poise review: the canonical pending/complete/not-recorded
status is returned separately. The tool returns retained native evidence and
supported issue, chain, Call, PR, checks, review, queue and merge links.

`tests/mcp-work.test.ts` guards the adapter, bounded selectors and workspace
assertions. `gateway/tests/mcp.test.ts` guards OAuth and live grant enforcement.
The Deployment end-to-end job exercises discovery, OAuth, initialize and both
tools using the MCP SDK client against the disposable gateway and actual
workspace containers. That fixture evidence does not establish desktop installation
or production activation.
