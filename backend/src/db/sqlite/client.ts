// The SQLite client: the local build's half of `#dialect` (see `db/index.ts`), on libsql (D8,
// #286). The database is one file, named by SQLITE_PATH.

import { AsyncLocalStorage } from 'node:async_hooks'
import { createClient, type InArgs, type InStatement } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema'

// Typed as either, so shared code can ask which one it is running on.
export const dialect: 'pg' | 'sqlite' = 'sqlite'

const path = process.env.SQLITE_PATH
if (!path) throw new Error('SQLITE_PATH is not set; it names the SQLite database file')

const client = createClient({ url: `file:${path}` })
// Readers never wait on the writer, and a write is one append. The mode is stored in the file,
// so this is a no-op after the first run.
await client.execute('PRAGMA journal_mode = WAL')

// SQLite has one writer at a time, and every connection here lives on this one thread. A
// transaction holds the write lock across its awaits (libsql begins it IMMEDIATE), so a second
// transaction or a plain write that arrives meanwhile cannot wait for it: a busy timeout would
// block the only thread that could let the first one finish. It fails with SQLITE_BUSY
// instead (#285). So writes take turns here, in-process, before they reach SQLite.
let tail: Promise<unknown> = Promise.resolve()
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const turn = tail.then(work)
  tail = turn.catch(() => undefined)
  return turn
}

// Set for everything a transaction's callback runs. A write through `db` from in there would
// wait for its own transaction to end, forever; say so instead.
const insideTransaction = new AsyncLocalStorage<true>()
function refuseInsideTransaction(what: string) {
  if (insideTransaction.getStore()) {
    throw new Error(`${what} inside a transaction would wait for it forever; use its \`tx\``)
  }
}

// Drizzle runs every statement outside a transaction through `client.execute` (and a batch
// through `client.batch`), so the turn is taken there. A read goes straight through: WAL lets
// it run beside an open transaction, and making it wait would serialise the whole app.
const execute = client.execute.bind(client)
client.execute = (statement: InStatement, args?: InArgs) => {
  const run = () => (typeof statement === 'string' ? execute(statement, args) : execute(statement))
  const text = typeof statement === 'string' ? statement : statement.sql
  if (/^\s*select\b/i.test(text)) return run()
  refuseInsideTransaction('A write through `db`')
  return inTurn(run)
}
const batch = client.batch.bind(client)
client.batch = (statements, mode?) => {
  refuseInsideTransaction('A batch through `db`')
  return inTurn(() => batch(statements, mode))
}

export const db = drizzle(client, { schema })

// Better Auth opens its transactions through this same object, so they take turns too.
const transaction = db.transaction.bind(db)
db.transaction = (work, config?) => {
  refuseInsideTransaction('`db.transaction`')
  return inTurn(() => insideTransaction.run(true, () => transaction(work, config)))
}

/** Postgres locks the rows it reads; here the transaction already holds the only write lock. */
export function forUpdate<Query>(query: Query): Query {
  return query
}
