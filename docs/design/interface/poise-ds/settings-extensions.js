// Settings → Extensions: the MCP servers chats can use. Installed servers by
// workspace, each switch saving itself, with each server's details; the
// directory, with Poise's built-in servers first; and a server of your own,
// with exactly what each agent receives. Built from settings.js's parts.
(() => {
  const { $, $$, params, esc, clock } = window.PoiseShell;
  const S = window.PoiseSettings;
  const { define, kept, save, lstat, arm, stateHTML, rowEl, hydrate } = S;
  const SECRET = '‹secret›';
  const AGENTS = [['claude', 'Claude Code'], ['codex', 'Codex'], ['muse', 'Muse'], ['grok', 'Grok Build']];

  // Workspaces are the repositories chats work in; chats without one share
  // Poise · local. New workspaces is the switch for ones chats have not used yet.
  const SPACES = [['local', 'Poise · local'], ['autonomio/poise', 'autonomio/poise'], ['Acme/Limen', 'Acme/Limen'], ['new', 'New workspaces']];
  const on = (...ks) => Object.fromEntries(SPACES.map(([k]) => [k, ks.includes(k)]));
  const GH_TOOLS = ['create_issue', 'get_issue', 'list_issues', 'create_pull_request', 'get_pull_request', 'get_pull_request_diff', 'list_pull_requests', 'search_code', 'get_file_contents', 'list_workflow_runs'];
  const FS_TOOLS = ['read_text_file', 'read_multiple_files', 'write_file', 'edit_file', 'create_directory', 'list_directory', 'directory_tree', 'move_file', 'search_files', 'get_file_info', 'list_allowed_directories'];
  const LN_TOOLS = ['list_issues', 'get_issue', 'create_issue', 'update_issue', 'create_comment', 'list_projects', 'list_cycles'];
  // A saved list from an earlier shape of this page is set aside, not misread.
  const SERVERS = kept.extensions?.every?.((x) => x.transport) ? kept.extensions : [
    { id: 'github', title: 'GitHub', name: 'github', source: 'directory', pub: 'GitHub', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', auth: 'token', tokenSet: true, state: 'ok', tools: 41, names: GH_TOOLS, at: '19:12', on: on('local', 'autonomio/poise', 'Acme/Limen', 'new') },
    { id: 'rdc', title: 'Remote Desktop Commander', name: 'remote-desktop-commander', source: 'builtin', pub: 'Desktop Commander', transport: 'http', url: 'https://mcp.desktopcommander.app/mcp', auth: 'oauth', signedIn: false, state: 'signin', tools: 0, names: [], at: '18:10', on: on('local') },
    { id: 'linear', title: 'Linear', name: 'linear', source: 'directory', pub: 'Linear', transport: 'http', url: 'https://mcp.linear.app/mcp', auth: 'oauth', signedIn: true, state: 'ok', tools: 23, names: LN_TOOLS, at: '18:40', on: on('local', 'autonomio/poise') },
    { id: 'files', title: 'Filesystem', name: 'filesystem', source: 'directory', pub: 'Model Context Protocol', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'], env: [], state: 'ok', tools: 11, names: FS_TOOLS, at: '17:05', on: on('local') },
    { id: 'sentry', title: 'Sentry', name: 'sentry', source: 'custom', transport: 'sse', url: 'https://mcp.sentry.dev/sse', auth: 'token', tokenSet: true, state: 'failed', error: 'The server answered 502 Bad Gateway.', tools: 0, names: [], at: '19:30', on: on('autonomio/poise') }
  ];
  const ui = { open: null, tab: 'overview', busy: {}, query: '', kind: 'any', setup: null, setupOpt: 0, agent: 'claude', form: null };
  const persist = () => save('extensions', SERVERS.filter((x) => !x.gone));
  const find = (b) => SERVERS.find((x) => x.id === b.closest('[data-x]')?.dataset.x);
  const nameFrom = (s) => String(s || 'server').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'server';
  const uniqueName = (n) => (SERVERS.some((x) => x.name === n && !x.gone) ? `${n}-${[2, 3, 4, 5, 6].find((i) => !SERVERS.some((x) => x.name === `${n}-${i}` && !x.gone))}` : n);
  const connection = (x) => (x.transport === 'stdio' ? `Local · <span class="t-mono">${esc([x.command, ...(x.args || [])].join(' '))}</span>` : `Remote · ${x.transport === 'sse' ? 'SSE' : 'Streamable HTTP'}${x.auth === 'oauth' ? ' · OAuth' : ''}`);
  const sourceWord = (x) => (x.source === 'builtin' ? 'Built in' : x.source === 'directory' ? 'From the directory' : 'Custom');
  // Which agents take a server of this transport: Codex and Muse take Streamable HTTP, not SSE.
  const reaches = (t) => AGENTS.map(([k, l]) => (t === 'sse' && (k === 'codex' || k === 'muse') ? { k, l, ok: false, why: `${l} takes Streamable HTTP, not SSE` } : { k, l, ok: true }));
  const where = (x) => SPACES.filter(([k]) => x.on[k]).map(([, l]) => l).join(', ') || 'no workspace';

  // ---------- Installed ----------
  const statusHTML = (x) => {
    if (ui.busy[x.id]) return stateHTML('running', ui.busy[x.id]);
    if (x.state === 'ok') return `<span class="fnote">Connected · ${x.tools} tools · checked ${esc(x.at)}</span>`;
    if (x.state === 'signin') return stateHTML('needs-you', 'sign in to use it');
    return stateHTML('failed', esc(x.error));
  };
  const cellHTML = (x, [k, l]) => `<button class="xcell" aria-pressed="${!!x.on[k]}" aria-label="${esc(x.title)} in ${esc(l)}" data-act="x-cell" data-space="${esc(k)}" data-ref="set.ext.cell"><span class="switch"></span></button>`;
  const lock = (f) => (f.secret ? `<span class="fnote">${f.set ? 'Saved' : 'Missing'} · secret</span>` : `<span class="t-mono">${esc(f.value)}</span>`);
  function overviewHTML(x, off) {
    const facts = x.transport === 'stdio'
      ? [['Command', `<span class="t-mono">${esc([x.command, ...(x.args || [])].join(' '))}</span>`], ['Runs in', 'Each chat’s checkout'], ...(x.env || []).map((f) => [esc(f.name), lock(f)])]
      : [['URL', `<span class="t-mono">${esc(x.url)}</span>`], ['Transport', x.transport === 'sse' ? 'SSE' : 'Streamable HTTP'], ...(x.auth === 'token' ? [['Authorization', `<span class="fnote">Bearer token · ${x.tokenSet ? 'Saved' : 'Missing'} · secret</span>`]] : []), ...(x.headers || []).map((f) => [esc(f.name), lock(f)]), ...(x.auth === 'oauth' ? [['Sign-in', x.signedIn ? 'Signed in' : 'Not signed in']] : [])];
    const sign = x.auth === 'oauth' ? `<span class="cline">${x.signedIn ? `<button class="btn-ghost" data-act="x-signout" data-ref="set.ext.signout"${off}>Sign out</button>` : ''}<button class="btn-ghost${x.signedIn ? '' : ' is-primary'}" data-act="x-signin" data-ref="set.ext.signin"${off}>${x.signedIn ? 'Sign in again' : 'Sign in'}</button></span>` : '';
    const rdc = x.id === 'rdc' ? '<p class="fnote" data-ref="set.ext.rdc">Pair each computer first: on it, run <span class="t-mono">npx @wonderwhy-er/desktop-commander@latest remote</span> and confirm the code it shows, then sign in here with the same account. Your computers are managed and revoked on <a class="lnk" href="https://mcp.desktopcommander.app" target="_blank" rel="noopener">its dashboard</a>, not in Poise.</p>' : '';
    return `${sign}${rdc}
      <div class="kvs" data-ref="set.ext.facts">${facts.map(([k, v]) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`).join('')}</div>
      <p class="t-micro">Reaches</p><span class="cline" data-ref="set.ext.reach">${reaches(x.transport).map((r) => `<span class="chip is-outline${r.ok ? '' : ' is-off'}" title="${esc(r.ok ? `Delivered to ${r.l} chats` : r.why)}">${esc(r.l)}${r.ok ? '' : ' · not sent'}</span>`).join('')}</span>
      <p class="fnote">On in ${esc(where(x))}. Change it in the grid.${x.source !== 'custom' ? ` ${sourceWord(x)}, published by ${esc(x.pub)}.` : ''}</p>
      <span class="cline"><button class="btn-ghost" data-act="x-edit" data-ref="set.ext.edit"${off}>Edit</button><button class="btn-ghost" data-act="x-check" data-ref="set.ext.check"${off}>Check now</button><span class="fnote">Connects the way an agent would and lists its tools.</span></span>`;
  }
  function detailsHTML(x, off) {
    const tabs = `<div class="seg" role="group" aria-label="${esc(x.title)}: what to show" data-ref="set.ext.tab">${[['overview', 'Overview'], ['tools', 'Tools'], ['activity', 'Activity']].map(([v, l]) => `<button aria-pressed="${ui.tab === v}" data-act="x-tab" data-v="${v}">${l}</button>`).join('')}</div>`;
    const body = ui.tab === 'tools'
      ? (x.names?.length ? `<ul class="xact" data-ref="set.ext.tools">${x.names.map((n) => `<li><span class="t-mono">mcp__${esc(x.name)}__${esc(n)}</span></li>`).join('')}${x.tools > x.names.length ? `<li class="fnote">and ${x.tools - x.names.length} more, from the check at ${esc(x.at)}</li>` : ''}</ul>` : '<p class="fnote" data-ref="set.ext.tools">Tools appear after a successful check.</p>')
      : ui.tab === 'activity'
        ? `<ul class="xact" data-ref="set.ext.activity">${activity(x).map(([t, e]) => `<li><span class="t-mono">${esc(t)}</span> ${esc(e)}</li>`).join('')}</ul><p class="fnote">The last 100 events: added, edited, checked, signed in, and delivered to which chat.</p>`
        : overviewHTML(x, off);
    return `<div class="xdetails">${tabs}${body}</div>`;
  }
  const activity = (x) => (x.state === 'failed'
    ? [[x.at, `Check failed: ${x.error}`], ['19:02', 'Not delivered to #475: Muse takes local commands and Streamable HTTP servers, not SSE'], ['18:40', 'Delivered to #479 on its next turn'], ['14:02', 'Switched on in autonomio/poise']]
    : x.state === 'signin' ? [[x.at, 'Checked: needs a sign-in'], [x.at, `Added ${x.source === 'builtin' ? 'from the directory, built in' : 'from the directory'}`]]
      : [[x.at, `Checked: ${x.tools} tools`], ['18:55', 'Delivered to #475 on its next turn'], ['14:02', 'Switched on in autonomio/poise']]);
  function serverHTML(x) {
    if (x.gone) return `<div class="xrow is-gone" data-x="${x.id}" data-ref="set.ext.row"><span class="xname"><b>${esc(x.title)}</b></span><span class="fnote">Removed ${esc(x.gone)} · its secrets and Activity went with it</span></div>`;
    const why = ui.busy[x.id] ? `${x.title} is busy: ${ui.busy[x.id]}` : '';
    const off = why ? ` aria-disabled="true" data-why="${esc(why)}"` : '';
    const acts = `${x.state === 'signin' ? `<button class="btn-ghost" data-act="x-signin" data-ref="set.ext.signin"${off}>Sign in</button>` : ''}<button class="lnk" data-act="x-open" aria-expanded="${ui.open === x.id}" data-ref="set.ext.details">${ui.open === x.id ? 'Close' : 'Details'}</button><button class="ib" data-act="x-remove" aria-label="Remove ${esc(x.title)}" data-ref="set.ext.remove"${off}><i data-i="cross" class="sm"></i></button>`;
    return `<div class="xrow${ui.open === x.id ? ' is-open' : ''}" data-x="${x.id}" data-ref="set.ext.row" data-now="${esc(`${x.title}: ${x.state === 'ok' ? `connected, ${x.tools} tools` : x.state === 'signin' ? 'needs a sign-in' : `failed: ${x.error}`}. On in ${where(x)}.`)}"><span class="xname"><b>${esc(x.title)}${x.source === 'builtin' ? ' <span class="chip is-outline" data-ref="set.ext.builtin">Built in</span>' : ''}</b><span class="fsub">${connection(x)}</span><span class="xstat">${statusHTML(x)}</span></span>${SPACES.map((sp) => cellHTML(x, sp)).join('')}<span class="xacts">${acts}</span>${ui.open === x.id ? detailsHTML(x, off) : ''}</div>`;
  }
  const gridHTML = () => `<div class="xgrid" aria-label="Servers by workspace"><div class="xrow xhead" aria-hidden="true"><span>Server, and its last check</span>${SPACES.map(([k, l]) => `<span class="${k === 'new' ? '' : 't-mono'}" data-ref="${k === 'new' ? 'set.ext.new' : 'set.ext.space'}">${esc(l)}</span>`).join('')}<span></span></div>${SERVERS.map(serverHTML).join('')}</div>`;
  const repaint = () => { const el = $('[data-xgrid]', rowEl('ext.installed')); if (el) { el.innerHTML = gridHTML(); hydrate(el); } };
  const done = (x, words) => lstat(installed, `${stateHTML(x.state === 'ok' ? 'done' : x.state === 'signin' ? 'needs-you' : 'failed', clock())} <span class="fnote">${esc(x.title)}: ${words}</span>`);

  const installed = {
    key: 'ext.installed', ref: 'set.ext.installed', group: 'Installed', label: 'Servers by workspace', type: 'custom', wide: true,
    gloss: 'Each switch turns a server on or off for one workspace’s chats: the twelve most recently used, Poise · local, and New workspaces. A change applies from each chat’s next turn; a turn already running keeps the tools it started with.',
    findText: () => `${SERVERS.map((x) => x.title).join(' ')} mcp extension server workspace`,
    // ?ext=none: nothing added yet.
    control: () => (params.get('ext') === 'none'
      ? '<div class="fnote"><p>No extensions yet. Chats get the MCP servers you add here, in the workspaces you choose.</p><span class="cline"><button class="btn-ghost" data-act="x-to" data-to="ext.directory">Browse the directory</button><button class="btn-ghost" data-act="x-to" data-to="ext.custom">Add a custom server</button></span></div>'
      : `<div data-xgrid>${gridHTML()}</div>`),
    act: (act, b) => {
      if (act === 'x-to') { rowEl(b.dataset.to)?.scrollIntoView({ block: 'center' }); return; }
      const x = find(b);
      if (!x) return;
      if (act === 'x-cell') {
        const k = b.dataset.space, label = SPACES.find((s) => s[0] === k)[1];
        x.on[k] = !x.on[k];
        persist();
        repaint();
        $(`[data-x="${x.id}"] [data-space="${CSS.escape(k)}"]`)?.focus();
        lstat(installed, `<span class="sdot is-saved"></span>${esc(x.title)} ${x.on[k] ? 'on' : 'off'} in ${esc(label)} ${clock()} · from each chat’s next turn${k === 'new' ? '; workspaces already shown keep theirs' : ''}`);
      }
      if (act === 'x-open') { ui.open = ui.open === x.id ? null : x.id; ui.tab = 'overview'; repaint(); $(`[data-x="${x.id}"] [data-act="x-open"]`)?.focus(); }
      if (act === 'x-tab') { ui.tab = b.dataset.v; repaint(); $(`[data-x="${x.id}"] [data-act="x-tab"][data-v="${ui.tab}"]`)?.focus(); }
      if (act === 'x-edit') { ui.form = formFrom(x); S.rerow('ext.custom'); rowEl('ext.custom')?.scrollIntoView({ block: 'center' }); $('[data-f="title"]', rowEl('ext.custom'))?.focus(); }
      if (act === 'x-signout') {
        Object.assign(x, { signedIn: false, state: 'signin' });
        persist();
        repaint();
        done(x, 'signed out; chats lose its tools from their next turn until you sign in again');
      }
      if (act === 'x-check' || act === 'x-signin') {
        ui.busy[x.id] = act === 'x-check' ? 'connecting the way an agent would…' : 'waiting for you to sign in, in the window it opened…';
        repaint();
        setTimeout(() => {
          delete ui.busy[x.id];
          if (x.id === 'sentry') x.error = 'The server answered 502 Bad Gateway again.';
          else Object.assign(x, { state: 'ok', tools: x.tools || 14, names: x.names?.length ? x.names : ['list_machines', 'read_file', 'write_file', 'start_process', 'search_code'], at: clock(), ...(x.auth === 'oauth' ? { signedIn: true } : {}) });
          persist();
          repaint();
          done(x, x.state === 'ok' ? `connected, ${x.tools} tools${act === 'x-signin' ? '; chats get it from their next turn' : ''}` : esc(x.error));
        }, act === 'x-check' ? 1800 : 3200);
      }
      if (act === 'x-remove') {
        if (!arm(b)) return;
        ui.busy[x.id] = 'removing…';
        repaint();
        setTimeout(() => { delete ui.busy[x.id]; x.gone = clock(); if (ui.open === x.id) ui.open = null; persist(); repaint(); lstat(installed, `${esc(x.title)} removed ${clock()} · chats lose its tools from their next turn; its secrets and Activity are erased`); }, 1200);
      }
    }
  };

  // ---------- The directory: Poise's copy of the MCP Registry, built-in servers first ----------
  const DIR = [
    { id: 'rdc', title: 'Remote Desktop Commander', pub: 'Desktop Commander', builtin: true, what: 'Files, terminal, search and code tools on your own computers, through a hosted relay. Pair each computer first.', options: [{ kind: 'remote', transport: 'http', summary: 'https://mcp.desktopcommander.app/mcp · OAuth', inputs: [] }] },
    { id: 'github', title: 'GitHub', pub: 'GitHub', what: 'Issues, pull requests, code search and Actions.', options: [{ kind: 'remote', transport: 'http', summary: 'https://api.githubcopilot.com/mcp/', inputs: [{ key: 'token', label: 'Personal access token', secret: true, required: true }] }, { kind: 'package', summary: 'ghcr.io/github/github-mcp-server', inputs: [], unsupported: 'It runs as an OCI image, which Poise cannot launch.' }] },
    { id: 'linear', title: 'Linear', pub: 'Linear', what: 'Issues, projects and cycles.', options: [{ kind: 'remote', transport: 'http', summary: 'https://mcp.linear.app/mcp · OAuth', inputs: [] }] },
    { id: 'brave', title: 'Brave Search', pub: 'Brave', what: 'Web and local search.', options: [{ kind: 'package', summary: 'npx -y @brave/brave-search-mcp-server', inputs: [{ key: 'BRAVE_API_KEY', label: 'BRAVE_API_KEY', secret: true, required: true }] }] },
    { id: 'figma', title: 'Figma', pub: 'Figma', what: 'Frames, components and variables from your files.', options: [{ kind: 'remote', transport: 'http', summary: 'https://mcp.figma.com/mcp · OAuth', inputs: [] }] },
    { id: 'k8s', title: 'Kubernetes', pub: 'Flux159', what: 'Clusters, pods and logs.', options: [{ kind: 'package', summary: 'docker.io/flux159/mcp-server-kubernetes', inputs: [], unsupported: 'It runs as an OCI image, which Poise cannot launch.' }] }
  ];
  const kindsOf = (d) => [...new Set(d.options.map((o) => (o.kind === 'remote' ? 'remote' : 'local')))];
  const runnable = (d) => d.options.some((o) => !o.unsupported);
  const isAdded = (d) => SERVERS.some((x) => x.id === d.id && !x.gone);
  const setupHTML = (d) => {
    const opt = d.options[ui.setupOpt] || d.options[0];
    return `<div class="xsetup" data-ref="set.ext.setup">${d.options.length > 1 ? `<p class="t-micro">How to run it</p><div class="seg" role="group" aria-label="How to run it">${d.options.map((o, i) => `<button aria-pressed="${i === ui.setupOpt}" data-act="d-opt" data-v="${i}"${o.unsupported ? ` aria-disabled="true" data-why="${esc(o.unsupported)}"` : ''} data-ref="set.ext.option">${o.kind === 'remote' ? 'Remote · Streamable HTTP' : 'Local package'}</button>`).join('')}</div>` : ''}
      <p class="fnote"><span class="t-mono">${esc(opt.summary)}</span>${opt.unsupported ? ` · ${esc(opt.unsupported)}` : ''}</p>
      ${opt.inputs.map((i) => `<label class="xfield"><span class="t-micro">${esc(i.label)}${i.required ? '' : ' (optional)'}</span><input class="sinput t-mono" type="${i.secret ? 'password' : 'text'}" autocomplete="off" spellcheck="false" data-dinput="${esc(i.key)}" aria-label="${esc(i.label)}"${i.secret ? ' data-ref="set.ext.secret"' : ''}></label>`).join('')}${opt.inputs.some((i) => i.secret) ? '<p class="fnote">Secrets are stored write-only and kept out of logs, transcripts and this page.</p>' : ''}
      <span class="cline"><button class="btn-ghost is-primary" data-act="d-confirm" data-ref="set.ext.add">Add to Poise</button><button class="lnk" data-act="d-cancel" data-ref="set.cancel">Cancel</button></span></div>`;
  };
  const dirHTML = () => {
    const q = ui.query.toLowerCase();
    const list = DIR.filter((d) => (!q || `${d.title} ${d.pub} ${d.what}`.toLowerCase().includes(q)) && (ui.kind === 'any' || kindsOf(d).includes(ui.kind)));
    if (!list.length) return '<p class="fnone">Nothing in the directory matches. <button class="lnk" data-act="d-custom" data-ref="set.ext.custom">Add it as a custom server</button></p>';
    return `${q ? '' : '<p class="t-micro">Built in first, then well-known servers, then everything</p>'}${list.map((d) => `<div class="frow" data-d="${d.id}" data-ref="set.ext.entry" data-now="${esc(`${d.title}, by ${d.pub}: ${d.what}`)}"><span class="fmain"><span class="name">${esc(d.title)}</span><span class="fsub">${esc(d.pub)} · ${esc(d.what)}</span>${runnable(d) ? '' : `<span class="fsub is-attn">${esc(d.options[0].unsupported)} Add it as a custom server instead.</span>`}</span><span class="fstate">${d.builtin ? '<span class="chip is-outline" data-ref="set.ext.builtin">Built in</span>' : ''}${kindsOf(d).map((k) => `<span class="chip is-outline">${k === 'remote' ? 'Remote' : 'Local'}</span>`).join('')}${d.options.some((o) => o.inputs.some((i) => i.secret)) ? '<span class="chip is-outline">Needs a key</span>' : ''}</span><span class="facts">${isAdded(d) ? '<span class="fnote">Added</span>' : runnable(d) ? `<button class="btn-ghost" data-act="d-add" data-ref="set.ext.add" aria-expanded="${ui.setup === d.id}">Add to Poise</button>` : '<span class="chip is-outline" data-ref="set.ext.customonly">Custom only</span>'}</span>${ui.setup === d.id ? setupHTML(d) : ''}</div>`).join('')}`;
  };
  const redir = () => { const l = $('[data-dlist]', rowEl('ext.directory')); if (l) { l.innerHTML = dirHTML(); hydrate(l); } };
  const directory = {
    key: 'ext.directory', ref: 'set.ext.directory', group: 'Directory', label: 'The directory', type: 'custom', wide: true,
    gloss: 'Poise’s own copy of the MCP Registry, with the servers Poise builds in first. Poise refreshes it in the background once a day; Refresh does it now.',
    findText: () => `${DIR.map((d) => d.title).join(' ')} directory registry`,
    control: () => `<span class="cline"><span class="sfield"><input class="sinput" placeholder="Search servers" aria-label="Search the directory" autocomplete="off" spellcheck="false" value="${esc(ui.query)}" data-dsearch data-ref="set.ext.search"></span><div class="seg" role="group" aria-label="Kind" data-ref="set.ext.kind">${[['any', 'Any'], ['remote', 'Remote'], ['local', 'Local']].map(([v, l]) => `<button aria-pressed="${ui.kind === v}" data-act="d-kind" data-v="${v}">${l}</button>`).join('')}</div><span class="fnote">1,284 servers · refreshed 08:10</span><button class="btn-ghost" data-act="d-refresh" data-ref="set.ext.refresh">Refresh</button></span><div class="flist" data-dlist>${dirHTML()}</div>`,
    onInput: (e) => { if (!e.target.matches('[data-dsearch]')) return !!e.target.closest('[data-dinput]'); ui.query = e.target.value.trim(); redir(); return true; },
    act: (act, b) => {
      const row = rowEl('ext.directory'), d = DIR.find((x) => x.id === b.closest('[data-d]')?.dataset.d);
      if (act === 'd-kind') { ui.kind = b.dataset.v; $$('[data-act="d-kind"]', row).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === ui.kind))); redir(); }
      if (act === 'd-refresh') { const fail = new URLSearchParams(location.search).get('directory') === 'failed'; lstat(directory, stateHTML('running', 'reading the registry; the last complete copy stays meanwhile')); setTimeout(() => lstat(directory, fail ? `${stateHTML('failed', clock())} <span class="fnote">The registry did not answer. The copy from 08:10 stays; Poise tries again in ten minutes, or now with Refresh.</span>` : `${stateHTML('done', clock())} <span class="fnote">1,286 servers, 2 new</span>`), 2400); }
      if (act === 'd-custom') { rowEl('ext.custom')?.scrollIntoView({ block: 'center' }); $('[data-f="title"]', rowEl('ext.custom'))?.focus(); }
      // Add asks only for what the entry declares; an entry with nothing to ask is added at once.
      if (act === 'd-add' && d) {
        if (d.options.length > 1 || d.options[0].inputs.length) { ui.setup = ui.setup === d.id ? null : d.id; ui.setupOpt = Math.max(0, d.options.findIndex((o) => !o.unsupported)); redir(); $(`[data-d="${d.id}"] [data-dinput], [data-d="${d.id}"] [data-act="d-confirm"]`, row)?.focus(); return; }
        addFrom(d, d.options[0], {});
      }
      if (act === 'd-opt' && d) { ui.setupOpt = +b.dataset.v; redir(); }
      if (act === 'd-cancel') { ui.setup = null; redir(); }
      if (act === 'd-confirm' && d) {
        const opt = d.options[ui.setupOpt], values = Object.fromEntries($$(`[data-d="${d.id}"] [data-dinput]`, row).map((i) => [i.dataset.dinput, i.value.trim()]));
        const missing = opt.inputs.find((i) => i.required && !values[i.key]);
        if (missing) { $(`[data-d="${d.id}"] [data-dinput="${CSS.escape(missing.key)}"]`, row)?.focus(); lstat(directory, `<span class="is-err">Not added: ${esc(d.title)} needs its ${esc(missing.label)}.</span>`); return; }
        addFrom(d, opt, values);
      }
    }
  };
  function addFrom(d, opt, values) {
    const remote = opt.kind === 'remote', oauth = /OAuth/.test(opt.summary);
    const x = { id: d.id, title: d.title, name: uniqueName(nameFrom(d.title)), source: d.builtin ? 'builtin' : 'directory', pub: d.pub, transport: remote ? 'http' : 'stdio', ...(remote ? { url: opt.summary.split(' ')[0], auth: oauth ? 'oauth' : opt.inputs.length ? 'token' : 'none', tokenSet: !!values.token, signedIn: false } : { command: 'npx', args: opt.summary.split(' ').slice(1), env: opt.inputs.map((i) => ({ name: i.key, value: '', secret: !!i.secret, set: !!values[i.key] })) }), state: oauth ? 'signin' : 'ok', tools: oauth ? 0 : 9, names: oauth ? [] : ['search', 'fetch', 'list'], at: clock(), on: on('local') };
    SERVERS.push(x);
    ui.setup = null;
    persist();
    repaint();
    redir();
    lstat(directory, `<span class="sdot is-saved"></span>Added ${esc(d.title)} ${clock()} · on in Poise · local${oauth ? '; sign in from its row above' : '; switch it on for other workspaces above'}`);
  }

  // ---------- A server of your own ----------
  const blank = () => ({ mode: 'add', id: null, kind: 'remote', title: '', url: '', transport: 'http', auth: 'none', token: '', tokenSet: false, headers: [{ name: '', value: '', secret: false }], command: '', args: [''], env: [], on: on('local'), json: '', imported: null, error: '' });
  const formFrom = (x) => ({ ...blank(), mode: 'edit', id: x.id, name: x.name, locked: x.source !== 'custom', kind: x.transport === 'stdio' ? 'local' : 'remote', title: x.title, url: x.url || '', transport: x.transport === 'sse' ? 'sse' : 'http', auth: x.auth || 'none', tokenSet: !!x.tokenSet, headers: (x.headers || []).map((f) => ({ ...f, value: f.secret ? '' : f.value })), command: x.command || '', args: x.args?.length ? [...x.args] : [''], env: (x.env || []).map((f) => ({ ...f, value: f.secret ? '' : f.value })) });
  ui.form = blank();
  // A link from the review opens the part it names: inside a server's details, a directory entry's setup, or a form.
  const want = new URLSearchParams(location.search).get('ref') || '';
  if (/^set\.ext\.(tab|facts|reach|tools|activity|edit|check|signout|rdc)$/.test(want)) { ui.open = { 'set.ext.rdc': 'rdc', 'set.ext.signout': 'linear' }[want] || 'github'; ui.tab = { 'set.ext.tools': 'tools', 'set.ext.activity': 'activity' }[want] || 'overview'; }
  if (/^set\.ext\.(setup|option|secret)$/.test(want)) ui.setup = 'github';
  if (want === 'set.ext.read') ui.form.kind = 'json';
  if (want === 'set.ext.env' || want === 'set.ext.lock') Object.assign(ui.form, { kind: 'local', env: [{ name: 'API_KEY', value: '', secret: true }] });
  if (want === 'set.ext.editing') ui.form = formFrom(SERVERS.find((x) => !x.gone) || SERVERS[0]);
  const looksSecret = (k, v) => /key|token|secret|password|auth/i.test(k) || /^(sk-|ghp_|github_pat_|xox[abp]-)/.test(String(v));
  // The server as an agent receives it, with every secret as ‹secret›.
  function resolved() {
    const f = ui.form;
    if (f.kind === 'json') return (f.imported || []).map((s) => s.server);
    const name = f.mode === 'edit' ? f.name : nameFrom(f.title || (f.kind === 'remote' ? (() => { try { return new URL(f.url).hostname.split('.').slice(-2, -1)[0]; } catch { return ''; } })() : f.command));
    const pairs = (rows) => Object.fromEntries(rows.filter((r) => r.name.trim()).map((r) => [r.name.trim(), r.secret ? SECRET : r.value]));
    if (f.kind === 'local') return [{ name, transport: 'stdio', command: f.command || 'npx', args: f.args.filter((a) => a.trim()), env: pairs(f.env) }];
    const headers = f.auth === 'token' || f.auth === 'oauth' ? { Authorization: `Bearer ${SECRET}` } : f.auth === 'headers' ? pairs(f.headers) : {};
    return [{ name, title: f.title || name, transport: f.transport, url: f.url || 'https://example.com/mcp', headers }];
  }
  const some = (o) => (o && Object.keys(o).length ? o : undefined);
  function shape(agent, servers) {
    const skipped = [];
    const take = (s, label) => { if (s.transport === 'sse') { skipped.push(`${s.title || s.name}: ${label} takes local commands and Streamable HTTP servers, not SSE`); return false; } return true; };
    if (agent === 'claude') return { note: '// Claude Agent SDK: setMcpServers(), over the control channel', value: Object.fromEntries(servers.map((s) => [s.name, s.transport === 'stdio' ? { type: 'stdio', command: s.command, args: s.args, ...(some(s.env) ? { env: s.env } : {}) } : { type: s.transport, url: s.url, ...(some(s.headers) ? { headers: s.headers } : {}) }])), skipped };
    if (agent === 'codex') return { note: '// Codex app-server: thread/start config', value: Object.fromEntries(servers.filter((s) => take(s, 'Codex')).map((s) => [`mcp_servers.${s.name}`, s.transport === 'stdio' ? { command: s.command, args: s.args, ...(some(s.env) ? { env: s.env } : {}), startup_timeout_sec: 60 } : { url: s.url, ...(some(s.headers) ? { http_headers: s.headers } : {}) }])), skipped };
    if (agent === 'muse') return { note: '// Muse: session/start config.mcpServers', value: Object.fromEntries(servers.filter((s) => take(s, 'Muse')).map((s) => [s.name, s.transport === 'stdio' ? { transport: 'stdio', command: s.command, args: s.args, ...(some(s.env) ? { env: s.env } : {}) } : { transport: 'streamableHttp', url: s.url, ...(some(s.headers) ? { headers: s.headers } : {}) }])), skipped };
    const list = (o) => Object.entries(o || {}).map(([name, value]) => ({ name, value }));
    return { note: '// Grok Build (ACP): session/new mcpServers', value: servers.map((s) => (s.transport === 'stdio' ? { name: s.name, command: s.command, args: s.args, env: list(s.env) } : { type: s.transport, name: s.name, url: s.url, headers: list(s.headers) })), skipped };
  }
  function previewHTML() {
    const servers = resolved(), { note, value, skipped } = shape(ui.agent, servers);
    const code = servers.length ? esc(JSON.stringify(value, null, 2)).split(esc(SECRET)).join(`<span class="xsecret">${SECRET}</span>`) : '<span class="xdim">// Fill in the server to see it here.</span>';
    return `<div class="seg" role="group" aria-label="Agent">${AGENTS.map(([k, l]) => `<button aria-pressed="${ui.agent === k}" data-act="c-agent" data-v="${k}">${l}</button>`).join('')}</div><pre class="xcode"><span class="xdim">${esc(note)}</span>\n${code}${skipped.map((s) => `\n<span class="xwarn">// Not sent: ${esc(s)}</span>`).join('')}</pre><p class="fnote">Secrets show as ${SECRET}. Poise fills them in only when it starts the agent, and keeps them out of logs, transcripts and this page.</p>`;
  }
  const pairHTML = (rows, list, locked) => rows.map((r, i) => `<span class="xpair"><input class="sinput t-mono is-short" value="${esc(r.name)}" placeholder="${list === 'env' ? 'NAME' : 'Header-Name'}" aria-label="${list === 'env' ? 'Variable name' : 'Header name'}" autocomplete="off" spellcheck="false" data-f="${list}.${i}.name"${locked ? ' disabled' : ''}><input class="sinput t-mono" type="${r.secret ? 'password' : 'text'}" value="${esc(r.value)}" placeholder="${r.secret && r.set ? 'Saved · type to replace' : 'value'}" aria-label="Value" autocomplete="off" spellcheck="false" data-f="${list}.${i}.value"><button class="btn-ghost" aria-pressed="${r.secret}" data-act="c-lock" data-list="${list}" data-i="${i}" data-ref="set.ext.lock"${locked ? ' aria-disabled="true" data-why="The directory sets which values are secret."' : ''}>${r.secret ? 'Secret' : 'Mark secret'}</button>${locked ? '' : `<button class="ib" aria-label="Remove" data-act="c-unrow" data-list="${list}" data-i="${i}"><i data-i="cross" class="sm"></i></button>`}</span>`).join('');
  function formHTML() {
    const f = ui.form, locked = f.mode === 'edit' && f.locked;
    const kinds = [['remote', 'Remote URL'], ['local', 'Local command'], ...(f.mode === 'add' ? [['json', 'Paste JSON']] : [])];
    const head = `${f.mode === 'edit' ? `<p class="fsub" data-ref="set.ext.editing">Editing <b>${esc(f.title)}</b>. ${locked ? 'The directory sets how it runs: change its name, its values or its secrets.' : 'A change applies from each chat’s next turn.'}</p>` : ''}<div class="seg" role="group" aria-label="Kind of server" data-ref="set.ext.form">${kinds.map(([v, l]) => `<button aria-pressed="${f.kind === v}" data-act="c-form" data-v="${v}"${f.mode === 'edit' && v !== f.kind ? ' aria-disabled="true" data-why="An edit keeps the kind of server."' : ''}>${l}</button>`).join('')}</div>`;
    if (f.kind === 'json') {
      const found = f.imported ? `<ul class="xact">${f.imported.map((s) => `<li><b>${esc(s.server.name)}</b> · ${s.server.transport === 'stdio' ? `Local <span class="t-mono">${esc([s.server.command, ...s.server.args].join(' '))}</span>` : `Remote <span class="t-mono">${esc(s.server.url)}</span>`}${s.secrets.length ? ` · ${esc(s.secrets.join(', '))} stored as secret${s.secrets.length > 1 ? 's' : ''}` : ''}</li>`).join('')}</ul>${useHTML(f)}` : '';
      return `${head}<div class="xform"><label class="xfield"><span class="t-micro">Configuration</span><textarea class="sarea t-mono" rows="6" placeholder="{ &quot;mcpServers&quot;: { &quot;name&quot;: { &quot;command&quot;: &quot;npx&quot;, &quot;args&quot;: [&quot;-y&quot;, &quot;…&quot;] } } }" aria-label="mcpServers JSON" spellcheck="false" data-f="json" data-ref="set.ext.custom.field">${esc(f.json)}</textarea></label><p class="fnote">The mcpServers block from Claude Desktop, Cursor or VS Code. Values whose names or shapes look like keys or tokens are stored as secrets.</p>${found}<span class="cline">${f.imported ? `<button class="btn-ghost is-primary" data-act="c-import" data-ref="set.ext.import">Import ${f.imported.length} server${f.imported.length === 1 ? '' : 's'}</button>` : '<button class="btn-ghost is-primary" data-act="c-read" data-ref="set.ext.read">Read configuration</button>'}<button class="lnk" data-act="c-cancel" data-ref="set.cancel">Cancel</button></span></div><div class="xpreview" data-ref="set.ext.receive" data-xpreview>${previewHTML()}</div>`;
    }
    const remote = f.kind === 'remote';
    const fields = remote
      ? `<label class="xfield"><span class="t-micro">URL</span><input class="sinput t-mono" value="${esc(f.url)}" placeholder="https://mcp.example.com/mcp" aria-label="Server URL" autocomplete="off" spellcheck="false" data-f="url" data-ref="set.ext.custom.field"${locked ? ' disabled' : ''}></label>
        <span class="xfield"><span class="t-micro">Transport</span><div class="seg" role="group" aria-label="Transport" data-ref="set.ext.transport">${[['http', 'Streamable HTTP'], ['sse', 'SSE (legacy)']].map(([v, l]) => `<button aria-pressed="${f.transport === v}" data-act="c-transport" data-v="${v}"${locked ? ' aria-disabled="true" data-why="The directory sets how it runs."' : ''}>${l}</button>`).join('')}</div>${f.transport === 'sse' ? '<span class="fsub is-attn">Codex and Muse chats take Streamable HTTP only; Claude Code and Grok Build chats take SSE too.</span>' : ''}</span>
        <span class="xfield"><span class="t-micro">Authentication</span><div class="seg" role="group" aria-label="Authentication" data-ref="set.ext.auth">${[['none', 'None'], ['oauth', 'OAuth sign-in'], ['token', 'Token'], ['headers', 'Headers']].map(([v, l]) => `<button aria-pressed="${f.auth === v}" data-act="c-auth" data-v="${v}"${locked && v !== f.auth ? ' aria-disabled="true" data-why="The directory sets how it signs in."' : ''}>${l}</button>`).join('')}</div>
        ${f.auth === 'oauth' ? '<span class="fnote">After adding, sign in from the server’s row. Poise registers itself with the server, keeps the sign-in and renews it.</span>' : f.auth === 'token' ? `<input class="sinput t-mono" type="password" value="${esc(f.token)}" placeholder="${f.tokenSet ? 'Saved · type to replace' : 'Bearer token'}" aria-label="Bearer token" autocomplete="off" data-f="token" data-ref="set.ext.secret"><span class="fnote">Sent as <span class="t-mono">Authorization: Bearer …</span>. Stored write-only.</span>` : f.auth === 'headers' ? `${pairHTML(f.headers, 'headers', false)}<button class="lnk" data-act="c-row" data-list="headers">Add header</button>` : ''}</span>`
      : `<label class="xfield"><span class="t-micro">Command</span><input class="sinput t-mono" value="${esc(f.command)}" placeholder="npx" aria-label="Command" autocomplete="off" spellcheck="false" data-f="command" data-ref="set.ext.custom.field"${locked ? ' disabled' : ''}></label>
        <span class="xfield"><span class="t-micro">Arguments</span>${f.args.map((a, i) => `<span class="xpair"><input class="sinput t-mono" value="${esc(a)}" aria-label="Argument ${i + 1}" autocomplete="off" spellcheck="false" data-f="args.${i}"${locked ? ' disabled' : ''}></span>`).join('')}${locked ? '' : '<button class="lnk" data-act="c-arg">Add argument</button>'}</span>
        <span class="xfield" data-ref="set.ext.env"><span class="t-micro">Environment</span>${pairHTML(f.env, 'env', locked)}${locked ? '' : '<button class="lnk" data-act="c-row" data-list="env">Add variable</button>'}<span class="fnote">The server runs in each chat’s checkout. Secret values are stored write-only and kept out of logs and transcripts.</span></span>`;
    return `${head}<div class="xform"><label class="xfield"><span class="t-micro">Name</span><input class="sinput" value="${esc(f.title)}" placeholder="${remote ? 'Ops tools' : 'Orders database'}" aria-label="Name" autocomplete="off" spellcheck="false" data-f="title" data-ref="set.ext.name"><span class="fnote" data-xname>Agents see its tools as <span class="t-mono">mcp__${esc(resolved()[0].name)}__…</span>${f.mode === 'edit' ? '; an edit keeps that name' : ''}.</span></label>${fields}${f.mode === 'add' ? useHTML(f) : ''}${f.error ? `<p class="is-err">${esc(f.error)}</p>` : ''}<span class="cline"><button class="btn-ghost is-primary" data-act="c-save" data-ref="set.ext.custom.add">${f.mode === 'edit' ? 'Save' : 'Add server'}</button><button class="lnk" data-act="c-cancel" data-ref="set.cancel">Cancel</button></span></div><div class="xpreview" data-ref="set.ext.receive" data-xpreview>${previewHTML()}</div>`;
  }
  const useHTML = (f) => `<span class="xfield" data-ref="set.ext.use"><span class="t-micro">${f.imported?.length > 1 ? 'Use them in' : 'Use it in'}</span><span class="cline">${SPACES.map(([k, l]) => `<button class="chip is-outline xpick" aria-pressed="${!!f.on[k]}" data-act="c-ws" data-v="${esc(k)}">${esc(l)}</button>`).join('')}</span></span>`;
  const reform = () => { S.rerow('ext.custom'); };
  const repreview = () => { const el = $('[data-xpreview]', rowEl('ext.custom')); if (el) el.innerHTML = previewHTML(); const n = $('[data-xname] .t-mono', rowEl('ext.custom')); if (n) n.textContent = `mcp__${resolved()[0]?.name || 'server'}__…`; };
  function readJSON(text) {
    let data;
    try { data = JSON.parse(text); } catch { return 'it is not JSON'; }
    const block = data?.mcpServers || data?.servers;
    if (!block || typeof block !== 'object' || !Object.keys(block).length) return 'it has no mcpServers block';
    return Object.entries(block).map(([n, s]) => {
      const secrets = [], hide = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => { const sec = looksSecret(k, v); if (sec) secrets.push(k); return [k, sec ? SECRET : String(v)]; }));
      const server = s.command ? { name: uniqueName(nameFrom(n)), transport: 'stdio', command: s.command, args: s.args || [], env: hide(s.env) } : { name: uniqueName(nameFrom(n)), title: n, transport: s.type === 'sse' ? 'sse' : 'http', url: s.url || '', headers: hide(s.headers) };
      return { server, secrets };
    });
  }
  const custom = {
    key: 'ext.custom', ref: 'set.ext.custom', group: 'Your own', label: 'Add a custom server', type: 'custom', wide: true,
    gloss: 'A server the directory does not list: a remote URL with its authentication, a command Poise runs in each chat’s checkout, or an mcpServers block as Claude Desktop, Cursor or VS Code write it.',
    findText: () => 'custom server url command json mcpServers secret token header oauth environment',
    control: () => formHTML(),
    onInput: (e) => {
      const k = e.target.dataset.f;
      if (!k) return false;
      const f = ui.form, [a, i, part] = k.split('.');
      if (a === 'args') f.args[+i] = e.target.value;
      else if (part) f[a][+i][part] = e.target.value;
      else f[a] = e.target.value;
      if (a === 'json') f.imported = null;
      e.target.removeAttribute('aria-invalid');
      repreview();
      return true;
    },
    act: (act, b) => {
      const f = ui.form;
      if (act === 'c-form') { if (f.mode === 'edit' || f.kind === b.dataset.v) return; ui.form = { ...blank(), kind: b.dataset.v }; reform(); $('[data-f]', rowEl('ext.custom'))?.focus(); }
      if (act === 'c-transport') { f.transport = b.dataset.v; reform(); }
      if (act === 'c-auth') { f.auth = b.dataset.v; reform(); $(`[data-act="c-auth"][data-v="${f.auth}"]`, rowEl('ext.custom'))?.focus(); }
      if (act === 'c-agent') { ui.agent = b.dataset.v; repreview(); $(`[data-act="c-agent"][data-v="${ui.agent}"]`, rowEl('ext.custom'))?.focus(); }
      if (act === 'c-row') { f[b.dataset.list].push({ name: '', value: '', secret: b.dataset.list === 'env' }); reform(); }
      if (act === 'c-arg') { f.args.push(''); reform(); }
      if (act === 'c-unrow') { f[b.dataset.list].splice(+b.dataset.i, 1); reform(); }
      if (act === 'c-lock') { const r = f[b.dataset.list][+b.dataset.i]; r.secret = !r.secret; reform(); }
      if (act === 'c-ws') { f.on[b.dataset.v] = !f.on[b.dataset.v]; b.setAttribute('aria-pressed', String(f.on[b.dataset.v])); }
      if (act === 'c-cancel') { ui.form = blank(); reform(); lstat(custom, ''); }
      if (act === 'c-read') { const r = readJSON(f.json.trim()); if (typeof r === 'string') { lstat(custom, `<span class="is-err">Not read: ${esc(r)}.</span>`); return; } f.imported = r; reform(); }
      if (act === 'c-import') {
        f.imported.forEach(({ server, secrets }) => SERVERS.push({ id: `c${Date.now().toString(36)}${server.name}`, title: server.title || server.name, name: server.name, source: 'custom', transport: server.transport, url: server.url, auth: 'headers', headers: Object.entries(server.headers || {}).map(([name, value]) => ({ name, value: value === SECRET ? '' : value, secret: value === SECRET, set: value === SECRET })), command: server.command, args: server.args, env: Object.entries(server.env || {}).map(([name, value]) => ({ name, value: value === SECRET ? '' : value, secret: value === SECRET, set: value === SECRET })), state: 'ok', tools: 6, names: ['query', 'describe'], at: clock(), on: { ...f.on } }));
        const n = f.imported.length;
        ui.form = blank(); persist(); repaint(); reform();
        lstat(custom, `<span class="sdot is-saved"></span>Imported ${n} server${n === 1 ? '' : 's'} ${clock()} · each checked, on where you chose`);
      }
      if (act === 'c-save') {
        const field = (n) => $(`[data-f="${n}"]`, rowEl('ext.custom'));
        const bad = (n, msg) => { field(n)?.setAttribute('aria-invalid', 'true'); field(n)?.focus(); lstat(custom, `<span class="is-err">Not saved: ${msg}.</span>`); };
        if (f.kind === 'remote' && !/^https?:\/\//.test(f.url.trim())) return bad('url', 'a remote server needs an http or https address');
        if (f.kind === 'local' && !f.command.trim()) return bad('command', 'a local server needs a command');
        if (f.auth === 'token' && !f.token && !f.tokenSet) return bad('token', 'the token is empty');
        const [s] = resolved(), secretRows = (rows, was) => rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), value: r.secret ? '' : r.value, secret: r.secret, set: r.secret && (!!r.value || !!was?.find((w) => w.name === r.name.trim())?.set) }));
        if (f.mode === 'edit') {
          const x = SERVERS.find((y) => y.id === f.id);
          Object.assign(x, { title: f.title.trim() || x.title, ...(f.kind === 'remote' ? { url: f.url.trim(), transport: f.transport, auth: f.auth, tokenSet: f.auth === 'token' && (!!f.token || x.tokenSet), headers: secretRows(f.headers, x.headers) } : { command: f.command.trim(), args: f.args.filter((a) => a.trim()), env: secretRows(f.env, x.env) }) });
          ui.form = blank(); persist(); repaint(); reform();
          lstat(custom, `<span class="sdot is-saved"></span>Saved ${esc(x.title)} ${clock()} · from each chat’s next turn; its tools keep the name mcp__${esc(x.name)}__…`);
          return;
        }
        const x = { id: `c${Date.now().toString(36)}`, title: f.title.trim() || s.name, name: uniqueName(s.name), source: 'custom', transport: f.kind === 'local' ? 'stdio' : f.transport, ...(f.kind === 'remote' ? { url: f.url.trim(), auth: f.auth, tokenSet: f.auth === 'token', signedIn: false, headers: secretRows(f.headers) } : { command: f.command.trim(), args: f.args.filter((a) => a.trim()), env: secretRows(f.env) }), state: f.auth === 'oauth' ? 'signin' : 'ok', tools: f.auth === 'oauth' ? 0 : 6, names: f.auth === 'oauth' ? [] : ['query', 'describe'], at: clock(), on: { ...f.on } };
        SERVERS.push(x);
        ui.form = blank(); persist(); repaint(); reform();
        lstat(custom, `<span class="sdot is-saved"></span>Added ${esc(x.title)} ${clock()} · ${x.state === 'signin' ? 'sign in from its row above' : 'checked: 6 tools'} · on in ${esc(where(x))}`);
      }
    }
  };
  define('extensions', { rows: [installed, directory, custom] });
})();
