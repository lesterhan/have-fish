import { Hono } from 'hono'
import type { AppVariables } from '../app'
import { isCalendarDate } from '../calendar-date'
import { fail } from '../errors'
import { loadJournal } from '../export/export-service'
import { serializeJournal } from '../export/journal'

const app = new Hono<{ Variables: AppVariables }>()

// GET /api/export/journal[?from=YYYY-MM-DD][&to=YYYY-MM-DD]
// The caller's ledger as an hledger `.journal` file (#283). Both bounds are optional and
// inclusive; with neither, it is everything. An empty parameter counts as absent, which is
// what a cleared date input sends.
app.get('/journal', async (c) => {
  const userId = c.get('userId')
  const from = c.req.query('from') || undefined
  const to = c.req.query('to') || undefined
  if (from !== undefined && !isCalendarDate(from)) {
    return fail(c, 'FIELD_NOT_DATE', { field: 'from' })
  }
  if (to !== undefined && !isCalendarDate(to)) return fail(c, 'FIELD_NOT_DATE', { field: 'to' })
  if (from !== undefined && to !== undefined && from > to) {
    return fail(c, 'RANGE_OUT_OF_ORDER', { from: 'from', to: 'to' })
  }

  // Built whole rather than streamed: a large personal ledger is a few megabytes, and a
  // failure halfway would otherwise arrive as a truncated file with a 200.
  const journal = serializeJournal(await loadJournal(userId, { from, to }))
  return c.body(journal, 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Disposition': 'attachment; filename="have-fish.journal"',
    // The whole ledger: no shared cache or browser cache should keep a copy.
    'Cache-Control': 'no-store',
  })
})

export default app
