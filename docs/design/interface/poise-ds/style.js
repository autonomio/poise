// A view transition the browser skips (a hidden tab, or a second click before
// the first page settled) is not an error: the page simply appears at once.
// This sits in the head, so it is listening before the new page's first frame.
(() => {
  const quiet = (vt) => { if (!vt) return; [vt.ready, vt.finished, vt.updateCallbackDone].forEach((p) => p?.catch(() => {})); };
  window.addEventListener('pageswap', (e) => quiet(e.viewTransition));
  window.addEventListener('pagereveal', (e) => quiet(e.viewTransition));
  // Any skip that reaches no handler, such as one rejected before the page could listen.
  window.addEventListener('unhandledrejection', (e) => { if (e.reason?.name === 'AbortError' && /transition/i.test(e.reason.message)) e.preventDefault(); });
})();

// How a view arrives when you move to it, decided before the page first paints.
// The first time this session it rises in with the spring, as the live app's views
// do (Chat, the Manager and Editor only fade); a view you have seen appears at once,
// and so does a page that Back restores. components.css draws the transition.
(() => {
  const root = document.documentElement;
  const page = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '');
  const ENTER = { overview: 'rise', board: 'rise', observe: 'rise', settings: 'rise', chat: 'fade', manager: 'fade', editor: 'fade' };
  const KEY = 'poise-seen-views';
  let seen = [];
  try { seen = JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { /* storage unavailable: every view enters */ }
  root.dataset.enter = !ENTER[page] ? 'fade' : seen.includes(page) ? 'none' : ENTER[page];
  if (ENTER[page] && !seen.includes(page)) { try { sessionStorage.setItem(KEY, JSON.stringify([...seen, page])); } catch { /* nothing to keep */ } }
  addEventListener('pageshow', (e) => { if (e.persisted) root.dataset.enter = 'none'; });
})();

