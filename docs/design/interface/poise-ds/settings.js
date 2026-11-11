// Settings: one place for every configuration, one section at a time.
// Every setting saves itself and says so on its own row: Saving…, then Saved
// with when it applies, and Undo. Nothing on the page moves while it saves.
// This file holds the place (sections, Find, routes back), the row and the list
// every section shares, and General. settings-sections.js defines the other
// seven sections with the same parts; the page starts once both are read.
(() => {
  const { $, $$, store, params, esc, clock, closeMenus } = window.PoiseShell;
  const term = (k) => (window.poiseTerm ? window.poiseTerm(k) : k);
  const KEY = 'poise-settings-v1';
  const kept = store.get(KEY, {});
  const UNDO_MS = 8000;
  const GITHUB_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
  let uid = 0;
  const nid = (p) => `${p}${Date.now().toString(36)}${uid++}`;

  // ---------- Sections ----------
  const SECTIONS = [
    ['general', 'General', 'Who you are on GitHub, what Poise follows, time, notifications, chats and appearance.'],
    ['accounts', 'Accounts', 'The sign-ins Poise acts with: the agent CLIs, GitHub and Google, and Poise Link on your computers.'],
    ['models', 'Models', 'The three models, the slot each place runs, the configurations you saved, and the catalog they come from.'],
    ['extensions', 'Extensions', 'The MCP servers chats can use: which workspaces each is on, the directory with Poise’s built-in servers, and servers of your own.'],
    ['publishing', 'Publishing', 'The sites Editor publishes to. Each is a GitHub repository whose publish.yaml says how it takes a post.'],
    ['behaviors', 'Behaviors', 'Work Poise does on GitHub on its own: the engine, each behavior with its switch, where it acts and what it remembers, and the chain that carries an issue to its merge. How often they run, and how well, is in Overview.'],
    ['snippets', 'Snippets', 'Text you reuse, in Chat and anywhere on your paired computers.'],
    ['admin', 'Admin', 'People and their workspaces on this gateway, and who may sign in. Only admins see this section.'],
    ['style', 'Style', 'How Poise looks and reads: type, space, shape, motion and the meaning colours. The Style panel holds the same choices, over any view.'],
    ['manager', 'Manager', 'The Manager’s three controls, what they add up to, where it works, what it always or never does, and how often it wakes. The same settings open from the Manager’s header.']
  ];
  const DEFS = {};
  const rowsOf = (sec) => DEFS[sec]?.rows || [];
  const allRows = () => SECTIONS.flatMap(([k]) => rowsOf(k));
  const byKey = (k) => allRows().find((s) => s.key === k);
  function define(sec, spec) { DEFS[sec] = spec; spec.rows.forEach((s) => { s.sec = sec; }); }
  const FROM = { overview: ['overview.html', 'Overview'], board: ['board.html', 'Board'], editor: ['editor.html', 'Editor'], chat: ['chat.html', 'Chat'], manager: ['manager.html', 'the Manager'], observe: ['observe.html', 'Observe'] }[params.get('back')];

  function persist() {
    kept.values = Object.fromEntries(allRows().filter((s) => 'value' in s && !s.own).map((s) => [s.key, s.value]));
    store.set(KEY, kept);
  }
  const save = (k, data) => { kept[k] = data; persist(); };

  // ---------- Words for a value ----------
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const short = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
  const optWords = (s, v) => (s.type === 'select' ? v : s.options?.find((o) => o[0] === v)?.[1] ?? v);
  const words = (s, v = s.value) => (s.words ? s.words(v) : `${optWords(s, v)}${s.unit ? ` ${s.unit}` : ''}`);
  const defWords = (s) => (typeof s.defWords === 'function' ? s.defWords() : `${words(s, s.def)}${s.defWords ? `, ${s.defWords}` : ''}`);
  const hasDef = (s) => s.def !== undefined;
  const isDefault = (s) => hasDef(s) && same(s.value, s.def);
  const changedIn = (sec) => rowsOf(sec).filter((s) => hasDef(s) && !isDefault(s)).length;
  const applies = (s) => (typeof s.applies === 'function' ? s.applies(s.value) : s.applies || 'applies now');
  function nowWords(s) {
    if (s.now) return s.now(s);
    if (!('value' in s)) return '';
    if (!hasDef(s)) return `${words(s) || 'Empty'}.`;
    return `${words(s)}. ${isDefault(s) ? 'The default.' : `Changed from the default, ${defWords(s)}.`}`;
  }
  const stateHTML = (state, note = '') => `<span class="st" data-state="${state}"><span data-term="state.${state}">${term(`state.${state}`)}</span></span>${note ? `<span class="fnote">${note}</span>` : ''}`;

  // ---------- Controls: a value, or one part of a value ----------
  const partVal = (s, part) => (part ? s.value?.[part] : s.value);
  const withPart = (s, part, v) => (part ? { ...s.value, [part]: v } : v);
  const refOf = (s) => s.ref || `set.${s.key}`;
  function segHTML(s, { part, options = s.options, off = s.off, label } = {}) {
    const cur = partVal(s, part);
    return `<div class="seg" role="group" ${label ? `aria-label="${esc(label)}"` : `aria-labelledby="l-${s.key}"`}${part ? ` data-part="${part}"` : ''} data-ref="${refOf(s)}">${options.map(([v, l]) => `<button aria-pressed="${String(v) === String(cur)}" data-v="${esc(v)}"${off?.includes(v) ? ' aria-disabled="true"' : ''}>${l}</button>`).join('')}</div>`;
  }
  function selectHTML(s, { part, options = s.options, label, id } = {}) {
    const cur = partVal(s, part);
    return `<span class="sselect"><select${id ? ` id="${id}"` : ''} data-input${part ? ` data-part="${part}"` : ''}${label ? ` aria-label="${esc(label)}"` : ''} data-ref="${refOf(s)}">${options.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></span>`;
  }
  function switchHTML(s, { part, id } = {}) {
    const on = partVal(s, part) === 'on';
    return `<button class="sswitch"${id ? ` id="${id}"` : ''}${part ? ` data-part="${part}"` : ''} aria-pressed="${on}" data-ref="${refOf(s)}"><span class="switch"></span><span data-switch-word>${on ? 'On' : 'Off'}</span></button>`;
  }
  function controlHTML(s) {
    if (s.control) return s.control(s);
    const id = `s-${s.key}`;
    switch (s.type) {
      case 'text': case 'number':
        return `<span class="sfield"><input id="${id}" class="sinput${s.mono ? ' t-mono' : ''}${s.unit ? ' is-short' : ''}" value="${esc(s.value)}"${s.type === 'number' ? ' inputmode="numeric"' : ''} placeholder="${esc(s.placeholder || '')}" autocomplete="off" spellcheck="false" data-input data-ref="${refOf(s)}">${s.unit ? `<span class="unit">${s.unit}</span>` : ''}</span>`;
      case 'select': return selectHTML(s, { id });
      case 'seg': return segHTML(s);
      case 'switch': return switchHTML(s, { id });
      default: return '';
    }
  }

  // ---------- The row ----------
  const ROW = {}; // per setting: { mode: dirty | saving | saved | error, prev, at, msg, timer }
  function statHTML(s) {
    const r = ROW[s.key] || {};
    const hint = (v) => (s.hint ? `<span class="t-mono">${esc(s.hint(v))}</span>` : '');
    if (r.mode === 'saving') return '<span class="sdot"></span>Saving…';
    if (r.mode === 'saved') return `<span class="sdot is-saved"></span>Saved ${r.at} · ${applies(s)}${r.prev != null ? ' · <button class="lnk" data-act="undo" data-ref="set.undo">Undo</button>' : ''}`;
    if (r.mode === 'error') return `<span class="is-err">Not saved: ${esc(r.msg)}.</span>${s.type === 'text' || s.type === 'number' ? ` Esc puts back ${esc(words(s) || 'the saved value')}.` : ''}`;
    if (r.mode === 'dirty') return `${s.hint ? `${hint(r.draft)} · ` : ''}Enter saves · Esc puts back`;
    if (!hasDef(s)) return s.idle ? s.idle(s) : hint(s.value);
    if (isDefault(s)) return `Default${s.hint ? ` · ${hint(s.value)}` : ''}`;
    const blocked = s.off?.includes(s.def);
    return `Changed · <button class="lnk" data-act="reset" data-ref="set.reset"${blocked ? ' aria-disabled="true"' : ''}>Reset to ${esc(defWords(s))}</button>`;
  }
  const leftHTML = (s, labelFor = '') => `<div class="srow-l"><span class="slabel"><label id="l-${s.key}"${labelFor} data-ref="${refOf(s)}">${s.label}</label>${s.local ? '<span class="chip is-outline" data-ref="set.scope">This browser</span>' : ''}</span><p class="gloss">${s.gloss}</p>${s.meta ? `<p class="smeta" data-meta>${s.meta(s)}</p>` : ''}</div>`;
  function rowHTML(s) {
    if (s.type === 'list') return listRowHTML(s);
    const labelFor = ['text', 'number', 'select', 'switch'].includes(s.type) ? ` for="s-${s.key}"` : s.labelFor ? ` for="${s.labelFor}"` : '';
    const stat = s.plain ? '' : s.type === 'custom' ? '<div class="sstat" data-lstat aria-live="polite"></div>' : `<div class="sstat" data-stat data-ref="set.status" aria-live="polite">${statHTML(s)}</div>`;
    return `<div class="srow${s.wide ? ' is-wide' : ''}" data-setting="${s.key}" data-now="${esc(nowWords(s))}">${leftHTML(s, labelFor)}<div class="srow-r">${controlHTML(s)}${stat}${s.under ? `<div class="sunder" data-under>${s.under(s)}</div>` : ''}</div></div>`;
  }
  const rowEl = (k) => $(`[data-setting="${CSS.escape(k)}"]`);
  const inRow = (s, sel) => { const row = rowEl(s.key); return row && $(sel, row); };
  const hydrate = (el) => { if (!el) return; hydrateIcons(el); window.poisePaintTerms?.(el); };
  // Repaints a row's status and state; the field you type in is left alone.
  function paint(s, { value = false } = {}) {
    const el = rowEl(s.key);
    if (!el) return;
    el.dataset.now = nowWords(s);
    const stat = $('[data-stat]', el);
    if (stat) { stat.innerHTML = statHTML(s); hydrate(stat); }
    $$('input[data-input]:not([data-part])', el).forEach((input) => {
      input.setAttribute('aria-invalid', String(ROW[s.key]?.mode === 'error'));
      if (value) input.value = s.value;
    });
    if (value) $$('select[data-input]', el).forEach((sel) => { sel.value = partVal(s, sel.dataset.part); });
    $$('.seg', el).forEach((g) => { const cur = partVal(s, g.dataset.part); $$('button', g).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(cur)))); });
    $$('.sswitch', el).forEach((sw) => { const on = partVal(s, sw.dataset.part) === 'on'; sw.setAttribute('aria-pressed', String(on)); $('[data-switch-word]', sw).textContent = on ? 'On' : 'Off'; });
    const meta = $('[data-meta]', el);
    if (meta && s.meta) { meta.innerHTML = s.meta(s); hydrate(meta); }
    s.painted?.(s, el);
    paintNav();
  }
  const paintUnder = (s) => { const el = inRow(s, '[data-under]'); if (el) { el.innerHTML = s.under(s); hydrate(el); } };
  const lstat = (s, html) => { const el = inRow(s, '[data-lstat]'); if (el) { el.innerHTML = html; hydrate(el); } };

  // ---------- Saving ----------
  function commit(s, v, { undo = false } = {}) {
    const r = (ROW[s.key] ||= {});
    clearTimeout(r.timer);
    if (same(v, s.value)) { Object.assign(r, { mode: null, draft: null }); paint(s, { value: true }); return; }
    const err = s.check?.(v);
    // A typed value stays in its field to fix; a choice goes back to the saved one.
    if (err) { Object.assign(r, { mode: 'error', msg: err, draft: v }); paint(s, { value: s.type !== 'text' && s.type !== 'number' }); return; }
    Object.assign(r, { mode: 'saving', prev: undo ? null : s.value, draft: null });
    s.value = v;
    s.apply?.(v);
    paint(s, { value: true });
    r.timer = setTimeout(() => {
      Object.assign(r, { mode: 'saved', at: clock() });
      persist();
      paint(s);
      r.timer = setTimeout(() => { Object.assign(r, { mode: null, prev: null }); paint(s); }, UNDO_MS);
    }, 450);
  }
  function putBack(s) {
    Object.assign((ROW[s.key] ||= {}), { mode: null, draft: null });
    paint(s, { value: true });
  }
  // × then Sure?: the first press arms the button for three seconds.
  function arm(b, label = 'Sure?') {
    if (b.classList.contains('is-armed')) return true;
    const was = b.innerHTML;
    b.classList.add('is-armed');
    b.textContent = label;
    setTimeout(() => { if (b.isConnected && b.classList.contains('is-armed')) { b.classList.remove('is-armed'); b.innerHTML = was; hydrateIcons(b); } }, 3000);
    return false;
  }

  // ---------- Lists: items inside one row ----------
  // Each item says where it stands on the right. × then Sure? removes it, and
  // it stays in place, crossed out, with Undo for eight seconds.
  const itemOf = (s, id) => s.items().find((it) => s.id(it) === id);
  const itemSel = (s, it) => `[data-item="${CSS.escape(s.id(it))}"]`;
  function itemHTML(s, it) {
    const id = esc(s.id(it)), name = `<span class="name${s.mono ? ' t-mono' : ''}">${esc(s.name(it))}</span>`;
    if (it.gone) return `<div class="frow is-gone" data-item="${id}" data-now="${esc(`${s.name(it)}: ${s.goneWords(it)}. Undo brings it back.`)}" data-ref="${s.itemRef}"><span class="fmain">${name}</span><span class="fstate"><span class="fnote">${s.goneWords(it)}</span></span><button class="lnk" data-act="item-undo" data-ref="set.undo">Undo</button></div>`;
    const rm = s.removable?.(it);
    return `<div class="frow${it.open ? ' is-open' : ''}" data-item="${id}" data-now="${esc(s.nowItem(it))}" data-ref="${s.itemRef}">${s.itemHTML(it)}${rm ? `<button class="ib" data-act="item-remove" aria-label="${esc(rm)}" data-ref="${s.removeRef}"><i data-i="cross" class="sm"></i></button>` : ''}${it.open && s.underItem ? `<div class="funder">${s.underItem(it)}</div>` : ''}</div>`;
  }
  function listRowHTML(s) {
    const add = s.add ? `<div class="fadd"><input id="s-${s.key}" class="sinput${s.add.mono ? ' t-mono' : ''}" placeholder="${esc(s.add.placeholder)}" aria-label="${esc(s.add.aria || s.add.placeholder)}" autocomplete="off" spellcheck="false" data-list-in data-ref="${s.add.inputRef}"><button class="btn-ghost" data-act="item-add" data-ref="${s.add.ref}">${s.add.plain ? '' : '<i data-i="plus" class="sm"></i>'}${s.add.label}</button></div>` : '';
    const items = s.items().map((it) => itemHTML(s, it)).join('');
    return `<div class="srow${s.wide ? ' is-wide' : ''}" data-setting="${s.key}" data-now="${esc(nowWords(s))}">${leftHTML(s, s.add ? ` for="s-${s.key}"` : '')}<div class="srow-r"><div class="flist" data-flist>${items || `<p class="fnone">${s.empty || 'None yet.'}</p>`}</div>${s.extra ? `<div class="fextra" data-extra>${s.extra(s)}</div>` : ''}${add}<div class="sstat" data-lstat aria-live="polite"></div></div></div>`;
  }
  function paintItem(s, it) {
    const row = rowEl(s.key);
    if (!row) return;
    const el = $(itemSel(s, it), row);
    if (el) { el.outerHTML = itemHTML(s, it); hydrate($(itemSel(s, it), row)); }
    row.dataset.now = nowWords(s);
    s.painted?.(s, row);
  }
  const paintExtra = (s) => { const el = inRow(s, '[data-extra]'); if (el) { el.innerHTML = s.extra(s); hydrate(el); } };
  function addItem(s, it, { top = false } = {}) {
    const list = inRow(s, '[data-flist]');
    if (!list) return;
    $('.fnone', list)?.remove();
    list.insertAdjacentHTML(top ? 'afterbegin' : 'beforeend', itemHTML(s, it));
    hydrate($(itemSel(s, it), list));
    rowEl(s.key).dataset.now = nowWords(s);
  }
  function dropItem(s, it) {
    const all = s.items(), i = all.indexOf(it);
    if (i >= 0) all.splice(i, 1);
    inRow(s, itemSel(s, it))?.remove();
    const row = rowEl(s.key);
    if (row) row.dataset.now = nowWords(s);
    s.save();
  }
  function removeItem(s, b, it) {
    if (!arm(b)) return;
    clearTimeout(it.timer);
    it.open = false;
    it.gone = true;
    s.onRemove?.(it);
    paintItem(s, it);
    s.save();
    inRow(s, `${itemSel(s, it)} [data-act="item-undo"]`)?.focus();
    it.timer = setTimeout(() => dropItem(s, it), UNDO_MS);
  }
  function undoRemove(s, it) {
    clearTimeout(it.timer);
    delete it.gone;
    s.onRestore?.(it);
    paintItem(s, it);
    s.save();
    lstat(s, `<span class="sdot is-saved"></span>${esc(s.name(it))} is back, as it was`);
  }
  function addFromField(s) {
    const input = inRow(s, '[data-list-in]'), v = input.value.trim();
    if (!v) { input.focus(); return; }
    const err = s.add.check(v);
    if (err) { lstat(s, `<span class="is-err">${err}</span>`); input.setAttribute('aria-invalid', 'true'); return; }
    input.value = '';
    input.setAttribute('aria-invalid', 'false');
    const it = s.add.create(v);
    if (s.add.top) s.items().unshift(it); else s.items().push(it);
    addItem(s, it, { top: s.add.top });
    s.save();
    s.add.then?.(it);
  }
  // A short process on an item or row: each step says where it stands.
  function steps(list, done) {
    let i = 0;
    const next = () => { if (i >= list.length) { done?.(); return; } const [fn, ms] = list[i++]; fn(); setTimeout(next, ms); };
    next();
  }

  // ---------- General ----------
  const browserTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
  const ZONES = [...new Set(['UTC', 'Europe/London', 'Europe/Berlin', 'Europe/Helsinki', 'Europe/Istanbul', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'America/Sao_Paulo', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', browserTz])];
  const offset = (z) => { try { return new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value || ''; } catch { return ''; } };
  const whole = (v) => (/^\d+$/.test(v) && Number(v) >= 1 ? '' : 'it must be a whole number, at least 1');
  // Following: each account's index, with the live stages in the state words.
  const STAGES = [['queued', 'waiting', 'in line to activate…', 900], ['authenticating', 'running', 'Checking GitHub access…', 1400], ['indexing', 'running', 'Indexing repositories…', 2600], ['building-user', 'running', 'Preparing your issues and pull requests…', 1800]];
  const FOLLOW = (kept.follows || ['acme', 'autonomio', 'harbor-research', 'northwind', 'mikkokotila'].map((login) => ({ login }))).map((f) => ({ login: f.login }));
  // The same failing sync as Overview's notice: main shows Sync failed, the error, and Retry.
  const SYNC_ERR = { northwind: 'GitHub returned 502 · failing since 19:24; Poise keeps retrying' };
  FOLLOW.forEach((f) => { if (SYNC_ERR[f.login] && !kept.synced?.includes(f.login)) f.error = SYNC_ERR[f.login]; });
  const following = {
    key: 'following', group: 'GitHub', label: 'Following', gloss: 'Organizations and people whose repositories Poise indexes. The first index can take a few minutes.', type: 'list', mono: true,
    items: () => FOLLOW, id: (f) => f.login, name: (f) => f.login, itemRef: 'set.follow.row', removeRef: 'set.follow.stop',
    save: () => save('follows', FOLLOW.filter((f) => !f.gone).map((f) => ({ login: f.login }))),
    itemHTML: (f) => { const st = STAGES.find((x) => x[0] === f.stage); return `<span class="fmain"><span class="name t-mono">${esc(f.login)}</span>${f.error && !st ? `<span class="fsub">${esc(f.error)}</span>` : ''}</span><span class="fstate">${st ? stateHTML(st[1], st[2]) : f.error ? `${stateHTML('waiting', 'Sync failed')}<button class="btn-ghost" data-act="retry-follow" data-ref="set.follow.retry">Retry</button>` : '<span class="fnote">Ready</span>'}</span>`; },
    nowItem: (f) => { const st = STAGES.find((x) => x[0] === f.stage); return st ? `${f.login}: ${term(`state.${st[1]}`)}, ${st[2].replace('…', '')}.` : f.error ? `${f.login}: Sync failed, ${f.error}.` : `${f.login}: Ready, indexed and kept in sync.`; },
    act: (act, f) => {
      if (act !== 'retry-follow' || !f?.error) return;
      const s = byKey('following');
      f.stage = 'indexing'; paintItem(s, f);
      lstat(s, `<span class="sdot"></span>Retrying ${esc(f.login)}…`);
      setTimeout(() => { delete f.stage; delete f.error; paintItem(s, f); save('synced', [...(kept.synced || []), f.login]); lstat(s, `<span class="sdot is-saved"></span>${esc(f.login)} synced · ${clock()} · 3 changes since 19:24`); }, 2200);
    },
    removable: (f) => `Stop following ${f.login}`, goneWords: () => 'Not followed · leaves Board and Observe',
    onRemove: (f) => { clearTimeout(f.stageTimer); delete f.stage; },
    now: () => { const live = FOLLOW.filter((f) => !f.gone), busy = live.filter((f) => f.stage).length; return `${live.length} accounts${busy ? `: ${live.length - busy} Ready, ${busy} activating` : ', all Ready'}.`; },
    findText: () => FOLLOW.map((f) => f.login).join(' '),
    add: {
      placeholder: 'acme-corp or octocat', aria: 'Organization or person to follow', mono: true, label: 'Follow', ref: 'set.follow.add', inputRef: 'set.follow.input',
      check: (v) => (!GITHUB_NAME.test(byKey('me').value || '') ? 'Not followed: set a valid Your GitHub account first.' : !GITHUB_NAME.test(v) ? 'Not followed: enter an organization name or a personal GitHub username, not a URL.' : FOLLOW.some((f) => !f.gone && f.login.toLowerCase() === v.toLowerCase()) ? `Already following ${esc(v)}.` : ''),
      create: (login) => ({ login }),
      then: (f) => {
        const s = byKey('following');
        lstat(s, `<span class="sdot"></span>Following ${esc(f.login)} · indexing takes a few minutes; you can leave this page`);
        const run = (i) => { f.stage = STAGES[i][0]; paintItem(s, f); f.stageTimer = setTimeout(() => { if (i + 1 < STAGES.length) { run(i + 1); return; } delete f.stage; paintItem(s, f); lstat(s, `<span class="sdot is-saved"></span>${esc(f.login)} is Ready · Board and Swarm include it from the next refresh`); }, STAGES[i][3]); };
        run(0);
      }
    }
  };
  // Storage: this workspace's disk, what fills it, and maintenance. A reading
  // that is partial, old or failed says so, with its age and Retry.
  // The same disk as Overview's storage notice and Logging: 4.6 GB free of 100 GB.
  // main's categories, word for word (server/storage-maintenance.ts). What is left of the disk is Poise and the system, which it does not list.
  const CATS = [['Chat worker workspaces', '41.8 GB'], ['Review checkouts', '18.2 GB'], ['Incident snapshots', '0.4 GB'], ['pip cache', '1.1 GB'], ['uv cache', '2.3 GB'], ['npm cache', '3.4 GB'], ['Issue-review work dirs', '2.6 GB'], ['Native behavior resources', '1.9 GB'], ['GitHub mirrors', '6.3 GB'], ['Shared checkout coordination (retained)', '12 MB'], ['Shared Codex state (retained)', '2.1 GB'], ['Shared Claude state (retained)', '3.2 GB'], ['Shared Grok state (retained)', '0.7 GB'], ['Shared Muse history (retained)', '1.4 GB'], ['Shared Muse configuration (retained)', '4 MB']];
  const STORE = { mode: ['partial', 'stale', 'failed'].includes(params.get('storage')) ? params.get('storage') : 'ok', run: null };
  const storage = {
    key: 'storage', ref: 'set.storage', group: 'This install', label: 'Storage', type: 'custom', wide: true, plain: false,
    gloss: 'This workspace’s disk, what fills it, and the maintenance that clears what nothing owns. It never removes shared sign-ins, history or your files.',
    findText: () => 'storage disk maintenance space free',
    control: () => {
      const cats = CATS.map(([l, v], i) => `<div class="kv"><span>${esc(l)}</span><span class="t-mono${STORE.mode === 'partial' && i <= 1 ? ' is-attn' : ''}">${STORE.mode === 'partial' && i === 1 ? 'unavailable' : STORE.mode === 'partial' && i === 0 ? `${esc(v)} (partial)` : esc(v)}</span></div>`).join('');
      const head = STORE.mode === 'failed'
        ? '<p class="fnote is-attn">Storage could not be read: the workspace did not answer in 15 s.</p>'
        : `<p class="fnote"><b>4.6 GB free</b> of 100 GB · 95% used · ${STORE.mode === 'stale' ? '<span class="is-attn">showing the last reading, measured 18:52; it could not refresh: the disk scan timed out</span>' : 'measured 4 minutes ago'}${STORE.mode === 'partial' ? ' · <span class="is-attn">some categories could not be measured</span>' : ''}</p>`;
      const retry = STORE.mode !== 'ok' ? '<button class="btn-ghost" data-act="retry" data-ref="set.storage.retry">Retry</button>' : '';
      return `<div class="kvs">${head}${STORE.mode === 'failed' ? '' : cats}</div><span class="cline">${retry}<button class="btn-ghost" data-act="maint" data-ref="set.storage.run"${STORE.run ? ' aria-disabled="true" data-why="Maintenance is running."' : ''}>Run maintenance now</button><button class="btn-ghost" data-act="dry" data-ref="set.storage.dry"${STORE.run ? ' aria-disabled="true" data-why="Maintenance is running."' : ''}>Dry run</button><span class="fnote">Last maintenance 19:00 · reclaimed 1.2 GB · 2 held</span></span>`;
    },
    act: (act) => {
      if (act === 'retry') {
        lstat(storage, stateHTML('running', 'measuring…'));
        setTimeout(() => { STORE.mode = 'ok'; rerowKeep('storage'); lstat(storage, `${stateHTML('done', `measured ${clock()}`)} <span class="fnote">every category read</span>`); }, 1500);
      }
      if ((act === 'maint' || act === 'dry') && !STORE.run) {
        STORE.run = act;
        rerowKeep('storage');
        lstat(storage, stateHTML('running', act === 'dry' ? 'dry run: finding what nothing owns…' : 'clearing what nothing owns…'));
        setTimeout(() => {
          STORE.run = null;
          rerowKeep('storage');
          lstat(storage, `${stateHTML('done', clock())} <span class="fnote">${act === 'dry' ? 'Would reclaim 640 MB; held 1, a checkout a running chat still owns' : 'Reclaimed 640 MB · held 1: a checkout a running chat still owns'}</span>`);
        }, 2600);
      }
    }
  };
  const rerowKeep = (k) => window.PoiseSettings.rerow(k);
  define('general', {
    rows: [
      { key: 'me', group: 'GitHub', label: 'Your GitHub account', gloss: 'Shows the issues and pull requests you are involved in. Connect this account under Accounts.', type: 'text', value: 'mikkokotila', placeholder: 'octocat', mono: true, applies: 'from the next refresh', check: (v) => (!v ? 'your GitHub account is required' : GITHUB_NAME.test(v) ? '' : 'it must be a GitHub login, not a URL or an email') },
      { key: 'agent', group: 'GitHub', label: 'Automation account', gloss: 'The GitHub account that posts automated reviews and comments. Connect it under Accounts. Poise adds it to every repository in your organizations by itself, and accepts the invitation for it.', type: 'text', value: 'bit-mis', mono: true, applies: 'from the next review or comment', check: (v) => (!v || GITHUB_NAME.test(v) ? '' : 'it must be a GitHub login, not a URL or an email') },
      following,
      { key: 'timezone', group: 'Time', label: 'Time zone', gloss: 'Sets where days and weeks begin in Overview, Board and Observe.', type: 'select', value: 'Europe/Helsinki', def: browserTz, defWords: 'this browser’s zone', options: ZONES.map((z) => [z, `${z} · ${offset(z)}`]), applies: 'applies now' },
      { key: 'refresh', group: 'Time', label: 'Refresh rate', gloss: 'How often Overview, Board and Observe read fresh data.', type: 'seg', value: '1m', def: '1m', options: [['1m', '1 min'], ['5m', '5 min']], local: true, applies: 'applies now' },
      { key: 'notifications', group: 'Notifications', label: 'Notifications', gloss: 'Alerts for sign-ins, failed behaviors, chats waiting for you and pull requests ready to merge. A ready pull request reminds you every 15 minutes until it is merged or silenced. Off stops them and the check of pull requests at once; Behaviors’ diagnostics stay.', type: 'switch', value: 'on', def: 'on', options: [['on', 'On'], ['off', 'Off']], applies: 'applies now, in every browser' },
      { key: 'branch', group: 'Chats', label: 'Branch prefix', gloss: 'Starts the name of the branch each new chat creates.', type: 'text', value: 'chat/', def: 'chat/', mono: true, applies: 'from the next chat', hint: (v) => `next: ${v}tidy-onboarding`, check: (v) => (/^[A-Za-z0-9._/-]+$/.test(v) && !v.startsWith('/') && !v.includes('..') ? '' : 'it must be a git ref fragment, like chat/') },
      { key: 'idle', group: 'Chats', label: 'Idle timeout', unit: 'minutes', gloss: 'Closes an idle agent process after this many minutes; 0 keeps it open. The chat resumes when you send another message.', type: 'number', value: '120', def: '120', applies: 'applies now', words: (v) => (v === '0' ? 'Never' : `${v} minutes`), check: (v) => (/^\d+$/.test(v) ? '' : 'it must be a whole number; 0 means never') },
      { key: 'running', group: 'Chats', label: 'Running at once', unit: 'at once', gloss: 'How many agent turns may run at the same time, chats and behavior runs together. From 2, one is always left for the turns you send; from 3, workers’ turns also leave one for behavior runs, so reviews can finish the workers’ own work. Past the limit, a turn or run shows Waiting, saying for what, and starts when another finishes.', type: 'number', value: '10', def: '4', applies: 'applies now; turns already running finish', check: (v) => whole(v) || (Number(v) < 1 || Number(v) > 64 ? 'it must be 1 to 64' : '') },
      { key: 'updatewait', group: 'Chats', label: 'Update wait', unit: 'minutes', gloss: 'How long running turns may hold up a Poise update. Past it, they are interrupted and resume after the update.', type: 'number', value: '15', def: '15', applies: 'from the next update', check: (v) => whole(v) || (Number(v) > 10080 ? 'it must be at most 10080, a week' : '') },
      { key: 'style', group: 'Appearance', label: 'Style', gloss: 'Every font, size, space, shape and colour Poise uses, as tokens you can change.', plain: true, control: () => '<button class="btn-ghost" data-style-open data-ref="set.style"><i data-i="palette" class="sm"></i>Open Style</button>' },
      { key: 'release', group: 'This install', label: 'Poise version', gloss: 'The commit this Poise runs, from autonomio/poise, and when it was updated to it.', plain: true, findText: () => 'release commit update version', control: () => '<span class="cline" data-ref="set.release"><span class="t-mono">autonomio/poise@3f9c2ab</span><span class="fnote">since 22 Oct, 21:40</span></span>' },
      storage,
      { key: 'setup', group: 'This install', label: 'First-run setup', gloss: 'Walk through setup again, from its first step, with your current choices prefilled.', plain: true, control: () => '<a class="btn-ghost" href="setup.html?back=settings" data-ref="set.setup">Run setup again</a>' }
    ]
  });

  // ---------- The place: sections, find, routes back ----------
  const secsEl = $('[data-secs]'), sectionEl = $('[data-section]'), scrollEl = $('[data-scroll]');
  let section = 'general';
  function paintNav() {
    secsEl.innerHTML = SECTIONS.map(([k, name]) => {
      const n = changedIn(k);
      return `<a class="set-go" href="#${k}" data-ref="set.go" data-changed="${n}"${k === section ? ' aria-current="page"' : ''}><span class="t">${name}</span>${n ? `<span class="n" data-ref="set.changed">${n} changed</span>` : ''}</a>`;
    }).join('')
      + '<span class="t-micro set-else">Beside your work</span>'
      + '<button class="set-go" data-style-open data-ref="set.style"><i data-i="palette" class="sm"></i><span class="t">Style panel</span></button>'
      + '<a class="set-go" href="manager.html?pane=controls&amp;back=settings" data-ref="set.manager"><i data-i="sliders" class="sm"></i><span class="t">Manager’s controls</span></a>';
    hydrateIcons(secsEl);
  }
  const backHTML = () => (FROM ? `<a class="back" href="${FROM[0]}" data-ref="back"><i data-i="chev" class="sm"></i>Back to ${FROM[1]}</a>` : '');
  function renderSection() {
    const [k, name, what] = SECTIONS.find((x) => x[0] === section);
    const rows = rowsOf(k), groups = [...new Set(rows.map((s) => s.group))];
    const scope = DEFS[k].scope ? ` <span class="chip is-outline" data-ref="set.scope">${DEFS[k].scope}</span>` : '';
    sectionEl.innerHTML = `<header class="set-head" data-ref="set.head">${backHTML()}<h1>${name}${scope}</h1><p>${what}</p></header>`
      + groups.map((g, i) => `<section class="sgrp" aria-labelledby="g-${k}-${i}"><h2 class="t-micro" id="g-${k}-${i}">${g}</h2>${rows.filter((s) => s.group === g).map(rowHTML).join('')}</section>`).join('');
    hydrate(sectionEl);
    paintNav();
    DEFS[k].mounted?.();
    document.title = `Poise — Settings · ${name}`;
  }
  function go(k, { keepScroll = false } = {}) {
    section = SECTIONS.some((x) => x[0] === k) ? k : 'general';
    const top = scrollEl.scrollTop;
    renderSection();
    scrollEl.scrollTop = keepScroll ? top : 0;
  }
  // Lights one row, from Find or from ?setting=. Only Find moves focus there.
  function light(key, { focus = false } = {}) {
    const el = rowEl(key);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.remove('is-lit');
    void el.offsetWidth;
    el.classList.add('is-lit');
    setTimeout(() => el.classList.remove('is-lit'), 1800);
    if (focus) $('input, select, textarea, .seg button:not([aria-disabled="true"]), .sswitch, .btn-ghost:not([aria-disabled="true"]), .ib', $('.srow-r', el))?.focus({ preventScroll: true });
  }

  // Find: every section, by name, explanation or value.
  const findEl = $('[data-find]'), resultsEl = $('[data-results]');
  function index() {
    return SECTIONS.flatMap(([k, name]) => rowsOf(k).map((s) => {
      const value = 'value' in s ? words(s) : '';
      return { sec: k, key: s.key, name: s.label, where: `${name} · ${short(value || nowWords(s).replace(/\.$/, '') || s.group, 56)}`, text: `${s.label} ${s.gloss} ${s.group} ${name} ${value} ${s.findText ? s.findText(s) : ''}` };
    }));
  }
  let hits = [], at = 0;
  function find() {
    const q = findEl.value.trim().toLowerCase();
    if (!q) { resultsEl.hidden = true; secsEl.hidden = false; return; }
    hits = index().filter((h) => h.text.toLowerCase().includes(q)).slice(0, 8);
    at = 0;
    resultsEl.hidden = false;
    secsEl.hidden = true;
    paintHits();
  }
  function paintHits() {
    resultsEl.innerHTML = hits.length
      ? hits.map((h, i) => `<button class="res" role="option" aria-selected="${i === at}" data-hit="${i}"><span class="t">${esc(h.name)}</span><span class="t-gloss">${esc(h.where)}</span></button>`).join('')
      : `<p class="none">Nothing matches “${esc(findEl.value.trim())}”. Try a word from what a setting does.</p>`;
  }
  function open(h) {
    if (!h) return;
    findEl.value = '';
    find();
    if (location.hash !== `#${h.sec}`) history.replaceState(null, '', `${location.pathname}${location.search}#${h.sec}`);
    if (h.sec !== section) go(h.sec);
    light(h.key, { focus: true });
  }

  // ---------- Events ----------
  const rowOf = (el) => byKey(el?.closest('[data-setting]')?.dataset.setting);
  sectionEl.addEventListener('click', (e) => {
    const b = e.target.closest('button, a');
    if (!b || b.matches('[aria-disabled="true"]')) return;
    const s = rowOf(b);
    if (!s) return;
    if (s.type === 'list') {
      const it = itemOf(s, b.closest('[data-item]')?.dataset.item);
      switch (b.dataset.act) {
        case 'item-remove': removeItem(s, b, it); return;
        case 'item-undo': undoRemove(s, it); return;
        case 'item-add': addFromField(s); return;
        default: if (b.dataset.act) s.act?.(b.dataset.act, it, b, e);
      }
      return;
    }
    switch (b.dataset.act) {
      case 'undo': commit(s, ROW[s.key].prev, { undo: true }); return;
      case 'reset': commit(s, s.def); return;
      case undefined: break;
      default: s.act?.(b.dataset.act, b, e); return;
    }
    if (b.matches('.seg button')) { commit(s, withPart(s, b.closest('.seg').dataset.part, b.dataset.v)); return; }
    if (b.matches('.sswitch')) { const part = b.dataset.part; commit(s, withPart(s, part, partVal(s, part) === 'on' ? 'off' : 'on')); }
  });
  sectionEl.addEventListener('input', (e) => {
    const s = rowOf(e.target);
    if (!s) return;
    if (s.onInput?.(e)) return;
    if (e.target.matches('[data-list-in]')) { e.target.setAttribute('aria-invalid', 'false'); lstat(s, ''); return; }
    if (e.target.matches('input[data-input]:not([data-part])')) {
      const r = (ROW[s.key] ||= {}), v = e.target.value.trim();
      clearTimeout(r.timer);
      Object.assign(r, v === s.value ? { mode: null, draft: null } : { mode: 'dirty', draft: v });
      paint(s);
    }
  });
  sectionEl.addEventListener('change', (e) => {
    const s = rowOf(e.target);
    if (!s || s.onChange?.(e)) return;
    if (e.target.matches('select[data-input]')) commit(s, withPart(s, e.target.dataset.part, e.target.value));
  });
  sectionEl.addEventListener('keydown', (e) => {
    const s = rowOf(e.target);
    if (!s || s.onKey?.(e)) return;
    if (e.target.matches('[data-list-in]') && e.key === 'Enter') { e.preventDefault(); addFromField(s); return; }
    if (!e.target.matches('input[data-input]:not([data-part])')) return;
    if (e.key === 'Enter') { e.preventDefault(); commit(s, e.target.value.trim()); }
    if (e.key === 'Escape' && ['dirty', 'error'].includes(ROW[s.key]?.mode)) { e.preventDefault(); e.stopPropagation(); putBack(s); }
  });
  // Leaving a field saves it, unless what is in it is not valid.
  sectionEl.addEventListener('focusout', (e) => {
    if (!e.target.matches('input[data-input]:not([data-part])')) return;
    const s = rowOf(e.target);
    if (ROW[s.key]?.mode === 'dirty') commit(s, e.target.value.trim());
  });

  findEl.addEventListener('input', find);
  findEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (hits.length) { at = (at + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length; paintHits(); } }
    if (e.key === 'Enter') { e.preventDefault(); open(hits[at]); }
    if (e.key === 'Escape' && findEl.value) { e.preventDefault(); e.stopPropagation(); findEl.value = ''; find(); }
  });
  resultsEl.addEventListener('click', (e) => { const b = e.target.closest('[data-hit]'); if (b) open(hits[Number(b.dataset.hit)]); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    e.preventDefault();
    findEl.focus();
  });
  window.addEventListener('hashchange', () => { closeMenus(); go(location.hash.slice(1)); });

  // What the other sections build with.
  window.PoiseSettings = {
    define, byKey, kept, save, persist, commit, paint, paintUnder, paintItem, paintExtra, addItem, dropItem, lstat, arm, steps, nid,
    stateHTML, segHTML, selectHTML, switchHTML, rowEl, hydrate, words, partVal, withPart, UNDO_MS, GITHUB_NAME, ROW,
    value: (k) => byKey(k)?.value,
    current: () => section,
    // Ends a row's Saved line, when another action has already undone its change.
    settle: (s) => { const r = ROW[s.key]; if (r) { clearTimeout(r.timer); Object.assign(r, { mode: null, prev: null }); } paint(s, { value: true }); },
    rerender: () => go(section, { keepScroll: true }),
    // Draws one row again, keeping what its status line says.
    rerow: (k) => { const el = rowEl(k); if (!el) return; const said = $('[data-lstat]', el)?.innerHTML; el.outerHTML = rowHTML(byKey(k)); hydrate(rowEl(k)); if (said) lstat(byKey(k), said); }
  };

  // ---------- Start, once every section is defined ----------
  document.addEventListener('DOMContentLoaded', () => {
    // A value saved in an older shape is left for the new default; an object
    // gains the fields added since (a behavior's Review cap, for one).
    const plain = (x) => x && typeof x === 'object' && !Array.isArray(x);
    Object.entries(kept.values || {}).forEach(([k, v]) => {
      const s = byKey(k);
      if (!s || !('value' in s) || s.own || typeof v !== typeof s.value || Array.isArray(v) !== Array.isArray(s.value)) return;
      if (s.options && !plain(v) && !s.options.some(([o]) => String(o) === String(v))) return;
      s.value = plain(v) && plain(s.value) ? { ...s.value, ...v } : v;
    });
    go(location.hash.slice(1) || 'general');
    if (params.get('setting')) setTimeout(() => light(params.get('setting')), 60);
    // The review shows Undo as a row shows it after a change, without making one: Undo here changes nothing.
    if (params.get('ref') === 'set.undo') { const s = byKey('refresh'); if (s) { Object.assign((ROW[s.key] ||= {}), { mode: 'saved', at: clock(), prev: s.value }); paint(s); } }
    // The first one that shows something: a status with words in it, not an empty one.
    if (params.get('ref')) setTimeout(() => { const all = $$(`[data-ref="${params.get('ref')}"]`), el = all.find((e) => e.offsetWidth && e.textContent.trim()) || all[0]; el?.scrollIntoView({ block: 'center' }); window.poiseOpenRef?.(el); }, 700);
  });
})();
