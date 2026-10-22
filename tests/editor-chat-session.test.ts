import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type EditorModule = typeof import('../server/editor')

let editor: EditorModule
let editorDir: string
let previousEditorDir: string | undefined

beforeAll(async () => {
  editorDir = await mkdtemp(join(tmpdir(), 'poise-editor-chat-session-test-'))
  previousEditorDir = process.env.POISE_EDITOR_DIR
  process.env.POISE_EDITOR_DIR = editorDir
  editor = await import('../server/editor')
})

afterAll(async () => {
  if (previousEditorDir === undefined) delete process.env.POISE_EDITOR_DIR
  else process.env.POISE_EDITOR_DIR = previousEditorDir
  await rm(editorDir, { recursive: true, force: true })
})

// server/chat.ts attaches the voice guide, the document's current body and the
// edit-proposal contract to a chat *only* when slugFromEditorSession matches.
// Annotation chats used to carry their own `ann-xxxxxxxx` id, which never
// matches, so "Ask the agent about this passage" reached the agent as nothing
// but the snippet in quotes — asked what a passage said, it answered "The
// working directory is empty."
//
// The editor now mints annotation sessions in this format, so these cases pin
// the contract the client depends on.
describe('editor chat session identity', () => {
  it('accepts the format the editor mints, including the uniqueness digits', () => {
    // `${Date.now()}${3 random digits}` — all digits, as the lookup requires.
    expect(editor.slugFromEditorSession('editor-untitled-20260722112438933-1769500000000042'))
      .toBe('untitled-20260722112438933')
  })

  it('extracts slugs that themselves contain dashes', () => {
    const slug = 'untitled-20260722112438933-7ad2fea8-8827-42db-8799-dae466b6e4ac'
    expect(editor.slugFromEditorSession(`editor-${slug}-1769500000000`)).toBe(slug)
  })

  it('rejects the old annotation-scoped ids that carried no document', () => {
    expect(editor.slugFromEditorSession('ann-qncjuig3')).toBeNull()
    expect(editor.slugFromEditorSession('ann-4f2a9c1b')).toBeNull()
  })

  it('rejects ids whose tail is not purely numeric', () => {
    expect(editor.slugFromEditorSession('editor-some-slug-12a4')).toBeNull()
    expect(editor.slugFromEditorSession('editor-some-slug-')).toBeNull()
  })

  it('rejects unrelated session ids', () => {
    expect(editor.slugFromEditorSession('')).toBeNull()
    expect(editor.slugFromEditorSession('card-123')).toBeNull()
  })

  it("reads a document's legacy chat id without minting one", async () => {
    expect(await editor.peekChatSession('untouched')).toBeNull()
    expect(existsSync(join(editorDir, 'untouched.chat.json'))).toBe(false)
    await writeFile(join(editorDir, 'brief.chat.json'), JSON.stringify({ session_id: 'editor-brief-1769500000000', created_at: '2026-10-20T10:00:00.000Z' }))
    expect(await editor.peekChatSession('brief')).toBe('editor-brief-1769500000000')
    await writeFile(join(editorDir, 'broken.chat.json'), '{oops')
    expect(await editor.peekChatSession('broken')).toBeNull()
    await writeFile(join(editorDir, 'empty.chat.json'), JSON.stringify({ session_id: '', created_at: '2026-10-20T10:00:00.000Z' }))
    expect(await editor.peekChatSession('empty')).toBeNull()
  })
})
