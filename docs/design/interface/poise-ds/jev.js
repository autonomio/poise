// JEV · primitives, in Chat's place: state in, typed answers out. It is not a conversation:
// no CLI, no checkout, no permissions, no chat history. Words and limits are main's (docs/Jev-primitives.md).
// ?jev=1 opens it; ?jev=running, stopped, failed, interrupted, pending, conflict, unsaved or unset shows a state.
(() => {
  const P = window.PoiseChat;
  if (!P || P.VIEW !== 'chat') return;
  const { $, $$, params, esc, toast, clock, mark, setState, byId, CHATS, render } = P;
  const { nowAt } = window.PoiseShell;
  const convo = $('.convo');
  const NAMES = { noul: ['Yes / no', 'Noul'], choice: ['Choose one', 'Choice'], score: ['Rate a scale', 'Score'] };
  const KEY_SET = params.get('jev') !== 'unset';

  const question = (type, id = 'question_1') => ({ id, type, instructions: '', yes: '', no: '', options: [{ name: '', description: '' }, { name: '', description: '' }], levels: ['', ''], open: true });
  const blank = () => ({ model: 'jev-latest', state: '', format: 'text', questions: [question('noul')], raw: null });
  const example = () => ({
    model: 'jev-latest', format: 'text', raw: null,
    state: 'My account was charged twice for the same order. Please refund the duplicate charge today; rent is due tomorrow.',
    questions: [
      { ...question('choice', 'request_type'), instructions: 'What is the customer asking for?', options: [{ name: 'refund', description: 'Money returned' }, { name: 'delivery', description: 'An update about shipping' }, { name: 'information', description: 'Information without a transaction' }, { name: 'other', description: 'None of these' }] },
      { ...question('noul', 'urgent'), instructions: 'Does the customer describe an explicit time-sensitive need?' },
      { ...question('score', 'frustration'), instructions: 'How frustrated does the customer sound?', levels: ['Calm and neutral', 'Concerned but civil', 'Very angry or hostile'] }
    ]
  });

  // ---------- The request, as main builds and checks it ----------
  function requestOf(d) {
    if (d.raw !== null) return JSON.parse(d.raw);
    const questions = {};
    d.questions.forEach((q) => {
      const criteria = q.type === 'choice' ? Object.fromEntries(q.options.map((o) => [o.name, o.description || null]))
        : q.type === 'score' ? q.levels
          : q.yes || q.no ? { ...(q.yes ? { true: q.yes } : {}), ...(q.no ? { false: q.no } : {}) } : undefined;
      questions[q.id] = { type: q.type, instructions: q.instructions, ...(criteria ? { criteria } : {}) };
    });
    let state = d.state;
    if (d.format === 'json') { try { state = JSON.parse(d.state); } catch { /* it stays editable; invalid() names it */ } }
    return { model: d.model, state, questions };
  }
  function invalid(d) {
    if (d.raw !== null) { try { JSON.parse(d.raw); } catch (e) { return e.message; } return ''; }
    const ids = new Set();
    for (const q of d.questions) {
      if (!q.id.trim() || q.id.length > 200) return 'Each question needs a unique ID of 1–200 characters.';
      if (ids.has(q.id)) return `Question ID “${q.id}” is repeated.`;
      ids.add(q.id);
    }
    if (!/^jev-[a-zA-Z0-9][a-zA-Z0-9.-]{0,99}$/.test(d.model)) return 'Choose a Jev model or alias, such as jev-latest.';
    if (!d.state.trim()) return 'State: add the text or JSON object/array to evaluate.';
    if (d.format === 'json') { try { const v = JSON.parse(d.state); if (!v || typeof v !== 'object') throw new Error(); } catch { return 'State: add the text or JSON object/array to evaluate.'; } }
    if (!d.questions.length) return 'Add at least one question.';
    if (d.questions.length > 1024) return 'Poise supports up to 1,024 questions in one request.';
    for (const q of d.questions) {
      if (!q.instructions.trim()) return `${q.id}: write a complete question in Instructions.`;
      if (q.type === 'choice') {
        const names = q.options.map((o) => o.name.trim());
        if (names.length < 2 || names.length > 255) return `${q.id}: use 2–255 Choice options.`;
        if (names.some((n) => !n)) return `${q.id}: every option needs a name and an optional text/JSON description.`;
        if (new Set(names).size !== names.length) return `${q.id}: Choice option names must be unique.`;
      }
      if (q.type === 'score' && (q.levels.length < 2 || q.levels.length > 10 || q.levels.some((l) => !l.trim()))) return `${q.id}: Score needs 2–10 ordered, descriptive levels.`;
    }
    return '';
  }
  // Shared Memories go last in each question's instructions; State stays as it is. No chat history goes.
  function effective(d) {
    const req = requestOf(d), memories = $('[data-mem]')?.value.trim();
    if (memories) Object.values(req.questions).forEach((q) => { q.instructions = `${q.instructions}\n\n${memories}`; });
    return req;
  }

  // ---------- A scripted provider: the same question always answers the same ----------
  // The world's questions and the example answer sensibly; anything you write gets a steady made-up answer.
  const SCRIPT = {
    block_merge: 0.18, urgent: 0.96,
    likely_cause: { flaky_test: 0.74, runner_capacity: 0.19, real_regression: 0.07 },
    cost_to_flow: { 0: 0.12, 1: 0.52, 2: 0.31, 3: 0.05 },
    request_type: { refund: 0.93, information: 0.04, delivery: 0.02, other: 0.01 },
    frustration: { 0: 0.11, 1: 0.71, 2: 0.18 }
  };
  const seed = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 997, 7) / 997;
  function spread(names, id) {
    const raw = names.map((n, i) => 0.05 + seed(`${id}${n}${i}`) ** 3);
    const sum = raw.reduce((a, b) => a + b, 0);
    return Object.fromEntries(names.map((n, i) => [n, raw[i] / sum]));
  }
  const certainty = (ps) => { const v = Object.values(ps), h = -v.reduce((a, p) => a + (p > 0 ? p * Math.log(p) : 0), 0); return 1 - h / Math.log(v.length); };
  function answer(id, q) {
    const known = SCRIPT[id];
    if (q.type === 'noul') return { type: 'noul', noul: typeof known === 'number' ? known : 0.04 + 0.92 * seed(id) };
    if (q.type === 'choice') { const ps = known && Object.keys(q.criteria).every((n) => n in known) ? { ...known } : spread(Object.keys(q.criteria), id); return { type: 'choice', choice: Object.entries(ps).sort((a, b) => b[1] - a[1])[0][0], probabilities: ps, confidence: certainty(ps) }; }
    const names = q.criteria.map((_, i) => String(i)), ps = known && names.every((n) => n in known) ? { ...known } : spread(names, id);
    return { type: 'score', score: names.reduce((a, n, i) => a + i * ps[n], 0), legend: Object.fromEntries(names.map((n, i) => [n, q.criteria[i]])), probabilities: ps, confidence: certainty(ps) };
  }
  const resultOf = (request, model = 'jev-1.13.0') => ({
    model,
    answers: Object.fromEntries(Object.entries(request.questions).map(([id, q]) => [id, answer(id, q)])),
    usage: { input_tokens: 240 + JSON.stringify(request).length % 300, output_tokens: 23 * Object.keys(request.questions).length }
  });
  const WHY = {
    cancelled: 'Stopped locally. JEV may already have processed or billed this request; it was not retried.',
    interrupted: 'Poise stopped before the result was recorded. This evaluation was not replayed; it may have been billed.',
    error: 'Could not reach JEV. Check the connection and try again.'
  };

  // ---------- The world's workspace ----------
  const gate = () => ({
    model: 'jev-latest', format: 'text', raw: null,
    state: 'The Safari shard failed 3 of its last 40 runs on main, each time at the same reconnect step in chat-work-log.spec.ts, and passed on retry. The gate blocks a merge on any failed shard, so each failure held one pull request for about 12 minutes.',
    questions: [
      { ...question('noul', 'block_merge'), instructions: 'Should a shard that passes on retry still block the merge?', yes: 'The gate holds the merge until a person looks.', no: 'The retry’s pass counts, and the merge goes on.' },
      { ...question('choice', 'likely_cause'), instructions: 'What most likely causes these failures?', options: [{ name: 'flaky_test', description: 'The test depends on timing' }, { name: 'real_regression', description: 'The product is broken' }, { name: 'runner_capacity', description: 'The machine ran out of room' }] },
      { ...question('score', 'cost_to_flow'), instructions: 'How much does this cost the team’s flow?', levels: ['Nobody notices', 'A retry now and then', 'Merges wait on retries', 'Work stops'] }
    ]
  });
  const run = (id, at, status, draft, model) => { const request = requestOf(draft); return { id, at, status, request, result: status === 'completed' ? resultOf(request, model) : null, error: WHY[status] || '', secs: 1.02 }; };
  const WS = {
    jev: {
      id: 'jev', title: 'Should the gate block on flaky shards?', draft: gate(), dirty: false, saving: false, conflict: false, pending: false, unsaved: false,
      runs: [run('r2', 'Oct 20, 14:12', 'completed', gate())], older: [run('r1', 'Oct 20, 13:58', 'completed', gate(), 'jev-1.12.4')], selected: 'r2'
    }
  };
  let ws = WS.jev, view = 'build', notice = ['', false], preview = null, templates = false, runningId = null, timer = 0, nextId = 2;
  const SNIPPETS = [';customer-triage'];

  // ---------- Drawing ----------
  const el = Object.assign(document.createElement('section'), { className: 'jev' });
  el.setAttribute('aria-label', 'JEV primitive builder');
  el.dataset.ref = 'jev.place';
  el.innerHTML = `<header class="jev-h"><span class="chip is-outline">JEV · primitives</span><input class="jev-title" aria-label="Workspace title" maxlength="200" data-ref="jev.title"><button class="btn-ghost" data-act="memories" data-ref="sw.memories">Memories</button><button class="btn-ghost" data-j="back" data-ref="jev.back">Back to chat</button><button class="btn-ghost" data-j="delete" data-ref="jev.delete">Delete</button></header>
    <div class="jev-scroll" data-jev-scroll><div class="col jev-col">
      <div class="jev-intro"><h2>State in. Typed answers out.</h2><p>Build focused judgments, not a conversation. Run one question or many together.</p></div>
      <p class="jev-notice" role="status" data-jev-notice hidden></p>
      <div class="jev-acts" data-jev-conflict hidden data-ref="jev.recover"><button class="btn-ghost" data-j="reload">Reload saved</button><button class="btn-ghost" data-j="keep">Save my version</button></div>
      <section class="jev-results" data-jev-results hidden></section>
      <div data-jev-builder></div>
      <details class="jev-preview" data-jev-preview hidden open data-ref="jev.preview"><summary>Exact outbound request · includes saved Memories</summary><pre></pre><button class="btn-ghost" data-j="copy-request">Copy request JSON</button></details>
      <div class="jev-template" data-jev-template hidden data-ref="jev.snippet"></div>
    </div></div>
    <footer class="jev-f"><div class="jev-f-l"><span class="jev-status" role="status" data-ref="jev.save" data-jev-status></span><button class="btn-ghost" data-j="retry-save" data-jev-retry hidden>Retry save</button><button class="btn-ghost" data-j="check-pending" data-jev-pending hidden data-ref="jev.recover">Check pending run</button><button class="btn-ghost" data-j="resubmit" data-jev-resubmit hidden>Retry submission</button><p class="t-gloss">Shared Memories, when set, are included last in each question. No chat history.</p><p class="t-gloss" role="status" data-jev-valid></p></div><button class="btn-ghost" data-j="stop" data-jev-stop hidden data-ref="jev.stop">Stop</button><button class="btn btn-primary" data-j="evaluate" data-ref="jev.evaluate" data-jev-run>Evaluate</button></footer>`;
  convo.append(el);
  const q$ = (s) => $(s, el);
  const say = (text, error = false) => { notice = [text, error]; const n = q$('[data-jev-notice]'); n.hidden = !text; n.textContent = text; n.classList.toggle('is-failed', error); };

  const field = (label, value, attrs, area, rows) => `<label class="jev-field"><span>${label}</span>${area ? `<textarea ${attrs}${rows ? ` rows="${rows}"` : ''}>${esc(value)}</textarea>` : `<input ${attrs} value="${esc(value)}">`}</label>`;
  const shape = (q) => (q.type === 'noul' ? 'Returns a probability of yes, from 0 to 1.' : q.type === 'choice' ? 'Returns one option, with probabilities and confidence.' : `Returns a score from 0 to ${q.levels.length - 1}, with probabilities and confidence.`);
  const questionHTML = (q, i, all) => `<details class="jev-q" data-q="${i}" data-ref="jev.question"${q.open ? ' open' : ''}><summary><span class="chip is-outline">${NAMES[q.type][1]}</span><span>${esc(q.id || 'Untitled question')}</span></summary><div class="jev-q-b">
    <div class="jev-q-top">${field('Answer ID', q.id, 'data-f="id" aria-label="Answer ID" spellcheck="false"')}<label class="jev-field" data-ref="jev.primitive"><span>Primitive</span><select data-f="type" aria-label="Primitive">${Object.entries(NAMES).map(([type, [plain, name]]) => `<option value="${type}"${q.type === type ? ' selected' : ''}>${plain} · ${name}</option>`).join('')}</select></label><button class="btn-ghost" data-j="duplicate">Duplicate</button><button class="btn-ghost" data-j="remove"${all.length === 1 ? ' aria-disabled="true"' : ''}>Remove</button></div>
    <p class="t-gloss">${shape(q)}</p>
    ${field('Instructions', q.instructions, 'data-f="instructions" aria-label="Instructions" placeholder="Ask one clear, focused question about the state…"', true, 3)}
    ${q.type === 'noul' ? `<details class="jev-sub"><summary>Define yes and no <span class="t-gloss">optional</span></summary>${field('Yes means', q.yes, 'data-f="yes"', true, 2)}${field('No means', q.no, 'data-f="no"', true, 2)}</details>` : ''}
    ${q.type === 'choice' ? `<p class="t-micro">Options · no ranking implied</p>${q.options.map((o, n) => `<div class="jev-opt" data-option="${n}">${field('Option', o.name, 'data-f="option-name" aria-label="Option name" placeholder="e.g. refund"')}${field('Description (optional)', o.description, 'data-f="option-description" aria-label="Option description"', true, 2)}<button class="btn-ghost" data-j="remove-option"${q.options.length <= 2 ? ' aria-disabled="true"' : ''}>Remove</button></div>`).join('')}<button class="btn-ghost" data-j="add-option"${q.options.length >= 255 ? ' aria-disabled="true"' : ''}>+ Option</button><details class="jev-sub"><summary>Paste many options</summary><textarea rows="3" data-paste aria-label="Paste options" placeholder="One option per line. Optional: name | description"></textarea><button class="btn-ghost" data-j="paste-options">Replace options</button></details>` : ''}
    ${q.type === 'score' ? `<p class="t-micro">Levels · lowest to highest; scores may fall between levels</p>${q.levels.map((l, n) => `<div class="jev-opt" data-level="${n}">${field(`Level ${n}`, l, 'data-f="level" aria-label="Level description" placeholder="Describe what this level means…"', true, 2)}<button class="btn-ghost" data-j="up-level" aria-label="Move level up"${n === 0 ? ' aria-disabled="true"' : ''}>↑</button><button class="btn-ghost" data-j="remove-level"${q.levels.length <= 2 ? ' aria-disabled="true"' : ''}>Remove</button></div>`).join('')}<button class="btn-ghost" data-j="add-level"${q.levels.length >= 10 ? ' aria-disabled="true"' : ''}>+ Level</button>` : ''}
  </div></details>`;
  function paintBuilder() {
    const d = ws.draft, raw = d.raw !== null;
    const advOpen = q$('.jev-adv')?.open || /^jev\.(model|preview)$/.test(params.get('ref') || '');
    q$('[data-jev-builder]').innerHTML = `<div class="jev-bar"><div class="seg" role="group" aria-label="Builder view" data-ref="jev.views"><button data-j="build" aria-pressed="${!raw}">Build</button><button data-j="json" aria-pressed="${raw}">Request JSON</button></div><span class="spacer"></span><button class="btn-ghost" data-j="example" data-ref="jev.example">Try an example</button><button class="btn-ghost" data-j="template" data-ref="jev.snippet">Load snippet</button></div>
      <p class="jev-notice is-failed" role="alert" data-jev-error hidden></p>
      ${raw ? field('Request JSON', d.raw, 'data-f="raw" aria-label="Request JSON" spellcheck="false" class="t-mono"', true, 18) : `<div class="jev-canvas"><section class="jev-card" data-ref="jev.state"><div class="jev-sec"><h3>1. State</h3><span class="t-gloss">The material to evaluate</span><span class="spacer"></span><button class="btn-ghost" data-j="file" data-ref="jev.file">Load text file</button><input type="file" accept=".txt,.md,.json,.csv,.log" data-file hidden></div><div class="seg" role="group" aria-label="State format"><button data-j="format" data-v="text" aria-pressed="${d.format === 'text'}">Text</button><button data-j="format" data-v="json" aria-pressed="${d.format === 'json'}">JSON</button></div>${field('State', d.state, 'data-f="state" aria-label="State" placeholder="Paste the message, document or record to evaluate…" spellcheck="false"', true, 9)}</section>
        <section class="jev-qs"><div class="jev-sec"><h3>2. Questions</h3><span class="t-gloss">Each one evaluates the same state, independently.</span></div>${d.questions.map(questionHTML).join('')}<div class="jev-acts" role="group" aria-label="Add primitive" data-ref="jev.add">${Object.entries(NAMES).map(([type, [, name]]) => `<button class="btn-ghost" data-j="add" data-type="${type}">+ ${name}</button>`).join('')}</div></section></div>`}
      <details class="jev-adv jev-sub"${advOpen ? ' open' : ''}><summary>Model &amp; request details</summary>${raw ? '<p class="t-gloss">Change the model in Request JSON.</p>' : `<div data-ref="jev.model">${field('Model or alias', d.model, 'data-f="model" aria-label="JEV model" list="jev-models" placeholder="jev-latest"')}</div>`}<datalist id="jev-models"><option value="jev-latest">Latest stable</option><option value="jev-preview">Latest preview</option></datalist><p class="t-gloss">jev-latest follows stable releases. Use jev-preview or a versioned ID to choose another release. No chat history, tools, or agent permissions are sent.</p><button class="btn-ghost" data-j="preview" data-ref="jev.preview">Preview exact request</button></details>`;
    controls();
  }
  const pct = (n) => `${(n * 100).toFixed(1)}%`;
  function distribution(a) {
    const items = Object.entries(a.probabilities);
    if (a.type === 'choice') items.sort((x, y) => y[1] - x[1]);
    return `<details class="jev-dist" open><summary>Probability distribution</summary>${items.map(([name, p]) => `<div class="jev-prob"><div><span>${esc(a.type === 'score' ? `${name} · ${a.legend[name]}` : name)}</span><b>${pct(p)}</b></div><meter min="0" max="1" value="${p}" aria-label="${esc(name)} probability"></meter></div>`).join('')}</details>`;
  }
  function resultHTML(r) {
    if (r.status !== 'completed' || !r.result) return `<div class="jev-run" role="status"><b>${r.status === 'running' ? 'Evaluating primitives…' : r.status === 'cancelled' ? 'Evaluation stopped' : r.status === 'interrupted' ? 'Evaluation interrupted' : 'Evaluation failed'}</b><p>${esc(r.error || 'Your inputs are saved. You can continue editing while JEV evaluates this snapshot.')}</p></div>`;
    const u = r.result.usage;
    return `<div class="jev-meta"><span class="chip is-outline">${esc(r.result.model)}</span><span>${r.secs.toFixed(2)} s</span><span>${u.input_tokens.toLocaleString('en-US')} input tokens · ${u.output_tokens.toLocaleString('en-US')} output tokens</span></div>
      <div class="jev-grid">${Object.entries(r.result.answers).map(([id, a]) => `<article class="jev-a" data-ref="jev.answer"><header><b>${esc(id)}</b><span class="chip is-outline">${a.type}</span></header><p class="t-gloss">${esc(r.request.questions[id]?.instructions || 'Structured question · see exact request')}</p>
        ${a.type === 'noul' ? `<div class="jev-v">${pct(a.noul)}</div><p>Probability of yes</p><meter min="0" max="1" value="${a.noul}" aria-label="Probability of yes"></meter><small>0 = no · 0.5 = uncertain · 1 = yes</small>` : a.type === 'choice' ? `<div class="jev-v">${esc(a.choice)}</div><p>Selected option · ${pct(a.probabilities[a.choice])} probability</p>${distribution(a)}` : `<div class="jev-v">${a.score.toFixed(2)} <small>/ ${Object.keys(a.legend).length - 1}</small></div><p>Position on your scale</p>${distribution(a)}`}
        ${a.type !== 'noul' ? `<div class="jev-conf">Confidence <b>${pct(a.confidence)}</b><small>Distribution certainty, not the selected option’s probability.</small></div>` : ''}</article>`).join('')}</div>`;
  }
  function paintResults() {
    const box = q$('[data-jev-results]');
    box.hidden = !ws.runs.length;
    if (!ws.runs.length) { box.innerHTML = ''; return; }
    const r = ws.runs.find((x) => x.id === ws.selected) || ws.runs[0], off = !r.result ? ' aria-disabled="true"' : '';
    box.innerHTML = `<div class="jev-sec" data-ref="jev.results"><h3>Results</h3><select class="jev-hist" data-history aria-label="Evaluation history" data-ref="jev.history">${ws.runs.map((x) => `<option value="${x.id}"${x.id === r.id ? ' selected' : ''}>${esc(x.at)} · ${Object.keys(x.request.questions).length} questions · ${x.status}</option>`).join('')}</select>${ws.older.length ? '<button class="btn-ghost" data-j="older">Earlier runs</button>' : ''}</div>
      ${resultHTML(r)}
      <div class="jev-acts"><button class="btn-ghost" data-j="copy-result" data-ref="jev.copy"${off}>Copy result JSON</button><button class="btn-ghost" data-j="edit-run" data-ref="jev.edit">Edit this run</button><button class="btn-ghost" data-j="as-state" data-ref="jev.asstate"${off}>Use answers as state</button></div>
      <details class="jev-sub" data-ref="jev.exact"><summary>Exact request &amp; response</summary><pre>${esc(JSON.stringify({ request: r.request, response: r.result }, null, 2))}</pre></details>`;
  }
  function controls() {
    const d = ws.draft, wrong = invalid(d), running = runningId && ws.runs.find((r) => r.id === runningId), go = q$('[data-jev-run]');
    const why = !KEY_SET ? 'Set JEV_API_KEY in the server .env, then restart Poise. The builder works without a key; evaluation requires it.' : wrong;
    go.textContent = running ? 'Evaluating…' : `Evaluate${d.questions.length > 1 && d.raw === null ? ` ${d.questions.length} questions` : ''}`;
    if (running || ws.pending || why) { go.setAttribute('aria-disabled', 'true'); go.dataset.why = running ? 'It is evaluating.' : ws.pending ? 'A request is not confirmed yet.' : why; } else { go.removeAttribute('aria-disabled'); delete go.dataset.why; }
    q$('[data-jev-stop]').hidden = !running;
    q$('[data-jev-valid]').textContent = why || '⌘ / Ctrl + Enter to evaluate. Enter adds a line.';
    q$('[data-jev-status]').textContent = ws.conflict ? 'The server has a newer draft. Your unsaved local version is preserved.' : ws.saving ? 'Saving builder…' : ws.unsaved ? 'Draft saved in this tab' : 'Builder saved';
    q$('[data-jev-conflict]').hidden = !ws.conflict;
    q$('[data-jev-retry]').hidden = !ws.unsaved;
    q$('[data-jev-pending]').hidden = !ws.pending;
    q$('[data-jev-resubmit]').hidden = !ws.pending;
  }
  function paintTemplates() {
    const box = q$('[data-jev-template]');
    box.hidden = !templates;
    box.innerHTML = templates ? `<label class="jev-field"><span>Snippet</span><select aria-label="Primitive template" data-tpl>${SNIPPETS.map((s) => `<option>${esc(s)}</option>`).join('') || '<option>No primitive templates saved yet</option>'}</select></label><div class="jev-acts"><button class="btn-ghost" data-j="use-template"${SNIPPETS.length ? '' : ' aria-disabled="true"'}>Load as new builder</button><button class="btn-ghost" data-j="close-template">Close</button></div>${field('Save this request as a snippet', '', 'data-tpl-name aria-label="Template name" placeholder=";my-primitive"')}<div class="jev-acts"><button class="btn-ghost" data-j="save-template">Save template</button></div><p class="t-gloss">Save request JSON as a snippet to reuse your questions. Ordinary text skills are not primitive definitions.</p>` : '';
  }
  function paint() {
    q$('.jev-title').value = ws.title;
    paintBuilder(); paintResults(); paintTemplates();
    const p = q$('[data-jev-preview]');
    p.hidden = !preview;
    if (preview) $('pre', p).textContent = JSON.stringify(preview, null, 2);
    const n = q$('[data-jev-notice]');
    n.hidden = !notice[0]; n.textContent = notice[0]; n.classList.toggle('is-failed', notice[1]);
    controls();
  }

  // ---------- Opening, and new builders ----------
  function open(id = ws.id) {
    ws = WS[id] || ws;
    convo.classList.remove('is-away', 'is-fresh');
    convo.classList.add('is-jev');
    mark(ws.id);
    paint();
  }
  function create(draft, title) {
    const id = `jev-${nextId += 1}`;
    WS[id] = { id, title, draft, dirty: false, saving: false, conflict: false, pending: false, unsaved: false, runs: [], older: [], selected: '' };
    CHATS.push({ id, title: `JEV · ${title}`, state: 'idle', who: 'JEV · Primitive builder', at: nowAt(), t: clock(), project: 'autonomio/poise' });
    render();
    preview = null; templates = false; notice = ['', false];
    open(id);
    q$('[data-f="state"]')?.focus();
  }
  P.openJev = (id) => { notice = ['', false]; preview = null; templates = false; open(id); };
  P.newJev = () => create(blank(), 'Untitled primitives');

  // ---------- Editing ----------
  function edited() {
    preview = null;
    q$('[data-jev-preview]').hidden = true;
    ws.saving = true;
    controls();
    clearTimeout(ws.timer);
    ws.timer = setTimeout(() => { ws.saving = false; controls(); }, 600);
  }
  function setField(t) {
    const f = t.dataset.f, d = ws.draft, q = d.questions[+t.closest('[data-q]')?.dataset.q];
    if (f === 'state') d.state = t.value;
    else if (f === 'model') d.model = t.value;
    else if (f === 'raw') d.raw = t.value;
    else if (f === 'id') { q.id = t.value; t.closest('.jev-q').querySelector('summary span:last-child').textContent = t.value || 'Untitled question'; }
    else if (f === 'instructions' || f === 'yes' || f === 'no') q[f] = t.value;
    else if (f === 'option-name') q.options[+t.closest('[data-option]').dataset.option].name = t.value;
    else if (f === 'option-description') q.options[+t.closest('[data-option]').dataset.option].description = t.value;
    else if (f === 'level') q.levels[+t.closest('[data-level]').dataset.level] = t.value;
    edited();
  }
  el.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('.jev-title')) { ws.title = t.value; const c = byId(ws.id); if (c) { c.title = `JEV · ${t.value}`; render(); mark(ws.id); } edited(); return; }
    if (t.dataset.f && t.dataset.f !== 'type') setField(t);
  });
  el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.f === 'type') { const q = ws.draft.questions[+t.closest('[data-q]').dataset.q]; q.type = t.value; paintBuilder(); edited(); return; }
    if (t.matches('[data-history]')) { ws.selected = t.value; paintResults(); return; }
    if (t.matches('[data-file]') && t.files[0]) {
      const file = t.files[0];
      t.value = '';
      if (file.size > 1024 * 1024) { say('Choose a text file smaller than 1 MiB.', true); return; }
      file.arrayBuffer().then((buf) => {
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { say('Choose a UTF-8 text file. Binary or undecodable files cannot be used as state.', true); return; }
        ws.draft.state = text; say(''); paintBuilder(); edited();
      });
    }
  });
  el.addEventListener('toggle', (e) => { const t = e.target; if (t.matches?.('.jev-q')) ws.draft.questions[+t.dataset.q].open = t.open; }, true);
  el.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); evaluate(); } });

  // ---------- Evaluating: one snapshot, one receipt, never sent twice by itself ----------
  function finish(id, status) {
    const r = ws.runs.find((x) => x.id === id);
    if (!r || r.status !== 'running') return;
    r.status = status;
    if (status === 'completed') r.result = resultOf(r.request); else r.error = WHY[status];
    if (runningId === id) runningId = null;
    setState(ws.id, 'idle');
    mark(ws.id);
    paintResults();
    controls();
  }
  function evaluate() {
    if (q$('[data-jev-run]').matches('[aria-disabled="true"]')) return;
    const id = `r${Date.now()}`;
    ws.runs.unshift({ id, at: clock(), status: 'running', request: effective(ws.draft), result: null, error: '', secs: 1.02 });
    ws.selected = id;
    runningId = id;
    setState(ws.id, 'running', 'evaluating');
    mark(ws.id);
    say('');
    paintResults();
    controls();
    q$('[data-jev-scroll]').scrollTop = 0;
    timer = setTimeout(() => finish(id, 'completed'), +params.get('jevms') || 1600);
  }
  function draftFromRun(r) {
    const d = blank();
    d.model = r.request.model;
    d.state = typeof r.request.state === 'string' ? r.request.state : JSON.stringify(r.request.state, null, 2);
    d.format = typeof r.request.state === 'string' ? 'text' : 'json';
    d.questions = Object.entries(r.request.questions).map(([id, q]) => ({
      ...question(q.type, id), instructions: String(q.instructions).split('\n\n')[0],
      ...(q.type === 'choice' ? { options: Object.entries(q.criteria).map(([name, description]) => ({ name, description: description || '' })) } : {}),
      ...(q.type === 'score' ? { levels: [...q.criteria] } : {}),
      ...(q.type === 'noul' && q.criteria ? { yes: q.criteria.true || '', no: q.criteria.false || '' } : {})
    }));
    return d;
  }
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-j]');
    if (!b || b.matches('[aria-disabled="true"]')) return;
    const act = b.dataset.j, d = ws.draft, qEl = b.closest('[data-q]'), q = qEl ? d.questions[+qEl.dataset.q] : null;
    const relay = () => { paintBuilder(); edited(); };
    switch (act) {
      case 'back': convo.classList.remove('is-jev'); P.back(); break;
      case 'delete': {
        if (!b.classList.contains('is-armed')) {
          b.classList.add('is-armed'); b.textContent = 'Sure?'; b.setAttribute('aria-label', `Delete “${ws.title}” and its evaluation history`);
          setTimeout(() => { if (b.isConnected) { b.classList.remove('is-armed'); b.textContent = 'Delete'; b.removeAttribute('aria-label'); } }, 3000);
          break;
        }
        b.classList.remove('is-armed'); b.textContent = 'Delete'; b.removeAttribute('aria-label');
        const gone = ws;
        CHATS.splice(CHATS.indexOf(byId(gone.id)), 1);
        delete WS[gone.id];
        convo.classList.remove('is-jev');
        P.back();
        render();
        toast(`Deleted “${gone.title}” and its evaluation history.`);
        ws = WS.jev || Object.values(WS)[0] || { id: '', title: '', draft: blank(), runs: [], older: [] };
        break;
      }
      case 'build': {
        if (d.raw === null) break;
        let parsed;
        try { parsed = JSON.parse(d.raw); ws.draft = { ...draftFromRun({ request: { model: 'jev-latest', state: '', questions: {}, ...parsed } }), raw: null }; if (!ws.draft.questions.length) ws.draft.questions = [question('noul')]; paintBuilder(); } catch (err) { const box = q$('[data-jev-error]'); box.hidden = false; box.textContent = err.message; }
        break;
      }
      case 'json': if (d.raw === null) { d.raw = JSON.stringify(requestOf(d), null, 2); paintBuilder(); } break;
      case 'example': {
        const empty = !d.state.trim() && d.questions.length === 1 && !d.questions[0].instructions.trim() && d.raw === null;
        if (empty) { ws.draft = example(); ws.title = 'Example · customer triage'; const c = byId(ws.id); if (c) { c.title = `JEV · ${ws.title}`; render(); mark(ws.id); } paint(); edited(); } else create(example(), 'Example · customer triage');
        break;
      }
      case 'template': templates = true; paintTemplates(); q$('[data-jev-template]').scrollIntoView({ block: 'nearest' }); break;
      case 'close-template': templates = false; paintTemplates(); break;
      case 'use-template': create(example(), SNIPPETS[0].replace(/^;/, '')); break;
      case 'save-template': {
        const name = q$('[data-tpl-name]').value.trim();
        if (!name) { say('Name the template first', true); break; }
        const trigger = name.startsWith(';') ? name : `;${name}`;
        if (!SNIPPETS.includes(trigger)) SNIPPETS.push(trigger);
        paintTemplates();
        say(`Saved ${trigger} in Snippets. It includes the state and questions, not Memories or results.`);
        break;
      }
      case 'file': q$('[data-file]').click(); break;
      case 'format': d.format = b.dataset.v; relay(); break;
      case 'add': { const n = d.questions.length + 1; d.questions.push(question(b.dataset.type, `question_${n}`)); relay(); break; }
      case 'duplicate': { const copy = JSON.parse(JSON.stringify(q)); copy.id = `${q.id}_copy`; d.questions.splice(+qEl.dataset.q + 1, 0, copy); relay(); break; }
      case 'remove': d.questions.splice(+qEl.dataset.q, 1); relay(); break;
      case 'add-option': q.options.push({ name: '', description: '' }); relay(); break;
      case 'remove-option': q.options.splice(+b.closest('[data-option]').dataset.option, 1); relay(); break;
      case 'paste-options': {
        const lines = $('[data-paste]', qEl).value.split('\n').filter((l) => l.trim());
        if (lines.length < 2 || lines.length > 255) { const box = q$('[data-jev-error]'); box.hidden = false; box.textContent = 'Paste 2–255 options, one per line.'; break; }
        q.options = lines.map((l) => { const at = l.indexOf('|'); return { name: (at < 0 ? l : l.slice(0, at)).trim(), description: at < 0 ? '' : l.slice(at + 1).trim() }; });
        relay();
        break;
      }
      case 'add-level': q.levels.push(''); relay(); break;
      case 'remove-level': q.levels.splice(+b.closest('[data-level]').dataset.level, 1); relay(); break;
      case 'up-level': { const n = +b.closest('[data-level]').dataset.level; [q.levels[n - 1], q.levels[n]] = [q.levels[n], q.levels[n - 1]]; relay(); break; }
      case 'preview': preview = effective(d); paint(); q$('[data-jev-preview]').scrollIntoView({ block: 'nearest' }); break;
      case 'copy-request': navigator.clipboard?.writeText(JSON.stringify(preview, null, 2)).catch(() => {}); say('Copied JSON.'); break;
      case 'evaluate': evaluate(); break;
      case 'stop': clearTimeout(timer); finish(runningId, 'cancelled'); break;
      case 'older': ws.runs.push(...ws.older.splice(0)); paintResults(); break;
      case 'copy-result': { const r = ws.runs.find((x) => x.id === ws.selected); navigator.clipboard?.writeText(JSON.stringify(r?.result, null, 2)).catch(() => {}); say('Copied JSON.'); break; }
      case 'edit-run': { const r = ws.runs.find((x) => x.id === ws.selected); if (r) create(draftFromRun(r), `${ws.title} · edited`); break; }
      case 'as-state': {
        const r = ws.runs.find((x) => x.id === ws.selected);
        if (!r?.result) break;
        const next = blank();
        next.format = 'json';
        next.state = JSON.stringify(r.result.answers, null, 2);
        create(next, `${ws.title} · answers`);
        say('Answers copied into State. Edit your next questions, then Evaluate; no other history is sent.');
        break;
      }
      case 'reload': ws.conflict = false; ws.draft = gate(); say('Latest saved builder loaded.'); paint(); break;
      case 'keep': ws.conflict = false; say(''); edited(); break;
      case 'retry-save': ws.unsaved = false; edited(); break;
      case 'check-pending': say('The evaluation is not confirmed yet. Check again, or Retry submission using the same request ID. Your builder is preserved.', true); break;
      case 'resubmit': ws.pending = false; say(''); evaluate(); break;
      default:
    }
  });

  // ---------- The states, and arriving by address ----------
  const want = params.get('jev'), ref = params.get('ref') || '';
  if (want != null || params.get('away') === 'jev' || /^jev\./.test(ref)) {
    const state = want || ({ 'jev.stop': 'running', 'jev.recover': 'conflict' }[ref]);
    if (state === 'conflict') ws.conflict = true;
    if (state === 'unsaved') ws.unsaved = true;
    if (state === 'pending') { ws.pending = true; notice = ['The evaluation is not confirmed yet. Check again, or Retry submission using the same request ID. Your builder is preserved.', true]; }
    open('jev');
    if (state === 'running') { evaluate(); clearTimeout(timer); timer = setTimeout(() => finish(runningId, 'completed'), +params.get('jevms') || 60000); }
    if (['stopped', 'failed', 'interrupted'].includes(state)) {
      const status = { stopped: 'cancelled', failed: 'error', interrupted: 'interrupted' }[state], r = run('r3', '19:41', status, ws.draft);
      ws.runs.unshift(r);
      ws.selected = r.id;
      paint();
    }
  }
})();
