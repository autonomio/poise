// The guide is bound to the code: it reads tokens.css and the lint report
// at load, measures every token in the live page, and re-measures whenever
// the Style panel changes something.
const host = document.getElementById('tokens-host');
const toc = document.getElementById('toc-tokens');
const root = document.documentElement;
let parsed = [];

function parse(css) {
  const out = [];
  let section = null, note = '';
  for (const line of css.split('\n')) {
    const sec = line.match(/\/\*\s*-{3,}\s*(.+?)\s*-{3,}\s*\*\//);
    if (sec) { section = { title: sec[1].replace(/^\d+\.\s*/, ''), tokens: [], notes: [] }; out.push(section); note = ''; continue; }
    const tok = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?);\s*(?:\/\*\s*(.+?)\s*\*\/)?\s*$/);
    if (tok && section) { section.tokens.push({ name: tok[1], raw: tok[2], note: tok[3] || '', group: note }); continue; }
    const c = line.match(/^\s*\/\*\s*(.+?)\s*\*\/\s*$/);
    if (c && section) note = c[1];
  }
  return out.filter((s) => s.tokens.length);
}

const probe = document.createElement('div');
probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:-9999px;top:0;';
document.body.appendChild(probe);
const px = (name, prop = 'width') => { probe.style.cssText += `;${prop}:var(${name})`; const v = prop === 'width' ? probe.getBoundingClientRect().width : parseFloat(getComputedStyle(probe)[prop === 'font-size' ? 'fontSize' : prop]); probe.style.removeProperty(prop); return Math.round(v * 100) / 100; };
const val = (name) => getComputedStyle(root).getPropertyValue(name).trim();

function kind(t) {
  const n = t.name;
  if (/^--(fs|ctl-base)/.test(n)) return 'size-type';
  if (/^--(sp|size|route|cap|w|line)-/.test(n)) return 'length';
  if (/^--r-/.test(n)) return 'radius';
  if (/^--shadow/.test(n)) return 'shadow';
  if (/^--(font|ctl-font|p-fallback)/.test(n)) return 'family';
  if (/^--fw-/.test(n)) return 'weight';
  if (/^--(lh|ls)-/.test(n)) return 'text';
  if (/^--(c-|p-n|p-white|p-black|p-blue|p-teal|p-green|p-amber|p-red|p-rose|p-violet|p-slate)/.test(n) || /^--ctl-tint/.test(n)) return n === '--ctl-tint' ? 'plain' : 'colour';
  return 'plain';
}

function sample(t) {
  switch (kind(t)) {
    case 'colour': return `<span class="swatch" style="--sw: var(${t.name})"></span>`;
    case 'size-type': return `<span class="type-sample" style="font-size: var(${t.name})">Agents with good manners</span>`;
    case 'length': return `<span class="bar" style="--sw: min(100%, var(${t.name}))"></span>`;
    case 'radius': return `<span class="radius-sample" style="--sw: var(${t.name})"></span>`;
    case 'shadow': return `<span class="shadow-sample" style="--sw: var(${t.name})"></span>`;
    case 'family': return `<span class="type-sample" style="font-family: var(${t.name})">Poise · 0123 · Merge</span>`;
    case 'weight': return `<span class="type-sample" style="font-weight: var(${t.name})">Review New Pull Requests</span>`;
    default: return '';
  }
}

function now(t) {
  const k = kind(t);
  if (k === 'size-type') return `${px(t.name, 'font-size')}px`;
  if (k === 'length' || k === 'radius') return `${px(t.name)}px`;
  const v = val(t.name);
  return v.length > 28 ? `${v.slice(0, 26)}…` : v;
}

function render() {
  host.innerHTML = parsed.map((s, i) => `
    <h2 id="tok-${i}">${s.title}</h2>
    <span class="t-gloss">${s.tokens.length} tokens${s.title.startsWith('Controls') ? ' · the knobs in the Style panel' : s.title.startsWith('Primitives') ? ' · raw values; components never read these' : ' · the only names components may use'}</span>
    <table class="tokens">
      <thead><tr><th class="w-name"><span class="t-micro">Token</span></th><th class="w-sample"><span class="t-micro">Sample</span></th><th class="w-now"><span class="t-micro">Now</span></th><th><span class="t-micro">Defined as</span></th></tr></thead>
      <tbody>${s.tokens.map((t) => `<tr data-token="${t.name}"><td><code>${t.name}</code>${t.note ? `<div class="t-gloss">${t.note}</div>` : t.group ? `<div class="t-gloss">${t.group}</div>` : ''}</td><td>${sample(t)}</td><td class="now t-mono">${now(t)}</td><td><span class="raw">${t.raw.length > 70 ? t.raw.slice(0, 68) + '…' : t.raw}</span></td></tr>`).join('')}</tbody>
    </table>`).join('');
  toc.innerHTML = parsed.map((s, i) => `<a href="#tok-${i}">${s.title}</a>`).join('');
}

function refresh() {
  parsed.forEach((s) => s.tokens.forEach((t) => { const cell = host.querySelector(`[data-token="${t.name}"] .now`); if (cell) cell.textContent = now(t); }));
}

fetch('tokens.css').then((r) => r.text()).then((css) => { parsed = parse(css); render(); }).catch(() => {
  host.innerHTML = '<p class="notice"><span class="cap is-attention"></span><span>Open this page through a local server so it can read <b>tokens.css</b>.</span></p>';
});
document.addEventListener('poise:style', refresh);

fetch('lint-report.json').then((r) => r.json()).then((rep) => {
  const files = Object.entries(rep.files);
  const ok = rep.violations === 0;
  document.getElementById('lint').innerHTML = `
    <span class="cap lg ${ok ? 'is-done' : 'is-failed'}"></span>
    <b>${ok ? 'Every file keeps to the tokens' : `${rep.violations} violation(s)`}</b>
    <span>${rep.tokens_defined} tokens defined · ${rep.tokens_used} used by components and views · checked by tools/lint_tokens.py</span>
    <ul>${files.map(([f, v]) => `<li class="chip ${v.length ? 'is-failed' : 'is-done'} dot">${f}${v.length ? ` · ${v.length}` : ''}</li>`).join('')}</ul>`;
}).catch(() => {});

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-play]');
  if (b) document.querySelector('.track').classList.toggle('go');
});
