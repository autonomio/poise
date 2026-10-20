import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root: string, previous: string | undefined
let database: typeof import('../server/db'), accounts: typeof import('../server/google/accounts')
const fakeFetch = vi.fn<typeof fetch>()
const origin = 'http://localhost:5173'
function request(cookie = '', givenOrigin = origin) { return { headers: { origin: givenOrigin, cookie } } as IncomingMessage }
function response() { return { setHeader: vi.fn() } as unknown as ServerResponse }
function begin() {
  const res = response(), result = accounts.beginGoogleLogin(request(), res)
  const url = new URL(result.url)
  const cookie = String(vi.mocked(res.setHeader).mock.calls[0][1]).split(';')[0]
  return { url, cookie }
}
const token = () => new Response(JSON.stringify({ access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/drive.file' }))
const identity = (sub = 'account-one', email = 'one@example.com') => new Response(JSON.stringify({ sub, email, email_verified: true }))

beforeEach(async () => {
  vi.resetModules(); root = await mkdtemp(join(tmpdir(), 'google-accounts-')); previous = process.env.POISE_DB; process.env.POISE_DB = join(root, 'cache.db')
  database = await import('../server/db'); accounts = await import('../server/google/accounts')
  accounts.configureGoogle({ clientId: 'poise.apps.googleusercontent.com', clientSecret: 'private-client-secret', origin })
  fakeFetch.mockReset(); vi.stubGlobal('fetch', fakeFetch)
})
afterEach(async () => { vi.unstubAllGlobals(); database.closeDatabase(); if (previous === undefined) delete process.env.POISE_DB; else process.env.POISE_DB = previous; await rm(root, { recursive: true, force: true }) })

describe('Google OAuth browser and account boundaries', () => {
  it('uses offline consent, account selection, PKCE and an HttpOnly browser-bound cookie', () => {
    const res = response(), result = accounts.beginGoogleLogin(request(), res), url = new URL(result.url)
    expect(url.origin).toBe('https://accounts.google.com')
    expect(url.searchParams.get('redirect_uri')).toBe(origin + '/')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('prompt')).toBe('consent select_account')
    expect(String(vi.mocked(res.setHeader).mock.calls[0][1])).toContain('HttpOnly; SameSite=Lax')
    expect(url.searchParams.get('client_secret')).toBeNull()
  })
  it('rejects missing, forged, expired, replayed and other-browser state without exchanging tokens', async () => {
    const { url, cookie } = begin(), state = url.searchParams.get('state')!
    await expect(accounts.completeGoogleLogin(request(), response(), { state, code: 'code' })).rejects.toThrow('another browser')
    await expect(accounts.completeGoogleLogin(request('poise_google=forged'), response(), { state, code: 'code' })).rejects.toThrow('another browser')
    await expect(accounts.completeGoogleLogin(request(cookie), response(), { state: 'forged', code: 'code' })).rejects.toThrow('another browser')
    await expect(accounts.completeGoogleLogin(request(cookie, 'https://other.example'), response(), { state, code: 'code' })).rejects.toThrow('another browser')
    expect(fakeFetch).not.toHaveBeenCalled()
    fakeFetch.mockResolvedValueOnce(token()).mockResolvedValueOnce(identity())
    await accounts.completeGoogleLogin(request(cookie), response(), { state, code: 'code' })
    await expect(accounts.completeGoogleLogin(request(cookie), response(), { state, code: 'code' })).rejects.toThrow('expired')
    const pending = begin(); vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 601_000)
    await expect(accounts.completeGoogleLogin(request(pending.cookie), response(), { state: pending.url.searchParams.get('state'), code: 'code' })).rejects.toThrow('expired')
  })
  it('connects two stable identities without switching the other account and never returns credentials', async () => {
    for (const [sub, email] of [['account-one', 'one@example.com'], ['account-two', 'two@example.com']]) {
      const { url, cookie } = begin(); fakeFetch.mockResolvedValueOnce(token()).mockResolvedValueOnce(identity(sub, email))
      await accounts.completeGoogleLogin(request(cookie), response(), { state: url.searchParams.get('state'), code: 'code' })
    }
    expect(accounts.googleAccounts()).toEqual([{ id: 'account-one', email: 'one@example.com', connected: true }, { id: 'account-two', email: 'two@example.com', connected: true }])
    expect(JSON.stringify(accounts.googleAccountSettings())).not.toMatch(/private-|refreshToken|accessToken|clientSecret/)
    expect(await accounts.googleAccessToken('account-two')).toBe('private-access')
    accounts.disconnectGoogle('account-one')
    await expect(accounts.googleAccessToken('account-one')).rejects.toThrow('Reconnect')
    expect(accounts.googleAccounts()[1].connected).toBe(true)
  })
  it('rejects wrong scopes and unverified identities', async () => {
    let auth = begin()
    fakeFetch.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'private', expires_in: 3600, scope: 'email' })))
    await expect(accounts.completeGoogleLogin(request(auth.cookie), response(), { state: auth.url.searchParams.get('state'), code: 'code' })).rejects.toThrow('not granted')
    auth = begin(); fakeFetch.mockResolvedValueOnce(token()).mockResolvedValueOnce(new Response(JSON.stringify({ sub: 'one', email: 'one@example.com', email_verified: false })))
    await expect(accounts.completeGoogleLogin(request(auth.cookie), response(), { state: auth.url.searchParams.get('state'), code: 'code' })).rejects.toThrow('verified')
    expect(accounts.googleAccounts()).toEqual([])
  })
})
