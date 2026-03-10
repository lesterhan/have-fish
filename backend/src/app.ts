import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import accountsRoute from './routes/accounts'
import transactionsRoute from './routes/transactions'

export const app = new Hono()

app.use('*', cors())
app.use('*', logger())

app.get('/health', (c) => c.json({ status: 'ok' }))

app.route('/api/accounts', accountsRoute)
app.route('/api/transactions', transactionsRoute)
