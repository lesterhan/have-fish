import { Hono } from 'hono'
import type { AppVariables } from '../app'
import { loadCoverageAccounts, todayUtc } from '../coverage/load'
import { sortAccounts, summarize } from '../coverage/catch-up'

const app = new Hono<{ Variables: AppVariables }>()

// GET /api/catch-up
// The whole coach payload: one entry per tracked account plus a summary. Every field the
// account cards, the coverage strips and the bootstrap step need, in one request.
//
// The projection at GET /api/coverage/accounts is the same derivation with the heavy parts
// dropped; see coverage/load.ts for why both go through one loader.
// 200: { today, accounts, summary }
app.get('/', async (c) => {
  const today = todayUtc()
  // Bootstrap proposes an account's existing ledger span as its starting line, so this is the
  // one reader that pays for the unbounded span query.
  const assembled = await loadCoverageAccounts(c.get('userId'), today, { spans: true })
  const ordered = sortAccounts(assembled)

  return c.json({
    today,
    accounts: ordered,
    summary: summarize(ordered),
  })
})

export default app
