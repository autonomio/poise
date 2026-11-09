import Database from 'better-sqlite3'
import { seedMcpChains } from '../../tests/fixtures/mcp-work'

// Runs only inside a disposable test workspace, against its native Poise database.
if (process.env.POISE_WORKSPACE_SKIP_CLI_BOOTSTRAP !== '1' && process.env.POISE_SKIP_CLI_BOOTSTRAP !== '1') throw new Error('MCP fixture requires a disposable workspace')
const db = new Database('/home/poise/.poise/cache.db')
try {
  const owner = process.env.POISE_WORKSPACE_OWNER
  if (!owner) throw new Error('MCP fixture requires its configured owner')
  const setting = db.prepare('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
  setting.run('me', owner); setting.run('agentAccount', 'review-bot')
  db.prepare(`INSERT INTO organizations(login,datastore_path,managed,status,stage,error,activated_at)
    VALUES ('fixtures','/home/poise/mcp-fixture.sqlite',0,'ready','ready',NULL,?)`).run(new Date().toISOString())
  seedMcpChains(db)
} finally { db.close() }
