# Google Markdown compatibility proof

Live provider checks performed on 2026-10-20 using a private disposable file,
through the connected Google Drive API and the Google Docs web editor. This
is a compatibility sample, not proof of every Google API guarantee.

| Check | Observed result |
| --- | --- |
| Upload `text/markdown`, read it, replace its raw bytes | Same Drive file ID; exact content readback |
| Add two quoted Drive API comments, then update the file | Drive comments survive; neither has a native text anchor |
| Add a native text-anchored comment in Docs | Raw `.md` acquires begin/end markers and a trailing `gdoc_comments` block |
| Read Drive comments after adding the native comment | Native comment absent; only the two Drive API comments returned |
| Read the Markdown file with Docs API `documents.get` | Content and revision ID returned |
| Update it with Docs API `documents.batchUpdate` | HTTP 400 `FAILED_PRECONDITION`: document must not be an Office file |
| Preserve native markers/block, change another paragraph and insert text before the anchor, then update raw file | Reopened Docs retains the anchored comment; exact 912-byte raw readback |
| Replace with plain Markdown containing the same quoted passage | Native thread becomes inactive, labelled “Original content deleted” |
| Add a native reply, then resolve the thread | Raw metadata retains reply text and a bodyless `action: RESOLVE` event; root status becomes `RESOLVED`; markers remain |

The recorded provider shape, with identity and token redacted:

```markdown
<!-- gdoc_comment_begin: c1 -->The silver owl circles the<!-- gdoc_comment_end: c1 --> old tower.

---
gdoc_comments:
  c1:
    status: RESOLVED
    token: REDACTED
    head:
      author: Reviewer
      body: Native Google Docs proof comment.
      quote: ''
    replies:
    - author: Reviewer
      body: Disposable Poise proof reply.
    - author: Reviewer
      action: RESOLVE
---
```

Regression fixtures in `tests/google-markdown.test.ts` use this observed shape
with redacted identity/token fields. Opaque metadata is preserved verbatim;
Poise exposes only safe comment text and locations to the browser. Unknown or
broken structures stop publication. Editing a commented passage or losing its
unambiguous identity also stops publication.

## Remaining provider proof

The initial proof did **not** test HTTP conditional-write enforcement, actual
Poise OAuth through the service gateway, or two real Google identities. Mocked
HTTP and browser tests establish client behavior, not Google's enforcement.

Before release, use an authorized Google OAuth client to read a validator,
modify that same file through another client, attempt a stale conditional raw
upload, and verify rejection with the newer bytes/comments unchanged. The
implementation refuses absent, weak or unusable validators. If Drive ignores
the conditional header, the current update design must change; a pre-write
read is not an atomic concurrency guarantee. This remains a release blocker
tracked in [#258](https://github.com/autonomio/poise/issues/258).

Google documents the underlying file-format capability in
[View and edit Markdown files in Google Docs](https://support.google.com/docs/answer/18289341?hl=en).
