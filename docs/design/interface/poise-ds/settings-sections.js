// Settings' other seven sections, built from the parts settings.js shares: the
// row that saves itself, the list whose items say where they stand, × then
// Sure? with Undo, and the seven state words for anything in motion.
(() => {
  const { $, $$, store, params, esc, clock } = window.PoiseShell;
  const S = window.PoiseSettings;
  const { define, kept, save, commit, paintUnder, paintItem, paintExtra, addItem, dropItem, lstat, arm, nid, stateHTML, segHTML, selectHTML, switchHTML, rowEl, hydrate, byKey, GITHUB_NAME } = S;
  const short = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
  const inItem = (s, it) => { const row = rowEl(s.key); return row && $(`[data-item="${CSS.escape(s.id(it))}"]`, row); };
  // A terminal under its row or item: the command, then what it says.
  const termHTML = (lines) => `<div class="term" role="log" aria-label="Terminal">${lines.map((l) => `<span class="${l.cls || ''}">${esc(l.t)}</span>`).join('')}</div><div class="fbtns"><button class="btn-ghost" data-act="term-close" data-ref="set.term.close">Close</button></div>`;

  // ---------- Accounts ----------
  const ACC = kept.accounts || {};
  const AGENTS = [
    { id: 'claude', name: 'Claude Code', cmd: 'claude auth login --claudeai', version: '2.3.1', state: 'in', who: 'mikko@example.com' },
    { id: 'codex', name: 'Codex', cmd: 'codex login --device-auth', version: '0.98.0', state: 'in', who: 'mikko@example.com' },
    { id: 'grok', name: 'Grok Build', cmd: 'grok login --device-auth', version: '1.4.2', state: 'out' },
    { id: 'muse', name: 'Muse', cmd: 'muse login', version: '1.3.0', state: 'here', cred: 'login' },
    { id: 'antigravity', name: 'Antigravity', cmd: 'agy', version: null, state: 'none' }
  ].map((a) => ({ ...a, ...(ACC.agents?.[a.id] || {}) }));
  const GOOGLE = ACC.google || [{ id: 'g1', email: 'mikko@example.com', state: 'connected' }, { id: 'g2', email: 'research@example.com', state: 'expired' }];
  const DEVICES = ACC.devices || [{ id: 'd1', label: 'Poise Link 1.6', state: 'connected', paired: '20 Oct, 09:12' }, { id: 'd2', label: 'Poise Link 1.5', state: 'away', paired: '2 Oct, 17:40', seen: '21 Oct, 22:40' }];
  const GH = [{ login: 'mikkokotila', active: true }, { login: 'bit-mis' }];
  function saveAccounts() {
    save('accounts', {
      agents: Object.fromEntries(AGENTS.map((a) => [a.id, { state: a.state === 'connecting' ? a.was : a.state, who: a.who, cred: a.cred }])),
      google: GOOGLE.filter((g) => !g.gone).map(({ id, email, state }) => ({ id, email, state: state === 'connecting' ? 'expired' : state })),
      devices: DEVICES.filter((d) => !d.gone).map(({ id, label, state, paired, seen }) => ({ id, label, state, paired, seen }))
    });
  }
  let terminalFor = null; // one sign-in terminal at a time, as in Poise
  const AGENT_WORDS = { in: (a) => `Signed in as ${a.who}`, here: () => 'Signed in here; the CLI cannot confirm it', out: () => 'Not signed in', none: () => 'Not installed', connecting: () => 'Running: waiting for you to sign in' };
  const agentState = (a) => (a.state === 'connecting' ? stateHTML('running', 'waiting for you to sign in') : `<span class="fnote${a.state === 'out' ? ' is-attn' : ''}">${esc(AGENT_WORDS[a.state](a))}</span>`);
  const agents = {
    key: 'agents', group: 'Agents', label: 'Agent sign-ins', gloss: 'Each agent CLI signs in with its own command, in a terminal here. Chats, reviews and behaviors run on these sign-ins.', type: 'list', wide: true,
    items: () => AGENTS, id: (a) => a.id, name: (a) => a.name, itemRef: 'set.agent.row', save: saveAccounts,
    itemHTML: (a) => {
      const why = a.state === 'none' ? 'Antigravity is not installed on this workspace, so nothing asks you to sign in to it.' : terminalFor && terminalFor !== a.id ? 'A sign-in terminal is open; finish or close it first.' : '';
      const btn = a.state === 'connecting' ? '' : `<button class="btn-ghost" data-act="connect" data-ref="set.agent.connect"${why ? ` aria-disabled="true" data-why="${esc(why)}"` : ''}>${a.state === 'in' || a.state === 'here' ? 'Reconnect' : 'Connect'}</button>`
        + (a.cred && a.state !== 'connecting' ? `<button class="btn-ghost" data-act="apikey" data-ref="set.agent.apikey"${why ? ` aria-disabled="true" data-why="${esc(why)}"` : ''}>Use an API key</button>` : '');
      return `<span class="fmain"><span class="name">${esc(a.name)}</span><span class="fsub"><span class="t-mono">${esc(a.cmd)}</span>${a.version ? ` · version ${a.version}` : ''}${a.cred ? ` · <span data-ref="set.agent.cred">${a.cred === 'key' ? 'API key' : 'Account login (device code)'}</span>` : ''}</span></span><span class="fstate">${agentState(a)}</span><span class="facts">${btn}</span>`;
    },
    underItem: (a) => termHTML(a.lines || []),
    nowItem: (a) => `${a.name}: ${AGENT_WORDS[a.state](a)}.`,
    now: () => { const out = AGENTS.filter((a) => a.state === 'out').map((a) => a.name); return out.length ? `${out.join(', ')} not signed in. The others are signed in or not installed.` : 'Every installed agent is signed in.'; },
    findText: () => AGENTS.map((a) => `${a.name} ${a.cmd}`).join(' '),
    act: (act, a) => { if (act === 'connect') connect(a); if (act === 'apikey') connect(a, true); if (act === 'term-close') closeTerminal(a); }
  };
  const repaintAgents = () => AGENTS.forEach((a) => paintItem(agents, a));
  function connect(a, withKey) {
    if (terminalFor) return;
    terminalFor = a.id;
    Object.assign(a, { was: a.state, state: 'connecting', open: true, lines: [{ t: `$ ${withKey ? 'muse auth set --api-key-stdin' : a.cmd}`, cls: 'cmd' }] });
    repaintAgents();
    const say = (t, cls) => { a.lines.push({ t, cls }); paintItem(agents, a); };
    if (withKey) {
      // The key goes to Muse on stdin; Poise never sees or stores it.
      lstat(agents, `<span class="sdot"></span>Waiting for your API key in the terminal`);
      a.timers = [
        setTimeout(() => say('Paste your Muse API key and press Enter. It goes straight to Muse; Poise never sees it.'), 500),
        setTimeout(() => {
          say('API key stored.', 'ok');
          Object.assign(a, { state: 'here', cred: 'key' });
          terminalFor = null;
          repaintAgents();
          saveAccounts();
          lstat(agents, `<span class="sdot is-saved"></span>Muse uses its API key ${clock()} · from each chat’s next turn`);
        }, 3000)
      ];
      return;
    }
    if (a.cred) say('This switches Muse to the account login and its subscription quota. Use an API key keeps the key.');
    lstat(agents, `<span class="sdot"></span>Signing in to ${esc(a.name)} · finish in the browser it opens`);
    a.timers = [
      setTimeout(() => say('Opening your browser to sign in…'), 700),
      setTimeout(() => say('Waiting for you to approve the sign-in…'), 1500),
      setTimeout(() => {
        say('Signed in as mikko@example.com.', 'ok');
        Object.assign(a, { state: 'in', who: 'mikko@example.com' }, a.cred ? { cred: 'login' } : {});
        terminalFor = null;
        repaintAgents();
        saveAccounts();
        lstat(agents, `<span class="sdot is-saved"></span>${esc(a.name)} signed in ${clock()} · chats and reviews can use it now`);
      }, 3600)
    ];
  }
  function closeTerminal(a) {
    if (a.state === 'connecting') {
      a.timers.forEach(clearTimeout);
      a.state = a.was;
      terminalFor = null;
      lstat(agents, `Sign-in to ${esc(a.name)} stopped · nothing changed`);
    }
    a.open = false;
    repaintAgents();
    $('[data-act="connect"]', inItem(agents, a))?.focus();
  }

  const isLogin = (a, k) => !!S.value(k) && a.toLowerCase() === S.value(k).toLowerCase();
  const ghNotes = (g) => [g.active ? 'active' : '', isLogin(g.login, 'me') ? 'your GitHub account' : '', isLogin(g.login, 'agent') ? 'your automation account' : ''].filter(Boolean).join(' · ');
  const gh = {
    key: 'gh', group: 'GitHub', label: 'GitHub CLI', gloss: 'gh signs in with gh auth login --web. Poise reads and writes GitHub as these accounts, and reads your sites through them.', type: 'list', wide: true, mono: true,
    items: () => GH, id: (g) => g.login, name: (g) => g.login, itemRef: 'set.gh.row', save: () => {},
    itemHTML: (g) => `<span class="fmain"><span class="name t-mono">${esc(g.login)}</span><span class="fsub">${ghNotes(g) || 'held by gh'}</span></span><span class="fstate"><span class="fnote">Signed in</span></span>`,
    nowItem: (g) => `${g.login}: signed in${ghNotes(g) ? `, ${ghNotes(g)}` : ''}.`,
    now: () => `${GH.length} accounts, both signed in.`,
    // Says so when General names an account gh does not hold.
    extra: () => [['me', 'Your GitHub account'], ['agent', 'Your automation account']].filter(([k]) => S.value(k) && !GH.some((g) => isLogin(g.login, k))).map(([k, w]) => `<p class="fwarn is-attn">${w}, ${esc(S.value(k))}, is not signed in to gh. Sign it in with gh, or change it in <a class="lnk" href="#general" data-ref="set.link">General</a>.</p>`).join('') + '<p class="t-gloss">gh version 2.62.0</p>',
    findText: () => GH.map((g) => g.login).join(' ')
  };
  // Google accounts: sign-ins under Accounts, destinations under Publishing; one list, the same in both.
  function googleList(key, group, label, gloss, fine) {
    const row = {
      key, group, label, gloss, type: 'list', wide: true,
      items: () => GOOGLE, id: (g) => g.id, name: (g) => g.email, itemRef: 'set.google.row', removeRef: 'set.google.disconnect', save: saveAccounts,
      itemHTML: (g) => `<span class="fmain"><span class="name">${esc(g.email)}</span>${g.state === 'connected' && fine ? `<span class="fsub">${fine}</span>` : ''}</span><span class="fstate">${g.state === 'connected' ? '<span class="fnote">Connected</span>' : g.state === 'connecting' ? stateHTML('running', 'opening Google…') : '<span class="fnote is-attn">Needs sign-in</span>'}</span><span class="facts">${g.state === 'expired' ? '<button class="btn-ghost" data-act="reconnect" data-ref="set.google.reconnect">Reconnect</button>' : ''}</span>`,
      nowItem: (g) => `${g.email}: ${g.state === 'connected' ? 'Connected' : g.state === 'connecting' ? 'Running, opening Google' : 'Needs sign-in; its documents cannot publish until it is reconnected'}.`,
      removable: (g) => (g.state === 'connecting' ? '' : `Disconnect ${g.email}`), goneWords: () => 'Disconnected · its Google files stay in its Drive; Editor stops publishing to them',
      now: () => { const live = GOOGLE.filter((g) => !g.gone), need = live.filter((g) => g.state === 'expired').length; return `${live.length} of up to ten Google accounts${need ? `, ${need} needing sign-in` : ''}.`; },
      extra: () => `<button class="btn-ghost" aria-disabled="true" data-ref="set.google.add"><i data-i="plus" class="sm"></i>Add Google account</button><p class="t-gloss">Google is enabled for this workspace by its operator.</p>`,
      findText: () => `${GOOGLE.map((g) => g.email).join(' ')} Google Docs Drive`,
      act: (act, g) => {
        if (act !== 'reconnect') return;
        g.state = 'connecting';
        paintItem(row, g);
        setTimeout(() => { g.state = 'connected'; paintItem(row, g); saveAccounts(); lstat(row, `<span class="sdot is-saved"></span>${esc(g.email)} connected ${clock()} · Editor can publish as it again`); }, 2200);
      }
    };
    return row;
  }
  const google = googleList('google', 'Google', 'Google accounts', 'Sign-ins for Google Docs. Editor publishes to them and reads Google’s comments through them; Publishing shows the same accounts. Up to ten.');
  const INSTALL = 'curl -fsSL https://poise.example.com/link/install.sh | sh';
  const linkInstall = {
    key: 'link-install', group: 'Poise Link', label: 'Install Poise Link', gloss: 'Poise Link syncs your snippets and brings alerts to your computer. It runs on macOS, Debian 12+ and Ubuntu 24.04+, and adds Espanso when needed.', type: 'custom', wide: true,
    control: () => `<div class="code"><code class="t-mono">${esc(INSTALL)}</code><button class="btn-ghost" data-act="copy" data-ref="set.link.copy"><i data-i="copy" class="sm"></i><span>Copy</span></button></div><p class="t-gloss">Run it on your computer. Windows has an installer; without curl, use <span class="t-mono">wget -qO- … | sh</span>.</p>`,
    act: (act, b) => {
      if (act !== 'copy') return;
      navigator.clipboard?.writeText(INSTALL).catch(() => {});
      $('span', b).textContent = 'Copied';
      setTimeout(() => { if (b.isConnected) $('span', b).textContent = 'Copy'; }, 1400);
      lstat(linkInstall, 'Copied · paste it in a terminal on your computer');
    }
  };
  const CODE = /^[A-Za-z]{4}-?[A-Za-z]{4}$/;
  const linkPair = {
    key: 'link-pair', group: 'Poise Link', label: 'Pair a computer', gloss: 'Enter the code Poise Link shows. Approve only a code your own Poise Link shows you: it pairs that computer with this workspace.', type: 'custom', labelFor: 's-link-code',
    control: () => '<span class="sfield"><input id="s-link-code" class="sinput t-mono is-code" placeholder="XXXX-XXXX" maxlength="9" autocomplete="off" spellcheck="false" data-code data-ref="set.link.code"><button class="btn-ghost" data-act="approve" data-ref="set.link.approve">Approve</button><button class="btn-ghost" data-act="deny" data-ref="set.link.deny">Deny</button></span>',
    onKey: (e) => { if (e.target.matches('[data-code]') && e.key === 'Enter') { e.preventDefault(); decide('approve'); return true; } return false; },
    onInput: (e) => { if (!e.target.matches('[data-code]')) return false; e.target.setAttribute('aria-invalid', 'false'); lstat(linkPair, ''); return true; },
    act: (act) => decide(act)
  };
  function decide(act) {
    const input = $('[data-code]'), code = input.value.trim().toUpperCase();
    if (!CODE.test(code)) { input.setAttribute('aria-invalid', 'true'); lstat(linkPair, '<span class="is-err">Enter the eight letters Poise Link shows, like ABCD-EFGH.</span>'); input.focus(); return; }
    input.value = '';
    if (act === 'deny') { lstat(linkPair, `Denied ${clock()} · that code no longer works`); return; }
    lstat(linkPair, stateHTML('running', `pairing ${code.replace(/^(.{4})-?/, '$1-')}…`));
    setTimeout(() => {
      const d = { id: nid('d'), label: 'Poise Link 1.6', state: 'connected', paired: `today, ${clock()}` };
      DEVICES.unshift(d);
      addItem(devices, d, { top: true });
      saveAccounts();
      lstat(linkPair, `<span class="sdot is-saved"></span>Paired ${clock()} · it is first under Paired computers`);
    }, 1600);
  }
  const devices = {
    key: 'devices', group: 'Poise Link', label: 'Paired computers', gloss: 'Computers whose Poise Link may reach this workspace. Connected means its Poise Link is running now.', type: 'list', wide: true,
    items: () => DEVICES, id: (d) => d.id, name: (d) => d.label, itemRef: 'set.device.row', removeRef: 'set.device.revoke', save: saveAccounts,
    itemHTML: (d) => `<span class="fmain"><span class="name">${esc(d.label)}</span><span class="fsub">Paired ${esc(d.paired)}</span></span><span class="fstate"><span class="fnote">${d.state === 'connected' ? 'Connected' : `Not connected · last seen ${esc(d.seen || 'never')}`}</span></span>`,
    nowItem: (d) => `${d.label}, paired ${d.paired}: ${d.state === 'connected' ? 'Connected' : `not connected, last seen ${d.seen || 'never'}`}.`,
    removable: (d) => `Revoke ${d.label}, paired ${d.paired}`, goneWords: () => 'Revoked · it can no longer reach this workspace',
    empty: 'No computer is paired yet.',
    now: () => { const live = DEVICES.filter((d) => !d.gone); return `${live.length} computers paired, ${live.filter((d) => d.state === 'connected').length} connected.`; }
  };
  let shellOpen = false;
  const shell = {
    key: 'shell', group: 'Terminal', label: 'Terminal', gloss: 'A shell in your workspace, for connections the buttons above do not cover. Two can run at once; an idle one closes after 15 minutes.', type: 'custom',
    control: () => `<button class="btn-ghost" data-act="shell" data-ref="set.shell"${shellOpen ? ' aria-disabled="true" data-why="The shell is open below."' : ''}><i data-i="term" class="sm"></i>Open a shell</button>`,
    under: () => (shellOpen ? termHTML([{ t: 'mikkokotila@workspace:~$', cls: 'cmd' }, { t: 'This mock shows where the shell opens; it runs nothing.' }]) : ''),
    act: (act) => {
      if (act === 'shell') { shellOpen = true; S.rerow('shell'); lstat(shell, `${stateHTML('running', 'open')} <span class="fnote">closes after 15 idle minutes</span>`); }
      if (act === 'term-close') { shellOpen = false; S.rerow('shell'); lstat(shell, `Closed ${clock()}`); $('[data-act="shell"]', rowEl('shell'))?.focus(); }
    }
  };
  // ---------- Accounts: SSH keys ----------
  // The public side of ~/.ssh: each private key file by name, with its public
  // key's fingerprint. Poise never opens a private key file.
  // ?ssh=none or error shows the list's other states.
  const SSH_STATE = params.get('ssh');
  const SSH = SSH_STATE === 'none' || SSH_STATE === 'error' ? [] : kept.ssh || [
    { id: 'id_ed25519', fp: 'SHA256:q3VxR8b0cZ1nL4yWm2hT7eKd9sJfA6uP0iXoN5gk9Tb', mode: '600' },
    { id: 'deploy_acme', fp: 'SHA256:Lm7cH2wQ9vB4xN8rE1tY6uI3oP5aS0dF7gJ2kZ2pQe', mode: '644' },
    { id: 'old_rsa', fp: null, mode: '600' },
    { id: 'laptop_2019', fp: null, pubOnly: true },
    { id: 'staging', fp: null, mode: '600', badPub: true }
  ];
  const tooOpen = (k) => (parseInt(k.mode, 8) & 0o077) !== 0;
  let sshTerm = null;
  const sshKeys = {
    key: 'ssh', group: 'SSH keys', label: 'SSH keys', type: 'list', wide: true, mono: true,
    gloss: 'Keys in ~/.ssh for servers you can reach, including from chats when you ask for work there. Poise lists public keys only, and never reads a private key file.',
    items: () => SSH, id: (k) => k.id, name: (k) => k.id, itemRef: 'set.ssh.row', save: () => save('ssh', SSH.filter((k) => !k.gone).map(({ id, fp, mode, pubOnly, badPub }) => ({ id, fp, mode, pubOnly, badPub }))),
    itemHTML: (k) => `<span class="fmain"><span class="name t-mono">${esc(k.id)}</span><span class="fsub">${k.pubOnly ? 'There is no private file for this public key.' : k.badPub ? `Its ${esc(k.id)}.pub holds no readable public key.` : k.fp ? `<span class="t-mono">${esc(k.fp.slice(0, 18))}…${esc(k.fp.slice(-6))}</span>` : `There is no ${esc(k.id)}.pub yet: derive it in a shell with <span class="t-mono">ssh-keygen -y -f ~/.ssh/${esc(k.id)}</span>`}${tooOpen(k) ? `<br><span class="is-attn">Permissions ${esc(k.mode)} are too open: ssh refuses a key others can read. Fix it in a shell with <span class="t-mono">chmod 600 ~/.ssh/${esc(k.id)}</span>.</span>` : ''}</span></span><span class="fstate"><span class="fnote${tooOpen(k) ? ' is-attn' : ''}">${tooOpen(k) ? 'ssh refuses it' : k.pubOnly ? 'Public key only' : k.fp ? 'Ready' : 'No public key'}</span></span>`,
    nowItem: (k) => `${k.id}: ${tooOpen(k) ? `permissions ${k.mode} are too open, so ssh refuses it` : k.pubOnly ? 'a public key only, with no private file beside it' : k.badPub ? `its ${k.id}.pub holds no readable public key` : k.fp ? `ready, fingerprint ${k.fp}` : 'no public key yet'}.`,
    now: () => { const live = SSH.filter((k) => !k.gone); return `${live.length} keys in ~/.ssh${live.some(tooOpen) ? `; ${live.filter(tooOpen).map((k) => k.id).join(', ')} cannot be used until its permissions are fixed` : ''}.`; },
    empty: SSH_STATE === 'error' ? 'Could not check SSH keys: the workspace did not answer. Reload Settings to try again.' : 'No SSH keys yet. Add one to reach your servers over SSH, including from chats when you ask for work there.',
    extra: () => `<button class="btn-ghost" data-act="ssh-add" data-ref="set.ssh.add"${sshTerm || terminalFor ? ' aria-disabled="true" data-why="A terminal is open; finish or close it first."' : ''}><i data-i="term" class="sm"></i>Add an SSH key</button>${sshTerm ? termHTML(sshTerm.lines) : ''}`,
    findText: () => `${SSH.map((k) => k.id).join(' ')} ssh key fingerprint`,
    act: (act) => {
      if (act === 'ssh-add' && !sshTerm) {
        sshTerm = { lines: [{ t: '$ poise ssh-key add', cls: 'cmd' }], timers: [] };
        paintExtra(sshKeys);
        lstat(sshKeys, '<span class="sdot"></span>Waiting for you in the terminal');
        const say = (t, cls) => { sshTerm.lines.push({ t, cls }); paintExtra(sshKeys); };
        sshTerm.timers = [
          setTimeout(() => say('Name for the key file in ~/.ssh: limen_deploy'), 600),
          setTimeout(() => say('Paste the private key, then press Enter on an empty line. Nothing shows while you paste.'), 1400),
          setTimeout(() => {
            say('Saved ~/.ssh/limen_deploy with 0600, and derived limen_deploy.pub.', 'ok');
            const k = { id: 'limen_deploy', fp: 'SHA256:Zt4nW1qR7yK0cV3bM8xH5jL2pS9dF6gA1eU4iO7r3Xc', mode: '600' };
            SSH.unshift(k);
            addItem(sshKeys, k, { top: true });
            sshKeys.save();
            lstat(sshKeys, `<span class="sdot is-saved"></span>Added limen_deploy ${clock()} · ssh can use it now, chats included`);
          }, 3200)
        ];
      }
      if (act === 'term-close' && sshTerm) {
        sshTerm.timers.forEach(clearTimeout);
        const finished = sshTerm.lines.some((l) => l.cls === 'ok');
        sshTerm = null;
        paintExtra(sshKeys);
        if (!finished) lstat(sshKeys, `Closed ${clock()} · no key was saved`);
        $('[data-act="ssh-add"]', rowEl('ssh'))?.focus();
      }
    }
  };
  define('accounts', { rows: [agents, gh, sshKeys, google, linkInstall, linkPair, devices, shell] });

  // ---------- Models ----------
  const OPUS_H = 'Claude Code · Opus 5 · High', OPUS_M = 'Claude Code · Opus 5 · Max', OPUS_L = 'Claude Code · Opus 5 · Low';
  const GPT5 = 'Codex · GPT-5 Codex · High', ASTRA = 'Codex · GPT-6 Astra · Max', MUSE = 'Muse · spark 1.3 contributor · max';
  const GROK = 'Grok Build · Grok 5 · High', GEMINI = 'Antigravity · Gemini 3.8 Flash · High';
  const CATALOG = kept.catalog || [OPUS_H, OPUS_M, OPUS_L, GPT5, ASTRA, MUSE, GROK, GEMINI];
  // Three models chosen once, as slots; every place runs a slot, or draws one
  // at Random on each run. A model that fails before its verdict hands the run
  // to a slot it has not tried yet.
  const SLOT = { primary: 'Primary', secondary: 'Secondary', tertiary: 'Tertiary' };
  const PICK = [['primary', 'Primary'], ['secondary', 'Secondary'], ['tertiary', 'Tertiary'], ['random', 'Random']];
  const agentOf = (m) => AGENTS.find((a) => a.name === m.split(' · ')[0]);
  const reviewersFor = (k) => Number(S.value(k === 'issue_review' ? 'beh.review-new-issues' : 'beh.review-new-prs')?.reviewers || '1');
  const cannotRun = (m) => { const a = agentOf(m); return a && (a.state === 'out' || a.state === 'none') ? a : null; };
  const slots = {
    key: 'models.slots', ref: 'set.models.slots', group: 'The three models', label: 'Models', gloss: 'Chosen once. Every place below runs one of these, or draws one at Random on each run, so changing a slot changes it everywhere. When a model fails before its verdict, the run moves to a slot it has not tried yet, within about a minute.', type: 'place', wide: true,
    value: { primary: OPUS_M, secondary: ASTRA, tertiary: MUSE }, def: { primary: OPUS_M, secondary: ASTRA, tertiary: MUSE }, applies: 'from the next chat, review and run', defWords: () => 'Caller’s choices',
    words: (v) => `Primary ${v.primary}; Secondary ${v.secondary}; Tertiary ${v.tertiary}`,
    check: (v) => { const seen = Object.entries(v).find(([k, m], i, all) => all.findIndex(([, n]) => n === m) !== i); return seen ? `${SLOT[seen[0]]} is already ${seen[1]} in another slot; the three must be different models` : ''; },
    control: (s) => `<div class="pgrid">${Object.keys(SLOT).map((p) => `<label class="pl"><span class="t-micro">${SLOT[p]}</span>${selectHTML(s, { part: p, options: CATALOG.map((m) => [m, m]), label: `${SLOT[p]} model` })}</label>`).join('')}</div>`,
    meta: (s) => [...new Set(Object.values(s.value))].map((m) => { const a = cannotRun(m); return a ? `<span class="is-attn">${esc(a.name)} is ${a.state === 'none' ? 'not installed' : 'not signed in'}, so ${esc(m)} cannot run; its places move to the next slot.</span> <a class="lnk" href="#accounts" data-ref="set.link">Accounts</a>` : ''; }).filter(Boolean).join('<br>'),
    painted: () => { PLACES.forEach((p) => { if (rowEl(p.key)) S.paint(p); }); if (rowEl('presets')) PRESETS.forEach((p) => paintItem(presets, p)); }
  };
  function place(key, label, gloss, applies, { reviewers = false, item = 'pull request', def = 'primary' } = {}) {
    return {
      key: `models.${key}`, ref: `set.models.${key}`, group: 'Where each one runs', label, gloss, type: 'seg', options: PICK, value: def, def, applies, defWords: () => SLOT[def] || 'Random',
      words: (v) => (v === 'random' ? 'Random: one of the three, drawn on each run' : `${SLOT[v]}: ${slots.value[v]}`),
      meta: (s) => {
        const n = reviewers ? reviewersFor(key) : 1;
        const panel = !reviewers ? '' : n === 1 ? `Behaviors asks for one reviewer for each new ${item}. <a class="lnk" href="#behaviors" data-ref="set.link">Behaviors</a>`
          : s.value === 'random' ? `Behaviors asks for ${n} reviewers: Random draws ${n} different models for each new ${item}. <a class="lnk" href="#behaviors" data-ref="set.link">Behaviors</a>`
            : `Behaviors asks for ${n} reviewers: this slot and the next ${n === 2 ? 'one review' : 'two review'} each new ${item}. <a class="lnk" href="#behaviors" data-ref="set.link">Behaviors</a>`;
        const m = s.value === 'random' ? null : slots.value[s.value], a = m && cannotRun(m);
        return [panel, a ? `<span class="is-attn">${esc(m)} cannot run now; runs here move to the next slot.</span>` : ''].filter(Boolean).join('<br>');
      }
    };
  }
  const PLACES = [
    place('chat', 'Chat', 'New chats, and chats started from Board cards.', 'from the next chat'),
    place('editor', 'Editor chat', 'Document, passage and review chats in Editor. /content and /consensus use Caller’s own models, below.', 'from the next Editor chat'),
    place('pr_review', 'PR review', 'Automatic and manual reviews, replays included. If Claude hits its output limit, the next slot takes over once.', 'from the next review', { reviewers: true }),
    place('pr_approve', 'PR approval', 'Automatic approvals and their replays.', 'from the next approval'),
    place('issue_review', 'Issue review', 'Review New Issues and its replays. Each reviewer works in a fresh checkout and comments as the agent account.', 'from the next issue review', { reviewers: true, item: 'issue' }),
    place('issue_implement', 'Issue implementation', 'Implement Issues: one fresh run implements a reviewed issue and opens its pull request. No chat stays running.', 'from the next implementation'),
    place('pr_repair', 'PR repair', 'Repair Pull Requests: one fresh run answers review findings, failing CI, conflicts or a queue rejection, then lets go of its resources.', 'from the next repair')
  ];
  PLACES.find((p) => p.key === 'models.pr_review').value = 'random';
  const CHOICES = [slots, ...PLACES];
  const PRESETS = kept.presets?.[0]?.models?.['models.slots'] ? kept.presets : [
    { id: 'p1', name: 'Deep reviews', at: '14 Oct', models: { 'models.slots': { primary: OPUS_M, secondary: ASTRA, tertiary: MUSE }, 'models.chat': 'primary', 'models.editor': 'primary', 'models.pr_review': 'random', 'models.pr_approve': 'primary', 'models.issue_review': 'primary', 'models.issue_implement': 'primary', 'models.pr_repair': 'secondary' } },
    { id: 'p2', name: 'Fast and light', at: '9 Oct', models: { 'models.slots': { primary: OPUS_H, secondary: GPT5, tertiary: MUSE }, 'models.chat': 'primary', 'models.editor': 'primary', 'models.pr_review': 'secondary', 'models.pr_approve': 'secondary', 'models.issue_review': 'secondary', 'models.issue_implement': 'primary', 'models.pr_repair': 'secondary' } }
  ];
  const inUse = (p) => CHOICES.every((s) => JSON.stringify(s.value) === JSON.stringify(p.models[s.key]));
  let usedBefore = null;
  const presets = {
    key: 'presets', group: 'Saved configurations', label: 'Your configurations', gloss: 'The three models and every place’s slot under one name. Use one to switch them all at once.', type: 'list', wide: true,
    items: () => PRESETS, id: (p) => p.id, name: (p) => p.name, itemRef: 'set.preset.row', removeRef: 'set.preset.delete',
    save: () => save('presets', PRESETS.filter((p) => !p.gone).map(({ id, name, at, models }) => ({ id, name, at, models }))),
    itemHTML: (p) => `<span class="fmain"><span class="name">${esc(p.name)}</span><span class="fsub">${esc(p.models['models.slots'].primary.split(' · ').slice(1).join(' '))} first · saved ${esc(p.at)}</span></span><span class="fstate">${inUse(p) ? '<span class="fnote">In use</span>' : ''}</span><span class="facts">${inUse(p) ? '' : '<button class="btn-ghost" data-act="use" data-ref="set.preset.use">Use</button>'}</span>`,
    nowItem: (p) => `${p.name}: Primary ${p.models['models.slots'].primary}, saved ${p.at}${inUse(p) ? '; in use now' : ''}.`,
    removable: (p) => `Delete ${p.name}`, goneWords: () => 'Deleted · the places keep their choices',
    now: () => { const live = PRESETS.filter((p) => !p.gone), on = live.find(inUse); return `${live.length} saved configurations${on ? `; ${on.name} is in use` : ''}.`; },
    findText: () => PRESETS.map((p) => p.name).join(' '),
    add: {
      placeholder: 'Name the current choices', aria: 'Name for the current choices', label: 'Save', plain: true, ref: 'set.preset.save', inputRef: 'set.preset.name',
      check: (v) => (v.length > 40 ? 'Not saved: a name is at most 40 characters.' : PRESETS.some((p) => !p.gone && p.name.toLowerCase() === v.toLowerCase()) ? `There is already a configuration named “${esc(v)}”.` : ''),
      create: (name) => ({ id: nid('p'), name, at: `today, ${clock()}`, models: Object.fromEntries(CHOICES.map((s) => [s.key, typeof s.value === 'object' ? { ...s.value } : s.value])) }),
      then: (p) => lstat(presets, `<span class="sdot is-saved"></span>Saved the current choices as “${esc(p.name)}”`)
    },
    act: (act, p) => {
      if (act === 'use') {
        usedBefore = CHOICES.map((s) => [s, s.value]);
        CHOICES.forEach((s) => commit(s, typeof p.models[s.key] === 'object' ? { ...p.models[s.key] } : p.models[s.key]));
        lstat(presets, `<span class="sdot is-saved"></span>Using “${esc(p.name)}” ${clock()} · from the next chat, review and run · <button class="lnk" data-act="undo-use" data-ref="set.undo">Undo</button>`);
      }
      if (act === 'undo-use' && usedBefore) {
        usedBefore.forEach(([s, v]) => commit(s, v, { undo: true }));
        usedBefore = null;
        lstat(presets, 'Back to the choices you had');
      }
    }
  };
  const FIXED = [
    { id: 'content', name: '/content', model: OPUS_H, what: 'Writes content, in the voice guide when one is set.' },
    { id: 'consensus', name: '/consensus', model: OPUS_M, what: 'Moderates a debate between one model from each family.' },
    { id: 'ci', name: 'Fix failing CI', model: GPT5, what: 'A Caller behavior.' },
    { id: 'simplify', name: 'Simplify issue', model: OPUS_H, what: 'A Caller behavior.' },
    { id: 'canary', name: 'Sign-in check', model: OPUS_L, what: 'One small Claude request that proves the sign-in, at start and while it is unhealthy.' }
  ];
  const fixed = {
    key: 'fixed', group: 'Set by Caller', label: 'Fixed models', gloss: 'Places whose model the Caller catalog sets. They change when Caller does.', type: 'list', wide: true,
    items: () => FIXED, id: (f) => f.id, name: (f) => f.name, itemRef: 'set.fixed.row', save: () => {},
    itemHTML: (f) => `<span class="fmain"><span class="name${f.name.startsWith('/') ? ' t-mono' : ''}">${esc(f.name)}</span><span class="fsub">${esc(f.what)}</span></span><span class="fstate"><span class="fnote">${esc(f.model)}</span></span>`,
    nowItem: (f) => `${f.name}: ${f.model}. ${f.what}`, now: () => 'Five places, set by Caller.',
    findText: () => FIXED.map((f) => `${f.name} ${f.model}`).join(' ')
  };
  let checking = null;
  const catalog = {
    key: 'catalog', group: 'Catalog', label: 'Model catalog', gloss: 'Where every model choice comes from. Poise checks it daily at 07:00 in your time zone; Check now also updates the provider CLIs.', type: 'custom',
    control: () => `<span class="cline"><span class="fnote">${CATALOG.length} models · checked ${esc(kept.checkedAt || 'today, 07:00')}</span><button class="btn-ghost" data-act="check" data-ref="set.catalog.check"${checking ? ' aria-disabled="true" data-why="A check is running."' : ''}>Check now</button></span>`,
    findText: () => CATALOG.join(' '),
    act: (act) => {
      if (act !== 'check' || checking) return;
      const t0 = Date.now();
      let what = 'updating provider CLIs';
      const tick = () => lstat(catalog, `${stateHTML('running', `${what} · ${Math.floor((Date.now() - t0) / 1000)} s`)} <span class="fnote">chats continue meanwhile</span>`);
      checking = setInterval(tick, 1000);
      S.rerow('catalog');
      tick();
      setTimeout(() => { what = 'checking models'; tick(); }, 3000);
      setTimeout(() => {
        clearInterval(checking);
        checking = null;
        const added = 'Codex · GPT-6 Astra · Ultra', isNew = !CATALOG.includes(added);
        if (isNew) CATALOG.push(added);
        kept.checkedAt = `today, ${clock()}`;
        save('catalog', CATALOG);
        if (S.current() === 'models') S.rerender();
        lstat(catalog, `${stateHTML('done', `checked ${clock()}`)} <span class="fnote">${isNew ? `1 new model, ${esc(added)}: every place can choose it.` : 'Nothing changed.'}</span>`);
      }, 5600);
    }
  };
  define('models', { rows: [slots, ...PLACES, presets, fixed, catalog] });

  // ---------- Publishing ----------
  const yamlFor = (site) => `version: 1\nsite: ${site}\nsections:\n  - name: Writing\n    path: src/content/writing/{slug}.md\n    slug: "^[a-z0-9]+(?:-[a-z0-9]+)*$"\n    first_line: title\n    fields:\n      title: { kind: text, required: true, max: 220 }\n      date:  { kind: date, required: true, default: today }`;
  // A description is saved only when it reads; the first problem is named by its key.
  function readYaml(t) {
    if (!/^version:\s*1\s*$/m.test(t)) return 'version must be 1';
    if (!/^site:\s*\S/m.test(t)) return 'site is missing';
    if (!/^sections:\s*$/m.test(t)) return 'sections is missing';
    const path = t.match(/^\s+path:\s*(\S.*)$/m)?.[1];
    if (!path) return 'sections[0].path is missing';
    if (!path.includes('{slug}')) return 'sections[0].path must contain {slug}';
    return '';
  }
  const repoOf = (v) => { const m = v.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/(\.git)?\/?$/, '').match(/^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})$/); return m ? `${m[1]}/${m[2]}` : ''; };
  const SITES = kept.sites || [
    { repo: 'mikkokotila/personal-site', site: 'example.com', state: 'ready', source: 'repository' },
    { repo: 'Acme/acme-site', site: 'acme.example', state: 'ready', source: 'settings', yaml: yamlFor('acme.example') },
    { repo: 'mikkokotila/music-site', site: 'example.org', state: 'ready', source: 'repository' }
  ];
  const siteState = (x) => (x.state === 'reading' ? stateHTML('running', 'reading the repository…') : x.state === 'missing' ? stateHTML('needs-you', 'no publish.yaml in the repository') : `<span class="fnote">Ready${x.source === 'settings' ? ' · described here' : ''}</span>`);
  const sites = {
    key: 'sites', group: 'Sites', label: 'Your sites', gloss: 'Editor publishes to each as a pull request; nothing reaches a site until it is merged. Sites are read as your GitHub account, signed in to gh.', type: 'list', wide: true,
    empty: 'No sites yet. Add a repository below.',
    items: () => SITES, id: (x) => x.repo, name: (x) => x.site, itemRef: 'set.site.row', removeRef: 'set.site.remove',
    save: () => save('sites', SITES.filter((x) => !x.gone).map(({ repo, site, state, source, yaml }) => ({ repo, site, state: state === 'reading' ? 'missing' : state, source, yaml }))),
    itemHTML: (x) => `<span class="fmain"><span class="name">${esc(x.site)}</span><span class="fsub t-mono">${esc(x.repo)}</span></span><span class="fstate">${siteState(x)}</span><span class="facts">${x.source === 'settings' || x.state === 'missing' ? `<button class="btn-ghost" data-act="describe" aria-expanded="${!!x.open}" data-ref="set.site.describe">${x.source === 'settings' ? 'Edit' : 'Describe'}</button>` : ''}</span>`,
    underItem: (x) => `<label class="t-micro" for="y-${esc(x.repo)}">publish.yaml for ${esc(x.repo)}, kept in Poise</label><textarea id="y-${esc(x.repo)}" class="sarea t-mono" rows="11" spellcheck="false" data-yaml>${esc(x.draft ?? x.yaml ?? yamlFor(x.site))}</textarea>${x.err ? `<p class="fwarn is-err">Not saved: ${esc(x.err)}.</p>` : ''}<div class="fbtns"><button class="btn-ghost" data-act="yaml-save" data-ref="set.site.save">Save</button><button class="btn-ghost" data-act="yaml-cancel">Cancel</button></div>`,
    nowItem: (x) => `${x.site}, from ${x.repo}: ${x.state === 'reading' ? 'Running, reading the repository' : x.state === 'missing' ? 'Needs you: the repository has no publish.yaml' : `Ready${x.source === 'settings' ? ', described here' : ''}`}.`,
    removable: (x) => `Remove ${x.site}`, goneWords: () => 'Removed · Editor no longer offers it; published pieces stay',
    now: () => { const live = SITES.filter((x) => !x.gone), need = live.filter((x) => x.state === 'missing').length; return `${live.length} sites${need ? `, ${need} needing a description` : ', all Ready'}.`; },
    findText: () => SITES.map((x) => `${x.site} ${x.repo}`).join(' '),
    add: {
      placeholder: 'owner/repository or its GitHub address', aria: 'Repository to publish to', mono: true, label: 'Add site', ref: 'set.site.add', inputRef: 'set.site.input',
      check: (v) => { const repo = repoOf(v); return !repo ? 'Not added: enter owner/repository, or the repository’s GitHub address.' : SITES.some((x) => !x.gone && x.repo.toLowerCase() === repo.toLowerCase()) ? `${esc(repo)} is already a site.` : ''; },
      create: (v) => { const repo = repoOf(v); return { repo, site: repo.split('/')[1], state: 'reading', source: 'repository' }; },
      then: (x) => {
        lstat(sites, `<span class="sdot"></span>Adding ${esc(x.repo)} · reading its publish.yaml`);
        setTimeout(() => { x.state = 'missing'; paintItem(sites, x); sites.save(); lstat(sites, `${esc(x.repo)} has no publish.yaml · Describe it here, or add one to the repository`); }, 1700);
      }
    },
    onInput: (e) => { if (!e.target.matches('[data-yaml]')) return false; SITES.find((x) => x.repo === e.target.closest('[data-item]').dataset.item).draft = e.target.value; return true; },
    act: (act, x) => {
      if (act === 'describe') { x.open = !x.open; x.err = ''; delete x.draft; paintItem(sites, x); if (x.open) $('[data-yaml]', inItem(sites, x))?.focus(); }
      if (act === 'yaml-cancel') { Object.assign(x, { open: false, err: '' }); delete x.draft; paintItem(sites, x); $('[data-act="describe"]', inItem(sites, x))?.focus(); }
      if (act === 'yaml-save') {
        const t = $('[data-yaml]', inItem(sites, x)).value, err = readYaml(t);
        if (err) { Object.assign(x, { draft: t, err }); paintItem(sites, x); $('[data-yaml]', inItem(sites, x))?.focus(); return; }
        Object.assign(x, { yaml: t, err: '', open: false, source: 'settings', state: 'ready', site: t.match(/^site:\s*(\S.*)$/m)[1].trim() });
        delete x.draft;
        paintItem(sites, x);
        sites.save();
        lstat(sites, `<span class="sdot is-saved"></span>Saved ${clock()} · ${esc(x.site)} is Ready · Editor offers it from the next publish`);
      }
    }
  };
  const gdocs = googleList('gdocs', 'Google Docs', 'Accounts it publishes to', 'Editor publishes a document to Google Docs as a private Markdown file in the My Drive of each account you choose there: one file per account, up to ten accounts. It is separate from the sites above. Accounts shows the same list.', 'publishes to My Drive as Markdown');
  const gdocsEdits = {
    key: 'gdocs.edits', ref: 'set.gdocs.edits', group: 'Google Docs', label: 'Edits made in Google', gloss: 'While a document is open, Editor checks its Google files every minute; Refresh Google checks at once. An edit made in Google never overwrites your draft. You review it, then keep your draft, publish yours over it, or import Google’s version; an import keeps your previous text so it can be restored.', type: 'custom', plain: true,
    control: () => '<a class="btn-ghost" href="editor.html?tab=publish&amp;back=settings" data-ref="set.gdocs.edits">Open Editor’s Publish</a>'
  };
  const gdocsComments = {
    key: 'gdocs.comments', ref: 'set.gdocs.comments', group: 'Google Docs', label: 'Comments made in Google', gloss: 'Editor shows Google’s comments under Reviews, with their author, passage, replies and whether they are resolved. You reply to them and resolve them in Google Docs.', type: 'custom', plain: true,
    control: () => '<a class="btn-ghost" href="editor.html?tab=reviews&amp;back=settings" data-ref="set.gdocs.comments">Open Editor’s Reviews</a>'
  };
  const gdocsLimits = { key: 'gdocs.limits', ref: 'set.gdocs.limits', group: 'Google Docs', label: 'What it publishes', gloss: 'Markdown only: up to 10 MB in Google, and 5 MB in Editor. Poise never swaps in another account or makes a replacement file on its own. A revoked account or a deleted file waits for you.', type: 'custom', plain: true, control: () => '' };
  define('publishing', { rows: [sites, gdocs, gdocsEdits, gdocsComments, gdocsLimits] });

  // ---------- Behaviors ----------
  const REPOS = ['autonomio/poise', 'Acme/Limen', 'Acme/acme-site', 'mikkokotila/agent-tooling', 'mikkokotila/personal-site', 'mikkokotila/music-site'];
  const CEILINGS = [['p0', 'p0 only'], ['p1', 'p0–p1'], ['p2', 'p0–p2'], ['p3', 'p0–p3'], ['p4', 'Any priority']];
  const ui = {}; // per behavior: the panel open under it, and its draft
  const bval = (k, t) => `<span class="bval${k === 'authors' ? ' t-mono' : ''}" data-bval="${k}">${esc(t)}</span>`;
  const shown = {
    skip: (v) => (v.skip.length ? v.skip.join(', ') : 'None'),
    repos: (v) => (v.repos.length ? v.repos.join(', ') : 'No repository yet'),
    authors: (v) => v.authors.join(', ') || 'Nobody yet',
    memory: (v) => (v.memory ? short(v.memory, 46) : 'None')
  };
  function fieldsHTML(s) {
    const v = s.value, f = [];
    if ('ceiling' in v) f.push(`<label class="bf"><span class="t-micro">Priority</span>${selectHTML(s, { part: 'ceiling', options: CEILINGS, label: `${s.label}: highest priority it reviews` })}</label>`);
    if ('reviewers' in v) f.push(`<div class="bf"><span class="t-micro">Reviewers</span>${segHTML(s, { part: 'reviewers', options: [['1', '1'], ['2', '2'], ['3', '3']], label: `${s.label}: reviewers` })}</div>`);
    if ('cap' in v) f.push(`<label class="bf"><span class="t-micro">Review cap</span>${selectHTML(s, { part: 'cap', options: CAPS, label: `${s.label}: review cap` })}<span class="fnote" data-ref="set.beh.cap">legacy only</span></label>`);
    if ('skip' in v) f.push(`<div class="bf"><span class="t-micro">Skips</span>${bval('skip', shown.skip(v))}<button class="lnk" data-act="choose" aria-expanded="${ui[s.key]?.panel === 'choose'}" data-ref="set.beh.skip">Choose</button></div>`);
    // In v2 the chain's seed scope decides which issues it reviews, as on main; the repository and author filter applies to legacy work only.
    if ('repos' in v && inV2()) f.push(`<div class="bf"><span class="t-micro">Issues</span><span class="bval">${esc(byKey('beh.chain.seed')?.value === 'all' ? 'All issues' : `Label ${byKey('beh.chain.label')?.value || 'poise'}`)}</span><button class="lnk" data-act="to-seed" data-ref="set.beh.chain.seed">Change</button></div>`);
    else if ('repos' in v) f.push(`<div class="bf"><span class="t-micro">Acts in</span>${bval('repos', shown.repos(v))}<button class="lnk" data-act="choose" aria-expanded="${ui[s.key]?.panel === 'choose'}" data-ref="set.beh.repos">Choose</button></div>`, `<div class="bf"><span class="t-micro">Trusts</span>${bval('authors', shown.authors(v))}</div>`);
    if ('memory' in v) f.push(`<div class="bf"><span class="t-micro">Memory</span>${bval('memory', shown.memory(v))}<button class="lnk" data-act="memory" aria-expanded="${ui[s.key]?.panel === 'memory'}" data-ref="set.beh.memory">${v.memory ? 'Edit' : 'Add'}</button></div>`);
    return f.join('');
  }
  function underHTML(s) {
    const u = ui[s.key];
    if (!u) return '';
    if (u.panel === 'memory') return `<div class="bpanel"><label class="t-micro" for="m-${s.key}">Memory for ${esc(s.label)}</label><textarea id="m-${s.key}" class="sarea" rows="4" placeholder="A note added to this behavior’s prompt on every run" data-memory data-ref="set.beh.memory">${esc(u.draft)}</textarea><div class="fbtns"><button class="btn-ghost" data-act="done" data-ref="set.beh.done">Save</button><button class="btn-ghost" data-act="cancel" data-ref="set.cancel">Cancel</button></div></div>`;
    const skip = 'skip' in s.value;
    return `<div class="bpanel" role="group" aria-label="${skip ? 'Repositories to skip' : 'Repositories it acts in'}"><p class="t-micro">${skip ? 'Skip these repositories' : 'Act in these repositories'}</p><div class="checks">${REPOS.map((r) => `<label class="check"><input type="checkbox" value="${esc(r)}"${u.draft.includes(r) ? ' checked' : ''} data-check data-ref="${skip ? 'set.beh.skip' : 'set.beh.repos'}"><span class="t-mono">${esc(r)}</span></label>`).join('')}</div>${skip ? '' : `<label class="bf wide"><span class="t-micro">Trusted authors</span><input class="sinput t-mono" value="${esc(u.authors.join(', '))}" placeholder="GitHub logins, separated by commas" data-authors data-ref="set.beh.repos"></label>`}<div class="fbtns"><button class="btn-ghost" data-act="done" data-ref="set.beh.done">Done</button><button class="btn-ghost" data-act="cancel" data-ref="set.cancel">Cancel</button></div></div>`;
  }
  function behaviorAct(s, act) {
    const v = s.value, el = rowEl(s.key);
    const toggle = (panel, draft) => { ui[s.key] = ui[s.key]?.panel === panel ? null : draft; paintUnder(s); S.paint(s); };
    if (act === 'choose') { toggle('choose', { panel: 'choose', draft: [...(v.skip || v.repos)], authors: [...(v.authors || [])] }); $('[data-check]', el)?.focus(); }
    if (act === 'memory') { toggle('memory', { panel: 'memory', draft: v.memory }); $('[data-memory]', el)?.focus(); }
    if (act === 'to-seed') { const r = rowEl('beh.chain.seed'); r?.scrollIntoView({ block: 'center' }); $('button, input, select', r)?.focus({ preventScroll: true }); }
    if (act === 'cancel') { ui[s.key] = null; paintUnder(s); S.paint(s); }
    if (act === 'done') {
      const u = ui[s.key];
      const next = u.panel === 'memory' ? { ...v, memory: $('[data-memory]', el).value.trim() }
        : 'skip' in v ? { ...v, skip: $$('[data-check]:checked', el).map((c) => c.value) }
          : { ...v, repos: $$('[data-check]:checked', el).map((c) => c.value), authors: $('[data-authors]', el).value.split(',').map((a) => a.trim()).filter(Boolean) };
      commit(s, next);
      if (S.ROW[s.key]?.mode !== 'error') { ui[s.key] = null; paintUnder(s); S.paint(s); }
    }
  }
  // A pause for a set time, beside a behavior's switch: future runs wait, and a
  // run already going carries on.
  const PAUSES = kept.pauses || {};
  const later = (min) => { const s = window.PoiseShell.secs() + min * 60; return `${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`; };
  const pauseHTML = (key) => (PAUSES[key]
    ? `<span class="cline"><span class="fnote">Paused until ${esc(PAUSES[key])} · a run already going carries on</span><button class="btn-ghost" data-act="resume" data-ref="set.beh.pause">Resume</button></span>`
    : '<button class="btn-ghost" data-act="pause" data-ref="set.beh.pause">Pause 15 min</button>');
  const CAPS = [['off', 'Off'], ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => [String(n), `${n} rounds`])];
  function behavior({ id, group = 'Pull requests', label, gloss, value, last, owner = 'bit-mis', see, pausable = false, extra = null }) {
    const key = `beh.${id}`;
    return {
      key, ref: `set.beh.${id}`, group, label, gloss, type: 'behavior', wide: true, value,
      applies: (v) => (v.on === 'on' ? 'from its next run' : 'it stops before its next run'),
      words: (v) => [v.on === 'on' ? 'On' : 'Off', v.ceiling ? `priority ${CEILINGS.find((c) => c[0] === v.ceiling)[1]}` : '', v.reviewers ? `${v.reviewers} reviewer${v.reviewers === '1' ? '' : 's'}` : '', v.cap ? (v.cap === 'off' ? 'no review cap' : `review cap at ${v.cap} rounds`) : '', v.skip ? (v.skip.length ? `skips ${v.skip.join(', ')}` : 'acts in every repository') : '', v.repos ? `acts in ${v.repos.length} repositories for ${v.authors.length} trusted authors` : '', 'memory' in v ? (v.memory ? 'with a memory note' : 'no memory note') : ''].filter(Boolean).join(', '),
      check: (v) => (v.authors?.some((a) => !GITHUB_NAME.test(a)) ? 'a trusted author must be a GitHub login' : ''),
      meta: (s) => [`${s.value.on === 'on' ? '' : 'Off · '}${PAUSES[key] ? `Paused until ${esc(PAUSES[key])} · ` : ''}${last ? `Last run ${stateHTML(last[0], `${esc(last[1])} · ${esc(last[2])}`)}${see ? ` · <a class="lnk" href="${see}&amp;back=settings" data-ref="set.beh.see">See it in Observe</a>` : ''}` : 'Never run'} · acts as <span class="t-mono">${esc(owner)}</span>`, extra?.(s)].filter(Boolean).join('<br>'),
      control: (s) => `<div class="bctl"><span class="cline">${switchHTML(s, { part: 'on' })}${pausable ? `<span data-pause>${pauseHTML(key)}</span>` : ''}</span><div class="bfields">${fieldsHTML(s)}</div></div>`,
      under: underHTML,
      painted: (s, el) => {
        Object.entries(shown).forEach(([k, fn]) => { const n = $(`[data-bval="${k}"]`, el); if (n && k in s.value) n.textContent = fn(s.value); });
        const m = $('[data-act="memory"]', el);
        if (m) { m.textContent = s.value.memory ? 'Edit' : 'Add'; m.setAttribute('aria-expanded', String(ui[key]?.panel === 'memory')); }
        $$('[data-act="choose"]', el).forEach((c) => c.setAttribute('aria-expanded', String(ui[key]?.panel === 'choose')));
        const p = $('[data-pause]', el);
        if (p) { p.innerHTML = pauseHTML(key); hydrate(p); }
      },
      findText: (s) => `${s.value.skip?.join(' ') || ''} ${s.value.repos?.join(' ') || ''} ${s.value.memory || ''}`,
      act: (act) => {
        if (act === 'pause' || act === 'resume') {
          if (act === 'pause') PAUSES[key] = later(15); else delete PAUSES[key];
          save('pauses', PAUSES);
          S.paint(byKey(key));
          const fb = $('[data-pause] button', rowEl(key));
          fb?.focus();
          return;
        }
        if (act === 'to-chain') { const r = rowEl('beh.chain.seed'); r?.scrollIntoView({ block: 'center' }); $('.seg button[aria-pressed="true"]', r)?.focus(); return; }
        behaviorAct(byKey(key), act);
      }
    };
  }

  // ---------- Behaviors: the engine, and the issue-to-merge chain ----------
  // v1 runs each behavior on its own; v2 carries one issue through every step
  // as a chain. Switching drains what runs now, then gives new work to v2.
  const ENGINE = Object.assign({ mode: 'v2', support: 'supported', legacy: ['autonomio/poise#484', 'autonomio/poise#486', 'Acme/Limen#1141'] }, kept.engine || {});
  delete ENGINE.since;
  if (params.get('engine') === 'v1') Object.assign(ENGINE, { mode: 'v1' });
  if (params.get('engine') === 'unsupported') Object.assign(ENGINE, { mode: 'v1', support: 'unsupported' });
  if (params.get('engine') === 'unavailable') Object.assign(ENGINE, { mode: 'v1', support: 'unavailable' });
  // v2 already owns new work, but the setup can no longer prove its cleanup: main pauses v2's admissions.
  if (params.get('engine') === 'paused') Object.assign(ENGINE, { mode: 'v2', support: 'unsupported' });
  let draining = null;
  const SUPPORT = {
    supported: 'This setup supports v2: it can prove every run’s processes and disk are cleaned up.',
    unsupported: 'This setup cannot run v2, because it cannot prove a run’s processes and disk are cleaned up. v1 stays available.',
    unavailable: 'The setup check is unavailable, so switching is off for now.',
    paused: 'v2 is paused: this setup can no longer prove a run’s processes and disk are cleaned up, so no new step starts. Steps already going finish.'
  };
  const engine = {
    key: 'beh.engine', ref: 'set.beh.engine', group: 'Engine', label: 'Behavior engine', type: 'custom', wide: true,
    gloss: 'v1 runs each behavior on its own. v2 carries an issue from review to merge as one chain, with a fresh run for each step and a journal of every step. Switching waits for the runs going now, then gives new work to v2. Chats carry on throughout.',
    control: () => {
      if (ENGINE.mode === 'v2') return `<span class="cline"><span class="fnote"><b>v2 owns new work</b></span><a class="lnk" href="observe.html?tab=tasks&amp;back=settings" data-ref="set.beh.tasks">See every chain in Observe</a></span>${ENGINE.support === 'supported' ? '' : `<p class="fnote is-attn">${esc(SUPPORT.paused)}</p>`}<details class="fsub"><summary data-ref="set.beh.legacy">${ENGINE.legacy.length} pull requests v1 owned at the switch keep v1</summary><ul class="t-mono">${ENGINE.legacy.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></details>`;
      if (ENGINE.mode === 'draining') return `<span class="cline">${stateHTML('waiting', draining.left ? `Switching · ${draining.left} behavior run${draining.left === 1 ? '' : 's'} still finishing` : 'Switching · checking which pull requests v1 keeps')}<button class="btn-ghost" data-act="cancel-switch" data-ref="set.beh.cancel">Cancel the switch</button></span><p class="fnote">New behavior runs wait meanwhile. Chats carry on.</p>`;
      const why = ENGINE.support !== 'supported' ? SUPPORT[ENGINE.support] : '';
      return `<span class="cline"><span class="fnote"><b>v1 owns new work</b></span><button class="btn-ghost" data-act="switch" data-ref="set.beh.switch"${why ? ` aria-disabled="true" data-why="${esc(why)}"` : ''}>Switch to v2</button></span><p class="fnote${ENGINE.support === 'supported' ? '' : ' is-attn'}">${esc(SUPPORT[ENGINE.support])}</p>`;
    },
    findText: () => 'v1 v2 switch engine chain cutover drain',
    act: (act) => {
      if (act === 'switch' && ENGINE.mode === 'v1') {
        ENGINE.mode = 'draining';
        draining = { left: 2, timer: null };
        S.rerow('beh.engine');
        lstat(engine, `<span class="sdot"></span>Accepted ${clock()} · waiting for the runs going now`);
        // The runs going now finish one by one; then the switch checks which pull requests v1 keeps.
        draining.timer = setInterval(() => {
          draining.left -= 1;
          if (draining.left >= 0) { S.rerow('beh.engine'); return; }
          clearInterval(draining.timer);
          Object.assign(ENGINE, { mode: 'v2' });
          save('engine', ENGINE);
          S.rerender();
          lstat(engine, `<span class="sdot is-saved"></span>Switched ${clock()} · new work goes to v2; 3 pull requests keep v1`);
        }, 3500);
      }
      if (act === 'cancel-switch' && ENGINE.mode === 'draining') {
        clearInterval(draining.timer);
        draining = null;
        ENGINE.mode = 'v1';
        S.rerow('beh.engine');
        lstat(engine, `Cancelled ${clock()} · v1 still owns new work`);
      }
    }
  };
  const inV2 = () => ENGINE.mode === 'v2';
  const v2only = () => (!inV2() ? '<span class="is-attn">Applies once v2 owns new work: see Behavior engine, above.</span>' : ENGINE.support !== 'supported' ? '<span class="is-attn">Waits while v2 is paused: see Behavior engine, above.</span>' : '');
  const chainOn = {
    key: 'beh.chain', ref: 'set.beh.chain', group: 'Issue to merge', label: 'Run the chain', type: 'switch', value: 'on', def: 'off',
    gloss: 'Lets new issues enter the chain. Each one moves through issue review, implementation, PR review, repair and merge by itself; a hold or a phase switch still stops it.',
    applies: (v) => (v === 'on' ? 'from the next issue that enters' : 'new issues stop entering; chains already going keep what they own'),
    check: (v) => (v === 'on' && !inV2() ? 'switch the engine to v2 first; v1 owns new work' : ''),
    meta: v2only
  };
  const chainSeed = {
    key: 'beh.chain.seed', ref: 'set.beh.chain.seed', group: 'Issue to merge', label: 'Which issues enter', type: 'seg', value: 'label', def: 'label',
    options: [['label', 'Issues with a label'], ['all', 'Every open issue']],
    gloss: 'Issues with the label below, or every open issue in the organizations you follow. The repositories and authors under Review New Issues apply to legacy work only, as on main.',
    applies: 'from the next issue that enters', unchanged: 'Chains already going.',
    apply: () => setTimeout(() => S.rerow('beh.review-new-issues'))
  };
  const chainLabel = {
    key: 'beh.chain.label', ref: 'set.beh.chain.label', group: 'Issue to merge', label: 'Label', type: 'text', mono: true, value: 'poise', def: 'poise',
    gloss: 'The label that lets an issue in. Add it on GitHub, or when you open an issue on Board.',
    check: (v) => (!v ? 'a label cannot be empty' : v.length > 50 ? 'a label is at most 50 characters' : ''),
    applies: 'from the next issue that enters',
    apply: () => setTimeout(() => S.rerow('beh.review-new-issues')),
    meta: () => (byKey('beh.chain.seed')?.value === 'all' ? 'Not used while every open issue enters.' : '')
  };
  // As main counts it: the behavior lane of Running at once, which keeps one for your own turns from 2.
  const ceiling = () => { const n = Math.max(1, +(byKey('running')?.value ?? 10) || 10); return n - (n >= 2 ? 1 : 0); };
  const chainCapacity = {
    key: 'beh.chain.capacity', ref: 'set.beh.chain.capacity', group: 'Issue to merge', label: 'Capacity', type: 'custom', wide: true, plain: true,
    gloss: 'How much the chain may run at once. The ceiling is shared with other heavy work; the Manager’s worker chats are counted apart.',
    control: () => (inV2()
      ? `<span class="cline"><span class="fnote"><b>2 of ${ceiling()}</b> model runs reserved · memory 3.1 of 8 GB · disk 12 of 40 GB</span></span><p class="fnote">The ceiling is Running at once less the one it keeps for your own turns. A run that does not fit waits, saying for what, and starts when another lets go of its share.</p>`
      : '<span class="fnote">Nothing reserved: v1 owns new work.</span>')
  };
  const BEHAVIORS = [
    behavior({ id: 'review-new-prs', see: 'observe.html?pr=autonomio/poise%23486', label: 'Review New Pull Requests', gloss: 'Reviews each new pull request of yours with the PR review model, and posts the review as the automation account.', value: { on: 'on', ceiling: 'p2', reviewers: '2', skip: [], memory: 'Name the missing test first. One finding per comment.' }, last: ['done', '19:12', 'reviewed autonomio/poise#486'] }),
    behavior({ id: 'approve-prs', see: 'observe.html?pr=autonomio/poise%23484', label: 'Approve Pull Requests', gloss: 'Looks again when you have addressed the automation account’s change request, or when a clean pull request asks for its approval, and approves when it holds. The review cap applies to legacy work only: a chain repairs until every blocker is gone, or holds.', value: { on: 'on', cap: '5', skip: [], memory: '' }, last: ['done', '18:55', 'approved autonomio/poise#484'] }),
    behavior({ id: 'resolve-unblocking', see: 'observe.html?pr=autonomio/poise%23471', label: 'Resolve Unblocking Conversations', gloss: 'When a pull request of yours is approved and green, resolves the conversations that only block the merge, so you can merge it.', value: { on: 'on', skip: ['mikkokotila/personal-site'] }, last: ['done', '17:20', 'resolved 2 conversations on autonomio/poise#471'] }),
    behavior({ id: 'rerun-grey-ci', see: 'observe.html?tab=logging&amp;event=grey', label: 'Rerun Grey CI', gloss: 'Reruns checks on your pull requests that finished without a result.', value: { on: 'on', skip: [] }, last: ['waiting', '18:40', 'GitHub’s API limit; it tries again at 19:50'] }),
    behavior({ id: 'merge-prs', label: 'Merge Pull Requests', gloss: 'Merges your pull requests once they are approved and every check passes. Through a merge queue it says Enqueued until GitHub merges.', value: { on: 'off', skip: [] }, last: null }),
    behavior({ id: 'review-new-issues', see: 'observe.html?pr=autonomio/poise%23483', group: 'Issues', label: 'Review New Issues', gloss: 'Reviews each new issue and comments as the review agent. Under v2 those are the issues that enter the chain; under v1, the ones in the repositories you choose, from authors you trust. Replaying a review reviews the revision the issue holds now.', value: { on: 'on', reviewers: '1', repos: ['autonomio/poise', 'Acme/Limen'], authors: ['mikkokotila'], memory: '' }, last: ['done', '16:03', 'reviewed autonomio/poise#483'],
      extra: () => (inV2() ? `In v2, the issues it reviews are the chain’s: ${byKey('beh.chain.seed')?.value === 'all' ? 'every open issue' : `label <span class="t-mono">${esc(byKey('beh.chain.label')?.value || 'poise')}</span>`}. <a class="lnk" href="#behaviors" data-ref="set.link" data-act="to-chain">Which issues enter</a>` : '') }),
    chainOn, chainSeed, chainLabel,
    behavior({ id: 'implement-issues', see: 'observe.html?tab=tasks&amp;task=t488', group: 'Issue to merge', label: 'Implement Issues', gloss: 'Implements a reviewed issue in one fresh run, publishes its branch and opens the pull request. No chat stays running.', value: { on: 'on', memory: 'Keep each change to one concern.' }, last: ['done', '19:20', 'opened autonomio/poise#492 for #488'], owner: 'mikkokotila', pausable: true, extra: v2only }),
    behavior({ id: 'repair-prs', see: 'observe.html?tab=tasks&amp;task=t498', group: 'Issue to merge', label: 'Repair Pull Requests', gloss: 'Answers review findings, failing or stuck CI, conflicts and a queue rejection, one fresh run each. Every repair makes a new head, which is reviewed afresh.', value: { on: 'on', memory: '' }, last: ['running', '19:38', 'repairing autonomio/poise#499 · round 2'], owner: 'mikkokotila', pausable: true, extra: v2only }),
    chainCapacity
  ];
  define('behaviors', { rows: [engine, ...BEHAVIORS] });

  // ---------- Snippets ----------
  const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'snippet';
  const SNIPS = kept.snippets || [
    { id: 'n1', trigger: 'guideline', text: 'Review this against AUTONOMIO_PR_GUIDELINE.md: scope, tests, and the issue it closes.' },
    { id: 'n2', trigger: 'brief', text: 'Check this against the Poise Interface and Interaction Brief, section by section, and say which sections it does not meet.' },
    { id: 'n3', trigger: 'pr', text: 'Open a pull request with this change, and link the issue it closes.' },
    { id: 'n4', trigger: 'ty', text: 'Thank you, this helps.' }
  ];
  // The Manager's standing instructions are the built-in /manager snippet: edited here like any
  // snippet, never renamed or deleted, and carried by every Manager turn.
  // Workers carry the built-in /worker snippet the same way, on every turn.
  // The shipped text, word for word: the numbered rules, then the closing paragraph.
  const charterText = (list) => `${(list || []).map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\n${window.POISE_POLICY?.closing || ''}`;
  if (!SNIPS.some((n) => n.id === 'manager')) SNIPS.unshift({ id: 'manager', trigger: 'manager', builtin: true, text: charterText(window.POISE_POLICY?.instructions) });
  if (!SNIPS.some((n) => n.id === 'worker')) SNIPS.splice(SNIPS.findIndex((n) => n.id === 'manager') + 1, 0, { id: 'worker', trigger: 'worker', builtin: true, text: charterText(window.POISE_POLICY?.worker) });
  const BUILTIN = { manager: 'The Manager’s standing instructions', worker: 'Every worker’s standing instructions' };
  if (['manager', 'worker'].includes(params.get('open'))) SNIPS.find((n) => n.id === params.get('open')).open = true;
  // Snippets saved from a selection in Editor arrive here, once each.
  const seen = new Set(kept.snipsSeen || []);
  store.get('poise-snippets-v1', []).filter((x) => !seen.has(x.id)).forEach((x) => {
    let t = slug(x.name), n = 2;
    while (SNIPS.some((s) => s.trigger === t)) t = `${slug(x.name).slice(0, 21)}-${n++}`;
    SNIPS.unshift({ id: nid('n'), trigger: t, text: x.text, from: x.id, fresh: true });
    seen.add(x.id);
  });
  let importing = false;
  const snippets = {
    key: 'snippets', group: 'Snippets', label: 'Your snippets', gloss: 'Each is also a Chat skill: ;name expands it anywhere through Espanso, and /name adds it in Chat. Skills saved with /create in Chat appear here too.', type: 'list', wide: true,
    items: () => SNIPS, id: (n) => n.id, name: (n) => `;${n.trigger}`, itemRef: 'set.snippet.row', removeRef: 'set.snippet.delete',
    save: () => { kept.snipsSeen = [...seen]; save('snippets', SNIPS.filter((n) => !n.gone && !n.draft).map(({ id, trigger, text, from, builtin }) => ({ id, trigger, text, from, builtin }))); },
    itemHTML: (n) => `<span class="fmain"><span class="name t-mono">${n.draft ? 'New snippet' : `;${esc(n.trigger)}`}</span><span class="fsub">${esc(short(n.text || 'Not saved yet', 96))}</span></span><span class="fstate">${n.builtin ? `<span class="chip is-outline" data-ref="set.snippet.builtin">${BUILTIN[n.id] || 'Built in'}</span>` : ''}${n.fresh ? '<span class="chip is-agent" data-ref="set.snippet.fresh">From Editor</span>' : ''}${n.draft ? '' : `<span class="fnote t-mono">/${esc(n.trigger)} in Chat</span>`}</span><span class="facts">${n.draft ? '' : `<button class="btn-ghost" data-act="edit" aria-expanded="${!!n.open}" data-ref="set.snippet.edit">${n.open ? 'Close' : 'Edit'}</button>`}</span>`,
    underItem: (n) => `<div class="sned"><label class="bf"><span class="t-micro">Trigger</span><span class="sfield"><span class="t-mono pre" aria-hidden="true">;</span><input class="sinput t-mono is-short" value="${esc(n.trigger)}" placeholder="name" aria-label="Trigger, after the semicolon" data-trigger${n.builtin ? ` readonly aria-readonly="true" title="Built in: the name stays ${esc(n.trigger)}"` : ''}></span></label><label class="bf wide"><span class="t-micro">Text</span><textarea class="sarea" rows="${n.builtin ? 8 : 4}" placeholder="Text to expand, or instructions to add in Chat" aria-label="Text" data-text>${esc(n.text)}</textarea></label>${n.err ? `<p class="fwarn is-err">Not saved: ${esc(n.err)}.</p>` : ''}<div class="fbtns"><button class="btn-ghost" data-act="sn-save" data-ref="set.snippet.save">Save</button><button class="btn-ghost" data-act="sn-cancel" data-ref="set.cancel">${n.draft ? 'Discard' : 'Cancel'}</button></div></div>`,
    nowItem: (n) => (n.draft ? 'A new snippet, not saved yet.' : `;${n.trigger}: ${short(n.text, 60)} Also /${n.trigger} in Chat.`),
    removable: (n) => (n.draft || n.builtin ? '' : `Delete ;${n.trigger}`), goneWords: () => 'Deleted · no longer expands, or appears in Chat',
    now: () => `${SNIPS.filter((n) => !n.gone && !n.draft).length} snippets.`,
    findText: () => SNIPS.map((n) => `${n.trigger} ${n.text}`).join(' '),
    extra: () => `<div class="fbtns"><button class="btn-ghost" data-act="sn-new" data-ref="set.snippet.add"><i data-i="plus" class="sm"></i>Add snippet</button><button class="btn-ghost" data-act="sn-import" aria-expanded="${importing}" data-ref="set.snippet.import">Import from Espanso</button></div>${importing ? '<div class="bpanel"><label class="t-micro" for="sn-import">Espanso matches, as in a match file</label><textarea id="sn-import" class="sarea t-mono" rows="5" spellcheck="false" placeholder="- trigger: &quot;:hi&quot;&#10;  replace: Hello" data-import data-ref="set.snippet.import"></textarea><div class="fbtns"><button class="btn-ghost" data-act="sn-import-run" data-ref="set.snippet.import.run">Import</button><button class="btn-ghost" data-act="sn-import" data-ref="set.cancel">Cancel</button></div></div>' : ''}`,
    act: (act, n) => snippetAct(act, n)
  };
  function snippetAct(act, n) {
    const s = snippets, el = n && inItem(s, n);
    if (act === 'edit') { n.open = !n.open; n.err = ''; paintItem(s, n); if (n.open) $('[data-text]', inItem(s, n))?.focus(); }
    if (act === 'sn-cancel') { if (n.draft) { dropItem(s, n); return; } Object.assign(n, { open: false, err: '' }); paintItem(s, n); $('[data-act="edit"]', inItem(s, n))?.focus(); }
    if (act === 'sn-save') {
      const trigger = $('[data-trigger]', el).value.trim().replace(/^[;:/]/, ''), text = $('[data-text]', el).value.trim();
      const err = n.builtin ? (!text ? 'the text is empty' : new Blob([text]).size > 65536 ? 'it must fit in 64 KiB' : '') : !/^[a-z0-9][a-z0-9_-]{0,31}$/i.test(trigger) ? 'a trigger is letters, digits, - and _, up to 32 of them' : SNIPS.some((x) => x !== n && !x.gone && !x.draft && x.trigger.toLowerCase() === trigger.toLowerCase()) ? `;${trigger} is already a snippet` : !text ? 'the text is empty' : '';
      Object.assign(n, { trigger, text });
      if (err) { n.err = err; paintItem(s, n); $('[data-trigger]', inItem(s, n))?.focus(); return; }
      Object.assign(n, { err: '', open: false });
      delete n.draft;
      delete n.fresh;
      paintItem(s, n);
      s.save();
      lstat(s, `<span class="sdot is-saved"></span>Saved ;${esc(trigger)} ${clock()} · it expands on your paired computers now, and /${esc(trigger)} works in Chat`);
    }
    if (act === 'sn-new') {
      const open = SNIPS.find((x) => x.draft);
      if (open) { $('[data-trigger]', inItem(s, open))?.focus(); return; }
      const d = { id: nid('n'), trigger: '', text: '', draft: true, open: true };
      SNIPS.unshift(d);
      addItem(s, d, { top: true });
      $('[data-trigger]', inItem(s, d))?.focus();
    }
    if (act === 'sn-import') { importing = !importing; paintExtra(s); if (importing) $('[data-import]')?.focus(); }
    if (act === 'sn-import-run') {
      const t = $('[data-import]').value;
      const pairs = [...t.matchAll(/trigger:\s*["']?[;:]?([A-Za-z0-9_-]+)["']?\s*\n\s*replace:\s*["']?([^\n]*?)["']?\s*(?=\n|$)/g)];
      const added = pairs.filter(([, trig]) => !SNIPS.some((x) => !x.gone && x.trigger.toLowerCase() === trig.toLowerCase())).map(([, trigger, text]) => ({ id: nid('n'), trigger, text }));
      added.forEach((x) => { SNIPS.push(x); addItem(s, x); });
      importing = false;
      paintExtra(s);
      s.save();
      lstat(s, pairs.length ? `<span class="sdot is-saved"></span>Imported ${added.length} of ${pairs.length}${added.length < pairs.length ? '; the rest have triggers you already use' : ''}` : '<span class="is-err">Nothing imported: no trigger and replace pairs found.</span>');
    }
  }
  define('snippets', { rows: [snippets] });

  // ---------- Admin ----------
  const BUDGET = '25 GB';
  const PEOPLE = kept.people || [
    { login: 'mikkokotila', admin: true, self: true, state: 'running', since: '08:02', access: 'Admin', last: 'today, 08:01', disk: '18.4 GB' },
    { login: 'octocat', state: 'idle', access: 'Allowed login', last: '20 Oct, 16:40', disk: '2.1 GB' },
    { login: 'hubot', state: 'failed', access: 'Member of autonomio', last: '19 Oct, 09:15', disk: '31.0 GB', over: true, error: 'The workspace image could not be pulled: manifest unknown.' }
  ];
  const personState = (p) => (p.disabled ? '<span class="fnote">Disabled · cannot sign in</span>' : p.busy ? stateHTML('waiting', p.busy) : p.state === 'running' ? stateHTML('running', `since ${esc(p.since)}`) : p.state === 'idle' ? stateHTML('idle', 'stopped') : stateHTML('failed', 'did not start'));
  const pbtn = (act, label, why = '') => `<button class="btn-ghost" data-act="${act}" data-ref="set.person.${act}"${why ? ` aria-disabled="true" data-why="${esc(why)}"` : ''}>${label}</button>`;
  // Start, Stop and Restart always sit together, so nothing moves when a
  // workspace changes state; the ones that do not apply say why.
  function personActs(p) {
    const all = p.busy ? `It is ${p.busy.replace('…', '')}.` : p.disabled ? 'Disabled: Enable it first.' : '';
    const a = [
      pbtn('start', 'Start', all || (p.state === 'running' ? 'It is running.' : '')),
      pbtn('stop', 'Stop', all || (p.state !== 'running' ? 'It is not running.' : '')),
      pbtn('restart', 'Restart', all || (p.state === 'idle' ? 'It is stopped: Start it.' : ''))
    ];
    if (!p.self) a.push(p.disabled ? pbtn('enable', 'Enable', p.busy ? all : '') : pbtn('disable', 'Disable', p.busy ? all : ''));
    return a.join('');
  }
  const people = {
    key: 'people', group: 'People and workspaces', label: 'People', gloss: 'Everyone who has signed in, and their workspace. You cannot disable yourself.', type: 'list', wide: true,
    items: () => PEOPLE, id: (p) => p.login, name: (p) => p.login, itemRef: 'set.person.row',
    save: () => save('people', PEOPLE.map(({ busy, ...p }) => p)),
    itemHTML: (p) => `<span class="fmain"><span class="name t-mono">${esc(p.login)}${p.admin ? ' <span class="chip is-outline">admin</span>' : ''}</span><span class="fsub">${esc(p.access)} · last sign-in ${esc(p.last)} · <span class="${p.over ? 'is-attn' : ''}">${esc(p.disk)} on disk${p.over ? `, over its ${BUDGET} budget` : ''}</span></span>${p.state === 'failed' && !p.busy && p.error ? `<span class="fsub is-err">${esc(p.error)}</span>` : ''}</span><span class="fstate">${personState(p)}</span><span class="facts">${personActs(p)}</span>`,
    nowItem: (p) => `${p.login}${p.admin ? ', admin' : ''}: ${p.disabled ? 'disabled' : p.busy ? `Waiting, ${p.busy}` : p.state === 'running' ? `Running since ${p.since}` : p.state === 'idle' ? 'Idle, stopped' : `Failed: ${p.error}`}. ${p.disk} on disk${p.over ? `, over the ${BUDGET} budget` : ''}.`,
    now: () => `${PEOPLE.length} people; ${PEOPLE.filter((p) => p.state === 'running' && !p.disabled).length} workspaces running, ${PEOPLE.filter((p) => p.state === 'failed').length} failed.`,
    findText: () => PEOPLE.map((p) => p.login).join(' '),
    act: (act, p, b) => {
      const run = (busy, to, ms = 1800) => {
        p.busy = busy;
        paintItem(people, p);
        setTimeout(() => { delete p.busy; Object.assign(p, to); paintItem(people, p); people.save(); lstat(people, `<span class="sdot is-saved"></span>${esc(p.login)}’s workspace is ${to.state === 'running' ? 'Running' : 'Idle'} · ${clock()}`); }, ms);
      };
      if (act === 'start') run('starting…', { state: 'running', since: clock() });
      if (act === 'stop') run('stopping…', { state: 'idle' });
      if (act === 'restart') run('restarting…', { state: 'running', since: clock(), error: '' }, 2400);
      if (act === 'disable') {
        if (!arm(b)) return;
        Object.assign(p, { disabled: true, state: 'idle' });
        paintItem(people, p);
        people.save();
        lstat(people, `${esc(p.login)} disabled ${clock()} · they cannot sign in, and their workspace is stopped · <button class="lnk" data-act="enable-again" data-login="${esc(p.login)}" data-ref="set.undo">Undo</button>`);
      }
      if (act === 'enable' || act === 'enable-again') {
        const q = p || PEOPLE.find((x) => x.login === b.dataset.login);
        q.disabled = false;
        paintItem(people, q);
        people.save();
        lstat(people, `<span class="sdot is-saved"></span>${esc(q.login)} can sign in again`);
      }
    }
  };
  const disk = { key: 'disk', group: 'People and workspaces', label: 'Server disk', gloss: 'The gateway’s disk, shared by every workspace. Poise warns when less than a tenth is free.', type: 'custom', plain: true, control: () => '<span class="cline"><span class="fnote">412 GB free of 1 TB</span><span class="t-gloss">measured 19:30</span></span>' };
  const ALLOWED = kept.allowed || [{ login: 'octocat', by: 'mikkokotila' }, { login: 'hubot', env: true }];
  const allow = {
    key: 'allow', group: 'Who may sign in', label: 'Allowed logins', gloss: 'Admins (mikkokotila) may always sign in, and so may members of Acme and autonomio. Add anyone else by their GitHub login.', type: 'list', wide: true, mono: true,
    items: () => ALLOWED, id: (a) => a.login, name: (a) => a.login, itemRef: 'set.allow.row', removeRef: 'set.allow.remove',
    save: () => save('allowed', ALLOWED.filter((a) => !a.gone).map(({ login, by, env }) => ({ login, by, env }))),
    itemHTML: (a) => `<span class="fmain"><span class="name t-mono">${esc(a.login)}</span></span><span class="fstate"><span class="fnote">${a.env ? 'Server configuration' : `added by ${esc(a.by)}`}</span></span>`,
    nowItem: (a) => `${a.login}: ${a.env ? 'allowed by the server configuration, so it is removed there' : `allowed, added by ${a.by}`}.`,
    removable: (a) => (a.env ? '' : `Remove ${a.login}`), goneWords: () => 'Removed · can no longer sign in',
    now: () => `${ALLOWED.filter((a) => !a.gone).length} logins, besides admins and the allowed organizations.`,
    findText: () => ALLOWED.map((a) => a.login).join(' '),
    add: {
      placeholder: 'GitHub login', aria: 'GitHub login to allow', mono: true, label: 'Allow', ref: 'set.allow.add', inputRef: 'set.allow.input',
      check: (v) => (!GITHUB_NAME.test(v) ? 'Not allowed: enter a GitHub login, not a URL or an email.' : ALLOWED.some((a) => !a.gone && a.login.toLowerCase() === v.toLowerCase()) ? `${esc(v)} may already sign in.` : ''),
      create: (login) => ({ login, by: S.value('me') || 'you' }),
      then: (a) => lstat(allow, `<span class="sdot is-saved"></span>${esc(a.login)} may sign in from now on`)
    }
  };
  const gateway = { key: 'gateway', group: 'Gateway', label: 'Gateway administration', gloss: 'The gateway’s own admin page, for when your workspace is unavailable.', type: 'custom', plain: true, control: () => '<a class="btn-ghost" aria-disabled="true" data-ref="set.gateway">Open gateway administration</a>' };
  define('admin', { rows: [people, disk, allow, gateway] });

  // ---------- Style ----------
  // The same choices as the Style panel (style.js keeps them); each row writes one token.
  const ST = window.PoiseStyle;
  const tok = (prop) => ST.token(prop);
  const PRESET_KEYS = ['--ctl-base-size', '--ctl-density'];
  const num = (v) => parseFloat(v);
  const LINE_WORDS = { '-0.25': 'Tighter by ¼ line', 0: 'None', 0.25: '¼ line', 0.5: '½ line', 0.75: '¾ line', 1: '1 line' };
  function tokenRow({ key, prop, group, label, gloss, min, max, step, fmt, unit = '', wide = false }) {
    const row = {
      key: `style.${key}`, ref: `set.style.${key}`, group, label, gloss, type: 'range', own: true, wide, prop,
      value: tok(prop), def: ST.defaultOf(prop), applies: 'applies now, in every view',
      read: () => tok(prop),
      words: (v) => fmt(num(v)),
      control: (r) => `<span class="srange"><input type="range" min="${min}" max="${max}" step="${step}" value="${num(r.value)}" aria-label="${esc(label)}" data-range data-ref="set.style.${key}"><output data-range-out>${esc(fmt(num(r.value)))}</output></span>`,
      // While you drag, the page shows it; letting go saves it.
      onInput: (e) => { if (!e.target.matches('[data-range]')) return false; document.documentElement.style.setProperty(prop, `${e.target.value}${unit}`); $('[data-range-out]', rowEl(row.key)).textContent = fmt(num(e.target.value)); return true; },
      onChange: (e) => { if (!e.target.matches('[data-range]')) return false; commit(row, `${e.target.value}${unit}`); return true; },
      apply: (v) => ST.set(prop, v === row.def ? null : v),
      painted: (r, el) => { const input = $('[data-range]', el); if (document.activeElement !== input) input.value = num(r.value); $('[data-range-out]', el).textContent = fmt(num(r.value)); }
    };
    return row;
  }
  const presetIn = () => Object.entries(ST.PRESETS).find(([, p]) => Object.entries(p.values).every(([k, v]) => tok(k) === v))?.[0] || '';
  let presetBefore = null;
  const preset = {
    key: 'style.preset', ref: 'set.style.preset', group: 'Start from', label: 'Preset', gloss: 'A starting point for size and density. Every row below stays yours to change.', type: 'custom', wide: true,
    control: () => `<div class="choices is-4" role="group" aria-label="Presets" data-ref="set.style.preset">${Object.entries(ST.PRESETS).map(([k, p]) => `<button class="choice" data-act="preset" data-v="${k}" aria-pressed="${presetIn() === k}"><b>${p.label}</b><span>${p.gloss}</span></button>`).join('')}</div>`,
    painted: (r, el) => $$('[data-act="preset"]', el || rowEl(r.key)).forEach((b) => b.setAttribute('aria-pressed', String(presetIn() === b.dataset.v))),
    act: (act, b) => {
      if (act === 'preset') {
        presetBefore = ST.saved();
        const p = ST.PRESETS[b.dataset.v];
        // Each row the preset touches saves on its own row, with its own Undo.
        STYLE.filter((r) => PRESET_KEYS.includes(r.prop)).forEach((r) => commit(r, p.values[r.prop]));
        lstat(preset, `<span class="sdot is-saved"></span>Starting from ${p.label} ${clock()} · applies now · <button class="lnk" data-act="preset-undo" data-ref="set.undo">Undo</button>`);
      }
      if (act === 'preset-undo' && presetBefore) { ST.restore(presetBefore); presetBefore = null; STYLE.filter((r) => PRESET_KEYS.includes(r.prop)).forEach(S.settle); lstat(preset, 'Back to what you had'); }
    }
  };
  const typeface = {
    key: 'style.type', ref: 'set.style.type', group: 'Type', label: 'Typeface', gloss: 'The faces for the interface, for headings and display, and for code, chosen to belong together.', type: 'choice', own: true, wide: true,
    value: ST.archetype(), def: 'engineer', applies: 'applies now, in every view',
    read: () => ST.archetype(),
    words: (v) => `${ST.ARCHETYPES[v].label}: ${ST.ARCHETYPES[v].gloss}`,
    control: (r) => `<div class="choices is-3" role="group" aria-labelledby="l-style.type" data-ref="set.style.type">${Object.entries(ST.ARCHETYPES).map(([k, a]) => `<button class="choice" data-act="face" data-v="${k}" aria-pressed="${k === r.value}"><b>${a.label}</b><span>${a.gloss}</span></button>`).join('')}</div>`,
    painted: (r, el) => $$('[data-act="face"]', el).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === r.value))),
    apply: (v) => ST.setArchetype(v),
    act: (act, b) => { if (act === 'face') commit(typeface, b.dataset.v); }
  };
  const motion = {
    key: 'style.motion', ref: 'set.style.motion', group: 'Space and shape', label: 'Motion', gloss: 'The Tactile spring when things open, settle and reorder. Off keeps everything still; nothing waits on an animation.', type: 'switch', own: true,
    value: tok('--ctl-motion') === '0' ? 'off' : 'on', def: 'on', options: [['on', 'On'], ['off', 'Off']], applies: 'applies now, in every view',
    read: () => (tok('--ctl-motion') === '0' ? 'off' : 'on'),
    apply: (v) => ST.set('--ctl-motion', v === 'on' ? null : '0')
  };
  // The meaning colours and the neutrals: one item per token, each with its own Reset.
  let colourBefore = null, neutralsOpen = false;
  const hex = (prop) => ST.toHex(tok(prop));
  function palette({ key, label, gloss, list, folded }) {
    const row = {
      key: `style.${key}`, ref: `set.style.${key}`, group: 'Colour', label, gloss, type: 'list', wide: true,
      items: () => (folded && !neutralsOpen ? [] : list.map(([prop, name, note]) => ({ prop, name, note }))), id: (c) => c.prop, name: (c) => c.name, itemRef: 'set.style.colour.row', save: () => {},
      itemHTML: (c) => { const changed = hex(c.prop) !== ST.toHex(ST.defaultOf(c.prop)); return `<span class="fmain"><span class="name">${esc(c.name)}</span>${c.note ? `<span class="fsub">${esc(c.note)}</span>` : ''}</span><span class="fstate">${changed ? '<button class="lnk" data-act="c-reset" data-ref="set.reset">Reset</button>' : '<span class="fnote">Default</span>'}</span><span class="facts"><input type="color" value="${hex(c.prop)}" aria-label="${esc(c.name)} colour" data-colour data-ref="set.style.colour"></span>`; },
      nowItem: (c) => `${c.name}: ${hex(c.prop)}${hex(c.prop) !== ST.toHex(ST.defaultOf(c.prop)) ? `, changed from Poise’s ${ST.toHex(ST.defaultOf(c.prop))}` : ', Poise’s own'}.`,
      now: () => { const n = list.filter(([prop]) => hex(prop) !== ST.toHex(ST.defaultOf(prop))).length; return n ? `${n} of ${list.length} changed from Poise’s own.` : `All ${list.length} are Poise’s own.`; },
      empty: folded ? `Folded: ${list.length} colours, from Canvas to Strongest.` : '',
      extra: folded ? () => `<button class="btn-ghost" data-act="fold" aria-expanded="${neutralsOpen}" data-ref="set.style.neutrals">${neutralsOpen ? 'Fold the neutrals' : 'Show the neutrals'}</button>` : undefined,
      findText: () => list.map(([, n, note]) => `${n} ${note || ''}`).join(' '),
      onInput: (e) => { if (!e.target.matches('[data-colour]')) return false; document.documentElement.style.setProperty(e.target.closest('[data-item]').dataset.item, e.target.value); return true; },
      onChange: (e) => {
        if (!e.target.matches('[data-colour]')) return false;
        const prop = e.target.closest('[data-item]').dataset.item, c = row.items().find((x) => x.prop === prop);
        colourBefore = ST.saved();
        ST.set(prop, e.target.value);
        paintItem(row, c);
        lstat(row, `<span class="sdot is-saved"></span>Saved ${esc(c.name)} ${clock()} · applies now, in every view · <button class="lnk" data-act="c-undo" data-ref="set.undo">Undo</button>`);
        return true;
      },
      act: (act, c) => {
        if (act === 'c-reset') { colourBefore = ST.saved(); ST.set(c.prop, null); paintItem(row, c); lstat(row, `<span class="sdot is-saved"></span>${esc(c.name)} is Poise’s own again · <button class="lnk" data-act="c-undo" data-ref="set.undo">Undo</button>`); }
        if (act === 'c-undo' && colourBefore) { ST.restore(colourBefore); colourBefore = null; row.items().forEach((x) => paintItem(row, x)); lstat(row, 'Back to the colours you had'); }
        if (act === 'fold') { neutralsOpen = !neutralsOpen; S.rerow(row.key); }
      }
    };
    return row;
  }
  let styleBefore = null;
  const STYLE = [
    preset,
    typeface,
    tokenRow({ key: 'size', prop: '--ctl-base-size', group: 'Type', label: 'Base size', gloss: 'Every size of type and control derives from this one, including rows and tables.', min: 13, max: 18, step: 0.5, unit: 'px', fmt: (v) => `${v}px` }),
    tokenRow({ key: 'leading', prop: '--ctl-leading', group: 'Type', label: 'Line height', gloss: 'The space between lines of reading and body text, shown for reading text. Interface labels keep theirs.', min: 0.85, max: 1.3, step: 0.05, fmt: (v) => (1.7 * v).toFixed(2) }),
    tokenRow({ key: 'density', prop: '--ctl-density', group: 'Space and shape', label: 'Density', gloss: 'Space inside and between things: rows, cards and controls.', min: 0.75, max: 1.35, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` }),
    tokenRow({ key: 'corners', prop: '--ctl-radius', group: 'Space and shape', label: 'Corners', gloss: 'From square to round, on every card, field and panel.', min: 0, max: 2, step: 0.25, fmt: (v) => (v === 0 ? 'Square' : `${v.toFixed(2)}×`) }),
    tokenRow({ key: 'lines', prop: '--ctl-line', group: 'Space and shape', label: 'Route lines', gloss: 'The weight of routes and their stations, in Board, Chat and the Manager.', min: 0.6, max: 1.6, step: 0.1, fmt: (v) => `${v.toFixed(1)}×` }),
    motion,
    tokenRow({ key: 'measure', prop: '--ctl-measure', group: 'Writing', label: 'Reading width', gloss: 'How wide a page of text runs in Editor and Settings. The other views fill the window.', min: 0.8, max: 1.3, step: 0.05, fmt: (v) => `${Math.round(760 * v)}px` }),
    tokenRow({ key: 'heading', prop: '--ctl-heading', group: 'Writing', label: 'Heading size', gloss: 'A document’s headings, and the space around them, which grows with them so they stay one family.', min: 0.8, max: 1.4, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` }),
    tokenRow({ key: 'paragraph', prop: '--ctl-paragraph', group: 'Writing', label: 'Paragraph spacing', gloss: 'Extra space after each paragraph in Editor, in lines. None keeps the empty line you type as the only gap.', min: -0.25, max: 1, step: 0.25, fmt: (v) => LINE_WORDS[v] ?? `${v} line` }),
    tokenRow({ key: 'tints', prop: '--ctl-tint', group: 'Colour', label: 'Status tints', gloss: 'How strongly a state colours its chip and its background.', min: 10, max: 35, step: 1, unit: '%', fmt: (v) => `${v}%` }),
    palette({ key: 'colours', label: 'Meaning colours', gloss: 'One colour per state word, then information and Poise acting on its own. Idle has no colour: it is hollow. Chips, routes and tints follow.', list: ST.MEANINGS }),
    palette({ key: 'neutrals', label: 'Neutrals', gloss: 'The dark stack every surface and text is made from. Contrast follows these, so change them with care.', list: ST.NEUTRALS, folded: true }),
    {
      key: 'style.copy', ref: 'set.style.copy', group: 'Keep and share', label: 'Copy as CSS', gloss: 'Your changes as CSS custom properties, to keep or to share.', type: 'custom',
      control: () => '<button class="btn-ghost" data-act="copy" data-ref="set.style.copy"><i data-i="copy" class="sm"></i><span>Copy as CSS</span></button>',
      act: (act, b) => { if (act !== 'copy') return; navigator.clipboard?.writeText(ST.css()).catch(() => {}); const n = Object.keys(ST.saved()).filter((k) => k !== '--archetype').length; lstat(byKey('style.copy'), n ? `Copied ${n} change${n === 1 ? '' : 's'} as CSS` : 'Copied · there are no changes yet, so it is empty'); $('span', b).textContent = 'Copied'; setTimeout(() => { if (b.isConnected) $('span', b).textContent = 'Copy as CSS'; }, 1400); }
    },
    { key: 'style.guide', ref: 'set.style.guide', group: 'Keep and share', label: 'Style guide', gloss: 'Every token and component, drawn with your choices.', type: 'custom', plain: true, control: () => '<a class="btn-ghost" href="guide.html" data-ref="set.style.guide">Open the style guide</a>' },
    {
      key: 'style.reset', ref: 'set.style.reset', group: 'Keep and share', label: 'Reset everything', gloss: 'Back to Poise’s own style, every row at once. Undo stays for eight seconds.', type: 'custom',
      control: () => '<button class="btn-ghost" data-act="reset-all" data-ref="set.style.reset">Reset everything</button>',
      act: (act, b) => {
        const r = byKey('style.reset');
        if (act === 'reset-all') { if (!arm(b)) return; styleBefore = ST.saved(); ST.restore({}); STYLE.filter((x) => x.read).forEach(S.settle); lstat(r, `<span class="sdot is-saved"></span>Back to Poise ${clock()} · applies now · <button class="lnk" data-act="reset-undo" data-ref="set.undo">Undo</button>`); setTimeout(() => { if (styleBefore) { styleBefore = null; lstat(r, `Back to Poise ${clock()}`); } }, S.UNDO_MS); }
        if (act === 'reset-undo' && styleBefore) { ST.restore(styleBefore); styleBefore = null; STYLE.filter((x) => x.read).forEach(S.settle); lstat(r, 'Your style is back'); }
      }
    }
  ];
  // The panel, a preset or Undo can change a token: every Style row follows.
  document.addEventListener('poise:style', () => {
    if (S.current() !== 'style') return;
    STYLE.forEach((r) => {
      if (r.read) { const v = r.read(); if (v !== r.value) { r.value = v; S.paint(r, { value: true }); } }
      if (r.type === 'list') r.items().forEach((c) => paintItem(r, c));
    });
    preset.painted(preset);
  });
  define('style', { rows: STYLE, scope: 'This browser' });

  // ---------- Manager ----------
  // The same settings as the Manager's controls in its place (manager.js reads these keys).
  const POLICY = window.POISE_POLICY;
  // null is every followed repository, as on main; a list narrows the Manager to those.
  const SCOPE = ((v) => (v === null || Array.isArray(v) ? v : POLICY.scope))(store.get('poise-mgr-scope', POLICY.scope));
  const mgrEffect = () => POLICY.effect(rhythm.value, stability.value, autonomy.value, POLICY.paused.get());
  const repaintEffect = () => { const el = rowEl('mgr.effect'); if (!el) return; $('[data-effect]', el).textContent = mgrEffect(); $('[data-scope-line]', el).textContent = `Scope: ${esc(POLICY.scopeWords(scope.value))}`; el.dataset.now = mgrEffect(); };
  const effect = {
    key: 'mgr.effect', ref: 'mgr.effective', group: 'In effect', label: 'What the three add up to', gloss: 'Your three controls, read together. They ride on every Manager turn with its scope and pause, and take precedence over its standing instructions.', type: 'custom', plain: true, wide: true,
    now: () => mgrEffect(),
    control: () => `<div class="seffect" data-ref="mgr.effective"><p class="sentence" data-effect>${esc(mgrEffect())}</p><span class="t-gloss" data-ref="mgr.scope" data-scope-line>Scope: ${esc(POLICY.scopeWords(scope.value))}</span></div>`
  };
  const slotsHTML = (n) => [...Array(10)].map((_, k) => `<span class="slot ${k < n ? 'free' : 'off'}"></span>`).join('');
  const rhythm = {
    key: 'mgr.rhythm', ref: 'mgr.rhythm', group: 'Controls', label: 'Rhythm', gloss: 'How many workers the Manager keeps on tasks at once. Each holds its slot from the moment it takes a task until you close its chat: running, waiting for you, blocked, between turns, or done. The Manager fills a free slot on its next turn, and its own chat never uses one. When slots sit idle for 15 minutes and the enhancement backlog is empty, Poise tells you, with issues to label.', type: 'stepper', own: true, wide: true,
    value: Math.min(10, Math.max(1, +store.get('poise-mgr-rhythm', 7) || 7)), def: 5, applies: 'from the Manager’s next turn; workers over the limit finish their tasks',
    words: (n) => `${n} slot${n === 1 ? '' : 's'}`,
    check: (n) => (n < 1 || n > 10 ? 'Rhythm is 1 to 10 slots' : ''),
    control: (r) => `<div class="rhythm" data-rhythm data-limit="${r.value}"><button class="ib" data-act="less" aria-label="One slot fewer" data-ref="mgr.rhythm"${r.value <= 1 ? ' aria-disabled="true"' : ''}><i data-i="minus"></i></button><output class="rh-n" data-ref="mgr.rhythm">${r.value}</output><button class="ib" data-act="more" aria-label="One slot more" data-ref="mgr.rhythm"${r.value >= 10 ? ' aria-disabled="true"' : ''}><i data-i="plus"></i></button><div class="slots" aria-hidden="true">${slotsHTML(r.value)}</div></div>`,
    painted: (r, el) => { const box = $('[data-rhythm]', el); box.dataset.limit = r.value; $('.rh-n', box).textContent = r.value; $('.slots', box).innerHTML = slotsHTML(r.value); $('[data-act="less"]', box).setAttribute('aria-disabled', String(r.value <= 1)); $('[data-act="more"]', box).setAttribute('aria-disabled', String(r.value >= 10)); repaintEffect(); },
    apply: (n) => store.set('poise-mgr-rhythm', n),
    act: (act) => commit(rhythm, Math.max(1, Math.min(10, rhythm.value + (act === 'more' ? 1 : -1))))
  };
  function stopsRow(kind, label, gloss, def, policyHTML) {
    const row = {
      key: `mgr.${kind}`, ref: `mgr.${kind}`, group: 'Controls', label, gloss, type: 'stops', own: true, wide: true,
      value: (() => { const v = +store.get(`poise-mgr-${kind}`, def); return v >= 0 && v <= 4 ? v : def; })(), def,
      applies: 'from the Manager’s next turn',
      words: (i) => POLICY[kind][i][0],
      control: (r) => `<div data-${kind}="${r.value}"><div class="stops" role="radiogroup" aria-label="${esc(label)}">${POLICY[kind].map(([name], i) => `<button role="radio" aria-checked="${i === r.value}" tabindex="${i === r.value ? 0 : -1}" data-act="stop" data-v="${i}" data-ref="mgr.${kind}"><i></i>${name}</button>`).join('')}</div><p class="spolicy" data-policy>${policyHTML(r.value)}</p></div>`,
      painted: (r, el) => {
        const box = $(`[data-${kind}]`, el);
        box.setAttribute(`data-${kind}`, r.value);
        $$('[data-act="stop"]', box).forEach((b) => { const on = +b.dataset.v === r.value; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
        $('[data-policy]', box).innerHTML = policyHTML(r.value);
        repaintEffect();
      },
      apply: (i) => store.set(`poise-mgr-${kind}`, i),
      act: (act, b) => { if (act === 'stop') commit(row, +b.dataset.v); },
      onKey: (e) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!step || !e.target.closest('[role="radiogroup"]')) return false;
        e.preventDefault();
        commit(row, Math.max(0, Math.min(4, row.value + step)));
        $(`[data-act="stop"][data-v="${row.value}"]`, rowEl(row.key))?.focus();
        return true;
      }
    };
    return row;
  }
  const stability = stopsRow('stability', 'Stability ↔ Expansion', 'How the Manager handles a new Poise release. Every Manager turn carries the words of the position you choose.', 2, (i) => `<b>${esc(POLICY.stability[i][0])}.</b> “${esc(POLICY.stability[i][1])}”`);
  const autonomy = stopsRow('autonomy', 'Autonomy', 'What the Manager decides on its own, and what it brings to you, in the words every Manager turn carries.', 2, (i) => { const [, d, b] = POLICY.autonomy[i]; return `<span class="t-micro">Decides</span>${esc(d)}<span class="t-micro">Brings to you</span>${esc(b)}`; });
  const paused = {
    key: 'mgr.paused', ref: 'mgr.paused', group: 'Controls', label: 'Pause new work', type: 'switch', own: true,
    gloss: 'New work waits until you resume: the Manager still wakes, watches and answers, and gives out no new ticket. Every Manager turn carries it.',
    value: POLICY.paused.get() ? 'on' : 'off', def: 'off', applies: 'from the Manager’s next turn',
    apply: (v) => { POLICY.paused.set(v === 'on'); repaintEffect(); }
  };
  let scopeOpen = false;
  const scope = {
    key: 'mgr.scope', ref: 'mgr.scope', group: 'Scope', label: 'Repositories', gloss: 'Where the Manager may bind work: every followed repository, or only the ones you choose. With none, it binds nothing.', type: 'scope', own: true, wide: true,
    value: SCOPE, def: POLICY.scope, applies: 'from the Manager’s next turn', defWords: () => 'every followed repository',
    words: (v) => POLICY.scopeWords(v).replace(/^./, (c) => c.toUpperCase()),
    control: (r) => `<span class="cline"><span class="bval is-wrap" data-bval="scope">${esc(POLICY.scopeWords(r.value).replace(/^./, (c) => c.toUpperCase()))}</span><button class="lnk" data-act="choose" aria-expanded="${scopeOpen}" data-ref="set.mgr.scope.choose">Choose</button></span>`,
    under: () => (scopeOpen ? `<div class="bpanel" role="group" aria-label="Repositories the Manager works in"><div class="checks"><label class="check"><input type="checkbox" value="*"${scope.value === null ? ' checked' : ''} data-check-all data-ref="set.mgr.scope.choose"><span>Every followed repository</span></label>${REPOS.map((repo) => `<label class="check"><input type="checkbox" value="${esc(repo)}"${scope.value === null || scope.value.includes(repo) ? ' checked' : ''}${scope.value === null ? ' disabled' : ''} data-check data-ref="set.mgr.scope.choose"><span class="t-mono">${esc(repo)}</span></label>`).join('')}</div><div class="fbtns"><button class="btn-ghost" data-act="done" data-ref="set.beh.done">Done</button><button class="btn-ghost" data-act="cancel" data-ref="set.cancel">Cancel</button></div></div>` : ''),
    painted: (r, el) => { $('[data-bval="scope"]', el).textContent = POLICY.scopeWords(r.value).replace(/^./, (c) => c.toUpperCase()); $('[data-act="choose"]', el).setAttribute('aria-expanded', String(scopeOpen)); repaintEffect(); },
    apply: (v) => store.set('poise-mgr-scope', v),
    onInput: (e) => { if (!e.target.matches('[data-check-all]')) return false; $$('[data-check]', rowEl('mgr.scope')).forEach((c) => { c.disabled = e.target.checked; if (e.target.checked) c.checked = true; }); return true; },
    act: (act) => {
      if (act === 'choose' || act === 'cancel') { scopeOpen = act === 'choose' ? !scopeOpen : false; paintUnder(scope); S.paint(scope); if (scopeOpen) $('[data-check]', rowEl('mgr.scope'))?.focus(); }
      if (act === 'done') {
        commit(scope, $('[data-check-all]', rowEl('mgr.scope'))?.checked ? null : $$('[data-check]:checked', rowEl('mgr.scope')).map((c) => c.value));
        if (S.ROW['mgr.scope']?.mode !== 'error') { scopeOpen = false; paintUnder(scope); S.paint(scope); }
      }
    }
  };
  // Standing instructions are the /manager snippet; this row shows it and opens it in Snippets.
  const charter = () => SNIPS.find((n) => n.id === 'manager')?.text || '';
  const charterLines = () => charter().split('\n').map((l) => l.trim()).filter(Boolean);
  const instructions = {
    key: 'mgr.instructions', ref: 'set.mgr.charter', group: 'Standing instructions', label: 'The /manager snippet', gloss: 'What the Manager always or never does, in your words. Every Manager turn carries it, after your own request and before Memories.', type: 'custom', plain: true, wide: true,
    now: () => `${charterLines().length} lines in /manager.`,
    findText: () => `standing instructions manager charter ${charter()}`,
    control: () => `<span class="cline"><span class="fsub">${esc(short(charterLines().join(' · ') || 'Empty', 160))}</span><a class="btn-ghost" href="settings.html?open=manager#snippets" data-ref="set.mgr.charter.edit">Edit in Snippets</a></span>`
  };
  // Wake-ups: the same control as the Manager's header, on the same key.
  const W = POLICY.wake;
  const wake = {
    key: 'mgr.wake', ref: 'mgr.wake', group: 'Wake-ups', label: 'Wake the Manager every', type: 'seg', own: true, options: W.options.map((m) => [String(m), `${m} min`]),
    value: String(W.get()), def: '60', applies: 'applies now; a wake-up already due still comes',
    gloss: 'How often Poise wakes the Manager to review the workspace. The same control sits in the Manager’s header. There is no off: put the Manager on hold, or Hold all timers, to stop it.',
    words: (v) => `${v} minutes, up to ${1440 / v} turns a day`,
    apply: (v) => W.set(Number(v)),
    meta: (s) => esc(W.status(Number(s.value)))
  };
  const elsewhere = { key: 'mgr.open', ref: 'set.mgr.open', group: 'In the Manager', label: 'The work table and the Switchboard', gloss: 'What the Manager’s workers and the chain are doing, row by row, with the Switchboard beside it. These are observations of work in progress, so they sit with the Manager.', type: 'custom', plain: true, control: () => '<a class="btn-ghost" href="manager.html?back=settings" data-ref="set.mgr.open"><i data-i="sliders" class="sm"></i>Open the Manager</a>' };
  define('manager', { rows: [effect, rhythm, stability, autonomy, paused, scope, wake, instructions, elsewhere] });
})();
