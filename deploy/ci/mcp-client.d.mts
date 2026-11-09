import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
export function connectPoise(endpoint: string, login: string, fetcher?: typeof fetch): Promise<{ client: Client; tokens: OAuthTokens; provider: OAuthClientProvider }>
export function tool(client: Client, name: string, args?: Record<string, unknown>): Promise<Record<string, unknown>>
