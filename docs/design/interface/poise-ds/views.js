// Swarm’s behaviour. Purely presentational; the top bar and its menus come from shell.js.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// Segmented filters: one choice per group.
document.addEventListener('click', (e) => {
  const b = e.target.closest('.seg button');
  if (!b) return;
  $$('button', b.parentElement).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
});

// Live elapsed counters.
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
setInterval(() => $$('[data-tick]').forEach((el) => { el.dataset.tick = +el.dataset.tick + 1; el.textContent = fmt(+el.dataset.tick); }), 1000);

// ---------- Board ----------
let dragged = null;
document.addEventListener('dragstart', (e) => {
  const card = e.target.closest('.card[draggable="true"]');
  if (!card) return;
  dragged = card;
  card.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragend', () => { dragged?.classList.remove('is-dragging'); $$('.lane.is-drop').forEach((l) => l.classList.remove('is-drop')); dragged = null; });
document.addEventListener('dragover', (e) => {
  const lane = e.target.closest('.lane[data-accepts]');
  if (!lane || !dragged) return;
  e.preventDefault();
  $$('.lane.is-drop').forEach((l) => l !== lane && l.classList.remove('is-drop'));
  lane.classList.add('is-drop');
});
document.addEventListener('drop', (e) => {
  const lane = e.target.closest('.lane[data-accepts]');
  if (!lane || !dragged) return;
  e.preventDefault();
  lane.classList.remove('is-drop');
  if (lane.dataset.accepts === 'issue') {
    // Dropping an idea on Issue opens the issue composer, prefilled.
    openComposer(lane, dragged.querySelector('.card-text').textContent.trim());
    return;
  }
  $('.lane-list', lane).prepend(dragged);
  dragged.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 400, easing: 'ease-out' });
  counts();
});
function counts() { $$('.lane').forEach((l) => { const c = $('.count', l); if (c) c.textContent = $$('.lane-list > .card', l).length; }); }

function openComposer(lane, text = '') {
  const comp = $('.composer', lane);
  if (!comp) return;
  comp.hidden = false;
  const field = $('textarea, input', comp);
  if (text) field.value = text;
  field.focus();
  $('.lane-add', lane)?.setAttribute('hidden', '');
}
function closeComposer(comp) { comp.hidden = true; $$('textarea, input', comp).forEach((f) => (f.value = '')); comp.closest('.lane').querySelector('.lane-add')?.removeAttribute('hidden'); }
document.addEventListener('click', (e) => {
  const add = e.target.closest('.lane-add');
  if (add) { openComposer(add.closest('.lane')); return; }
  const cancel = e.target.closest('[data-cancel]');
  if (cancel) { closeComposer(cancel.closest('.composer')); return; }
  const ok = e.target.closest('[data-add]');
  if (ok) {
    const comp = ok.closest('.composer');
    const text = $('textarea, input', comp).value.trim();
    if (!text) return;
    const lane = comp.closest('.lane');
    const card = $('#tpl-card').content.firstElementChild.cloneNode(true);
    $('.card-text', card).textContent = text;
    $('.repo', card).textContent = $('.select', comp)?.dataset.value || '';
    if (lane.dataset.accepts === 'issue') { card.removeAttribute('draggable'); $('.time', card).textContent = 'just now · opening on GitHub'; }
    $('.lane-list', lane).prepend(card);
    hydrateIcons(card);
    card.classList.add('settle');
    closeComposer(comp);
    counts();
    return;
  }
  const act = e.target.closest('[data-card-act]');
  if (act) {
    const card = act.closest('.card');
    if (act.dataset.cardAct === 'copy') { act.classList.add('is-done'); const use = $('use', act); const old = use.getAttribute('href'); use.setAttribute('href', '#i-check'); setTimeout(() => { use.setAttribute('href', old); act.classList.remove('is-done'); }, 1200); }
    if (act.dataset.cardAct === 'delete') { card.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.98)' }], { duration: 220, easing: 'ease-out' }).onfinish = () => { card.remove(); counts(); }; }
    return;
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('.composer:not([hidden])').forEach(closeComposer); });

// ---------- Swarm ----------
document.addEventListener('click', (e) => {
  const exp = e.target.closest('[data-expand]');
  if (exp) {
    const row = exp.closest('tr');
    const detail = row.nextElementSibling;
    if (detail?.classList.contains('detail')) {
      detail.hidden = !detail.hidden;
      exp.setAttribute('aria-expanded', String(!detail.hidden));
    }
    return;
  }
  const stop = e.target.closest('[data-stop]');
  if (stop) {
    if (!stop.classList.contains('is-armed')) {
      stop.classList.add('is-armed'); stop.textContent = 'Sure?';
      setTimeout(() => { if (stop.isConnected && stop.textContent === 'Sure?') { stop.classList.remove('is-armed'); stop.innerHTML = '<svg class="i sm solid"><use href="#i-stop"/></svg>'; } }, 3000);
      return;
    }
    stop.classList.remove('is-armed'); stop.innerHTML = '<span class="spin"></span>'; stop.disabled = true;
    const row = stop.closest('tr');
    setTimeout(() => {
      $('.status', row).innerHTML = '<span class="status-word is-flat"><svg class="i sm"><use href="#i-stopped"/></svg>Stopped</span><span class="status-note">held for this head; the next tick will not relaunch it</span>';
      row.classList.remove('is-running');
      const t = $('[data-tick]', row); if (t) t.removeAttribute('data-tick');
      stop.replaceWith(Object.assign(document.createElement('span'), { className: 'dash', textContent: '—' }));
    }, 1000);
    return;
  }
  const replay = e.target.closest('[data-replay]');
  if (replay) {
    const row = replay.closest('tr');
    if (row.dataset.refuse) {
      const note = row.nextElementSibling?.classList.contains('refusal') ? row.nextElementSibling : null;
      if (note) note.hidden = false;
      return;
    }
    replay.innerHTML = '<span class="spin"></span>'; replay.disabled = true;
    setTimeout(() => {
      replay.innerHTML = '<svg class="i sm"><use href="#i-replay"/></svg>'; replay.disabled = false;
      const tpl = $('#tpl-run');
      if (!tpl) return;
      const fresh = tpl.content.firstElementChild.cloneNode(true);
      $('.cell-model', fresh).innerHTML = $('.cell-model', row).innerHTML;
      $('.cell-behavior', fresh).innerHTML = $('.cell-behavior', row).innerHTML;
      $('.cell-org', fresh).innerHTML = $('.cell-org', row).innerHTML;
      $('.cell-repo', fresh).innerHTML = $('.cell-repo', row).innerHTML;
      $('tbody').prepend(fresh);
      fresh.classList.add('settle');
    }, 900);
  }
});

// One running row walks through its phases, as the live view would.
const walker = $('[data-phases]');
if (walker) {
  const phases = walker.dataset.phases.split('|');
  let k = 0;
  setInterval(() => {
    k = (k + 1) % phases.length;
    $('.phase', walker).textContent = phases[k];
    const em = $('.stage em', walker);
    if (em) em.textContent = phases[k].split(' ')[0];
  }, 4200);
}
