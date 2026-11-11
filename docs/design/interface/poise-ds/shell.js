// The shell every view shares: the top bar's menus, feedback, the instruction
// lifecycle and the mock clock. Views take these from window.PoiseShell rather
// than keeping their own copies, so they cannot drift apart.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: settings last for this visit */ } }
  };
  const params = new URLSearchParams(location.search);
  // ?still: motion off, for captures that cannot wait for animations.
  if (params.has('still')) document.documentElement.style.setProperty('--ctl-motion', '0');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Motion comes from tokens: a probe resolves the calc()'d durations and the spring.
  const probe = document.createElement('i');
  probe.hidden = true;
  document.body.append(probe);
  function motion(dur = '--dur-settle') {
    probe.style.transition = `opacity var(${dur}) var(--ease-spring)`;
    const cs = getComputedStyle(probe);
    return { duration: (parseFloat(cs.transitionDuration) || 0) * 1000, easing: cs.transitionTimingFunction || 'ease-out' };
  }

  // A mock clock that starts at 19:41 and runs in real time.
  const t0 = Date.now(), base = (19 * 60 + 41) * 60 + 20;
  const secs = () => base + Math.floor((Date.now() - t0) / 1000);
  const clock = () => { const s = secs(); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`; };
  const nowAt = () => Math.floor(secs() / 3600) * 100 + (Math.floor(secs() / 60) % 60);

  // Instruction progress, drawn by one function: accepted → queued → executing → completed.
  const STAGES = ['Accepted', 'Queued', 'Executing', 'Completed'];
  function lifeHTML(stage, label, skipQueued) {
    const i = STAGES.indexOf(stage);
    return STAGES.map((s, k) => {
      let cls = '';
      if (skipQueued && s === 'Queued' && i > 1) cls = 'skip';
      else if (k < i || (k === i && stage === 'Completed')) cls = 'd';
      else if (k === i) cls = 'now';
      return `${k ? `<b${k <= i ? ' class="d"' : ''}></b>` : ''}<i${cls ? ` class="${cls}"` : ''}></i>`;
    }).join('') + `<span class="lbl"><b>${stage}</b>${label ? ` · ${label}` : ''}</span>`;
  }
  function lifeTo(el, stage, label, skip) { if (!el) return; el.dataset.life = stage; el.innerHTML = lifeHTML(stage, label, skip); }

  // Feedback that says what happened and when it applies.
  let toastEl = $('[data-toast]'), toastTimer = 0;
  function toast(text, state) {
    if (!toastEl) {
      toastEl = Object.assign(document.createElement('div'), { className: 'toast', hidden: true });
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.append(toastEl);
    }
    toastEl.innerHTML = `${state ? `<span class="sc" data-state="${state}"></span>` : ''}<span>${text}</span>`;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4200);
  }

  // Menus: [data-menu="id"] opens that menu; [data-menu-open] opens Settings.
  let openFor = null;
  function closeMenus() {
    $$('.menu').forEach((m) => { m.hidden = true; });
    $$('[aria-expanded="true"][aria-haspopup]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    openFor = null;
  }
  function openMenu(menu, anchor, align = 'left') {
    const again = openFor === anchor;
    closeMenus();
    if (!menu || again) return;
    const r = anchor.getBoundingClientRect(), gap = 8;
    menu.hidden = false;
    menu.style.top = `${r.bottom + gap}px`;
    if (align === 'right') { menu.style.left = ''; menu.style.right = `${innerWidth - r.right}px`; } else { menu.style.right = ''; menu.style.left = `${r.left}px`; }
    anchor.setAttribute('aria-expanded', 'true');
    openFor = anchor;
    $('[role^="menuitem"]:not([aria-disabled="true"])', menu)?.focus({ preventScroll: true });
  }
  document.addEventListener('click', (e) => {
    const t = e.target;
    const opener = t.closest('[data-menu], [data-menu-open]');
    if (opener) { openMenu(document.getElementById(opener.dataset.menu || 'main-menu'), opener, opener.dataset.menuAlign); return; }
    if (t.closest('.menu [aria-disabled="true"]')) return;
    if (t.closest('.menu [data-style-open]')) { closeMenus(); return; }
    if (!t.closest('.menu')) closeMenus();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openFor) { const a = openFor; closeMenus(); a.focus(); } });

  // The connection says when what you see may be out of date.
  const conn = $('[data-ref="conn"]');
  setTimeout(() => { if (!conn) return; conn.textContent = 'Reconnecting…'; conn.classList.add('is-reconnecting'); setTimeout(() => { conn.textContent = 'Live'; conn.classList.remove('is-reconnecting'); }, 2600); }, 31000);

  // States any view can be in: Poise restarting onto a new version, or a sign-in
  // that ended. The page dims under a card that says what is happening and what
  // carries on; ?state=updating or ?state=signedout shows them.
  const STATE = {
    updating: ['Updating to the latest version…', 'Poise is back in a few seconds. Running agents and reviews carry on.', 'st.updating'],
    signedout: ['Your sign-in has ended', 'Sign in again to go on where you were. Running agents and reviews carry on meanwhile.', 'st.signedout']
  }[params.get('state')];
  // Claude's subscription: a strip at the foot of every view while Claude-backed work is paused, in main's words; the page makes room.
  // ?state=claude-reauth, claude-signing, claude-quota, claude-unavailable, claude-local or claude-failed.
  const CLAUDE = {
    reauth: ['Claude subscription sign-in required', 'Claude-backed work is paused. Sign in with the Claude Max or Pro subscription connected to this computer.', 'Sign in with Claude'],
    signing: ['Complete Claude sign-in in your browser', 'Poise will verify the Claude subscription and resume Claude-backed work automatically.'],
    quota: ['Claude subscription quota exhausted', 'Signed in, but out of quota: Claude-backed work is paused until more quota is available. No need to sign in again.'],
    unavailable: ['Claude subscription check unavailable', 'Poise cannot reach Claude Code on this computer. It will keep checking automatically.'],
    local: ['Poise could not check the Claude subscription', 'Claude-backed work is paused. The request timed out. This is a problem reaching Poise’s own server, not necessarily the subscription.'],
    failed: ['Claude subscription verification failed', 'Claude-backed work is paused. Reconnect the subscription now, or let Poise keep retrying automatically.', 'Reconnect Claude']
  };
  function footCard(ref, c, tone, onPress) {
    const root = document.documentElement;
    let card = document.querySelector('.foot-card');
    if (!c) { card?.remove(); root.style.removeProperty('--foot-h'); return; }
    if (!card) {
      card = Object.assign(document.createElement('section'), { className: 'foot-card' });
      document.body.append(card);
      addEventListener('resize', () => { if (card.isConnected) root.style.setProperty('--foot-h', `${card.offsetHeight}px`); });
    }
    card.setAttribute('role', ref === 'st.claude' ? 'alert' : 'status');
    card.dataset.ref = ref;
    card.dataset.tone = tone || '';
    card.innerHTML = `<div class="foot-copy"><b>${c[0]}</b><span>${c[1]}</span></div>${c[2] ? `<button class="btn-ghost"${c[3] ? ' aria-disabled="true"' : ''}>${c[2]}</button>` : ''}`;
    if (!c[3]) card.querySelector('button')?.addEventListener('click', onPress);
    root.style.setProperty('--foot-h', `${card.offsetHeight}px`);
  }
  function claudeCard(kind) {
    footCard('st.claude', CLAUDE[kind], kind === 'reauth' ? 'failed' : '', () => {
      claudeCard('signing');
      setTimeout(() => { claudeCard(null); toast('Claude is signed in. Claude-backed work resumes.', 'done'); }, 2600);
    });
  }
  // A new build is live. Refresh keeps your drafts, and waits for what a reload would lose: ?state=build or build-wait.
  const BUILD = 'A new Poise build is live (4b7d1e0).';
  function buildCard(wait) {
    footCard('st.build', [BUILD, wait ? 'Waiting for text being composed. Refresh keeps your drafts.' : 'Refresh keeps your drafts.', 'Refresh'], 'info', () => {
      if (wait) { footCard('st.build', [BUILD, 'Refresh is waiting for text being composed: save or clear it and the tab will refresh.', 'Refreshing…', true], 'info'); return; }
      footCard('st.build', [BUILD, 'Refreshing…', 'Refreshing…', true], 'info');
      setTimeout(() => { footCard(null, null); toast('Updated to autonomio/poise@4b7d1e0. Nothing you were doing was lost.', 'done'); }, 1400);
    });
  }
  const FOOT = /^(claude|build)(?:-(\w+))?$/.exec(params.get('state') || '') || [];
  if (FOOT[1] === 'claude') claudeCard(FOOT[2]);
  if (FOOT[1] === 'build') buildCard(FOOT[2] === 'wait');
  if (STATE) {
    const page = location.pathname.split('/').pop() || 'overview.html';
    const layer = Object.assign(document.createElement('div'), { className: 'up-backdrop' });
    layer.setAttribute('role', 'alertdialog');
    layer.setAttribute('aria-live', 'assertive');
    layer.setAttribute('aria-label', STATE[0]);
    layer.innerHTML = `<div class="up-card" data-ref="${STATE[2]}">${params.get('state') === 'updating' ? '<span class="spin" aria-hidden="true"></span>' : ''}<p class="up-title">${STATE[0]}</p><p class="up-detail">${STATE[1]}</p>${params.get('state') === 'signedout' ? `<a class="btn btn-primary" href="gateway.html?state=signin&amp;next=${encodeURIComponent(page)}">Sign in again</a>` : ''}</div>`;
    document.body.append(layer);
    document.querySelector('.frame')?.setAttribute('inert', '');
    layer.querySelector('a')?.focus();
    if (params.get('state') === 'updating') {
      // Once Poise answers again, the page reloads into the new version.
      setTimeout(() => {
        layer.remove();
        document.querySelector('.frame')?.removeAttribute('inert');
        const u = new URL(location.href); u.searchParams.delete('state'); history.replaceState(null, '', u);
        toast('Updated to autonomio/poise@4b7d1e0. Nothing you were doing was lost.', 'done');
      }, 4200);
    }
  }

  window.PoiseShell = { $, $$, store, params, esc, motion, secs, clock, nowAt, lifeHTML, lifeTo, toast, openMenu, closeMenus };
})();
