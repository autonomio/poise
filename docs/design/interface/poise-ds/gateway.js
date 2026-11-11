// The gateway's own pages: the sign-in in front of every workspace, your
// workspace's address, its start and its updates, and signing out. They are
// plain on purpose; everything else lives inside the workspace.
(() => {
  const { $, params, esc, toast } = window.PoiseShell;
  const HOST = 'you.poise.example.com';
  // Only a page of this workspace may be the way back.
  const next = /^[a-z-]+\.html$/.test(params.get('next') || '') ? params.get('next') : null;
  const PAGES = {
    signin: ['Sign in', () => `<p class="gw-label">Welcome</p><h1>Sign in</h1><p>Use your GitHub account to open your Poise workspace.</p>${params.get('out') ? '<p class="gw-note">You are signed out of the gateway and of your workspace in this browser.</p>' : ''}<div class="gw-acts"><a class="btn btn-primary" href="${next ? esc(next) : 'gateway.html?state=home'}" data-ref="gw.signin">Sign in with GitHub</a></div>`],
    home: ['Poise', () => `<p class="gw-label">Your workspace</p><h1>Signed in as mikkokotila</h1><p>Your workspace lives at <code>${HOST}</code>. Devices, sign-ins and everything else are in its Settings.</p><div class="gw-acts"><a class="btn btn-primary" href="overview.html" data-ref="gw.open">Open your workspace</a><a class="btn-ghost" href="gateway.html?state=signout" data-ref="gw.signout">Sign out</a></div>`],
    starting: ['Starting your workspace', () => `<p class="gw-label">Your workspace</p><h1>Starting your workspace…</h1><p>Your Poise at <code>${HOST}</code> is starting. This page reloads by itself when it is ready.</p><span class="spin" aria-hidden="true"></span>${params.get('failed') ? '<p class="gw-error">The last start failed: the workspace image could not be pulled: manifest unknown.</p><p class="gw-note">As an admin you can restart it from <a class="lnk" href="settings.html#admin">People and workspaces</a>.</p>' : ''}`, 'overview.html'],
    updating: ['Updating Poise', () => `<p class="gw-label">Your workspace</p><h1>Updating to the latest version…</h1><p>Your Poise at <code>${HOST}</code> is restarting on its new version. Running agents and reviews carry on. This page reloads by itself in a few seconds.</p><span class="spin" aria-hidden="true"></span>`, 'overview.html'],
    signout: ['Sign out', () => `<h1>Sign out of Poise?</h1><p>This signs you out of the gateway and of your workspace in this browser.</p><div class="gw-acts"><a class="btn btn-primary" href="gateway.html?state=signin&amp;out=1" data-ref="gw.confirm">Sign out</a><a class="btn-ghost" href="gateway.html?state=home">Stay signed in</a></div>`],
    denied: ['Not allowed', () => `<h1>Not allowed here</h1><p>The GitHub account <b class="t-mono">octo-guest</b> is not allowed on this Poise. Ask an admin to add it under Admin → Who may sign in.</p><div class="gw-acts"><a class="btn-ghost" href="gateway.html?state=signin">Use another account</a></div>`]
  };
  const state = PAGES[params.get('state')] ? params.get('state') : 'signin';
  const [title, body, then] = PAGES[state];
  document.title = `${title} · Poise`;
  $('[data-card]').innerHTML = body();
  $('[data-states]').innerHTML = `<span class="t-micro">The gateway’s pages</span>${[['signin', 'Sign in'], ['home', 'Your workspace'], ['starting', 'Starting'], ['updating', 'Updating'], ['signout', 'Sign out'], ['denied', 'Not allowed']].map(([k, l]) => `<a href="gateway.html?state=${k}"${k === state ? ' aria-current="page"' : ''}>${l}</a>`).join('')}`;
  // Starting and updating reload by themselves once the workspace answers.
  if (then) setTimeout(() => { toast('The workspace answers: opening it.', 'done'); setTimeout(() => { location.href = then; }, 900); }, 3600);
})();
