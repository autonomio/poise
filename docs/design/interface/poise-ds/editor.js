// Editor: a page to write on, and one pane for what surrounds it.
// Presentational only: a scripted workspace that behaves the way Poise would.
(() => {
  const { $, $$, store, params, esc, clock, lifeHTML, lifeTo, toast, closeMenus } = window.PoiseShell;
  const term = (k) => (window.poiseTerm ? window.poiseTerm(k) : k);

  // ---------- Documents ----------
  // The opening of the document open in the live Editor on 22 October.
  const HELIOS = [
    '# HELIOS',
    '# For research in fields where being second means losing',
    'Helios is a new kind of scientific instrument for the age of frontier intelligence. It lets researchers recognize consequential structure across large bodies of dispersed knowledge. As a larger whole comes into view, new questions become possible.',
    '',
    'Helios is an instrument built for continuity. Research develops across conversations, literature, and teams in a shared world model where evidence, uncertainty, and unresolved tensions are present and connected together.',
    '',
    'The instrument operates through the conversations and tools researchers already use. In the portal, the developing knowledge structure takes on a visceral form: relationships can be encountered, followed, and explored.',
    '',
    '# A new kind of research instrument',
    'Helios combines a research portal, a plugin for ChatGPT and Claude, continuous autonomous literature review, a semantic information exploration interface, a question reformulation engine, and an experiential knowledge atlas. Every human and agent interaction connects through the same project-level world model, governed by rules enforced in software.',
    '',
    '**The research portal** is organized around a stream of questions, each connected to relevant entities: claims, evidence, uncertainties, gaps, residue, and relationships.',
    '',
    '**The Helios plugin** connects the portal with existing chats and agent environments, including ChatGPT and Claude. Researchers continue working in familiar tools. Their conversations contribute to the world model, and the developing model enriches each inquiry.',
    '',
    '**Autonomous literature review** continues developing the world model in the background. It finds both apparent connections and those that would otherwise go unnoticed, with every update subject to governance rules enforced in software.',
    '',
    '**Semantic information exploration** lets researchers move fluently through large bodies of relevant literature. Their interactions direct an ongoing background search, and the view updates in real time as they explore.',
    '',
    '**The experiential knowledge atlas** gives the world model a visceral form. Researchers follow relationships, examine suggested connections, and enrich the model through exploration. Its purpose is embodied meaning: understanding that develops only through encountering knowledge and working with its relationships.',
    '',
    '**The question reformulation engine** recasts research questions in surprising forms, helping both the researcher and frontier intelligence move beyond their usual limits.',
    '',
    '**The world model** is the connective tissue of the instrument. It captures every connected conversation, claim, piece of evidence, gap, residue, uncertainty, and expiry condition. It is secure, tamper-proof, encrypted, and owned by the organization.',
    '',
    '# The whole develops around the questions',
    'The knowledge relevant to a research question far exceeds what researchers can continuously examine. Literature, patents, and other research material are dispersed across services, each with its own conventions and search interfaces.',
    '',
    'Meaning and relationships within knowledge extend beyond words and definitions. They can remain latent across a body of knowledge, inaccessible even to the most sophisticated and sustained human analysis.'
  ].join('\n');
  const KEY = 'poise-editor-v1';
  const kept = store.get(KEY, {});
  // Real titles from the live document list; only HELIOS opens in full here.
  const DOCS = [
    ['helios', 'HELIOS', '1d', 'Yesterday', true],
    ['gcheck', 'Poise Google connection check — 22 October 2026', '1d', 'Yesterday'],
    ['awb', 'Automated Work and Beyond', '2d', 'This week'],
    ['daemon', 'The Daemon', '2d', 'This week'],
    ['limen', 'Limen: The Research Engine', '3d', 'This week'],
    ['acme', 'acme.example', '4d', 'This week'],
    ['dmn', 'Sixteen Simple Statements About the Default Mode Network', '5d', 'This week'],
    ['corp', 'Corporate position', '13d', 'This month'],
    ['demon', 'From the dream of all-knowing demon to the reality of self-correcting…', '13d', 'This month'],
    ['ruoka', 'Ruoka kypsänä, ei raakana', '13d', 'This month'],
    ['bg', 'Background', '13d', 'This month'],
    ['hello', 'Hello world', '13d', 'This month']
  ].map(([id, title, ago, bucket, full]) => ({ id, title, ago, bucket, full: !!full }));
  (kept.created || []).forEach((d) => DOCS.unshift(d));
  (kept.deleted || []).forEach((id) => { const i = DOCS.findIndex((d) => d.id === id); if (i >= 0) DOCS.splice(i, 1); });
  const TEXT = Object.assign({ helios: HELIOS }, kept.text || {});
  let current = DOCS.find((d) => d.full)?.id || null;
  let shown = null;   // the document whose text is on the page right now
  const byDoc = (id) => DOCS.find((d) => d.id === id);
  const persist = () => store.set(KEY, { text: Object.fromEntries(DOCS.filter((d) => d.full).map((d) => [d.id, TEXT[d.id] || ''])), created: DOCS.filter((d) => d.created), deleted: kept.deleted || [], comments: COMMENTS, chats: Object.fromEntries(Object.entries(CHATS).map(([k, v]) => [k, v.filter((m) => !m.typing)])) });

  // ---------- Lines: Markdown drawn as you type; markers show on the caret line ----------
  const docEl = $('[data-doc]'), paperEl = $('[data-paper]'), scrollEl = $('[data-scroll]'), marksEl = $('[data-marks]');
  const BLOCK = [[/^### /, 'h3'], [/^## /, 'h2'], [/^# /, 'h1'], [/^(\d+\.|[-*]) /, 'li'], [/^> /, 'quote'], [/^(-{3,}|\*{3,})\s*$/, 'rule']];
  function kindOf(t) {
    for (const [re, kind] of BLOCK) { const m = t.match(re); if (m) return { kind, len: kind === 'rule' ? t.length : m[0].length }; }
    return { kind: t ? 'body' : 'empty', len: 0 };
  }
  const inline = (s) => esc(s).replace(/\*\*([^*]+?)\*\*/g, '<span class="mk">**</span><b>$1</b><span class="mk">**</span>');
  function lineHTML(t) {
    if (!t) return '<br>';
    const k = kindOf(t);
    return `${k.len ? `<span class="mk blk">${esc(t.slice(0, k.len))}</span>` : ''}${inline(t.slice(k.len))}`;
  }
  const lineDiv = (t) => `<div class="ln" data-kind="${kindOf(t).kind}" data-src="${esc(t)}">${lineHTML(t)}</div>`;
  const lines = () => $$('.ln', docEl);
  const docText = () => lines().map((l) => l.textContent).join('\n');
  const lineOf = (node) => (node && (node.nodeType === 1 ? node : node.parentElement))?.closest?.('.ln');

  // Character offsets count every source character, hidden markers included.
  function offsetIn(line, node, off) {
    if (node === line) { let n = 0; for (let i = 0; i < off; i++) n += line.childNodes[i].textContent.length; return n; }
    const w = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let n = 0, t;
    while ((t = w.nextNode())) { if (t === node) return n + off; n += t.length; }
    return n;
  }
  function locate(line, off) {
    const w = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let n = 0, t, last = null;
    while ((t = w.nextNode())) { if (off < n + t.length || (off === n + t.length && !t.parentElement.classList.contains('mk'))) return [t, off - n]; n += t.length; last = t; }
    return last ? [last, last.length] : [line, 0];
  }
  function setCaret(line, off) {
    const [node, o] = locate(line, off), r = document.createRange();
    r.setStart(node, Math.min(o, node.nodeType === 3 ? node.length : 0));
    r.collapse(true);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
  function caretPos() {
    const s = getSelection(), line = s.rangeCount && lineOf(s.anchorNode);
    return line && docEl.contains(line) ? [lines().indexOf(line), offsetIn(line, s.anchorNode, s.anchorOffset)] : null;
  }
  function markCaret() {
    const s = getSelection(), line = s.rangeCount && docEl.contains(s.anchorNode) ? lineOf(s.anchorNode) : null;
    lines().forEach((l) => l.classList.toggle('is-caret', l === line));
  }
  // Keep the page a flat list of lines, whatever the browser inserts.
  function normalize() {
    [...docEl.childNodes].forEach((n) => {
      if (n.nodeType === 1 && n.classList.contains('ln')) return;
      if (n.nodeType === 1 && n.tagName === 'DIV') { n.className = 'ln'; return; }
      if (n.nodeType === 1 && n.tagName === 'BR' && docEl.childNodes.length > 1) { n.remove(); return; }
      const d = document.createElement('div');
      d.className = 'ln';
      docEl.insertBefore(d, n);
      d.append(n);
    });
    if (!docEl.firstChild) docEl.innerHTML = lineDiv('');
  }
  function sync() {
    normalize();
    const pos = caretPos();
    lines().forEach((l) => {
      const t = l.textContent;
      if (l.dataset.src === t && l.dataset.kind) return;
      l.dataset.src = t;
      l.dataset.kind = kindOf(t).kind;
      l.innerHTML = lineHTML(t);
    });
    if (pos) setCaret(lines()[pos[0]], pos[1]);
    markCaret();
    docEl.dataset.empty = String(!docText().trim());
  }
  function load(text) {
    docEl.innerHTML = text.split('\n').map(lineDiv).join('');
    docEl.dataset.empty = String(!text.trim());
  }

  // ---------- Undo and redo: Poise's own history, kept per document ----------
  const HIST = {};
  let histTimer = 0;
  const hist = () => (HIST[current] ||= { list: [{ text: docText(), pos: null }], i: 0 });
  function record() {
    const h = hist(), text = docText();
    if (h.list[h.i].text === text) return;
    h.list.splice(h.i + 1);
    h.list.push({ text, pos: caretPos() });
    if (h.list.length > 200) h.list.shift();
    h.i = h.list.length - 1;
  }
  function travel(step) {
    clearTimeout(histTimer);
    record();
    const h = hist(), to = h.i + step;
    if (to < 0 || to >= h.list.length) return;
    h.i = to;
    const { text, pos } = h.list[to], at = h.list[step < 0 ? to + 1 : to].pos;
    load(text);
    const p = (step < 0 ? at : pos) || [Math.max(0, text.split('\n').length - 1), 0];
    const line = lines()[Math.min(p[0], lines().length - 1)];
    if (line) setCaret(line, Math.min(p[1], line.textContent.length));
    markCaret();
    changed(false);
  }

  // ---------- Saving: Saving…, then Saved with the time ----------
  // ?save=failed or conflict shows a save that did not go through.
  const SAVE = { state: ['failed', 'conflict'].includes(params.get('save')) ? params.get('save') : 'saved', at: '19:40' };
  let saveTimer = 0;
  function changed(recordIt = true) {
    TEXT[current] = docText();
    if (recordIt) { clearTimeout(histTimer); histTimer = setTimeout(record, 450); }
    if (SAVE.state === 'conflict') { renderStatus(); return; }
    SAVE.state = 'saving';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 900);
    const d = byDoc(current);
    if (d) { d.ago = 'now'; d.bucket = 'Today'; d.title = titleOf(TEXT[current]) || 'Untitled'; $('[data-doc-title]').textContent = d.title; }
    drawMarks();
    renderStatus();
  }
  function saveNow() {
    clearTimeout(saveTimer);
    if (!shown) return;
    TEXT[shown] = docText();
    persist();
    Object.assign(SAVE, { state: 'saved', at: clock() });
    renderStatus();
  }
  const titleOf = (text) => (text.split('\n').find((l) => l.trim()) || '').replace(/^#+\s*/, '').replace(/\*\*/g, '').trim().slice(0, 80);
  const words = () => docText().split('\n').map((l) => l.slice(kindOf(l).len).replace(/\*\*/g, '')).join(' ').split(/\s+/).filter(Boolean).length;

  // ---------- Status line: the document at a glance ----------
  const statusEl = $('[data-status]');
  function pubSummary() {
    const pubs = SITES.filter((s) => s.pub);
    if (!pubs.length) return '<span class="t-muted">Not yet</span>';
    return pubs.map((s) => `<span class="sc" data-state="${s.pub.state}"></span>${s.name} · ${term('state.' + s.pub.state)}${s.pub.detail ? ` · ${s.pub.detail}` : ''}`).join('<span class="sep"></span>');
  }
  function renderStatus() {
    if (!statusEl) return;
    if (!byDoc(current)?.full) { statusEl.innerHTML = ''; return; }
    const needs = REVIEWS.filter((r) => r.state === 'needs-you' && !r.held).length, held = REVIEWS.filter((r) => r.held).length;
    statusEl.innerHTML = `<span class="stat" data-ref="ed.save"><span class="save-dot${SAVE.state === 'saving' ? ' is-saving' : SAVE.state === 'failed' || SAVE.state === 'conflict' ? ' is-failed' : ''}"></span>${SAVE.state === 'saving' ? 'Saving…' : SAVE.state === 'failed' ? 'Not saved · retrying' : SAVE.state === 'conflict' ? 'Conflict: reload' : `Saved · ${SAVE.at}`}</span>`
      + `<span class="sep"></span><span class="stat" data-ref="ed.words">${words().toLocaleString('en-US')} words</span><span class="sep"></span>`
      + `<button class="stat" data-act="tab" data-tab="comments" data-ref="ed.comments"><span class="t-micro">Comments</span>${COMMENTS.length}</button>`
      + `<button class="stat" data-act="tab" data-tab="reviews" data-ref="ed.reviews"><span class="t-micro">Reviews</span>${needs ? `<span class="sc" data-state="needs-you"></span>${term('state.needs-you')} ${needs}` : 'none open'}${held ? `<span class="new" data-ref="ed.held">${held} new</span>` : ''}</button>`
      + `<button class="stat push" data-act="tab" data-tab="publish" data-ref="ed.published"><span class="t-micro">Published</span>${pubSummary()}</button>`;
  }

  // ---------- What surrounds HELIOS: comments, reviews, publications, a chat ----------
  let uid = 0;
  const nid = (p) => `${p}${Date.now().toString(36)}${uid++}`;
  const COMMENTS = kept.comments || [
    { id: 'c1', quote: 'takes on a visceral form', text: 'Is “visceral” right for a research audience?', at: '19:12', replies: [{ id: 'c1a', who: 'agent', at: '19:13', text: '“Tangible” keeps the sense of contact without the bodily undertone. The atlas paragraph says “visceral” too, so change both or neither.', edit: { from: 'takes on a visceral form', to: 'takes on a tangible form' } }] },
    { id: 'c2', quote: 'secure, tamper-proof, encrypted', text: 'Can we stand behind “tamper-proof”?', at: '19:20', replies: [] }
  ];
  const REVIEWS = [
    { id: 'r1', site: 'example.com', pr: 14, who: 'Copilot', quote: 'Literature, patents, and other research material are dispersed across services', text: 'Name two or three of these services; it makes the dispersion concrete.', state: 'needs-you', at: '19:31', replies: [] },
    { id: 'r2', site: 'example.com', pr: 14, who: 'Copilot', quote: null, text: 'The document opens with two H1 headings in a row. Consider making the second a subtitle.', state: 'needs-you', at: '19:31', replies: [] },
    { id: 'r3', site: 'Google Docs', who: 'A reader in Google Docs', quote: 'governed by rules enforced in software', text: 'Which rules? A short example would help.', state: 'done', at: '18:02', replies: [{ id: 'r3a', who: 'you', text: 'Added an example to the governance section.' }] }
  ];
  const SITES = [
    { key: 'mkc', name: 'example.com', section: 'Articles', chosen: true, slug: 'helios', pub: { pr: 14, state: 'waiting', detail: 'checks running' } },
    { key: 'vq', name: 'acme.example', section: 'Writing', chosen: false, slug: 'helios', pub: null },
    { key: 'ec', name: 'example.org', section: 'Notes', chosen: false, slug: 'helios', pub: null }
  ];
  const SHARED = { title: 'HELIOS', description: 'For research in fields where being second means losing', date: '2026-10-22' };
  const GOOGLE = { state: 'local', reviewing: false };
  // ?google=new, none, off or gone: a document not yet on Google, and what can stand in the way.
  let gFirst = ['new', 'none', 'off', 'gone'].includes(params.get('google')) ? params.get('google') : '';
  const GOOGLE_FIRST = { new: 'Publish a private Markdown document.', none: 'Connect Google to publish this document.', off: 'Google connections are unavailable. Ask the Poise operator to enable Google.', gone: 'That Google account is no longer connected. Reconnect it or choose an account explicitly.' };
  const GOOGLE_SAYS = { match: 'Matches your draft', local: 'Your draft changed since you published to Google', remote: 'Google’s copy changed: someone edited the Google Doc' };
  const CHATS = kept.chats || {};
  const chatOf = () => (CHATS[current] ||= []);
  const LIVES = {};   // element key → [stage, label, skip]
  // A new issue takes the next number after the workspace's newest, #509.
  let nextPr = 15, nextIssue = 510, checkedAt = '19:40', publishing = false;
  const withDoc = () => current === 'helios';

  // ---------- Underlines over the text, never moving it ----------
  function rangeFor(quote) {
    if (!quote) return null;
    for (const l of lines()) {
      const i = l.textContent.indexOf(quote);
      if (i < 0) continue;
      const r = document.createRange(), [a, ao] = locate(l, i), [b, bo] = locate(l, i + quote.length);
      r.setStart(a, ao);
      r.setEnd(b, bo);
      return r;
    }
    return null;
  }
  function rectsHTML(range, cls, extra = '') {
    const base = paperEl.getBoundingClientRect();
    return [...range.getClientRects()].filter((r) => r.width >= 1).map((r) => `<div class="${cls}" ${extra} style="left:${r.left - base.left}px;top:${cls.startsWith('ed-hi') ? r.top - base.top : r.bottom - base.top - 2}px;width:${r.width}px${cls.startsWith('ed-hi') ? `;height:${r.height}px` : ''}"></div>`).join('');
  }
  function drawMarks() {
    if (!marksEl) return;
    if (!withDoc()) { marksEl.innerHTML = ''; return; }
    let html = '';
    COMMENTS.forEach((c) => { const r = rangeFor(c.quote); c.lost = !!c.quote && !r; if (r) html += rectsHTML(r, 'ed-mark', `data-mark="${c.id}" data-ref="ed.mark"`); });
    REVIEWS.filter((v) => v.state === 'needs-you' && !v.held).forEach((v) => { const r = rangeFor(v.quote); v.lost = !!v.quote && !r; if (r) html += rectsHTML(r, 'ed-mark is-review', `data-mark="${v.id}" data-ref="ed.mark"`); });
    marksEl.innerHTML = html;
  }
  function flash(quote, cls = 'ed-hi', ms = 1600) {
    const r = rangeFor(quote);
    if (!r) return false;
    marksEl.insertAdjacentHTML('beforeend', rectsHTML(r, `${cls} is-flash`));
    const added = $$('.is-flash', marksEl);
    if (ms) setTimeout(() => added.forEach((d) => d.remove()), ms);
    return true;
  }
  function showPassage(quote) {
    const r = rangeFor(quote);
    if (!r) { toast('That passage is no longer in the document; the comment is kept.'); return; }
    const box = r.getBoundingClientRect(), s = scrollEl.getBoundingClientRect();
    if (box.top < s.top + 40 || box.bottom > s.bottom - 40) scrollEl.scrollTo({ top: scrollEl.scrollTop + box.top - s.top - s.height / 3, behavior: 'smooth' });
    flash(quote);
  }

  // ---------- Selection: comment, ask an agent, create an issue, save a snippet ----------
  const selbar = $('[data-selbar]'), pop = $('[data-popover]');
  let selQuote = '';
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  function hideSel() { selbar.hidden = true; }
  document.addEventListener('selectionchange', () => {
    markCaret();
    const s = getSelection();
    if (!s.rangeCount || s.isCollapsed || !docEl.contains(s.anchorNode) || !docEl.contains(s.focusNode)) {
      hideSel();
      // A click back into the text lets go of the selection Chat beside was reading.
      if (s.rangeCount && s.isCollapsed && docEl.contains(s.anchorNode) && lastSel) { lastSel = ''; renderReads(); }
      return;
    }
    selQuote = s.toString().split('\n').map((t) => t.trim()).find(Boolean) || '';
    if (!selQuote || !withDoc()) { hideSel(); return; }
    lastSel = selQuote;
    renderReads();
    const r = s.getRangeAt(0).getBoundingClientRect();
    selbar.hidden = false;
    selbar.style.left = `${clamp(r.left + r.width / 2 - selbar.offsetWidth / 2, 8, innerWidth - selbar.offsetWidth - 8)}px`;
    selbar.style.top = `${Math.max(8, r.top - selbar.offsetHeight - 8)}px`;
  });
  selbar.addEventListener('mousedown', (e) => e.preventDefault());
  const REPOS = ['autonomio/poise', 'Acme/Limen', 'Acme/design-system', 'mikkokotila/control-plane', 'agent-tooling'];
  function openPop(html) {
    const top = selbar.hidden ? innerHeight / 3 : parseFloat(selbar.style.top) + selbar.offsetHeight + 8;
    const left = selbar.hidden ? innerWidth / 2 - 176 : parseFloat(selbar.style.left);
    hideSel();
    pop.innerHTML = html;
    pop.hidden = false;
    hydrateIcons(pop);
    pop.style.left = `${clamp(left, 8, innerWidth - pop.offsetWidth - 8)}px`;
    pop.style.top = `${clamp(top, 8, innerHeight - pop.offsetHeight - 8)}px`;
    $('input, textarea', pop)?.focus();
  }
  function closePop() { pop.hidden = true; pop.innerHTML = ''; }
  const issuePop = (q) => `<h4>Create issue</h4><input data-p="title" aria-label="Issue title" data-ref="composer.title" placeholder="Issue title" value="${esc(q.split(/\s+/).slice(0, 8).join(' '))}"><textarea data-p="body" rows="3" aria-label="Issue body" data-ref="composer.body">${esc(q)}</textarea><select data-p="repo" aria-label="Repository" data-ref="composer.repo">${REPOS.map((r) => `<option>${r}</option>`).join('')}</select><span class="err" data-p="err" hidden></span><div class="life" data-ref="life" data-p="life" hidden></div><div class="row"><button class="btn btn-line" data-act="pop-cancel">Cancel</button><button class="btn btn-primary" data-act="pop-issue">Open issue</button></div>`;
  const snippetPop = (q) => `<h4>Save as snippet</h4><input data-p="name" aria-label="Snippet name" placeholder="Name" value="${esc(q.split(/\s+/).slice(0, 4).join(' '))}"><textarea data-p="text" rows="3" aria-label="Snippet text">${esc(q)}</textarea><div class="life" data-ref="life" data-p="life" hidden></div><div class="row"><button class="btn btn-line" data-act="pop-cancel">Cancel</button><button class="btn btn-primary" data-act="pop-snippet">Save</button></div>`;

  // ---------- The side pane ----------
  const bodyEl = $('.ed-body'), tabsEl = $('[data-tabs]'), paneEl = $('[data-pane]');
  let tab = null, inPane = false;
  const lifeOf = (key) => (LIVES[key] ? `<div class="life" data-ref="life" data-life-for="${key}">${lifeHTML(...LIVES[key])}</div>` : `<div class="life" data-ref="life" data-life-for="${key}" hidden></div>`);
  function life(key, stage, label, skip) {
    LIVES[key] = [stage, label, skip];
    const el = $(`[data-life-for="${key}"]`);
    if (el) { el.hidden = false; lifeTo(el, stage, label, skip); }
  }
  const docOrder = (q) => { const i = q ? docText().indexOf(q) : -1; return i < 0 ? Infinity : i; };
  function diffHTML({ from, to }) {
    let a = 0;
    while (a < from.length && a < to.length && from[a] === to[a]) a++;
    let b = 0;
    while (b < from.length - a && b < to.length - a && from[from.length - 1 - b] === to[to.length - 1 - b]) b++;
    return `${esc(from.slice(0, a))}<del>${esc(from.slice(a, from.length - b))}</del><ins>${esc(to.slice(a, to.length - b))}</ins>${esc(from.slice(from.length - b))}`;
  }
  const suggestHTML = (r) => `<div class="suggest" data-ref="ed.suggest"><span class="t-micro">Suggested edit</span><p class="chg">${diffHTML(r.edit)}</p>${r.applied ? '' : `<div class="acts"><button class="btn-ghost" data-act="sg-show">Show in text</button><button class="btn btn-primary" data-act="sg-apply" data-ref="ed.suggest">Apply</button></div>`}${lifeOf(`${r.id}-apply`)}${r.failed ? `<span class="pane-note"><span class="st" data-state="failed"><span data-term="state.failed">Failed</span></span> The passage changed since; nothing was applied.</span>` : ''}</div>`;
  const replyHTML = (r) => `<div class="reply${r.who === 'you' ? ' is-you' : ''}" data-reply="${r.id}"><span class="who">${r.who === 'agent' ? 'Agent' : 'You'}${r.at ? ` · ${r.at}` : ''}</span>${lifeOf(r.id)}${r.text ? `<p>${esc(r.text)}</p>` : ''}${r.edit ? suggestHTML(r) : ''}${r.suggest ? `<div class="pane-sec"><span class="t-micro">Suggested GitHub reply</span><p>${esc(r.suggest)}</p><button class="btn-ghost" data-act="use-reply" data-id="${r.id}" data-ref="ed.review.reply">Use as reply</button></div>` : ''}</div>`;
  const quoteHTML = (it) => (it.quote ? `<button class="quote${it.lost ? ' is-lost' : ''}" data-act="passage" data-ref="ed.passage">${it.lost ? 'Passage changed · ' : ''}“${esc(it.quote)}”</button>` : '');
  function commentHTML(c) {
    const head = c.editing
      ? `<textarea data-cdraft="${c.id}" rows="3" aria-label="Your comment" placeholder="Write a comment…">${esc(c.draft || '')}</textarea><div class="acts"><button class="btn btn-primary" data-act="c-save">Save</button><button class="btn btn-line" data-act="c-cancel">Cancel</button></div>`
      : `<div class="pcard-h"><span class="who">You</span><time>${c.at}</time></div><p>${esc(c.text)}</p>`;
    return `<article class="pcard" data-comment="${c.id}" data-ref="ed.comment">${quoteHTML(c)}${head}${c.replies.map(replyHTML).join('')}${c.editing ? '' : `<div class="acts"><button class="btn-ghost" data-act="c-ask" data-ref="ed.comment.ask"><i data-i="think" class="sm"></i>Ask the agent</button><button class="btn-ghost" data-act="c-del" data-ref="ed.comment.delete"><i data-i="cross" class="sm"></i>Delete</button></div>`}</article>`;
  }
  function reviewHTML(v) {
    return `<article class="pcard${v.isNew ? ' is-new' : ''}" data-review="${v.id}" data-ref="ed.review"><div class="pcard-h"><span class="st" data-state="${v.state}"><span data-term="state.${v.state}">${term('state.' + v.state)}</span></span><span class="who">${esc(v.who)}</span><span>${v.site}${v.pr ? ` · #${v.pr}` : ''}</span>${v.isNew ? '<span class="new">New</span>' : ''}<time>${v.at}</time></div>${v.quote ? quoteHTML(v) : '<span class="pane-note">Document feedback</span>'}<p>${esc(v.text)}</p>${v.replies.map(replyHTML).join('')}${lifeOf(v.id)}`
      + `${v.replying ? `<textarea data-rdraft="${v.id}" rows="2" aria-label="Reply on GitHub" placeholder="Your reply, posted as you">${esc(v.draft || '')}</textarea><div class="acts"><button class="btn btn-primary" data-act="r-post">Post reply</button><button class="btn btn-line" data-act="r-cancel">Cancel</button></div>` : ''}`
      + `${v.state === 'done' || v.replying ? '' : `<div class="acts">${v.pr ? '<button class="btn-ghost" data-act="r-reply" data-ref="ed.review.reply">Reply on GitHub</button><button class="btn-ghost" data-act="r-resolve" data-ref="ed.review.resolve">Resolve thread</button>' : ''}<button class="btn-ghost" data-act="r-ask" data-ref="ed.review.ask">Ask an agent privately</button></div>`}</article>`;
  }
  function publishHTML() {
    // ?sites=none: nothing to publish to yet.
    if (params.get('sites') === 'none') return '<div class="pane-sec"><p class="pane-note">No sites to publish to yet.</p><a class="lnk" href="settings.html?back=editor#publishing" data-ref="ed.site">Add one in Settings → Publishing</a></div>';
    const chosen = SITES.filter((s) => s.chosen), update = chosen.length && chosen.every((s) => s.pub);
    const sites = SITES.map((s) => `<label class="site" data-site="${s.key}" data-ref="ed.site"><input type="checkbox" data-site-pick="${s.key}"${s.chosen ? ' checked' : ''}${publishing ? ' disabled' : ''}><span class="name">${s.name} <small>· ${s.section}</small></span>${s.pub ? `<span class="pub" data-ref="ed.pub"><span class="st" data-state="${s.pub.state}"><span data-term="state.${s.pub.state}">${term('state.' + s.pub.state)}</span></span>${s.pub.detail}<span class="t-mono">#${s.pub.pr}</span></span>` : ''}${lifeOf(`site-${s.key}`)}</label>`).join('');
    const fields = chosen.length ? `<div class="pane-sec pane-form"><span class="t-micro">Once, for every site</span><label class="field" data-ref="ed.field"><span>Title</span><input data-shared="title" value="${esc(SHARED.title)}"></label><label class="field" data-ref="ed.field"><span>Description</span><textarea data-shared="description" rows="2">${esc(SHARED.description)}</textarea></label><label class="field" data-ref="ed.field"><span>Date</span><input type="date" data-shared="date" value="${SHARED.date}"></label>${chosen.map((s) => `<span class="dest-name">${s.name} · ${s.section}</span><label class="field" data-ref="ed.field"><span>Slug</span><input data-slug="${s.key}" value="${esc(s.slug)}"${s.pub ? ' readonly' : ''}></label>`).join('')}</div>` : '';
    const g = GOOGLE.reviewing ? `<div class="compare"><div><h5>Your draft</h5><pre>${esc(GOOGLE.mine)}</pre></div><div><h5>Google’s copy</h5><pre>${esc(GOOGLE.theirs)}</pre></div></div><div class="acts"><button class="btn btn-primary" data-act="g-import">Import Google’s version</button><button class="btn-ghost" data-act="g-publish">Publish yours instead</button><button class="btn-ghost" data-act="g-keep">Keep your draft</button></div>` : '';
    return `<div class="pane-sec pane-form"><span class="t-micro">Sites</span>${sites}<span class="pane-note">From Settings → Publishing. Each site gets a pull request.</span></div>${fields}`
      + `<div class="pane-sec"><div class="acts"><button class="btn btn-primary" data-act="publish" data-ref="ed.publish.go"${!chosen.length || publishing ? ' aria-disabled="true"' : ''}>${publishing ? 'Publishing…' : update ? 'Update' : 'Publish'}</button></div></div>`
      + `<div class="pane-sec" data-ref="ed.google"><span class="t-micro">Google Docs</span>${gFirst ? `<p class="pane-note">${GOOGLE_FIRST[gFirst]}</p>${gFirst === 'new' || gFirst === 'gone' ? `<div class="pane-form"><label class="field"><span>Google publishing account</span><select aria-label="Google publishing account" data-google-account>${gFirst === 'gone' ? '<option value="" selected disabled>Choose a Google account…</option>' : ''}<option value="g1">mikko@example.com</option></select></label></div>` : ''}<div class="acts">${gFirst === 'off' ? '' : `${gFirst === 'none' ? '' : `<button class="btn-ghost" data-act="g-first"${gFirst === 'gone' ? ' aria-disabled="true"' : ''}>Publish to Google</button>`}<a class="lnk" href="settings.html?back=editor#accounts">${gFirst === 'gone' ? 'Reconnect Google account' : 'Add Google account'}</a>`}</div>` : `<p class="pane-note"><b data-google-state>${GOOGLE_SAYS[GOOGLE.state]}</b></p><p class="pane-note">HELIOS · mikko@example.com</p>`}${lifeOf('google')}${gFirst ? '' : GOOGLE.reviewing ? g : `<div class="acts"><button class="btn-ghost" data-act="g-publish">Update Google document</button><button class="btn-ghost" data-act="g-refresh">Refresh Google</button>${GOOGLE.state === 'remote' ? '<button class="btn-ghost" data-act="g-review" data-ref="ed.google.review">Review Google’s changes</button>' : ''}</div>`}</div>`;
  }
  const AGENTS = ['Claude Code · Opus 5 · High', 'Muse · spark 1.3 contributor · max', 'Codex · GPT-5 Codex · High'];
  const STARTS = ['Tighten the opening', 'Check claims that need a source', 'Suggest a subtitle', 'Summarise it in three lines'];
  let agent = AGENTS.includes(store.get('poise-editor-agent', '')) ? store.get('poise-editor-agent', '') : AGENTS[0];
  let chatDraft = '', lastSel = '', pending = null;
  const short = (t, n = 48) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
  const msgHTML = (m) => (m.who === 'you'
    ? `<div class="msg is-you" data-msg="${m.id}" data-ref="msg.you"><span class="who">You · ${m.at}</span>${m.about ? `<span class="about">About “${esc(short(m.about))}”</span>` : ''}<p>${esc(m.text)}</p>${lifeOf(m.id)}</div>`
    : `<div class="msg is-agent" data-msg="${m.id}"><span class="who">${esc(m.agent || 'Agent')} · ${m.at}</span>${m.typing ? '<span class="dots" aria-label="Writing"><i></i><i></i><i></i></span>' : `<p>${esc(m.text)}</p>`}${m.read ? `<span class="read">Read: ${m.read}</span>` : ''}${m.edit ? suggestHTML(m) : ''}</div>`);
  const readsHTML = () => `<span class="t-micro">Reads</span><span class="chip is-outline">“${esc(short(byDoc(current)?.title || 'this document', 30))}” · ${words().toLocaleString('en-US')} words</span>${lastSel ? `<span class="chip is-agent">Selection: “${esc(short(lastSel, 34))}”<button class="x" data-act="cb-drop-sel" aria-label="Leave the selection out">×</button></span>` : '<span class="t-gloss">Select text to ask about just that</span>'}`;
  const scrollThread = () => { const t = $('[data-thread]', paneEl); if (t) t.scrollTop = t.scrollHeight; };
  function renderReads() {
    const el = tab === 'chat' && $('[data-cb-reads]', paneEl);
    if (!el) return;
    el.innerHTML = readsHTML();
    const input = $('[data-chat-in]', paneEl);
    if (input) input.placeholder = lastSel ? 'Ask about your selection (Enter)' : 'Ask about this document (Enter)';
  }
  function paneHTML() {
    if (!withDoc() && tab !== 'chat') return `<div class="pane-sec"><p class="pane-note">${tab === 'comments' ? 'No comments yet. Select text and choose Comment.' : tab === 'reviews' ? 'Reviews arrive once this document is published.' : 'Publish this document once it has a title.'}</p></div>`;
    if (tab === 'comments') return `<div class="pane-sec">${COMMENTS.length ? [...COMMENTS].sort((a, b) => docOrder(a.quote) - docOrder(b.quote)).map(commentHTML).join('') : '<p class="pane-note">No comments yet. Select text and choose Comment.</p>'}</div>`;
    if (tab === 'reviews') {
      const shown = REVIEWS.filter((v) => !v.held), open = shown.filter((v) => v.state !== 'done').sort((a, b) => docOrder(a.quote) - docOrder(b.quote)), closed = shown.filter((v) => v.state === 'done');
      return `<div class="pane-sec"><div class="acts"><button class="btn-ghost" data-act="r-refresh" data-ref="ed.review.refresh"><i data-i="replay" class="sm"></i>Refresh reviews</button><span class="pane-note" data-checked>Checked ${checkedAt}</span></div>${open.map(reviewHTML).join('') || '<p class="pane-note">Nothing waits for you.</p>'}</div>${closed.length ? `<div class="pane-sec"><span class="t-micro">${term('state.done')}</span>${closed.map(reviewHTML).join('')}</div>` : ''}`;
    }
    if (tab === 'publish') return publishHTML();
    const msgs = chatOf(), st = pending ? 'running' : 'idle';
    return `<div class="cb" data-ref="ed.chat"><div class="cb-head"><span class="st" data-state="${st}" data-ref="state"><span data-term="state.${st}">${term('state.' + st)}</span></span><span class="cb-agent"><select data-cb-agent aria-label="Agent and model" data-ref="ed.chat.agent">${AGENTS.map((a) => `<option${a === agent ? ' selected' : ''}>${a}</option>`).join('')}</select></span></div>`
      + `<div class="cb-reads" data-cb-reads data-ref="ed.chat.reads">${readsHTML()}</div>`
      + `${msgs.length ? '' : `<div class="cb-starts"><p>Ask about “${esc(short(byDoc(current)?.title || 'this document', 40))}”, or start with one of these:</p>${STARTS.map((t) => `<button data-act="cb-start" data-ref="ed.chat.start">${t}</button>`).join('')}</div>`}`
      + `<div class="thread" data-thread>${msgs.map(msgHTML).join('')}</div>`
      + `<div class="thread-in"><textarea data-chat-in rows="2" aria-label="Message" data-ref="ed.chat.in" placeholder="${lastSel ? 'Ask about your selection (Enter)' : 'Ask about this document (Enter)'}">${esc(chatDraft)}</textarea><div class="acts"><span class="pane-note">It suggests edits; it never changes the text itself.</span>${pending ? '<button class="btn btn-line" data-act="cb-stop" data-ref="ed.chat.stop">Stop</button>' : '<button class="btn btn-primary" data-act="chat-send" data-ref="composer.send">Send</button>'}</div></div></div>`;
  }
  function renderTabs() {
    const needs = REVIEWS.filter((v) => v.state === 'needs-you' && !v.held).length;
    tabsEl.innerHTML = [['comments', 'Comments', withDoc() ? COMMENTS.length : 0], ['reviews', 'Reviews', withDoc() ? needs : 0], ['publish', 'Publish', null], ['chat', 'Chat', null]]
      .map(([k, label, n]) => `<button role="tab" aria-selected="${tab === k}" data-act="tab" data-tab="${k}" data-ref="ed.tab.${k}">${label}${n != null ? `<span class="n${k === 'reviews' && n ? ' is-attention' : ''}">${n}</span>` : ''}</button>`).join('')
      + '<button class="ib" data-act="close-pane" aria-label="Close the side pane" data-ref="pane.close"><i data-i="cross"></i></button>';
    hydrateIcons(tabsEl);
    $$('.ed-head [data-act="tab"]').forEach((b) => b.setAttribute('aria-pressed', String(bodyEl.classList.contains('pane-open') && b.dataset.tab === tab)));
  }
  function renderPane() {
    if (!tab) return;
    paneEl.classList.toggle('is-chat', tab === 'chat');
    paneEl.innerHTML = paneHTML();
    scrollThread();
    hydrateIcons(paneEl);
    window.poisePaintTerms?.(paneEl);
  }
  function openTab(name, toggle) {
    if (toggle && tab === name && bodyEl.classList.contains('pane-open')) { closePane(); return; }
    tab = name;
    bodyEl.classList.add('pane-open');
    if (name === 'reviews') REVIEWS.forEach((v) => { if (v.held) { v.held = false; v.isNew = true; } });
    renderTabs();
    renderPane();
    renderStatus();
    drawMarks();
  }
  function closePane() { bodyEl.classList.remove('pane-open'); tab = null; renderTabs(); }

  // ---------- Agents, comments and suggested edits ----------
  const AGENT = [
    ['tamper-proof', '“Tamper-proof” promises more than software can show. “Tamper-evident” says what the world model can guarantee: every change is recorded and visible.', { from: 'secure, tamper-proof, encrypted', to: 'secure, tamper-evident, encrypted' }],
    ['dispersed across services', 'Two or three named examples are enough. They turn an abstract claim into something a reader recognises.', { from: 'dispersed across services,', to: 'dispersed across services such as PubMed, patent offices and preprint servers,' }],
    ['two H1 headings', 'The second line works as a subtitle. Make it a second-level heading and the opening reads as a title, then a promise.', { from: '# For research in fields where being second means losing', to: '## For research in fields where being second means losing' }],
    ['visceral', '“Tangible” keeps the sense of contact without the bodily undertone.', { from: 'takes on a visceral form', to: 'takes on a tangible form' }],
    ['carries the section', 'Agreed: opening with it frames the section around meaning before dispersion. Move it up as the section’s first sentence.', null]
  ];
  const agentFor = (s) => { const hit = AGENT.find(([k]) => s.includes(k)); return hit ? { text: hit[1], edit: hit[2] } : { text: 'This reads clearly. If you want it tighter, the clause after the colon can carry the sentence on its own.' }; };
  const findComment = (id) => COMMENTS.find((c) => c.id === id);
  function refresh(sel, html) { const el = $(sel, paneEl); if (el) { el.outerHTML = html; const fresh = $(sel, paneEl); hydrateIcons(fresh); window.poisePaintTerms?.(fresh); } }
  function ask(c, about = '') {
    const r = { id: nid('a'), who: 'agent', at: clock(), text: '' };
    c.replies.push(r);
    LIVES[r.id] = ['Accepted', clock(), true];
    persist();
    if (tab === 'comments') refresh(`[data-comment="${c.id}"]`, commentHTML(c));
    setTimeout(() => life(r.id, 'Executing', 'reading the passage', true), 500);
    setTimeout(() => {
      const a = agentFor(`${about} ${c.quote || ''} ${c.text || ''}`);
      Object.assign(r, { text: a.text, at: clock() }, a.edit ? { edit: a.edit } : {}, c.review ? { suggest: 'Thanks for flagging this. I will tighten this passage in the next revision.', review: c.review } : {});
      LIVES[r.id] = ['Completed', clock(), true];
      persist();
      if (tab === 'comments') refresh(`[data-reply="${r.id}"]`, replyHTML(r));
    }, 2200);
  }
  function newComment(quote, question, about) {
    const c = { id: nid('c'), quote, text: question || '', at: clock(), replies: [], editing: !question, draft: '', ...(about ? { review: about } : {}) };
    COMMENTS.push(c);
    persist();
    getSelection().removeAllRanges();
    hideSel();
    openTab('comments');
    $(`[data-comment="${c.id}"]`, paneEl)?.scrollIntoView({ block: 'nearest' });
    if (question) ask(c, question); else $(`[data-cdraft="${c.id}"]`, paneEl)?.focus();
    return c;
  }
  function applyEdit(c, r, redraw = () => refresh(`[data-reply="${r.id}"]`, replyHTML(r))) {
    const key = `${r.id}-apply`;
    life(key, 'Accepted', clock(), true);
    setTimeout(() => {
      const line = lines().find((l) => l.textContent.includes(r.edit.from));
      if (!line) { r.failed = true; delete LIVES[key]; redraw(); return; }
      record();
      line.textContent = line.textContent.replace(r.edit.from, r.edit.to);
      line.dataset.src = '';
      sync();
      record();
      changed(false);
      r.applied = true;
      if (c && c.quote === r.edit.from) c.quote = r.edit.to;
      LIVES[key] = ['Completed', 'applied · Undo takes it back', true];
      persist();
      redraw();
      drawMarks();
      flash(r.edit.to, 'ed-hi is-suggest', 2200);
    }, 350);
  }
  // Passages light up while you rest on their comment.
  let lit = null;
  paneEl.addEventListener('pointerover', (e) => {
    const card = e.target.closest('[data-comment], [data-review]');
    const it = card && (findComment(card.dataset.comment) || REVIEWS.find((v) => v.id === card.dataset.review));
    if (it === lit) return;
    $$('.is-lit', marksEl).forEach((d) => d.remove());
    lit = it;
    if (it?.quote) { const r = rangeFor(it.quote); if (r) marksEl.insertAdjacentHTML('beforeend', rectsHTML(r, 'ed-hi is-lit')); }
  });
  paneEl.addEventListener('pointerleave', () => { $$('.is-lit', marksEl).forEach((d) => d.remove()); lit = null; inPane = false; flushHeld(); });
  paneEl.addEventListener('pointerenter', () => { inPane = true; });

  // ---------- Publishing: per site, with each pull request's state ----------
  function publish() {
    const chosen = SITES.filter((s) => s.chosen);
    if (!chosen.length || publishing) return;
    if (SAVE.state === 'failed' || SAVE.state === 'conflict') { toast('The document could not be saved, so it was not published.', 'failed'); return; }
    publishing = true;
    renderPane();
    chosen.forEach((s, i) => {
      const key = `site-${s.key}`, was = s.pub;
      setTimeout(() => life(key, 'Accepted', clock(), true), i * 300);
      setTimeout(() => life(key, 'Executing', was ? `updating #${was.pr}` : 'opening a pull request', true), i * 300 + 600);
      setTimeout(() => {
        s.pub = { pr: was ? was.pr : nextPr++, state: 'waiting', detail: 'checks running' };
        LIVES[key] = ['Completed', `#${s.pub.pr} ${was ? 'updated' : 'opened'}`, true];
        if (i === chosen.length - 1) {
          publishing = false;
          renderPane();
          renderStatus();
          toast(`Published to ${chosen.map((x) => x.name).join(' and ')}. Checks are running; the pull request${chosen.length > 1 ? 's are' : ' is'} on <a href="board.html">Board</a>.`, 'waiting');
        }
      }, i * 300 + 2000);
    });
  }
  function google(act) {
    if (act !== 'g-keep' && act !== 'g-refresh' && (SAVE.state === 'failed' || SAVE.state === 'conflict')) { toast(act === 'g-review' ? 'Save the Poise draft before reviewing Google changes.' : 'Save the document before publishing.', 'failed'); return; }
    if (act === 'g-refresh') { toast('Refreshed from Google.'); return; }
    if (act === 'g-first') {
      life('google', 'Accepted', clock(), true);
      setTimeout(() => life('google', 'Executing', 'publishing to Google', true), 500);
      setTimeout(() => { gFirst = ''; GOOGLE.state = 'match'; LIVES.google = ['Completed', `published ${clock()}`, true]; renderPane(); toast('Published. The same Google document will receive future updates.', 'done'); }, 1800);
      return;
    }
    if (act === 'g-review') {
      const first = lines().map((l) => l.textContent).find((t) => t.startsWith('Helios is a new kind')) || '';
      Object.assign(GOOGLE, { reviewing: true, mine: first, theirs: first.replace('frontier intelligence', 'frontier AI') });
      renderPane();
    } else if (act === 'g-keep') { GOOGLE.reviewing = false; renderPane(); }
    else if (act === 'g-import') {
      const line = lines().find((l) => l.textContent === GOOGLE.mine);
      if (line) { record(); line.textContent = GOOGLE.theirs; line.dataset.src = ''; sync(); record(); changed(false); flash(GOOGLE.theirs, 'ed-hi is-suggest', 2200); }
      Object.assign(GOOGLE, { state: 'match', reviewing: false });
      renderPane();
      toast('Imported Google’s version of the opening paragraph. Undo takes it back; your sites change only when you publish.');
    } else if (act === 'g-publish') {
      GOOGLE.reviewing = false;
      renderPane();
      life('google', 'Accepted', clock(), true);
      setTimeout(() => life('google', 'Executing', 'publishing to Google', true), 500);
      setTimeout(() => { GOOGLE.state = 'match'; LIVES.google = ['Completed', `published ${clock()}`, true]; renderPane(); }, 1800);
    }
  }
  // Replies read the document as it is now: its sections, its claims, your selection.
  function sections() {
    const secs = [];
    let cur = null;
    lines().forEach((l) => {
      const t = l.textContent, k = kindOf(t);
      if (k.kind === 'h1' || k.kind === 'h2') { cur = { title: t.slice(k.len).replace(/\*\*/g, ''), words: 0 }; secs.push(cur); return; }
      if (cur) cur.words += t.slice(k.len).replace(/\*\*/g, '').split(/\s+/).filter(Boolean).length;
    });
    return secs.filter((x) => x.words > 0);
  }
  function chatReply(q, about) {
    const t = `${q} ${about}`.toLowerCase(), has = (s) => docText().includes(s);
    if (/tamper|proof|claim|source|evidence|guarantee/.test(t)) {
      return has('tamper-proof')
        ? { read: about ? 'your selection' : 'the whole document', text: 'One claim asks for trust it cannot earn: “tamper-proof”. Software can show tampering; it cannot rule it out. Everything else describes what the instrument does rather than what it guarantees.', edit: { from: 'secure, tamper-proof, encrypted', to: 'secure, tamper-evident, encrypted' } }
        : { read: 'the whole document', text: 'Nothing here asks for more trust than it earns now: the claims describe what the instrument does, not what it guarantees.' };
    }
    if (/visceral/.test(t) && has('takes on a visceral form')) return { read: 'your selection', text: '“Visceral” is bodily; researchers may hear it as hype. “Tangible” keeps the sense of contact.', edit: { from: 'takes on a visceral form', to: 'takes on a tangible form' } };
    if (/opening|tight|intro|subtitle|title/.test(t) && has('# For research in fields')) {
      return { read: 'the opening', text: /subtitle|title/.test(t) ? 'Your second line already works as a subtitle: it says who Helios is for. Make it a second-level heading so the title stands alone.' : 'The opening makes its promise twice: in the second heading and again in the first paragraph. Keep the heading as a subtitle and let the paragraph begin with what Helios is.', edit: { from: '# For research in fields where being second means losing', to: '## For research in fields where being second means losing' } };
    }
    if (/summar|three lines|short|tl;?dr/.test(t)) return { read: 'the whole document', text: 'Helios is a research instrument that keeps questions, evidence and uncertainty connected in one world model. It works through the tools researchers already use: a portal, a plugin for ChatGPT and Claude, and continuous literature review. Nothing in it is a final answer; the question stays at the centre.' };
    if (about) {
      const w = about.split(/\s+/).filter(Boolean).length;
      return { read: 'your selection', text: `“${short(about, 60)}” is ${w} words and reads clearly. ${w > 24 ? 'It carries two ideas; ending the sentence after the first would let each land.' : 'Standing as its own sentence would give it more weight.'}` };
    }
    const secs = sections(), total = secs.reduce((n, x) => n + x.words, 0), big = [...secs].sort((a, b) => b.words - a.words)[0];
    return { read: 'the whole document', text: big ? `The draft has ${secs.length} sections with text. “${big.title}” carries the most: ${big.words} of ${total} words. Ask about any part, or select a passage and I will read just that.` : 'There is nothing to read yet. Write a few lines, or ask me to help you start.' };
  }
  function sendChat(text = chatDraft.trim()) {
    if (!text || pending) return;
    const about = lastSel;
    const m = { id: nid('m'), who: 'you', text, at: clock(), about };
    const a = { id: nid('m'), who: 'agent', agent: agent.split(' · ')[0], at: clock(), typing: true };
    const list = chatOf();
    list.push(m, a);
    LIVES[m.id] = ['Accepted', clock(), true];
    chatDraft = '';
    pending = { m, a, list, timers: [] };
    renderPane();
    renderTabs();
    $('[data-chat-in]', paneEl)?.focus();
    scrollThread();
    pending.timers.push(setTimeout(() => life(m.id, 'Executing', about ? 'reading your selection' : 'reading the document', true), 500));
    pending.timers.push(setTimeout(() => {
      const r = chatReply(text, about);
      Object.assign(a, { typing: false, text: r.text, read: r.read, at: clock() }, r.edit ? { edit: r.edit } : {});
      LIVES[m.id] = ['Completed', clock(), true];
      pending = null;
      persist();
      renderTabs();
      // Only the chat itself redraws: a draft in another tab is never touched.
      if (tab !== 'chat') return;
      const typing = document.activeElement?.matches('[data-chat-in]');
      renderPane();
      scrollThread();
      if (typing) { const input = $('[data-chat-in]', paneEl); input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }, 2300));
  }
  function stopChat() {
    if (!pending) return;
    pending.timers.forEach(clearTimeout);
    pending.list.splice(pending.list.indexOf(pending.a), 1);
    LIVES[pending.m.id] = ['Completed', 'stopped by you', true];
    pending = null;
    persist();
    renderPane();
    renderTabs();
  }

  // ---------- Documents: menu, open, new, copy, delete ----------
  const docMenu = $('[data-docmenu]');
  function renderDocMenu() {
    docMenu.innerHTML = '<button class="menu-row new-row" role="menuitem" data-act="new" data-ref="ed.new"><i data-i="plus" class="sm"></i><span class="t">New document</span><span class="kbd">⌘N</span></button>'
      + ['Today', 'Yesterday', 'This week', 'This month', 'Earlier'].map((b) => { const ds = DOCS.filter((d) => d.bucket === b); return ds.length ? `<span class="t-micro bucket">${b}</span>${ds.map((d) => `<button class="menu-row" role="menuitem" data-open="${d.id}"${d.id === current ? ' aria-current="true"' : ''} data-ref="ed.docrow"><span class="t">${esc(d.title)}</span><time>${d.ago}</time></button>`).join('')}` : ''; }).join('');
    hydrateIcons(docMenu);
  }
  $('.doc-pick').addEventListener('pointerdown', renderDocMenu);
  $('.doc-pick').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') renderDocMenu(); });
  function open(id) {
    const d = byDoc(id);
    if (!d) return;
    if (shown) saveNow();
    closeMenus();
    hideSel();
    closePop();
    current = id;
    $('[data-doc-title]').textContent = d.title;
    const away = $('[data-away]');
    away.hidden = d.full;
    docEl.hidden = !d.full;
    if (d.full) { load(TEXT[id] || ''); shown = id; hist(); } else { shown = null; $('[data-away-title]').textContent = d.title; }
    scrollEl.scrollTop = 0;
    renderStatus();
    renderTabs();
    renderPane();
    drawMarks();
  }
  function newDoc() {
    const d = { id: nid('d'), title: 'Untitled', ago: 'now', bucket: 'Today', full: true, created: true };
    DOCS.unshift(d);
    TEXT[d.id] = '';
    persist();
    open(d.id);
    docEl.focus();
    setCaret(lines()[0], 0);
    toast('New document. It is saved as soon as you type.');
  }
  // Import: a Markdown or text file becomes a new document, word for word.
  // Only line endings change. Up to 5 MiB, and it must read as UTF-8.
  const IMPORT_MAX = 5 * 1024 * 1024, UNDO_MAX = 1024 * 1024;
  let undoNoted = false;
  async function importFile(input) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > IMPORT_MAX) { toast(`Not imported: ${file.name} is ${(file.size / 1048576).toFixed(1)} MiB. Choose a file smaller than 5 MiB.`, 'failed'); return; }
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
    catch { toast(`Not imported: ${file.name} could not be read as text. Choose a UTF-8 text file.`, 'failed'); return; }
    text = text.replace(/\r\n?/g, '\n');
    const title = (text.match(/^#\s+(.+)$/m)?.[1] || file.name.replace(/\.(md|markdown|txt)$/i, '')).slice(0, 80);
    const d = { id: nid('d'), title, ago: 'now', bucket: 'Today', full: true, created: true };
    DOCS.unshift(d);
    TEXT[d.id] = text;
    persist();
    open(d.id);
    toast(`Imported ${file.name} as a new document: ${text.split('\n').length.toLocaleString('en-US')} lines, saved as it opened.${new Blob([text]).size > UNDO_MAX ? ' Undo keeps the last 1 MiB of changes in this document.' : ''}`, 'done');
    if (new Blob([text]).size > UNDO_MAX && !undoNoted) undoNoted = true;
  }
  $('[data-import-file]')?.addEventListener('change', (e) => importFile(e.target));

  // A thread opens on the page, under its passage; the pane keeps every action.
  function inlineThread(id, m) {
    $('.ed-inline', paperEl)?.remove();
    const c = COMMENTS.find((x) => x.id === id), v = REVIEWS.find((x) => x.id === id), t = c || v;
    if (!t) return;
    const base = paperEl.getBoundingClientRect(), r = m.getBoundingClientRect();
    const msgs = [{ who: c ? 'You' : v.who, at: t.at, text: t.text }, ...t.replies.map((x) => ({ who: x.who === 'agent' ? 'Agent' : x.who === 'you' ? 'You' : x.who, at: x.at || '', text: x.text }))];
    paperEl.insertAdjacentHTML('beforeend', `<aside class="ed-inline" role="dialog" aria-label="${c ? 'Comment' : 'Review'} on this passage" data-inline="${id}" data-ref="ed.inline" style="top:${Math.round(r.bottom - base.top + 6)}px"><div class="ed-inline-h"><span class="t-micro">${c ? 'Comment' : `Review · ${esc(v.site)}`}</span><button class="ib" data-act="inline-close" aria-label="Close"><i data-i="cross" class="sm"></i></button></div>${msgs.map((x) => `<p><b>${esc(x.who)}</b>${x.at ? ` <time>${esc(x.at)}</time>` : ''}<br>${esc(x.text)}</p>`).join('')}<div class="acts"><button class="btn-ghost" data-act="inline-pane" data-id="${id}">${c ? 'Reply or ask an agent' : 'Reply or resolve'}</button></div></aside>`);
    hydrateIcons($('.ed-inline', paperEl));
    $('.ed-inline [data-act="inline-close"]', paperEl)?.focus({ preventScroll: true });
  }
  paperEl.addEventListener('click', (e) => {
    const b = e.target.closest('.ed-inline [data-act]');
    if (!b) return;
    const box = b.closest('.ed-inline');
    if (b.dataset.act === 'inline-close') { box.remove(); docEl.focus({ preventScroll: true }); }
    if (b.dataset.act === 'inline-pane') {
      const id = b.dataset.id, isReview = REVIEWS.some((v) => v.id === id);
      box.remove();
      openTab(isReview ? 'reviews' : 'comments');
      const card = $(isReview ? `[data-review="${id}"]` : `[data-comment="${id}"]`, paneEl);
      card?.scrollIntoView({ block: 'nearest' });
      card?.classList.add('is-hi');
      setTimeout(() => card?.classList.remove('is-hi'), 1600);
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('.ed-inline', paperEl)?.contains(document.activeElement)) { $('.ed-inline', paperEl).remove(); docEl.focus({ preventScroll: true }); } });

  function del(btn) {
    if (!btn.classList.contains('is-armed')) {
      btn.classList.add('is-armed');
      btn.lastChild.textContent = 'Sure?';
      setTimeout(() => { if (btn.classList.contains('is-armed')) { btn.classList.remove('is-armed'); btn.lastChild.textContent = 'Delete'; } }, 3000);
      return;
    }
    btn.classList.remove('is-armed');
    btn.lastChild.textContent = 'Delete';
    const d = byDoc(current);
    DOCS.splice(DOCS.indexOf(d), 1);
    if (d.created) delete TEXT[d.id];
    persist();
    const next = DOCS.find((x) => x.full) || DOCS[0];
    if (next) open(next.id);
    toast(`Deleted “${d.title}”. Published versions and issues created from it are unchanged.`);
  }
  function writer(on) {
    document.body.classList.toggle('is-writer', on);
    $$('.ed-head [data-act="writer"]').forEach((b) => b.setAttribute('aria-pressed', String(on)));
    store.set('poise-editor-writer', on);
    setTimeout(drawMarks, 60);
    if (on && !docEl.hidden) docEl.focus({ preventScroll: true });
  }
  function go(url) {
    try { sessionStorage.setItem('poise-editor-back', JSON.stringify({ doc: current, scroll: scrollEl.scrollTop })); } catch { /* the route back still works, from the top */ }
    location.href = url;
  }
  function bold() {
    const s = getSelection();
    if (!s.rangeCount) return;
    const line = lineOf(s.anchorNode);
    if (!line || line !== lineOf(s.focusNode)) return;
    let a = offsetIn(line, s.anchorNode, s.anchorOffset), b = offsetIn(line, s.focusNode, s.focusOffset);
    if (a > b) [a, b] = [b, a];
    const t = line.textContent;
    let next, from, to;
    if (t.slice(a - 2, a) === '**' && t.slice(b, b + 2) === '**') { next = t.slice(0, a - 2) + t.slice(a, b) + t.slice(b + 2); from = a - 2; to = b - 2; }
    else { next = `${t.slice(0, a)}**${t.slice(a, b)}**${t.slice(b)}`; from = a + 2; to = b + 2; }
    record();
    line.textContent = next;
    line.dataset.src = '';
    sync();
    const [n1, o1] = locate(line, from), [n2, o2] = locate(line, to), r = document.createRange();
    r.setStart(n1, o1);
    r.setEnd(n2, o2);
    s.removeAllRanges();
    s.addRange(r);
    changed();
  }
  function paste(text) {
    const s = getSelection();
    if (!s.rangeCount) return;
    if (!s.isCollapsed) s.deleteFromDocument();
    const line = lineOf(s.anchorNode);
    if (!line) return;
    const off = offsetIn(line, s.anchorNode, s.anchorOffset), t = line.textContent, parts = text.replace(/\r/g, '').split('\n');
    const head = t.slice(0, off), tail = t.slice(off);
    record();
    line.textContent = head + parts[0] + (parts.length === 1 ? tail : '');
    line.dataset.src = '';
    let last = line;
    parts.slice(1).forEach((p, i, rest) => { const d = document.createElement('div'); d.className = 'ln'; d.textContent = p + (i === rest.length - 1 ? tail : ''); last.after(d); last = d; });
    sync();
    setCaret(last, parts.length === 1 ? head.length + parts[0].length : parts[parts.length - 1].length);
    changed();
  }

  // ---------- Events ----------
  docEl.addEventListener('input', () => { sync(); changed(); });
  docEl.addEventListener('beforeinput', (e) => { if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') { e.preventDefault(); travel(e.inputType === 'historyUndo' ? -1 : 1); } });
  docEl.addEventListener('paste', (e) => { e.preventDefault(); paste(e.clipboardData.getData('text/plain')); });
  docEl.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    if (mod && k === 'b' && !e.shiftKey) { e.preventDefault(); bold(); }
    else if (mod && k === 'z') { e.preventDefault(); travel(e.shiftKey ? 1 : -1); }
    else if (mod && k === 'y') { e.preventDefault(); travel(1); }
  });
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    if (mod && k === 's') { e.preventDefault(); if (byDoc(current)?.full) saveNow(); return; }
    if (mod && k === 'n' && !e.shiftKey) { e.preventDefault(); newDoc(); return; }
    if (e.key === 'Escape') {
      if (!pop.hidden) { closePop(); return; }
      if (!selbar.hidden) { hideSel(); return; }
      if (document.body.classList.contains('is-writer') && !$('.ref-layer') && !$('.menu:not([hidden])')) writer(false);
    }
    const chatIn = e.target.closest?.('[data-chat-in]');
    if (chatIn && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatDraft = chatIn.value; sendChat(); }
    const cd = e.target.closest?.('[data-cdraft]');
    if (cd && e.key === 'Enter' && mod) { e.preventDefault(); $(`[data-comment="${cd.dataset.cdraft}"] [data-act="c-save"]`, paneEl)?.click(); }
  });
  paneEl.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.cdraft) findComment(t.dataset.cdraft).draft = t.value;
    if (t.dataset.rdraft) REVIEWS.find((v) => v.id === t.dataset.rdraft).draft = t.value;
    if (t.dataset.shared) SHARED[t.dataset.shared] = t.value;
    if (t.dataset.slug) SITES.find((s) => s.key === t.dataset.slug).slug = t.value;
    if (t.matches('[data-chat-in]')) chatDraft = t.value;
  });
  paneEl.addEventListener('change', (e) => {
    if (e.target.matches('[data-google-account]')) { gFirst = 'new'; renderPane(); return; }
    if (e.target.matches('[data-cb-agent]')) { agent = e.target.value; store.set('poise-editor-agent', agent); return; }
    const pick = e.target.closest('[data-site-pick]');
    if (pick) { SITES.find((s) => s.key === pick.dataset.sitePick).chosen = pick.checked; renderPane(); }
  });
  marksEl.addEventListener('click', (e) => {
    const m = e.target.closest('[data-mark]');
    if (!m) return;
    inlineThread(m.dataset.mark, m);
  });

  document.addEventListener('click', (e) => {
    const openDoc = e.target.closest('[data-open]');
    if (openDoc) { open(openDoc.dataset.open); return; }
    const b = e.target.closest('[data-act]');
    if (!b || b.matches('[aria-disabled="true"]')) return;
    const comment = findComment(b.closest('[data-comment]')?.dataset.comment);
    const review = REVIEWS.find((v) => v.id === b.closest('[data-review]')?.dataset.review);
    const reply = (comment || review)?.replies.find((r) => r.id === b.closest('[data-reply]')?.dataset.reply);
    const msg = chatOf().find((m) => m.id === b.closest('[data-msg]')?.dataset.msg);
    switch (b.dataset.act) {
      case 'new': closeMenus(); newDoc(); break;
      case 'import': closeMenus(); $('[data-import-file]')?.click(); break;
      case 'copy': navigator.clipboard?.writeText(docText()).catch(() => {}); toast(`Copied ${words().toLocaleString('en-US')} words as Markdown.`); break;
      case 'delete': del(b); break;
      case 'writer': writer(!document.body.classList.contains('is-writer')); break;
      case 'tab': openTab(b.dataset.tab, b.getAttribute('role') !== 'tab'); break;
      case 'close-pane': closePane(); break;
      case 'open-chat': go(`chat.html?draft=${encodeURIComponent(`About “${byDoc(current)?.title || 'this document'}”: `)}&back=editor`); break;
      case 'back': open(DOCS.find((d) => d.full)?.id); break;
      case 'sel-comment': newComment(selQuote); break;
      case 'sel-ask': newComment(selQuote, 'What would make this passage stronger?'); break;
      case 'sel-issue': openPop(issuePop(selQuote)); break;
      case 'sel-snippet': openPop(snippetPop(selQuote)); break;
      case 'pop-cancel': closePop(); break;
      case 'pop-issue': {
        const title = $('[data-p="title"]', pop).value.trim(), repo = $('[data-p="repo"]', pop).value, err = $('[data-p="err"]', pop), lifeEl = $('[data-p="life"]', pop);
        if (!title) { err.hidden = false; err.textContent = 'Add a title: it is required.'; $('[data-p="title"]', pop).focus(); break; }
        err.hidden = true;
        $$('button', pop).forEach((x) => x.setAttribute('aria-disabled', 'true'));
        lifeEl.hidden = false;
        lifeTo(lifeEl, 'Accepted', clock(), true);
        const num = nextIssue++;
        setTimeout(() => lifeTo(lifeEl, 'Executing', 'opening on GitHub', true), 500);
        setTimeout(() => { lifeTo(lifeEl, 'Completed', `opened #${num}`, true); setTimeout(() => { closePop(); toast(`Opened #${num} in ${repo}. It is on <a href="board.html">Board</a>.`, 'done'); }, 1100); }, 1700);
        break;
      }
      case 'pop-snippet': {
        const name = $('[data-p="name"]', pop).value.trim() || 'Snippet', text = $('[data-p="text"]', pop).value.trim(), lifeEl = $('[data-p="life"]', pop);
        $$('button', pop).forEach((x) => x.setAttribute('aria-disabled', 'true'));
        lifeEl.hidden = false;
        lifeTo(lifeEl, 'Completed', `saved ${clock()}`, true);
        // Settings → Snippets picks it up, marked as from Editor.
        store.set('poise-snippets-v1', [...store.get('poise-snippets-v1', []), { id: nid('snip'), name, text }]);
        setTimeout(() => { closePop(); toast(`Saved the snippet “${esc(name)}”. <a class="lnk" href="settings.html?back=editor#snippets">Open it in Settings → Snippets</a>`); }, 900);
        break;
      }
      case 'passage': showPassage((comment || review)?.quote); break;
      case 'c-save': {
        const text = (comment.draft || '').trim();
        if (!text) { COMMENTS.splice(COMMENTS.indexOf(comment), 1); } else Object.assign(comment, { text, editing: false, at: clock() });
        persist(); renderPane(); renderTabs(); renderStatus(); drawMarks();
        break;
      }
      case 'c-cancel': if (!comment.text) COMMENTS.splice(COMMENTS.indexOf(comment), 1); else comment.editing = false; persist(); renderPane(); renderTabs(); renderStatus(); drawMarks(); break;
      case 'c-ask': ask(comment, comment.text); break;
      case 'c-del':
        if (!b.classList.contains('is-armed')) { b.classList.add('is-armed'); b.lastChild.textContent = 'Sure?'; setTimeout(() => { if (b.isConnected && b.classList.contains('is-armed')) { b.classList.remove('is-armed'); b.lastChild.textContent = 'Delete'; } }, 3000); break; }
        COMMENTS.splice(COMMENTS.indexOf(comment), 1); persist(); renderPane(); renderTabs(); renderStatus(); drawMarks(); toast('Deleted the comment. The text is unchanged.');
        break;
      case 'sg-show': { const it = msg || reply; showPassage(it.edit.from); flash(it.edit.from, 'ed-hi is-suggest'); break; }
      case 'sg-apply': if (msg) applyEdit(null, msg, () => refresh(`[data-msg="${msg.id}"]`, msgHTML(msg))); else applyEdit(comment, reply); break;
      case 'r-reply': review.replying = true; refresh(`[data-review="${review.id}"]`, reviewHTML(review)); $(`[data-rdraft="${review.id}"]`, paneEl)?.focus(); break;
      case 'r-cancel': review.replying = false; refresh(`[data-review="${review.id}"]`, reviewHTML(review)); break;
      case 'r-post': {
        const text = (review.draft || '').trim();
        if (!text) break;
        const p = { id: nid('p'), who: 'you', text, at: clock() };
        Object.assign(review, { replying: false, draft: '' });
        review.replies.push(p);
        LIVES[p.id] = ['Accepted', clock(), true];
        refresh(`[data-review="${review.id}"]`, reviewHTML(review));
        setTimeout(() => life(p.id, 'Executing', 'posting on GitHub', true), 500);
        setTimeout(() => life(p.id, 'Completed', 'posted on GitHub', true), 1500);
        break;
      }
      case 'r-resolve': review.state = 'done'; review.isNew = false; renderPane(); renderTabs(); renderStatus(); drawMarks(); toast('Resolved on GitHub. The document is unchanged.', 'done'); break;
      case 'r-ask': newComment(review.quote, review.text, review.pr ? review.id : null); break;
      case 'use-reply': {
        const r = COMMENTS.flatMap((c) => c.replies).find((x) => x.id === b.dataset.id), v = REVIEWS.find((x) => x.id === r?.review);
        if (!v) break;
        Object.assign(v, { replying: true, draft: r.suggest });
        openTab('reviews');
        $(`[data-rdraft="${v.id}"]`, paneEl)?.focus();
        break;
      }
      case 'r-refresh': b.setAttribute('aria-disabled', 'true'); b.lastChild.textContent = 'Checking…'; setTimeout(() => { checkedAt = clock(); renderPane(); }, 900); break;
      case 'publish': publish(); break;
      case 'g-review': case 'g-keep': case 'g-import': case 'g-publish': case 'g-first': case 'g-refresh': google(b.dataset.act); break;
      case 'chat-send': chatDraft = $('[data-chat-in]', paneEl)?.value || chatDraft; sendChat(); break;
      case 'cb-start': sendChat(b.textContent.trim()); break;
      case 'cb-stop': stopChat(); break;
      case 'cb-drop-sel': lastSel = ''; renderReads(); break;
      default: break;
    }
  });

  // ---------- The same evening: a review arrives, Google changes, checks pass ----------
  function flushHeld() {
    if (!REVIEWS.some((v) => v.held) || inPane || tab !== 'reviews') return;
    REVIEWS.forEach((v) => { if (v.held) { v.held = false; v.isNew = true; } });
    renderPane(); renderTabs(); renderStatus(); drawMarks();
  }
  setTimeout(() => {
    REVIEWS.push({ id: 'r4', site: 'example.com', pr: 14, who: 'Copilot', quote: 'Meaning and relationships within knowledge extend beyond words and definitions.', text: 'This sentence carries the section. Consider opening the section with it.', state: 'needs-you', at: clock(), replies: [], held: true });
    flushHeld();
    renderTabs(); renderStatus(); drawMarks();
  }, +(params.get('t1') || 9000));
  setTimeout(() => { GOOGLE.state = 'remote'; if (tab === 'publish' && !inPane) renderPane(); }, +(params.get('t2') || 13000));
  setTimeout(() => {
    const s = SITES[0];
    s.pub = { ...s.pub, state: 'needs-you', detail: 'ready to merge' };
    renderStatus();
    if (tab === 'publish') refresh(`[data-site="${s.key}"]`, publishHTML().match(new RegExp(`<label class="site" data-site="${s.key}"[\\s\\S]*?</label>`))[0]);
  }, +(params.get('t3') || 18000));

  // ---------- Start ----------
  if (!byDoc(current)) current = DOCS[0]?.id;
  open(current);
  renderDocMenu();
  if (store.get('poise-editor-writer', false)) writer(true);
  document.fonts?.ready.then(drawMarks);
  addEventListener('resize', drawMarks);
  new ResizeObserver(() => drawMarks()).observe(paperEl);
  try {
    const back = JSON.parse(sessionStorage.getItem('poise-editor-back') || 'null');
    if (back) { sessionStorage.removeItem('poise-editor-back'); if (byDoc(back.doc)) open(back.doc); scrollEl.scrollTop = back.scroll || 0; }
  } catch { /* no session storage: start at the top */ }
  if (['comments', 'reviews', 'publish', 'chat'].includes(params.get('tab'))) openTab(params.get('tab'));
  const FROM = { overview: ['overview.html', 'Overview'], board: ['board.html', 'Board'], chat: ['chat.html', 'Chat'], manager: ['manager.html', 'the Manager'], observe: ['observe.html', 'Observe'], settings: ['settings.html#publishing', 'Settings'] }[params.get('back')];
  if (FROM) { const b = $('[data-back]'); b.hidden = false; b.href = FROM[0]; b.innerHTML = `<i data-i="chev" class="sm"></i>Back to ${FROM[1]}`; hydrateIcons(b); }
  if (params.get('ref') === 'ed.inline') { const m = $('[data-mark]', paperEl); if (m) inlineThread(m.dataset.mark, m); }
  // The selection's actions show on a selection: the review selects a few words.
  if (/^ed\.sel/.test(params.get('ref') || '')) {
    const prose = (n) => n.textContent.trim().length > 40 && !n.parentElement.closest('.ln')?.textContent.trim().startsWith('#');
    const t = document.createTreeWalker(docEl, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (prose(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) }).nextNode();
    if (t) { const r = document.createRange(), i = t.textContent.search(/\S/), j = t.textContent.indexOf(' ', i + 24); r.setStart(t, i); r.setEnd(t, j > 0 ? j : t.textContent.length); getSelection().removeAllRanges(); getSelection().addRange(r); }
  }
  if (params.get('ref')) setTimeout(() => window.poiseOpenRef?.($(`[data-ref="${params.get('ref')}"]`)), 700);
  if (params.get('tip')) setTimeout(() => window.poiseShowTip?.($(`[data-ref="${params.get('tip')}"]`)), 700);
})();
