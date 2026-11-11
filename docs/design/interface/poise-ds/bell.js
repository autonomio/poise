// The bell on every view: it counts what Overview's level shows, in the same
// colour, and opens Overview's Answer here with a route back to where you were.
(() => {
  const OV = window.PoiseOV;
  const btn = document.querySelector('[data-ref="bell"]'), badge = btn?.querySelector('[data-bell]');
  if (!btn || !badge || !OV) return;
  const view = { current: 'board' }[document.body.dataset.view] || document.body.dataset.view || '';
  function paint() {
    const b = OV.bell();
    badge.textContent = b.count;
    badge.hidden = !b.count;
    badge.dataset.tone = b.tone;
    btn.setAttribute('aria-label', `Notifications, ${b.count} open. Opens Answer here in Overview.`);
  }
  OV.on(paint);
  paint();
  btn.addEventListener('click', () => { location.href = `overview.html?back=${view}#answer`; });
})();
