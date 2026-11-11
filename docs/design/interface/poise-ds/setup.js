// First-run setup: a dialog in the middle of the screen, with everything else
// dimmed, that takes you through what Poise needs in the order it needs it.
// Each step checks that its connection works before the next one opens, and
// setup resumes at the step you left. Run again from Settings, today's choices
// are filled in.
(() => {
  const { $, $$, store, params, esc, toast } = window.PoiseShell;
  const KEY = 'poise-setup-step';
  const again = params.get('back') === 'settings';
  const S = {
    github: again ? 'connected' : 'missing',
    agent: again ? 'connected' : 'missing', agentLogin: again ? 'bit-mis' : '',
    orgs: again ? [['mikkokotila', 'ready'], ['autonomio', 'ready'], ['Acme', 'ready'], ['northwind', 'ready'], ['harbor-research', 'ready']] : [['mikkokotila', 'ready']],
    zone: 'Europe/Helsinki', refresh: '1m',
    ai: { claude: 'in', codex: 'in', muse: again ? 'in' : 'out', grok: 'out', gemini: again ? 'unknown' : 'out' },
    link: again ? 'paired' : 'none', models: null
  };
  const timers = new Set();
  const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };

  // ---------- Steps ----------
  // GitHub's device sign-in, shared by your account and the agent account.
  const DEVICE = {
    missing: (who) => `<p class="ob-line">${cap('idle')}<span>${who ? `<b class="t-mono">${esc(who)}</b> · ` : ''}Not connected yet.</span></p>`,
    code: () => `<div class="ob-code" data-ref="ob.code"><span class="t-mono">WDJB-MJHT</span><button class="btn btn-primary" data-act="copy">Copy code and open GitHub</button></div><p class="ob-note">GitHub opens in a new tab at github.com/login/device: paste the code there and approve.</p>`,
    waiting: () => `<p class="ob-line"><span class="spin"></span><span>Waiting for you to approve at GitHub…</span></p>`,
    checking: () => `<p class="ob-line"><span class="spin"></span><span>GitHub approved. Checking the connection…</span></p>`,
    connected: (who, agent) => `<p class="ob-line">${cap('done')}<span><b class="t-mono">${esc(who)}</b> · Connected. GitHub confirms the account works${agent ? '; reviews and comments are posted as it' : ', and Poise reads GitHub as it'}.</span></p>`
  };
  const cap = (s) => `<span class="sc" data-state="${s}"></span>`;
  function deviceFlow(kind, root, rerender) {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'connect') {
        if (kind === 'agent') {
          const v = $('[data-login]', root).value.trim();
          if (!v) { status('Enter the agent account’s GitHub login first.', 'error'); return; }
          if (v === 'mikkokotila') { status('The agent account must be a separate account from yours.', 'error'); return; }
          S.agentLogin = v;
        }
        S[kind] = 'code'; rerender();
      }
      if (b.dataset.act === 'copy') {
        navigator.clipboard?.writeText('WDJB-MJHT').catch(() => {});
        S[kind] = 'waiting'; rerender();
        status('The code is copied. In this mock, GitHub approves by itself in a moment.');
        later(2400, () => { S[kind] = 'checking'; rerender(); later(1000, () => { S[kind] = 'connected'; rerender(); status(`Connected as ${kind === 'agent' ? S.agentLogin : 'mikkokotila'}.`, 'ok'); }); });
      }
      if (b.dataset.act === 'redo') { S[kind] = 'missing'; rerender(); }
    });
  }
  function github() {
    const st = S.github;
    return {
      html: `<div class="ob-card" data-ref="ob.github"><p class="ob-who"><span class="av">mi</span><b class="t-mono">mikkokotila</b><span class="t-gloss">your GitHub account, from the sign-in</span></p>${DEVICE[st]('mikkokotila')}${st === 'missing' ? '<button class="btn btn-primary" data-act="connect">Connect GitHub</button>' : ''}${st === 'connected' && again ? '<button class="lnk" data-act="redo">Sign in again</button>' : ''}</div>`,
      ready: () => S.github === 'connected',
      bind: (root) => deviceFlow('github', root, show)
    };
  }
  function agent() {
    const st = S.agent;
    return {
      html: `<div class="ob-card" data-ref="ob.agent">${st === 'missing' ? `<label class="ob-field">The agent account’s GitHub login<input class="search" data-login value="${esc(S.agentLogin)}" placeholder="for example bit-mis" autocomplete="off" spellcheck="false"></label>` : ''}${DEVICE[st](S.agentLogin, true)}${st === 'missing' ? '<button class="btn btn-primary" data-act="connect">Connect agent account</button>' : ''}</div>`,
      ready: () => S.agent === 'connected',
      bind: (root) => deviceFlow('agent', root, show)
    };
  }
  const STAGES = ['Waiting to activate…', 'Checking GitHub access…', 'Indexing repositories…', 'Preparing your issues and pull requests…'];
  function orgs() {
    return {
      html: `<div class="ob-card" data-ref="ob.orgs"><ul class="ob-list">${S.orgs.map(([n, st]) => `<li>${st === 'ready' ? cap('done') : '<span class="spin"></span>'}<b class="t-mono">${esc(n)}</b><span class="t-gloss">${st === 'ready' ? (n === 'mikkokotila' ? 'Ready · your own account' : 'Ready') : esc(st)}</span></li>`).join('')}</ul>
        <form class="ob-add" data-add><input class="search" data-org placeholder="Organization or personal GitHub username" aria-label="Organization or username" autocomplete="off" spellcheck="false"><button class="btn-ghost" type="submit">Add</button></form></div>`,
      ready: () => S.orgs.some(([, st]) => st === 'ready'),
      bind: (root) => $('[data-add]', root).addEventListener('submit', (e) => {
        e.preventDefault();
        const v = $('[data-org]', root).value.trim();
        if (!v) return;
        if (/[/:.]/.test(v)) { status('Enter an organization name or personal GitHub username, not a URL.', 'error'); return; }
        if (S.orgs.some(([n]) => n.toLowerCase() === v.toLowerCase())) { status(`${v} is already followed.`, 'error'); return; }
        const item = [v, STAGES[0]];
        S.orgs.push(item);
        show();
        STAGES.forEach((stage, i) => later(700 * (i + 1), () => { item[1] = STAGES[i + 1] || 'ready'; if (cur().id === 'organizations') show(); }));
        later(700 * STAGES.length + 50, () => { item[1] = 'ready'; if (cur().id === 'organizations') { show(); status(`${v} is ready: its issues and pull requests reach Board and Observe.`, 'ok'); } });
      })
    };
  }
  const ZONES = ['Europe/Helsinki', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Singapore'];
  function time() {
    return {
      html: `<div class="ob-card ob-grid" data-ref="ob.time"><label class="ob-field">Time zone<select class="search" data-zone>${ZONES.map((z) => `<option${z === S.zone ? ' selected' : ''}>${z}</option>`).join('')}</select><span class="t-gloss">From this browser: Europe/Helsinki. Days begin at midnight here.</span></label>
        <div class="ob-field">Refresh rate<div class="seg" role="group" aria-label="Refresh rate" data-refresh>${[['1m', 'Every minute'], ['5m', 'Every 5 minutes']].map(([k, l]) => `<button aria-pressed="${S.refresh === k}" data-v="${k}">${l}</button>`).join('')}</div><span class="t-gloss">How often Overview, Board and Observe read fresh data.</span></div></div>`,
      ready: () => true,
      bind: (root) => {
        $('[data-zone]', root).addEventListener('change', (e) => { S.zone = e.target.value; status(`Times now read in ${S.zone}.`, 'ok'); });
        $('[data-refresh]', root).addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) { S.refresh = b.dataset.v; show(); } });
      }
    };
  }
  const PROVIDERS = [['claude', 'Claude Code', 'claude login'], ['codex', 'Codex', 'codex login'], ['muse', 'Muse', 'muse login'], ['grok', 'Grok Build', 'grok login --device-auth'], ['gemini', 'Antigravity', 'antigravity login']];
  const TERM = {
    muse: ['$ muse login', 'Opening a sign-in page…', 'Open https://muse.example/device and enter ZK4P-91QA', 'Waiting…', 'Signed in as mikko@example.com.'],
    grok: ['$ grok login --device-auth', 'Visit https://accounts.x.ai/device', 'and enter the code QF7K-2LMD', 'Waiting for approval…', 'Signed in as mikko@example.com.'],
    gemini: ['$ antigravity login', 'A browser window opens for your Google account.', 'Finish the sign-in there, then come back.', '(Antigravity cannot report whether it finished.)']
  };
  let terminal = null;
  function ai() {
    const word = { in: 'Signed in here', out: 'Not signed in', unknown: 'Sign-in not reported' };
    return {
      html: `<div class="ob-card" data-ref="ob.ai"><ul class="ob-list is-ai">${PROVIDERS.map(([k, l, cmd]) => `<li data-p="${k}">${cap(S.ai[k] === 'in' ? 'done' : S.ai[k] === 'unknown' ? 'waiting' : 'idle')}<b>${l}</b><span class="t-gloss">${word[S.ai[k]]} · <span class="t-mono">${cmd}</span></span><span class="ob-acts">${S.ai[k] === 'in' ? '' : terminal === k ? '' : S.ai[k] === 'unknown' ? '<button class="btn-ghost" data-act="did">I have signed in</button><button class="btn-ghost" data-act="didnt">Not signed in</button>' : '<button class="btn-ghost" data-act="signin">Sign in</button>'}</span></li>${terminal === k ? `<li class="ob-term" data-ref="ob.terminal"><pre class="t-mono" data-term></pre></li>` : ''}`).join('')}</ul></div>`,
      ready: () => true,
      bind: (root) => root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const k = b.closest('[data-p]').dataset.p;
        if (b.dataset.act === 'did') { S.ai[k] = 'in'; show(); status(`${PROVIDERS.find((p) => p[0] === k)[1]} counts as signed in.`, 'ok'); }
        if (b.dataset.act === 'didnt') { S.ai[k] = 'out'; show(); }
        if (b.dataset.act === 'signin') {
          if (terminal) { status('Finish the sign-in that is open first.', 'error'); return; }
          terminal = k;
          show();
          const lines = TERM[k] || [`$ ${PROVIDERS.find((p) => p[0] === k)[2]}`, 'Signed in.'];
          lines.forEach((line, i) => later(600 * (i + 1), () => { const pre = $('[data-term]'); if (pre) pre.textContent += `${line}\n`; }));
          later(600 * (lines.length + 1), () => { terminal = null; S.ai[k] = k === 'gemini' ? 'unknown' : 'in'; if (cur().id === 'ai') show(); status(k === 'gemini' ? 'Antigravity cannot say whether its sign-in finished. If it did, choose I have signed in.' : `${PROVIDERS.find((p) => p[0] === k)[1]} is signed in here.`, k === 'gemini' ? 'info' : 'ok'); });
        }
      })
    };
  }
  const CATALOG = [['Claude Code · Opus 5 · High', 'claude'], ['Claude Code · Opus 5 · Max', 'claude'], ['Codex · GPT-5 Codex · High', 'codex'], ['Codex · GPT-6 Astra · Max', 'codex'], ['Muse · spark 1.3 contributor · max', 'muse'], ['Grok Build · Grok 5 · High', 'grok'], ['Antigravity · Gemini 3.8 Flash · High', 'gemini']];
  // Three models chosen once, as slots; then each place runs a slot, or Random.
  const SLOTS = [['primary', 'Primary', 'Claude Code · Opus 5 · Max'], ['secondary', 'Secondary', 'Codex · GPT-6 Astra · Max'], ['tertiary', 'Tertiary', 'Muse · spark 1.3 contributor · max']];
  const PLACES = [['chat', 'Chat'], ['editor', 'Editor chat'], ['pr_review', 'PR review'], ['pr_approval', 'PR approval'], ['issue_review', 'Issue review'], ['issue_implement', 'Issue implementation'], ['pr_repair', 'PR repair']];
  const PICKS = [['primary', 'Primary'], ['secondary', 'Secondary'], ['tertiary', 'Tertiary'], ['random', 'Random']];
  const signed = (m) => S.ai[CATALOG.find((c) => c[0] === m)[1]] === 'in';
  // Each slot gets its proposed model when its provider is signed in; otherwise the first signed-in model no earlier slot took.
  function propose() {
    const taken = [];
    const slots = Object.fromEntries(SLOTS.map(([k, , want]) => { const pick = signed(want) && !taken.includes(want) ? want : (CATALOG.find(([c]) => signed(c) && !taken.includes(c))?.[0] || want); taken.push(pick); return [k, pick]; }));
    S.models = { slots, places: Object.fromEntries(PLACES.map(([k]) => [k, 'primary'])) };
  }
  function models() {
    if (!S.models?.slots) propose();
    const none = !CATALOG.some(([m]) => signed(m));
    const opt = (sel) => CATALOG.map(([m]) => `<option${m === sel ? ' selected' : ''}${signed(m) ? '' : ' disabled'}>${m}${signed(m) ? '' : ' · sign in first'}</option>`).join('');
    return {
      html: `<div class="ob-card" data-ref="ob.models"><p class="ob-note">${none ? 'No AI account is signed in yet, so every model is dimmed. Go back to sign in, or choose now and sign in later.' : 'Every place runs one of these slots, or draws one at Random on each run. Models from providers you have not signed in to are dimmed.'}</p>
        <table class="ob-models"><thead><tr><th>Slot</th><th>Model</th></tr></thead><tbody>${SLOTS.map(([k, l]) => `<tr data-slotrow="${k}"><th scope="row">${l}</th><td><select class="search" data-slot="${k}" aria-label="${l} model">${opt(S.models.slots[k])}</select></td></tr>`).join('')}</tbody></table>
        <table class="ob-models"><thead><tr><th>Place</th><th>Runs</th></tr></thead><tbody>${PLACES.map(([k, l]) => `<tr data-place="${k}"><th scope="row">${l}</th><td><select class="search" data-pick aria-label="${l} runs">${PICKS.map(([v, w]) => `<option value="${v}"${S.models.places[k] === v ? ' selected' : ''}>${w}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>`,
      ready: () => true,
      bind: (root) => root.addEventListener('change', (e) => {
        const slot = e.target.closest('[data-slot]'), pick = e.target.closest('[data-pick]');
        if (slot) {
          const was = S.models.slots[slot.dataset.slot];
          S.models.slots[slot.dataset.slot] = slot.value;
          const vals = Object.values(S.models.slots);
          if (new Set(vals).size < vals.length) { S.models.slots[slot.dataset.slot] = was; slot.value = was; status('The three slots must be different models.', 'error'); } else status(`${SLOTS.find((x) => x[0] === slot.dataset.slot)[1]} saved: every place that runs it now runs ${slot.value}.`, 'ok');
        }
        if (pick) { const k = pick.closest('[data-place]').dataset.place; S.models.places[k] = pick.value; status(`${PLACES.find((p) => p[0] === k)[1]} runs ${pick.value === 'random' ? 'a model drawn at Random on each run' : PICKS.find((x) => x[0] === pick.value)[1]}.`, 'ok'); }
      })
    };
  }
  function link() {
    const st = S.link;
    return {
      html: `<div class="ob-card" data-ref="ob.link">${st === 'paired' ? `<p class="ob-line">${cap('done')}<span>This computer is paired. Continue when you are ready.</span></p>` : `<ol class="ob-steps"><li>Install Poise Link on this computer. <button class="lnk" data-act="download">Download for macOS</button></li><li>Open it, choose Pair, and enter <b class="t-mono ob-pair">PL-4821-7730</b>.</li></ol>${st === 'waiting' ? '<p class="ob-line"><span class="spin"></span><span>Waiting for Poise Link…</span></p>' : '<button class="btn btn-primary" data-act="entered">I have entered the code</button>'}`}</div>`,
      ready: () => S.link === 'paired',
      bind: (root) => root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        if (b.dataset.act === 'download') status('This mock downloads nothing; the live app offers the installer here.');
        if (b.dataset.act === 'entered') { S.link = 'waiting'; show(); later(1600, () => { S.link = 'paired'; if (cur().id === 'link') show(); status('Paired: snippets and alerts reach this computer.', 'ok'); }); }
      })
    };
  }
  function finish() {
    const signedIn = Object.values(S.ai).filter((v) => v === 'in').length, orgsReady = S.orgs.filter(([, st]) => st === 'ready').length;
    const rows = [
      ['Your GitHub account', S.github === 'connected', S.github === 'connected' ? 'Connected · mikkokotila' : 'Not connected'],
      ['Agent account', S.agent === 'connected', S.agent === 'connected' ? `Connected · ${S.agentLogin}` : 'Skipped · reviews and comments wait for it'],
      ['Organizations', orgsReady > 0, `${orgsReady} followed`],
      ['Time', true, `${S.zone} · ${S.refresh === '1m' ? 'every minute' : 'every 5 minutes'}`],
      ['AI accounts', signedIn > 0, signedIn ? `${signedIn} of ${PROVIDERS.length} signed in` : 'None signed in yet'],
      ['Models', true, `Three slots, for ${PLACES.length} places`],
      ['This computer', S.link === 'paired', S.link === 'paired' ? '1 computer paired with Poise Link' : 'Not paired yet']
    ];
    return {
      html: `<div class="ob-card" data-ref="ob.finish"><ul class="ob-list">${rows.map(([l, ok, v]) => `<li>${cap(ok ? 'done' : 'idle')}<b>${l}</b><span class="t-gloss">${esc(v)}</span></li>`).join('')}</ul><p class="ob-note">All of it can be changed later in Settings, under the menu at the top.</p></div>`,
      ready: () => true,
      bind: () => {}
    };
  }
  const STEPS = [
    { id: 'github', name: 'GitHub', title: 'Connect your GitHub account', intro: 'Poise reads GitHub as you, mikkokotila, through gh, GitHub’s own command-line tool in your workspace.', render: github },
    { id: 'agent', name: 'Agent', title: 'Add the agent account', intro: 'Reviews, approvals and comments are posted as a separate GitHub account, such as a bot. It signs in to gh here too, and Poise confirms it works. Poise then invites it to every repository in your organizations, and accepts each invitation for it.', skippable: true, render: agent },
    { id: 'organizations', name: 'Organizations', title: 'Add your organizations', intro: 'The GitHub organizations, and personal accounts, whose work Poise follows: Board, Observe and your automations read them.', render: orgs },
    { id: 'time', name: 'Time', title: 'Time zone and refresh rate', intro: 'How Poise tells time, and how often it looks for news.', render: time },
    { id: 'ai', name: 'AI accounts', title: 'Sign in to your AI accounts', intro: 'Connect the ones you use. Each opens its own login in a terminal here; the agent keeps what it signs in with in your workspace, and Poise never reads it.', render: ai },
    { id: 'models', name: 'Models', title: 'Choose your models', intro: 'Three models, chosen once, and which of them each place runs.', render: models },
    { id: 'link', name: 'This computer', title: 'Connect this computer', intro: 'Poise Link keeps your snippets on your computer and brings Poise’s alerts to it.', skippable: true, render: link },
    { id: 'finish', name: 'Done', title: 'You’re all set', intro: 'Poise is ready.', render: finish }
  ];

  // ---------- The dialog ----------
  // ?step= opens a given step, for links and captures; otherwise setup resumes where it was left.
  const REF_STEP = { 'ob.github': 'github', 'ob.agent': 'agent', 'ob.orgs': 'organizations', 'ob.time': 'time', 'ob.ai': 'ai', 'ob.models': 'models', 'ob.link': 'link', 'ob.finish': 'finish' };
  const start = params.get('step') || REF_STEP[params.get('ref')] || (again ? 'github' : store.get(KEY, 'github'));
  let index = Math.min(STEPS.length - 1, Math.max(0, STEPS.findIndex((s) => s.id === start)));
  let view = null;
  const cur = () => STEPS[index];
  function status(text, tone = 'info') { const el = $('[data-status]'); el.textContent = text; el.dataset.tone = tone; }
  function show(focus = false) {
    const step = cur();
    view = step.render();
    const body = $('[data-body]');
    body.innerHTML = view.html;
    hydrateIcons(body);
    view.bind(body);
    $('[data-title]').textContent = step.title;
    $('[data-intro]').textContent = step.intro;
    $('[data-count]').textContent = step.id === 'finish' ? 'Setup complete' : `Step ${index + 1} of ${STEPS.length - 1} · ${step.name}`;
    $('[data-rail]').innerHTML = STEPS.slice(0, -1).map((s, i) => `<span class="${i < index ? 'is-done' : i === index ? 'is-now' : ''}" title="${s.name}"></span>`).join('');
    $('[data-act="later"]').hidden = step.id === 'finish';
    $('[data-act="back"]').hidden = index === 0;
    $('[data-act="skip"]').hidden = !step.skippable || view.ready();
    const next = $('[data-act="next"]');
    next.textContent = step.id === 'finish' ? 'Open Poise' : 'Continue';
    next.disabled = !view.ready();
    if (focus) requestAnimationFrame(() => $('[data-title]').focus({ preventScroll: true }));
  }
  function go(i) {
    index = Math.max(0, Math.min(STEPS.length - 1, i));
    terminal = null;
    store.set(KEY, cur().id);
    status('');
    show(true);
  }
  $('.ob-foot').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    if (b.dataset.act === 'back') go(index - 1);
    if (b.dataset.act === 'skip') go(index + 1);
    if (b.dataset.act === 'next') {
      if (cur().id === 'finish') { store.set(KEY, 'github'); location.href = again ? 'settings.html#general' : 'overview.html'; return; }
      const busy = S.orgs.filter(([, st]) => st !== 'ready').map(([n]) => n);
      if (cur().id === 'organizations' && busy.length) toast(`${busy.join(', ')} keeps activating; Board shows it when it is ready.`, 'running');
      go(index + 1);
    }
  });
  // Setup is a path, not a popup: Escape does not end it; Finish later does.
  $('[data-act="later"]').addEventListener('click', () => { location.href = again ? 'settings.html#general' : 'overview.html'; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); status('Setup stays open; Finish later leaves it for now, and it opens where you left it.'); }
    if (e.key !== 'Tab') return;
    const f = $$('.ob button, .ob input, .ob select, .ob [href], .ob [tabindex]:not([tabindex="-1"])').filter((n) => !n.disabled && !n.hidden && n.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
  hydrateIcons(document.body);
  // On arrival nothing is focused for you; each step you move to brings its title into focus.
  show(false);
  // Something finished in the background, such as a sign-in: refresh the footer.
  setInterval(() => { if (view) { const r = view.ready(); $('[data-act="next"]').disabled = !r; $('[data-act="skip"]').hidden = !cur().skippable || r; } }, 400);
  if (params.get('ref')) setTimeout(() => window.poiseOpenRef?.($(`[data-ref="${params.get('ref')}"]`)), 700);
})();