// The Style panel: a person's full control over the tokens.
// Every control writes a token on :root; saved overrides apply on every page
// (load this file in <head> so they land before first paint).
(() => {
  const KEY = 'poise-style';
  const root = document.documentElement;
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
  const write = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* still applies for this page */ } };
  let saved = read();
  const apply = (o) => Object.entries(o).forEach(([k, v]) => root.style.setProperty(k, v));

  const ARCHETYPES = {
    engineer: { label: 'Engineer', gloss: 'Plex, Zen Maru display', ui: 'IBM Plex Sans', display: 'Zen Maru Gothic', mono: 'IBM Plex Mono' },
    minimalist: { label: 'Minimalist', gloss: 'Manrope, Space Grotesk', ui: 'Manrope', display: 'Space Grotesk', mono: 'JetBrains Mono' },
    companion: { label: 'Companion', gloss: 'Nunito, Rubik', ui: 'Nunito', display: 'Rubik', mono: 'IBM Plex Mono' },
    editor: { label: 'Editor', gloss: 'Lato, Playfair Display', ui: 'Lato', display: 'Playfair Display', mono: 'IBM Plex Mono' },
    writer: { label: 'Writer', gloss: 'Lora throughout', ui: 'Lora', display: 'Lora', mono: 'IBM Plex Mono' },
    auteur: { label: 'Auteur', gloss: 'Work Sans, Syne', ui: 'Work Sans', display: 'Syne', mono: 'IBM Plex Mono' }
  };
  const loadFonts = (a) => {
    const fams = [...new Set([a.ui, a.display, a.mono])].map((f) => `family=${f.replace(/ /g, '+')}:wght@400;600;700`).join('&');
    let link = document.getElementById('style-fonts');
    if (!link) { link = Object.assign(document.createElement('link'), { id: 'style-fonts', rel: 'stylesheet' }); document.head.appendChild(link); }
    link.href = `https://fonts.googleapis.com/css2?${fams}&display=swap`;
  };
  const archetype = () => saved['--archetype'] ? ARCHETYPES[saved['--archetype'].replace(/"/g, '')] : null;
  apply(saved);
  if (archetype()) loadFonts(archetype());

  const set = (prop, value) => { saved[prop] = value; root.style.setProperty(prop, value); write(saved); sync(); };
  const setMany = (o) => { Object.assign(saved, o); apply(o); write(saved); sync(); };
  const token = (prop) => getComputedStyle(root).getPropertyValue(prop).trim();

  const PRESETS = {
    calm: { label: 'Calm', gloss: 'Poise default', values: { '--ctl-density': '1', '--ctl-base-size': '15px' } },
    compact: { label: 'Compact', gloss: 'more rows on screen', values: { '--ctl-density': '0.8', '--ctl-base-size': '14px' } },
    comfortable: { label: 'Comfortable', gloss: 'more air', values: { '--ctl-density': '1.2', '--ctl-base-size': '15px' } },
    large: { label: 'Large type', gloss: 'for long days', values: { '--ctl-density': '1.1', '--ctl-base-size': '17px' } }
  };
  const SLIDERS = [
    ['--ctl-base-size', 'Base size', 'scales all type and controls', 13, 18, 0.5, 'px'],
    ['--ctl-density', 'Density', 'space inside and between things', 0.75, 1.35, 0.05, '×'],
    ['--ctl-radius', 'Corners', 'square to round', 0, 2, 0.25, '×'],
    ['--ctl-line', 'Route lines', 'weight of lines and stations', 0.6, 1.6, 0.1, '×'],
    ['--ctl-tint', 'Status tints', 'how strongly a meaning colours its badge', 10, 35, 1, '%']
  ];
  // One colour per state word; Idle has none (it is hollow). Then information, and Poise acting on its own.
  const MEANINGS = [
    ['--c-attention', 'Needs you', 'only you can move it on'], ['--c-running', 'Running', 'working now'],
    ['--c-other', 'Waiting', 'for checks or a slot; also the route'], ['--c-risk', 'Blocked', 'a prerequisite is missing'],
    ['--c-done', 'Done', 'finished, merged'], ['--c-failed', 'Failed', 'errors, and destructive actions'],
    ['--c-agent', 'Information', 'an agent, information, focus'], ['--c-special', 'Poise acting', 'the Manager, Poise changing itself']
  ];
  const NEUTRALS = [
    ['--p-n0', 'Canvas'], ['--p-n1', 'Surface'], ['--p-n2', 'Hairline'], ['--p-n3', 'Border'],
    ['--p-n4', 'Muted text'], ['--p-n5', 'Soft text'], ['--p-n6', 'Text'], ['--p-n7', 'Strongest']
  ];
  const toHex = (c) => { const d = document.createElement('div'); d.style.color = c; document.body.appendChild(d); const m = getComputedStyle(d).color.match(/\d+/g); d.remove(); return m ? '#' + m.slice(0, 3).map((x) => (+x).toString(16).padStart(2, '0')).join('') : '#000000'; };

  // Each control names its row in Settings → Style, which the registry explains.
  const SLIDER_REF = { '--ctl-base-size': 'set.style.size', '--ctl-density': 'set.style.density', '--ctl-radius': 'set.style.corners', '--ctl-line': 'set.style.lines', '--ctl-tint': 'set.style.tints' };
  // Settings → Style, with a route back to the view the panel is open over.
  const VIEW_OF = { 'overview.html': 'overview', 'board.html': 'board', 'chat.html': 'chat', 'manager.html': 'manager', 'editor.html': 'editor', 'observe.html': 'observe' };
  const here = location.pathname.split('/').pop();
  const SETTINGS_HREF = here === 'settings.html' ? '#style' : `settings.html${VIEW_OF[here] ? `?back=${VIEW_OF[here]}` : ''}#style`;
  function build() {
    const panel = document.createElement('aside');
    panel.className = 'panel';
    panel.id = 'style-panel';
    panel.setAttribute('aria-label', 'Style');
    panel.innerHTML = `
      <div class="panel-h"><i data-i="palette"></i><h2>Style</h2><button class="ib" data-style-close aria-label="Close style" data-ref="style.close"><i data-i="cross"></i></button></div>
      <div class="panel-b">
        <p class="t-gloss">The same settings as <a class="lnk" href="${SETTINGS_HREF}" data-ref="style.settings">Settings → Style</a>, which also has the writing ones.</p>
        <div class="panel-sec"><span class="t-micro">Presets</span><span class="t-gloss">a starting point; everything below stays adjustable</span></div>
        <div class="choices" data-group="preset">${Object.entries(PRESETS).map(([k, p]) => `<button class="choice" data-preset="${k}" data-ref="set.style.preset"><b>${p.label}</b><span>${p.gloss}</span></button>`).join('')}</div>
        <div class="panel-sec"><span class="t-micro">Type</span><span class="t-gloss">interface, display and code faces together</span></div>
        <div class="choices" data-group="type">${Object.entries(ARCHETYPES).map(([k, a]) => `<button class="choice" data-arch="${k}" data-ref="set.style.type"><b>${a.label}</b><span>${a.gloss}</span></button>`).join('')}</div>
        <div class="panel-sec"><span class="t-micro">Scale and shape</span></div>
        ${SLIDERS.map(([p, l, h, min, max, step]) => `<div class="field"><label for="f${p}" data-ref="${SLIDER_REF[p]}">${l}</label><output data-out="${p}"></output><input id="f${p}" type="range" min="${min}" max="${max}" step="${step}" data-slider="${p}" data-ref="${SLIDER_REF[p]}"><span class="hint">${h}</span></div>`).join('')}
        <div class="field"><label data-ref="set.style.motion">Motion</label><button class="ib" data-motion aria-label="Motion" data-ref="set.style.motion"><span class="switch"></span></button><span class="hint">the Tactile spring; off keeps everything still</span></div>
        <div class="panel-sec"><span class="t-micro">Meaning colours</span><span class="t-gloss">each colour is one meaning; badges, lines and tints follow</span></div>
        ${MEANINGS.map(([p, l, h]) => `<div class="field"><label for="c${p}" data-ref="set.style.colours">${l}</label><input id="c${p}" type="color" data-color="${p}" data-ref="set.style.colour"><span class="hint">${h}</span></div>`).join('')}
        <details class="panel-sec"><summary class="t-micro" data-ref="set.style.neutrals">Neutrals</summary><span class="t-gloss">the dark stack every surface is made from</span>
        ${NEUTRALS.map(([p, l]) => `<div class="field"><label for="n${p}" data-ref="set.style.neutrals">${l}</label><input id="n${p}" type="color" data-color="${p}" data-ref="set.style.colour"></div>`).join('')}</details>
      </div>
      <div class="panel-f"><button class="btn btn-line" data-style-reset data-ref="set.style.reset">Reset to Poise</button><button class="btn btn-line" data-style-copy data-ref="set.style.copy">Copy as CSS</button><a class="btn btn-primary" href="guide.html" data-ref="set.style.guide">Style guide</a></div>`;
    document.body.appendChild(panel);
    if (typeof hydrateIcons === 'function') hydrateIcons(panel);

    panel.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.slider) { const unit = SLIDERS.find((s) => s[0] === t.dataset.slider)[6]; set(t.dataset.slider, unit === 'px' || unit === '%' ? `${t.value}${unit}` : t.value); }
      if (t.dataset.color) set(t.dataset.color, t.value);
    });
    panel.addEventListener('click', (e) => {
      const t = e.target.closest('button, a');
      if (!t) return;
      if (t.dataset.preset) setMany(PRESETS[t.dataset.preset].values);
      if (t.dataset.arch) { const a = ARCHETYPES[t.dataset.arch]; loadFonts(a); setMany({ '--archetype': `"${t.dataset.arch}"`, '--ctl-font-ui': `"${a.ui}"`, '--ctl-font-display': `"${a.display}"`, '--ctl-font-mono': `"${a.mono}"` }); }
      if (t.hasAttribute('data-motion')) set('--ctl-motion', token('--ctl-motion') === '0' ? '1' : '0');
      if (t.hasAttribute('data-style-reset')) { Object.keys(saved).forEach((k) => root.style.removeProperty(k)); saved = {}; write(saved); sync(); }
      if (t.hasAttribute('data-style-copy')) { navigator.clipboard?.writeText(css()); t.textContent = 'Copied'; setTimeout(() => (t.textContent = 'Copy as CSS'), 1400); }
      if (t.hasAttribute('data-style-close')) toggle(false);
    });
    sync();
  }

  function sync() {
    document.dispatchEvent(new CustomEvent('poise:style'));
    const panel = document.getElementById('style-panel');
    if (!panel) return;
    SLIDERS.forEach(([p, , , , , , unit]) => {
      const v = parseFloat(token(p));
      const input = panel.querySelector(`[data-slider="${p}"]`);
      if (input && document.activeElement !== input) input.value = v;
      const out = panel.querySelector(`[data-out="${p}"]`);
      if (out) out.textContent = unit === '×' ? `${v.toFixed(2)}×` : `${v}${unit}`;
    });
    panel.querySelectorAll('[data-color]').forEach((i) => { if (document.activeElement !== i) i.value = toHex(token(i.dataset.color)); });
    panel.querySelector('[data-motion]').setAttribute('aria-pressed', String(token('--ctl-motion') !== '0'));
    const arch = (saved['--archetype'] || '"engineer"').replace(/"/g, '');
    panel.querySelectorAll('[data-arch]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.arch === arch)));
    const preset = Object.entries(PRESETS).find(([, p]) => Object.entries(p.values).every(([k, v]) => token(k) === v));
    panel.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', String(!!preset && b.dataset.preset === preset[0])));
  }

  // Settings → Style works on the same saved choices as this panel.
  const unset = (prop) => { delete saved[prop]; root.style.removeProperty(prop); write(saved); sync(); };
  const css = () => `:root {\n${Object.entries(saved).filter(([k]) => k !== '--archetype').map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`;
  // Poise's own value of a token: what it is with your choice set aside.
  function defaultOf(prop) {
    const mine = root.style.getPropertyValue(prop);
    if (mine) root.style.removeProperty(prop);
    const d = token(prop);
    if (mine) root.style.setProperty(prop, mine);
    return d;
  }
  function restore(o) {
    Object.keys(saved).forEach((k) => root.style.removeProperty(k));
    saved = { ...o };
    apply(saved);
    write(saved);
    if (archetype()) loadFonts(archetype());
    sync();
  }
  function setArchetype(k) {
    if (k === 'engineer') { ['--archetype', '--ctl-font-ui', '--ctl-font-display', '--ctl-font-mono'].forEach((p) => { delete saved[p]; root.style.removeProperty(p); }); write(saved); sync(); return; }
    const a = ARCHETYPES[k];
    loadFonts(a);
    setMany({ '--archetype': `"${k}"`, '--ctl-font-ui': `"${a.ui}"`, '--ctl-font-display': `"${a.display}"`, '--ctl-font-mono': `"${a.mono}"` });
  }
  window.PoiseStyle = {
    token, defaultOf, restore, setArchetype, css, toHex, ARCHETYPES, PRESETS, MEANINGS, NEUTRALS,
    set: (prop, value) => (value == null ? unset(prop) : set(prop, value)),
    saved: () => ({ ...saved }),
    archetype: () => (saved['--archetype'] || '"engineer"').replace(/"/g, '')
  };

  function toggle(force) {
    const panel = document.getElementById('style-panel');
    const on = panel.classList.toggle('open', force);
    document.querySelectorAll('[data-style-open]').forEach((b) => b.setAttribute('aria-pressed', String(on)));
  }

  // Review links: ?style-preset=compact&style-type=editor show a style without saving it.
  const q = new URLSearchParams(location.search);
  if (q.get('style-preset') && PRESETS[q.get('style-preset')]) apply(PRESETS[q.get('style-preset')].values);
  if (q.get('style-type') && ARCHETYPES[q.get('style-type')]) { const a = ARCHETYPES[q.get('style-type')]; loadFonts(a); apply({ '--ctl-font-ui': `"${a.ui}"`, '--ctl-font-display': `"${a.display}"`, '--ctl-font-mono': `"${a.mono}"` }); }
  if (q.get('style-radius')) apply({ '--ctl-radius': q.get('style-radius') });

  document.addEventListener('DOMContentLoaded', () => {
    build();
    document.addEventListener('click', (e) => { if (e.target.closest('[data-style-open]')) toggle(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });
    if (new URLSearchParams(location.search).get('style') === 'open') toggle(true);
  });
  window.addEventListener('storage', (e) => { if (e.key === KEY) { Object.keys(saved).forEach((k) => root.style.removeProperty(k)); saved = read(); apply(saved); sync(); } });
})();
