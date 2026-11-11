// Overview, direction B: the Briefing. One column, read from the top in order of
// what matters: a few sentences, what to answer now, the day against typical,
// the work in motion, the behaviors and the API quota.
(() => {
  const { $, $$, esc, clock, motion, lifeHTML, params } = window.PoiseShell;
  const OV = window.PoiseOV, UI = window.PoiseOVUI;
  const term = (k) => (window.poiseTerm ? window.poiseTerm(k) : k);
  const main = $('.ovb');
  const glide = () => (motion().duration ? 'smooth' : 'auto');
  const metric = (id) => [...OV.PROD, ...OV.PER_PR, ...OV.FRICTION].find((m) => m.id === id);
  let sel = 'prs-merged';

  // ---------- Answer now ----------
  const answers = $('[data-answers]');
  UI.mountAnswers(answers, { style: 'stops', focusFirst: true, compact: true, render: paintCount });
  function paintCount() {
    const b = OV.bell(), c = $('[data-toc-count]');
    c.textContent = b.count;
    c.dataset.tone = b.tone;
    c.hidden = !b.count;
  }
  $('[data-act="bell"]').addEventListener('click', () => {
    answers.scrollIntoView({ block: 'start', behavior: glide() });
    $('[data-notice]', answers)?.focus({ preventScroll: true });
  });

  // ---------- The briefing: a few sentences from the same numbers ----------
  // It rewrites itself as things change, but never while you are in the list.
  let reading = false;
  const many = (n, one, more) => `${n} ${n === 1 ? one : more}`;
  // One line per piece of work: an issue or pull request a worker in the same
  // state carries is that worker's task, already listed under its worker.
  const one = (st) => { const items = OV.WORK.filter((w) => w.state === st), by = new Set(items.filter((w) => w.kind === 'worker').map((w) => w.title.split(' · ')[0])); return items.filter((w) => !((w.kind === 'issue' || w.kind === 'pr') && by.has(w.who))); };
  // Meaning rides on the state capsule and the pace arrow, as everywhere else; the links stay quiet.
  const cap = (state) => `<span class="sc" data-state="${state}"></span>`;
  const arr = (p) => `<b class="bk-a is-${p.tone}">${UI.arrow(p.dir)}</b>`;
  const link = (to, mark, words, pick) => `<a class="bk" href="#${to}"${pick ? ` data-pick="${pick}"` : ''}>${mark}${words}</a>`;
  const pct = (p) => Math.round(Math.abs(p.ratio - 1) * 100);
  const lower = (t) => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
  const and = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] || '');
  function briefHTML() {
    const open = OV.open(), count = (g) => open.filter((n) => n.group === g).length;
    const you = count('needs-you'), faults = count('fault'), ready = count('ready'), auto = count('auto');
    const s = [];
    // What wants you, at the level you chose.
    const lead = you ? link('answer', cap('needs-you'), you === 1 ? '1 thing needs you' : `${you} things need you`) : 'Nothing needs you';
    const also = [];
    if (OV.level >= 1 && faults) also.push(link('answer', cap('failed'), `Poise has ${many(faults, 'fault', 'faults')}`));
    if (OV.level >= 2 && ready) also.push(link('answer', cap('done'), `${ready} ${ready === 1 ? 'has' : 'have'} finished`));
    s.push(`${lead}${also.length ? `; ${and(also)}` : ''}.${OV.level >= 3 && auto ? ` Poise is handling ${auto} on its own.` : ''}`);
    // The work.
    const w = (k, st) => OV.WORK.filter((x) => x.kind === k && x.state === st).length;
    const all = (st) => one(st).length;
    const run = w('worker', 'running'), slot = (window.POISE_MANAGER?.next || []).length, failed = all('failed'), blocked = all('blocked');
    const work = [`${many(run, 'worker is', 'workers are')} running`];
    if (slot) work.push(`${slot} ticket${slot === 1 ? ' waits' : 's wait'} for a slot`);
    const wrong = [failed ? link('motion', cap('failed'), `${failed} failed`) : '', blocked ? link('motion', cap('blocked'), `${blocked} ${blocked === 1 ? 'is' : 'are'} blocked`) : ''].filter(Boolean);
    s.push(`${work.join(' and ')}${wrong.length ? `; ${and(wrong)}` : ''}.`);
    // The day against typical: the biggest lead and the biggest lag, and a slow duration.
    const today = OV.day === 0;
    const counts = OV.PROD.filter((m) => m.kind === 'count' && !m.fewer).map((m) => ({ m, p: OV.pace(m) })).filter(({ p }) => p.ratio != null && p.tone !== 'neutral');
    const by = (a, b) => Math.abs(b.p.ratio - 1) - Math.abs(a.p.ratio - 1);
    const best = counts.filter(({ p }) => p.tone === 'good').sort(by)[0], worst = counts.filter(({ p }) => p.tone === 'bad').sort(by)[0];
    const slow = OV.PROD.filter((m) => m.kind === 'time').map((m) => ({ m, p: OV.pace(m) })).filter(({ p }) => p.tone === 'bad').sort(by)[0];
    const day = [best, worst].filter(Boolean).map(({ m, p }, i) => link('today', arr(p), `${i ? lower(m.short) : m.short} ${today ? 'are' : 'were'} ${pct(p)}% ${today ? (p.dir === 'up' ? 'ahead of pace' : 'behind') : (p.dir === 'up' ? 'above typical' : 'below typical')}`, m.id));
    if (slow) day.push(link('today', arr(slow.p), `${lower(slow.m.short)} ${today ? 'is' : 'was'} ${pct(slow.p)}% slower than usual`, slow.m.id));
    if (day.length) s.push(`${today ? '' : `${OV.dayLabel()}: `}${day.length > 1 ? `${day.slice(0, -1).join('; ')}, and ${day[day.length - 1]}` : day[0]}.`);
    else s.push(`${today ? 'The day is' : `${OV.dayLabel()} was`} about typical.`);
    // The quota, only when the risk is real.
    OV.QUOTA.forEach((a) => a.buckets.filter((q) => q.risk >= 50).forEach((q) => s.push(`${link('api', '', `${a.login} may run out of ${q.res} requests before ${q.reset}`)}.`)));
    return s.join(' ');
  }
  function paintBrief() {
    if (reading) return;
    $('[data-brief]').innerHTML = briefHTML();
    $('[data-when]').textContent = `Friday 23 October, ${clock()}`;
  }
  answers.addEventListener('pointerenter', () => { reading = true; });
  answers.addEventListener('focusin', () => { reading = true; });
  const leave = () => setTimeout(() => { if (answers.matches(':hover') || answers.contains(document.activeElement)) return; reading = false; paintBrief(); }, 450);
  answers.addEventListener('pointerleave', leave);
  answers.addEventListener('focusout', (e) => { if (!answers.contains(e.relatedTarget)) leave(); });
  // A clause opens what it names: the list, a number's year, the work or the quota. The
  // strip's links go to their sections; both glide unless motion is off.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-brief] a[href^="#"], [data-toc] a, .oq-note a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    if (a.dataset.pick) choose(a.dataset.pick);
    aimed = $(a.getAttribute('href')).closest('.ovb-sec')?.id || null;
    $(a.getAttribute('href')).scrollIntoView({ block: 'start', behavior: glide() });
    spy();
    if (a.dataset.pick) $(`[data-prow="${sel}"]`)?.focus({ preventScroll: true });
    else if (a.getAttribute('href') === '#answer') $('[data-notice]', answers)?.focus({ preventScroll: true });
  });

  // ---------- Today so far: the day against typical, and one shared year ----------
  const ROWS = () => [
    ['Counts', OV.day === 0 ? 'against typical by now' : 'against the 7-day median', OV.PROD.filter((m) => m.kind === 'count')],
    ['Durations', 'medians, against the 7-day median', OV.PROD.filter((m) => m.kind === 'time')],
    ['Per merged pull request', 'medians, against the 7-day median', OV.PER_PR],
    ['Review', 'what it took to merge, against the 7 days before', OV.FRICTION]
  ];
  // The difference in words: pace for counts, faster or slower for durations, points for shares.
  function diffHTML(m) {
    const p = OV.pace(m);
    if (p.ratio == null) return '<span class="pace">—</span>';
    let w;
    if (m.kind === 'count') w = p.tone === 'neutral' ? (OV.day === 0 ? 'On pace' : 'About typical') : `${pct(p)}% ${OV.day === 0 && !m.fewer ? (p.dir === 'up' ? 'ahead of pace' : 'behind pace') : (p.dir === 'up' ? 'above typical' : 'below typical')}`;
    else if (m.kind === 'time') w = `${pct(p)}% ${p.dir === 'down' ? 'faster' : 'slower'}${m.n && OV.day === 0 ? ` · ${m.n} measured` : ''}`;
    else if (m.kind === 'share') { const d = Math.round(Math.abs(p.v - p.typical) * 100); w = d ? `${d} ${d === 1 ? 'point' : 'points'} ${p.v > p.typical ? 'higher' : 'lower'}` : 'Same as usual'; }
    else w = pct(p) ? `${pct(p)}% ${p.v > p.typical ? 'more' : 'fewer'}` : 'Same as usual';
    return `<span class="pace is-${p.tone}" data-ref="ov.pace"><b>${UI.arrow(p.dir)}</b>${w}</span>`;
  }
  function rowHTML(m) {
    const p = OV.pace(m), on = m.id === sel;
    return `<tr data-prow="${m.id}" tabindex="${on ? 0 : -1}" aria-selected="${on}" data-ref="ov.pacerow">
      <th scope="row">${esc(m.label)}${m.of && OV.day === 0 && OV.org === 'all' ? `<span class="onote">${m.of[0]} of ${m.of[1]}</span>` : ''}</th>
      <td class="num v">${OV.fmt(m, p.v)}</td><td class="num">${UI.typicalValue(m)}</td><td>${diffHTML(m)}</td><td class="bl">${UI.bullet(m)}</td></tr>`;
  }
  function workTypeHTML() {
    const total = OV.WORK_TYPE.reduce((n, [, c]) => n + c, 0);
    let x = 0;
    const segs = OV.WORK_TYPE.map(([, c]) => { const w = (c / total) * 100, r = `<rect class="wt-s" x="${x.toFixed(2)}" width="${Math.max(0, w - 0.6).toFixed(2)}" height="6"/>`; x += w; return r; }).join('');
    return `<div class="ovb-wt" data-ref="ov.worktype"><p class="ovb-wth"><span class="t-micro">Work type</span><span class="t-gloss">of ${total} merged, by Conventional Commit prefix</span></p><svg viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">${segs}</svg><p class="ovb-wtl">${OV.WORK_TYPE.map(([k, c]) => `<span><b class="t-mono">${k}</b> ${c}</span>`).join('')}</p></div>`;
  }
  function paintTable() {
    const box = $('[data-pace]'), had = box.contains(document.activeElement);
    box.innerHTML = `<table class="otable opace" role="grid" aria-label="The day against typical. Arrow keys choose a number; its year is drawn beside the table.">
      <thead><tr><th scope="col">Number</th><th scope="col" class="num">${OV.day === 0 ? 'So far' : 'Value'}</th><th scope="col" class="num">Typical</th><th scope="col">Difference</th><th scope="col"><span class="sr">Against typical</span></th></tr></thead>
      ${ROWS().map(([name, gloss, ms]) => `<tbody><tr class="og"><th colspan="5" scope="rowgroup"><span class="t-micro">${name}</span><span class="t-gloss">${gloss}</span></th></tr>${ms.map(rowHTML).join('')}</tbody>`).join('')}
    </table>${workTypeHTML()}`;
    if (had) $(`[data-prow="${sel}"]`, box)?.focus({ preventScroll: true });
  }
  function paintChart() {
    const m = metric(sel), p = OV.pace(m);
    const box = $('[data-chart]');
    box.innerHTML = `<header class="ovb-chh"><p class="t-micro">${esc(m.label)}</p><p class="ovb-chv"><span class="ovb-big">${OV.fmt(m, p.v)}</span>${UI.paceHTML(m)}</p><p class="t-gloss">${UI.typicalWords(m)} · the past year below, one point per week</p></header>${UI.yearHTML(m)}`;
  }
  function choose(id) {
    if (!metric(id)) return;
    sel = id;
    $$('[data-prow]').forEach((r) => { const on = r.dataset.prow === id; r.setAttribute('aria-selected', on); r.tabIndex = on ? 0 : -1; });
    paintChart();
  }
  const pace = $('[data-pace]');
  pace.addEventListener('click', (e) => { const r = e.target.closest('[data-prow]'); if (r) { choose(r.dataset.prow); r.focus({ preventScroll: true }); } });
  pace.addEventListener('keydown', (e) => {
    const r = e.target.closest('[data-prow]');
    if (!r) return;
    const rows = $$('[data-prow]', pace), i = rows.indexOf(r);
    const j = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: rows.length - 1 }[e.key];
    if (j === undefined) return;
    e.preventDefault();
    const to = rows[Math.max(0, Math.min(rows.length - 1, j))];
    choose(to.dataset.prow);
    to.focus();
  });
  UI.bindYear($('[data-chart]'));
  function paintDay() {
    $('[data-dayctl]').innerHTML = UI.dayHTML();
    hydrateIcons($('[data-dayctl]'));
    $('[data-today-title]').textContent = OV.day === 0 ? 'Today so far' : OV.dayLabel();
    $('[data-dayline]').textContent = `${OV.day === 0 ? `Until ${clock()}` : 'The whole day'} · ${OV.ORGS.find((o) => o[0] === OV.org)[1]} · choose a number to draw its year`;
  }
  UI.bindDay($('[data-dayctl]'));

  // ---------- In motion: what went wrong first, each with its next step ----------
  // A next step answers the notice it shares with Answer now, or says where to look.
  const NEXT = {
    c446: { notice: 'n446', key: 'muse' },
    480: { href: 'https://github.com/autonomio/poise/pull/480/checks', label: 'Open the failed check' },
    w5: { notice: 'n1141', key: 'agent', label: 'Ask an agent to review Limen#1141' },
    460: { notice: 'n460', key: 'resolve' }
  };
  const listed = new Set();
  function nextHTML(w) {
    const x = NEXT[w.id];
    if (!x) return '';
    if (x.href) return `<a class="lnk" href="${x.href}" target="_blank" rel="noopener" data-ref="ov.next">${esc(x.label)} ↗</a>`;
    const n = OV.N.find((y) => y.id === x.notice), o = n.options.find((y) => y.key === x.key);
    if (n.answering) return `<span class="life" data-life="${n.answering.stage}">${lifeHTML(n.answering.stage, n.answering.words, true)}</span>`;
    if (n.answered) return `<span class="nc-done"><span class="sdot is-saved"></span>${esc(n.answered.words)}</span>`;
    return `<button class="btn-ghost is-primary" data-act="next" data-for="${n.id}" data-key="${o.key}" data-ref="ov.next">${esc(x.label || o.label)}</button>`;
  }
  const itemHTML = (w, next) => `<li><span class="sc" data-state="${w.state}"></span><a href="${w.href}">${esc(w.title)}</a>${w.note ? `<span class="onote">${esc(w.note)}</span>` : ''}${next ? `<span class="ovb-next">${nextHTML(w)}</span>` : ''}</li>`;
  function motionHTML() {
    const wrong = ['failed', 'blocked'].map((s) => {
      const items = one(s);
      return items.length ? `<div class="ovb-st"><h3 class="ovb-sth"><span class="t-micro" data-term="state.${s}">${term(`state.${s}`)}</span><span class="n">${items.length}</span></h3><ul class="owork">${items.map((w) => itemHTML(w, true)).join('')}</ul></div>` : '';
    }).join('');
    const rest = ['needs-you', 'running', 'waiting', 'idle', 'done'];
    const counts = rest.map((s) => { const n = OV.WORK.filter((w) => w.state === s).length; return `<button class="oc${listed.has(s) ? ' is-on' : ''}" data-state-pick="${s}" aria-pressed="${listed.has(s)}"${n ? '' : ' disabled'} data-ref="ov.count"><span class="sc" data-state="${s}"></span><b>${n}</b><span>${term(`state.${s}`)}</span></button>`; }).join('');
    const lists = rest.filter((s) => listed.has(s)).map((s) => `<div class="ovb-st"><h3 class="ovb-sth"><span class="t-micro">${term(`state.${s}`)}</span><span class="n">${OV.WORK.filter((w) => w.state === s).length}</span></h3><ul class="owork">${OV.WORK.filter((w) => w.state === s).map((w) => itemHTML(w, false)).join('')}</ul></div>`).join('');
    return `${wrong}<div class="ovb-rest"><span class="t-gloss">The rest, on request</span><div class="ocounts" role="group" aria-label="List the work in a state">${counts}</div></div>${lists}`;
  }
  const paintMotion = () => { $('[data-motion]').innerHTML = motionHTML(); };
  $('[data-motion]').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.statePick) { const s = b.dataset.statePick; if (listed.has(s)) listed.delete(s); else listed.add(s); paintMotion(); $(`[data-state-pick="${s}"]`)?.focus(); return; }
    if (b.dataset.act === 'next') OV.answer(b.dataset.for, b.dataset.key);
  });
  const paintMgr = () => { $('[data-mgrbox]').innerHTML = UI.managerHTML(); hydrateIcons($('[data-mgrbox]')); };
  UI.bindManager($('[data-mgr]'), paintMgr);

  // ---------- Behaviors: the table, led by what needs a look ----------
  function behLead() {
    const on = OV.BEHAVIORS.filter((b) => b.on === 'on');
    const s = [`${on.length} of ${OV.BEHAVIORS.length} are on.`];
    on.filter((b) => b.last && b.last[0] === 'failed').forEach((b) => s.push(`${b.label} failed at ${b.last[1]} on ${b.last[2]}; Poise tries again on its own.`));
    on.filter((b) => b.paused).forEach((b) => s.push(`${b.label} is paused until ${b.paused}, then resumes.`));
    return s.join(' ');
  }
  const paintBehaviors = () => {
    $('[data-behlead]').textContent = behLead();
    $('[data-behaviors]').innerHTML = UI.behaviorsHTML();
    window.poisePaintTerms?.($('[data-behaviors]'));
  };
  UI.bindBehaviors($('[data-behaviors]'), paintBehaviors);

  // ---------- GitHub API: a quiet line, until the risk is real ----------
  let quotaOpen = false;
  function quotaLine() {
    const risky = OV.QUOTA.some((a) => a.buckets.some((q) => q.risk >= 50));
    const accts = OV.QUOTA.map((a) => `<span class="oq-a"><span class="t-mono">${esc(a.login)}</span>${a.buckets.map((q) => `<span class="oq-b is-${OV.riskTone(q.risk)}" data-ref="ov.bucket">${q.res} <b>${Math.round((q.used / q.limit) * 100)}%</b> used${q.risk ? `, ${q.risk}% risk` : ''}</span>`).join('')}</span>`).join('');
    return `<div class="oqline${risky ? ' is-risk' : ''}" data-ref="ov.quotaline">${accts}<span class="oq-note">${risky ? '<a class="lnk" href="#answer">In Answer now, with its lever</a>' : 'Used of each budget; nothing to watch'}</span><button class="lnk" data-act="quota" aria-expanded="${quotaOpen}">${quotaOpen ? 'Fewer details' : 'Details'}</button></div>${quotaOpen ? UI.quotaHTML() : ''}`;
  }
  const paintQuota = () => { $('[data-quota]').innerHTML = quotaLine(); };
  $('[data-quota]').addEventListener('click', (e) => { if (e.target.closest('[data-act="quota"]')) { quotaOpen = !quotaOpen; paintQuota(); $('[data-act="quota"]')?.focus(); } });

  // ---------- On this page: the section you are reading is marked ----------
  const toc = $('[data-toc]'), secs = $$('.ovb-sec');
  // The section is the one whose top has passed the upper third; at the very end, the last.
  // One chosen from a link stays marked until you scroll yourself, even if it cannot reach the top.
  let aimed = null;
  ['wheel', 'touchmove', 'keydown', 'pointerdown'].forEach((t) => main.addEventListener(t, () => { aimed = null; }, { passive: true }));
  function spy() {
    const line = main.getBoundingClientRect().top + main.clientHeight / 3;
    let cur = secs[0];
    secs.forEach((s) => { if (s.getBoundingClientRect().top <= line) cur = s; });
    if (main.scrollTop + main.clientHeight >= main.scrollHeight - 2) cur = secs[secs.length - 1];
    if (aimed) cur = $(`#${aimed}`);
    $$('[data-toc-to]', toc).forEach((a) => (a.dataset.tocTo === cur.id ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
  }
  main.addEventListener('scroll', spy, { passive: true });

  // ---------- Live ----------
  OV.on((what) => {
    if (what === 'day') { paintDay(); paintTable(); paintChart(); }
    if (what === 'behaviors') paintBehaviors();
    if (what === 'manager') { paintMgr(); paintMotion(); }
    if (what === 'quota') paintQuota();
    if (['answer', 'answered', 'undo', 'settled', 'work'].includes(what)) paintMotion();
    paintBrief();
  });
  // Typical by now moves with the clock; the numbers hold their place while you are on them.
  setInterval(() => {
    paintBrief();
    if (OV.day !== 0) return;
    paintDay();
    paintQuota();
    if (!pace.matches(':hover') && !pace.contains(document.activeElement)) { paintTable(); paintChart(); }
  }, 60000);

  paintBrief(); paintDay(); paintTable(); paintChart(); paintMotion(); paintMgr(); paintBehaviors(); paintQuota(); spy();
  window.poisePaintTerms?.(main);
  // A link from the review opens an element with its full reference.
  const want = params.get('ref');
  if (want) setTimeout(() => { const el = $(`[data-ref="${want}"]`); el?.scrollIntoView({ block: 'center' }); window.poiseOpenRef?.(el); }, 700);
})();
