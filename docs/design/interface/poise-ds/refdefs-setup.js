// First-run setup's vocabulary. Same rules as refdefs.js.
Object.assign(window.POISE_REF, {
  'ob.dialog': { name: 'Setup', kind: 'Place', what: 'What a new workspace needs, in the order it needs it: how Poise looks, GitHub, the agent account, organizations, time, AI accounts, models, and this computer.', does: 'Each step checks its connection works before the next opens. Setup opens where you left it.', unchanged: 'Everything set here is in Settings afterwards, where it can be changed.' },
  'ob.rail': { name: 'Steps', kind: 'Display', what: 'Eight steps; done ones are filled, the current one is marked.' },
  'ob.count': { name: 'Step', kind: 'Display', what: 'Which step this is, of eight.' },
  'ob.later': { name: 'Finish later', kind: 'Action', what: 'Leaves setup for now. It opens again where you left it.', unchanged: 'What you already set, which is saved.' },
  'ob.back': { name: 'Back', kind: 'Action', what: 'Returns to the step before, as you left it.' },
  'ob.skip': { name: 'Skip for now', kind: 'Action', what: 'Goes on without this step. Only the agent account and this computer can wait.', unavailable: 'Once the step is done there is nothing to skip.' },
  'ob.next': { name: 'Continue', kind: 'Action', what: 'Goes to the next step once this one is ready. On the last, Open Poise.', unavailable: 'Until this step’s connection works.' },
  'ob.github': { name: 'Your GitHub account', kind: 'Setting', what: 'The account you signed in with. Poise reads GitHub as it, through gh in your workspace.', shows: 'The one-time code, then Waiting for you to approve at GitHub, then Connected once GitHub confirms it works.' },
  'ob.code': { name: 'One-time code', kind: 'Action', what: 'GitHub’s device sign-in: copy the code, approve at github.com/login/device.' },
  'ob.agent': { name: 'Agent account', kind: 'Setting', what: 'A separate GitHub account, such as a bot, that posts reviews, approvals and comments.', unavailable: 'It cannot be your own account.' },
  'ob.orgs': { name: 'Organizations', kind: 'Setting', what: 'The organizations and personal accounts whose work Poise follows.', shows: 'Each activates in steps, then says Ready.', when: 'It keeps activating in the background if you go on.' },
  'ob.time': { name: 'Time zone and refresh rate', kind: 'Setting', what: 'How Poise tells time, and how often it reads fresh data.' },
  'ob.ai': { name: 'AI accounts', kind: 'Setting', what: 'The agents you use. Each signs in with its own login, in a terminal here; Poise never reads what it keeps.', values: [['Signed in here', 'Ready to run.'], ['Not signed in', 'Sign in now, or later in Accounts.'], ['Sign-in not reported', 'The agent cannot say; tell Poise whether it finished.']] },
  'ob.terminal': { name: 'Terminal', kind: 'Display', what: 'The agent’s own login, running in your workspace.' },
  'ob.models': { name: 'Models', kind: 'Setting', what: 'The three models, chosen once as Primary, Secondary and Tertiary, and which slot each place runs, or Random.', does: 'A model that fails before its verdict hands the run to a slot it has not tried yet.', unavailable: 'Models whose provider is not signed in are dimmed. The three slots must be different models.' },
  'ob.link': { name: 'This computer', kind: 'Setting', what: 'Pairs Poise Link, which keeps your snippets on your computer and brings Poise’s alerts to it.' },
  'ob.finish': { name: 'Summary', kind: 'Display', what: 'What setup set, and what waits.' }
});
