// Editor's vocabulary: documents, comments, reviews and publications.
// Same rules as refdefs.js: one entry per element, read by the tooltip, the
// full reference and the element review alike.
Object.assign(window.POISE_REF, {
  /* ---------- The document and its actions ---------- */
  'ed.doc': {
    name: 'Document', kind: 'Control', what: 'The document you are writing. Opens every other one, grouped by when you last changed them.',
    now: (el) => `${el.textContent.replace(/\s+/g, ' ').replace('▾', '').trim()}.`,
    values: [['Today, Yesterday, This week, This month, Earlier', 'Groups by last change, newest first; the open document is marked.']],
    source: 'Your documents in Poise, saved as Markdown on this machine.'
  },
  'ed.group.document': { name: 'Document', kind: 'Group', what: 'Actions on the document as a whole.' },
  'ed.group.write': { name: 'Write', kind: 'Group', what: 'How the page looks while you write. Changes what you see, never the document.' },
  'ed.group.ask': { name: 'Ask', kind: 'Group', what: 'Talk with an agent about this document.' },
  'ed.group.share': { name: 'Share', kind: 'Group', what: 'Where this document goes: your sites and Google Docs.' },
  'ed.new': { name: 'New document', kind: 'Action', what: 'Starts a new, empty document. Shortcut ⌘N.', when: 'Immediately; it is saved as soon as you type.', shows: 'It opens under Today in the document list.', unchanged: 'The document you leave, saved first.' },
  'ed.copy': { name: 'Copy document', kind: 'Action', what: 'Copies the whole document as Markdown.', shows: 'Feedback says how many words were copied.', unchanged: 'The document.' },
  'ed.delete': { name: 'Delete document', kind: 'Action', what: 'Removes this document from Poise.', when: 'After you confirm with “Sure?” within three seconds.', unchanged: 'Published versions on your sites and in Google Docs, and issues created from it.', shows: 'The next document opens.' },
  'ed.writer': {
    name: 'Writer mode', kind: 'Display preference', what: 'Hides everything but the page.',
    now: (el) => (el.closest('[aria-pressed]')?.getAttribute('aria-pressed') === 'true' ? 'On.' : 'Off.'),
    does: 'Esc, or the button in the corner, brings everything back.', scope: 'This browser.', when: 'Immediately.', unchanged: 'The document and everything in it.'
  },
  'ed.ask-pane': { name: 'Chat beside', kind: 'Action', what: 'Opens a conversation about this document in the side pane.', unchanged: 'The document. The agent changes it only through suggested edits you apply.' },
  'ed.ask-chat': { name: 'Open in Chat', kind: 'Action', what: 'Starts a chat in Chat with this document as the draft.', shows: 'Chat opens with the draft; Back to Editor returns you to this place in the document.', unchanged: 'Nothing is sent until you send it.' },
  'ed.publish': { name: 'Publish', kind: 'Action', what: 'Opens Publish in the side pane: your sites and Google Docs.' },
  'ed.away': { name: 'Not in this mock', kind: 'Display', what: 'This mock opens HELIOS in full. Other documents open here in Poise, at the place you left them.' },

  /* ---------- Status line: the document at a glance ---------- */
  'ed.status': { name: 'Status', kind: 'Display', what: 'This document at a glance: whether it is saved, how long it is, its comments and reviews, and where it is published.', does: 'Each part opens its place in the side pane.' },
  'ed.save': {
    name: 'Save state', kind: 'Display', what: 'Whether everything you typed is saved.', now: (el) => `${el.textContent.trim()}.`,
    values: [['Saving…', 'Typed moments ago; being written.'], ['Saved · time', 'Everything on the page is saved.'], ['Not saved', 'Saving failed; Poise keeps retrying and keeps your text on the page. Publishing waits for it.'], ['Conflict: reload', 'The document changed somewhere else since this page read it, so this save was refused. Reload to read the latest. Publishing waits for it.']],
    when: 'A moment after you stop typing, and at once with ⌘S.', source: 'Poise’s copy of the document on this machine.'
  },
  'ed.words': { name: 'Words', kind: 'Display', what: 'How long the document is, without Markdown markers.', now: (el) => `${el.textContent.trim()}.` },
  'ed.comments': { name: 'Comments', kind: 'Display', what: 'Your comments and the agent’s replies on passages of this document.', now: (el) => `${el.textContent.trim()}.`, does: 'Opens Comments.' },
  'ed.reviews': { name: 'Reviews', kind: 'Display', what: 'Review comments from your sites’ pull requests and from Google Docs.', now: (el) => `${el.textContent.trim()}.`, does: 'Opens Reviews.' },
  'ed.published': { name: 'Published', kind: 'Display', what: 'Where this document is published, and the state of each place in the seven state words.', now: (el) => `${el.textContent.trim()}.`, does: 'Opens Publish.' },
  'ed.held': { name: 'New review comments', kind: 'Display', what: 'Review comments that arrived while you were writing.', does: 'Shown when you open Reviews, so neither the text nor the pane moves while you write.', now: (el) => el.textContent.trim() },

  /* ---------- Writing ---------- */
  'ed.page': {
    name: 'The page', kind: 'Control', what: 'Where you write. Markdown is drawn as you type; its markers show only on the line you are on.',
    does: '⌘B bold · ⌘Z undo · ⌘⇧Z redo · ⌘S save now · ⌘N new document. Select text for comments, an agent, an issue or a snippet.',
    source: 'Saved as plain Markdown.'
  },
  'ed.selbar': { name: 'Selection actions', kind: 'Display', what: 'What you can do with the text you selected.' },
  'ed.sel.comment': { name: 'Comment', kind: 'Action', what: 'Adds a comment on the selected passage.', shows: 'The passage is underlined, and the comment opens in Comments.', unchanged: 'The text.' },
  'ed.sel.ask': { name: 'Ask an agent', kind: 'Action', what: 'Asks an agent about the selected passage.', shows: 'Accepted, then Executing while it reads, then its reply in Comments, with a suggested edit when it has one.', unchanged: 'The text, until you apply an edit.' },
  'ed.sel.issue': { name: 'Create issue', kind: 'Action', what: 'Opens a new GitHub issue with the passage as its body.', when: 'When you choose Open issue.', shows: 'Accepted, then Opened with its number. It appears on Board.' },
  'ed.sel.snippet': { name: 'Save as snippet', kind: 'Action', what: 'Saves the passage as a snippet you can insert anywhere.', shows: 'Saved, and listed in Settings → Snippets.', unchanged: 'The text.' },
  'ed.mark': {
    name: 'Commented passage', kind: 'Display', what: 'A passage with a comment or a review comment on it.', does: 'Click it to open its comment.',
    values: [['Grey underline', 'Your comment or an agent’s reply.'], ['Amber underline', 'A review comment that needs you.']]
  },

  /* ---------- The side pane ---------- */
  'ed.tab.comments': { name: 'Comments', kind: 'Tab', what: 'Your comments on passages, and the agent’s replies, in the order of the text.' },
  'ed.tab.reviews': { name: 'Reviews', kind: 'Tab', what: 'Review comments from your sites’ pull requests and from Google Docs, needs-you first.' },
  'ed.tab.publish': { name: 'Publish', kind: 'Tab', what: 'Where this document goes: your sites, and Google Docs.' },
  'ed.tab.chat': { name: 'Chat', kind: 'Tab', what: 'A conversation with an agent about this document.' },
  'ed.comment': { name: 'Comment', kind: 'Card', what: 'Your note on a passage, with any agent replies.', does: 'Show the passage, ask the agent, or delete the comment.' },
  'ed.comment.ask': { name: 'Ask the agent', kind: 'Action', what: 'Asks an agent about this passage and your comment.', shows: 'Accepted, Executing while it reads, then its reply here.', unchanged: 'The text, until you apply an edit.' },
  'ed.comment.delete': { name: 'Delete comment', kind: 'Action', what: 'Removes this comment and its replies.', when: 'After you confirm with “Sure?” within three seconds.', unchanged: 'The text.' },
  'ed.passage': { name: 'Passage', kind: 'Action', what: 'The words this comment is about.', does: 'Shows them in the text, without moving your caret.', values: [['Quoted', 'Found in the text.'], ['Passage changed', 'The words are no longer in the document; the comment is kept.']] },
  'ed.suggest': {
    name: 'Suggested edit', kind: 'Card', what: 'An agent’s proposed change to a passage.', does: 'Show it in the text first; Apply makes the change.',
    when: 'On Apply.', shows: 'Accepted, then Completed · applied; or Failed when the passage changed since.', unchanged: 'Everything else in the document. Undo takes it back.'
  },
  'ed.review': {
    name: 'Review comment', kind: 'Card', what: 'A comment from a site’s pull request review or from Google Docs, anchored to its passage when it can be.',
    now: (el) => el.querySelector('.st')?.textContent.trim() || '',
    values: [['Needs you', 'Unresolved, or document feedback waiting for your answer.'], ['Needs you · passage changed', 'Its words are no longer in the document; the comment is kept here.'], ['Done', 'Resolved.']],
    source: 'The site’s pull request on GitHub, or the Google Doc.'
  },
  'ed.review.reply': { name: 'Reply on GitHub', kind: 'Action', what: 'Posts your reply in the review thread, as you.', when: 'When you choose Reply.', shows: 'Your reply appears under the comment, then on GitHub.' },
  'ed.review.resolve': { name: 'Resolve thread', kind: 'Action', what: 'Marks the review thread resolved on GitHub.', shows: 'The comment becomes Done.', unchanged: 'The document.' },
  'ed.review.ask': { name: 'Ask an agent privately', kind: 'Action', what: 'Asks an agent about this review comment. Nothing is posted.', shows: 'Its reply appears in Comments; on a pull request’s comment, with a Suggested GitHub reply and Use as reply, which only fills your reply.' },
  'ed.review.refresh': { name: 'Refresh reviews', kind: 'Action', what: 'Checks your sites and Google Docs for review comments now.', now: (el) => el.closest('.pane-sec')?.querySelector('[data-checked]')?.textContent || '', source: 'Checked on the shared refresh tick, and whenever you ask.' },
  'ed.site': { name: 'Site', kind: 'Control', what: 'A site from Settings → Publishing. Choose it to publish there.', now: (el) => (el.querySelector('input')?.checked ? 'Chosen.' : 'Not chosen.') },
  'ed.field': { name: 'Publishing field', kind: 'Control', what: 'Title, description and date are set once, for every chosen site; each site has its own slug.', when: 'When you publish.' },
  'ed.publish.go': {
    name: 'Publish', kind: 'Action', what: 'Opens a pull request with this document on each chosen site. Once published, it updates them.',
    shows: 'Accepted, then Executing per site, then Completed with each pull request; then the pull request’s own state.', unchanged: 'Your draft. Publishing again updates the same pull requests.',
    unavailable: 'Choose at least one site.'
  },
  'ed.pub': {
    name: 'Publication', kind: 'Display', what: 'This document on one site: its pull request and its state.',
    now: (el) => el.textContent.replace(/\s+/g, ' ').trim(),
    values: [['Waiting', 'Checks are running on the pull request.'], ['Needs you', 'Ready to merge: merging makes it live.'], ['Done', 'Merged: live on the site.'], ['Failed', 'Publishing failed; nothing changed on the site.'], ['Blocked', 'The site changed under you; Replace with mine settles it.']],
    source: 'The site’s pull request on GitHub.'
  },
  'ed.google': {
    name: 'Google Docs', kind: 'Display', what: 'This document as a Google Doc.',
    now: (el) => el.querySelector('[data-google-state]')?.textContent || '',
    values: [['Matches', 'The Google Doc is the same as your draft.'], ['Your draft changed', 'Update Google document to bring it level.'], ['Google’s copy changed', 'Review Google’s changes before publishing.'], ['Not yet on Google', 'Choose a Google account and Publish to Google; the same document receives future updates.'], ['Connect Google', 'No account is connected: add one in Settings → Accounts.'], ['Account no longer connected', 'Reconnect it, or choose an account explicitly.'], ['Unavailable', 'This Poise has no Google set up: ask its operator.'], ['Status unavailable', 'Google could not be read. Refresh Google tries again.']],
    source: 'Your connected Google account.'
  },
  'ed.google.review': { name: 'Review Google’s changes', kind: 'Action', what: 'Compares the Google Doc with your draft.', does: 'Import Google’s version, publish yours instead, or keep your draft.', unchanged: 'Your other sites, until you publish.' },
  'ed.chat': { name: 'Chat beside', kind: 'Display', what: 'A conversation with an agent about this document, beside it. Each document keeps its own.', does: 'Enter sends. The agent reads the document as it is now, or only your selection, and suggests edits; it never changes the text itself.', source: 'Saved with the document in Poise.' },
  'ed.chat.agent': {
    name: 'Agent and model', kind: 'Setting', what: 'Who answers in Chat beside.',
    now: (el) => `${el.value}.`,
    scope: 'Chat beside in every document, in this browser.', when: 'From your next message. A reply being written finishes with the agent that started it.', unchanged: 'Earlier replies, and your default agent for new chats.'
  },
  'ed.chat.reads': {
    name: 'Reads', kind: 'Display', what: 'What the agent reads when you send: the whole document as it is now, or only your selection.',
    now: (el) => el.textContent.replace(/×/g, '').replace(/\s+/g, ' ').replace(/^Reads\s*/, '').trim() + '.',
    does: 'Select text in the document to ask about just that; × leaves the selection out.', unchanged: 'The selection in the document.'
  },
  'ed.chat.start': { name: 'Starting point', kind: 'Action', what: 'Sends this as your first message.', shows: 'Your message with its progress, then the reply, with a suggested edit when one fits.', unchanged: 'The document.' },
  'ed.chat.in': { name: 'Message', kind: 'Control', what: 'Your message to the agent about this document.', does: 'Enter sends; Shift+Enter starts a new line.', unchanged: 'What you type is kept while you switch tabs.' },
  'ed.chat.stop': { name: 'Stop', kind: 'Action', what: 'Stops the reply being written.', shows: 'Your message shows Completed · stopped by you, and nothing more is written.', unchanged: 'The document, and earlier replies.' },
  'ed.import': { name: 'Import', kind: 'Action', what: 'Opens a Markdown or text file as a new document, word for word: only line endings change.', unavailable: () => 'A file over 5 MiB, or one that does not read as UTF-8 text, is refused, saying which; the open document is untouched.', shows: 'The new document, saved as it opens.' },
  'ed.inline': { name: 'Thread', kind: 'Display', what: 'The comment or review on this passage, under it on the page, with its replies.', does: 'Reply, ask an agent or resolve opens it in the side pane, where every action is. Esc closes it.' },
  'ed.docrow': { name: 'Document', kind: 'Action', what: 'Opens this document. The one open now is marked.', now: (el) => `${el.querySelector('.t')?.textContent || ''}, last changed ${el.querySelector('time')?.textContent || ''}.` }
});
