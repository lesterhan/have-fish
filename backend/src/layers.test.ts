/**
 * Keeps the backend's three layers apart (`ARCHITECTURE.md`, the domain-layer epic #423).
 *
 * - A **route** parses the request, reads `userId`, calls a service and answers.
 * - A **service** (`*-service.ts`) loads what a rule needs, runs it, and writes. It is the
 *   only kind of file that touches the database.
 * - A **domain module** is a pure rule: does this balance, what legs does this row make, how
 *   does this split. It can run with no server around it: on a phone against its own SQLite
 *   file, or on a document that just arrived from the sync relay. So it may not reach the
 *   database client, the schema, Drizzle or Hono, not even for a type.
 *
 * Every source file gets a layer from its name, and anything no rule below names is domain.
 * A new file is held to the strictest rule the day it lands, and the way out is a name that
 * says what it does. The two other kinds of file:
 *
 * - `*-sql.ts` builds query fragments for services. It needs the schema to name columns, but
 *   runs no query, so it doesn't import the database client either, and only services import it.
 * - Infrastructure is the handful of files named below: the server, auth, logging, request
 *   parsing, the database client itself, and the one outbound fetch.
 *
 * Imports are read with TypeScript's own scanner (`preProcessFile`), which sees type-only
 * imports and re-exports and ignores comments, so neither a stray `from '…'` in a comment
 * nor an `import type` changes the answer.
 *
 * Modelled on `routes/bodies.test.ts` and `ledger/writers.test.ts`, which read sources for the
 * same reason.
 */

import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import ts from 'typescript'

const SRC = import.meta.dir

type Layer = 'route' | 'service' | 'sql' | 'infrastructure' | 'domain'

/** Files that are none of the three layers, and why. Paths are relative to `src/`. */
const INFRASTRUCTURE: Record<string, string> = {
  'index.ts': 'the Bun entry point',
  'server.ts': 'the API, the built frontend and the SPA fallback on one server',
  'app.ts': "the server build's app, which the test suite imports",
  'build-app.ts': 'the request logger, the session guard and the route mounts, for either edge',
  'server-edge.ts': "the server build's edge: CORS, Better Auth and Fish Pie",
  'local/edge.ts': "the local build's edge: the Host and Origin check and the launch-token session",
  'local/launch.ts': 'starting the local build: lock, data directory, port and browser',
  'local/launch-token.ts': 'signing and redeeming the single-use launch link',
  'local/lockfile.ts': 'one running local instance per data directory',
  'local/holder.ts': 'asking the instance the lockfile names, on 127.0.0.1, whether it is there',
  'local/data-dir.ts': 'where the local build keeps its data, and who may read it',
  'local/desktop-entry.ts': 'the menu entry and icon the binary installs for its owner',
  'local/log-file.ts': "the local build's log file, rotated and the owner's alone",
  'local/embed.ts': "the compiled binary's generated entry point: its files and migrations",
  'test-network-off.ts': 'the test run, which switches the network off',
  'auth.ts': 'Better Auth, which owns its own tables',
  'logging.ts': 'the structured logger',
  'request-log.ts': 'the one line per request',
  'validation.ts': 'parsing a request body against its schema',
  'respond.ts': 'answering a request with a failure',
  'test-utils.ts': 'the test harness, which empties every table',
  'db/index.ts': 'the database client',
  'db/schema.ts': 'the schema',
  'db/pg/client.ts': "the database client, the server build's dialect",
  'db/pg/schema.ts': "the schema, the server build's dialect",
  'db/sqlite/client.ts': "the database client, the local build's dialect",
  'db/sqlite/schema.ts': "the schema, the local build's dialect",
  'db/sqlite/test-preload.ts': 'the SQLite test run, which makes and migrates a database file',
  'db/sqlite/migrate.ts': 'bringing a SQLite database file up to the current schema',
  'db/sqlite/files.ts': 'copying a SQLite ledger file and checking one before it is opened',
  'db/returning.ts': "reading a statement's returned row",
  'db/unique-violation.ts': 'recognising a unique index refusing a row, on either driver',
  'fx/rate-source.ts': 'the one outbound fetch, so it has one function to stub',
}

/**
 * The route files that leave this repository for the Fish Pie service under #380. They still
 * query and open database transactions themselves: #430 took only their maths, because their
 * orchestration would otherwise be ported twice. The same list as `routes/bodies.test.ts`.
 * Deleting a name here is how a route rejoins the rule, and the test fails if a name no longer
 * matches a file or no longer needs the exemption, so the list can only shrink.
 */
const LEAVING_WITH_FISH_PIE = [
  'routes/fish-pie-balances.ts',
  'routes/fish-pie-categories.ts',
  'routes/fish-pie-expenses.ts',
  'routes/fish-pie-groups.ts',
  'routes/fish-pie-invites.ts',
  'routes/fish-pie-merge.ts',
  'routes/fish-pie-overview.ts',
  'routes/fish-pie-settlements.ts',
]

/**
 * The packages a domain module may import: an allowlist, so a new one is a decision made in a
 * diff rather than a dependency found later on a phone.
 */
const DOMAIN_PACKAGES: Record<string, string> = {
  papaparse: 'CSV parsing, plain JavaScript',
  '@noble/hashes': 'the import fingerprint hashes, pure JavaScript and synchronous (#474)',
}

const DB_CLIENT = 'db/index.ts'
const SCHEMA = 'db/schema.ts'
const STORAGE_PACKAGES = ['drizzle-orm', 'postgres', '@libsql/client', '#dialect']

function layerOf(file: string): Layer {
  if (file.startsWith('routes/')) return 'route'
  if (file.endsWith('-service.ts')) return 'service'
  if (file.endsWith('-sql.ts')) return 'sql'
  if (file in INFRASTRUCTURE) return 'infrastructure'
  return 'domain'
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [relative(SRC, path)] : []
  })
}

/** A relative import as the file it names under `src/`; a package import as its name. */
function resolve(from: string, spec: string): string {
  if (!spec.startsWith('.')) return spec
  const base = join(dirname(from), spec)
  for (const candidate of [`${base}.ts`, join(base, 'index.ts'), base]) {
    if (existsSync(join(SRC, candidate)) && statSync(join(SRC, candidate)).isFile()) {
      return candidate
    }
  }
  return base
}

type Edge = { file: string; imports: string }

const FILES = sourceFiles(SRC).sort()
const SOURCE = new Map(FILES.map((f) => [f, readFileSync(join(SRC, f), 'utf8')]))
const EDGES: Edge[] = FILES.flatMap((file) =>
  ts
    .preProcessFile(SOURCE.get(file) ?? '', true, true)
    .importedFiles.map((i) => ({ file, imports: resolve(file, i.fileName) })),
)

const isPackage = (target: string, name: string) => target === name || target.startsWith(`${name}/`)
/** `@noble/hashes/sha2.js` is the package `@noble/hashes`; `papaparse` is itself. */
const packageOf = (spec: string) =>
  spec
    .split('/')
    .slice(0, spec.startsWith('@') ? 2 : 1)
    .join('/')
const inLayer = (layer: Layer) => (e: Edge) => layerOf(e.file) === layer
const leaving = (file: string) => LEAVING_WITH_FISH_PIE.includes(file)
const shown = (e: Edge) => `${e.file} → ${e.imports}`

// `db.transaction(` and `inLedgerTransaction(`: both open a database transaction, and a route
// that opens one is doing a service's job.
const OPENS_TRANSACTION = /(\.transaction|\binLedgerTransaction)\s*\(/
const touchesStorage = (e: Edge) =>
  e.imports === DB_CLIENT ||
  e.imports === SCHEMA ||
  STORAGE_PACKAGES.some((p) => isPackage(e.imports, p))

describe('a domain module', () => {
  const domain = EDGES.filter(inLayer('domain'))

  // Checked one import at a time, which is enough for the whole graph: a domain module may
  // import only other domain modules, so everything it reaches is domain too.
  it('imports only other domain modules', () => {
    const outside = domain.filter((e) => SOURCE.has(e.imports) && layerOf(e.imports) !== 'domain')
    expect(outside.map(shown)).toEqual([])
  })

  it('imports no package outside the allowlist, so never Hono, Drizzle or the schema', () => {
    const packages = domain.filter((e) => !SOURCE.has(e.imports))
    const refused = packages.filter((e) => !(packageOf(e.imports) in DOMAIN_PACKAGES))
    expect(refused.map(shown)).toEqual([])
  })

  it('makes no network call', () => {
    const fetching = FILES.filter(
      (f) => layerOf(f) === 'domain' && /\bfetch\s*\(/.test(SOURCE.get(f) ?? ''),
    )
    expect(fetching).toEqual([])
  })

  it('is most of the backend, so the rules above are not vacuous', () => {
    const modules = FILES.filter((f) => layerOf(f) === 'domain')
    expect(modules).toEqual(
      expect.arrayContaining([
        'errors.ts',
        'money.ts',
        'ledger/validate.ts',
        'import/commit-plan.ts',
        'fish-pie/splits.ts',
        'fish-pie/legs.ts',
      ]),
    )
    expect(modules.length).toBeGreaterThan(30)
    // And the scanner does see a domain module's imports.
    expect(domain.map(shown)).toContain('fish-pie/legs.ts → ledger/validate.ts')
  })
})

describe('the database client', () => {
  it('is imported only by services and infrastructure', () => {
    const importers = EDGES.filter((e) => e.imports === DB_CLIENT)
      .map((e) => e.file)
      .filter((f) => !['service', 'infrastructure'].includes(layerOf(f)) && !leaving(f))
    expect(importers).toEqual([])
  })

  it('is imported by the services, so that rule is not vacuous', () => {
    const importers = new Set(EDGES.filter((e) => e.imports === DB_CLIENT).map((e) => e.file))
    expect([...importers]).toEqual(
      expect.arrayContaining(['ledger/write-service.ts', 'accounts/account-service.ts']),
    )
  })
})

describe('the dialect (`#dialect/*`)', () => {
  // It resolves to one build's client or schema, and `db/index.ts` and `db/schema.ts` are the
  // two doors to it. Anything reaching past them would skip the rules above.
  it('is imported only through `db/index.ts` and `db/schema.ts`', () => {
    const importers = EDGES.filter((e) => isPackage(e.imports, '#dialect')).map((e) => e.file)
    expect([...new Set(importers)].sort()).toEqual([DB_CLIENT, SCHEMA])
  })
})

describe('a query fragment (`*-sql.ts`)', () => {
  it('runs no query of its own, and only services use it', () => {
    const sql = EDGES.filter(inLayer('sql')).filter((e) => e.imports === DB_CLIENT)
    const users = EDGES.filter((e) => SOURCE.has(e.imports) && layerOf(e.imports) === 'sql').filter(
      (e) => layerOf(e.file) !== 'service' && layerOf(e.file) !== 'sql',
    )
    expect([...sql, ...users].map(shown)).toEqual([])
  })
})

describe('a route', () => {
  const staying = FILES.filter((f) => layerOf(f) === 'route' && !leaving(f))

  it('touches neither the database, the schema nor Drizzle', () => {
    const touching = EDGES.filter((e) => staying.includes(e.file)).filter(touchesStorage)
    expect(touching.map(shown)).toEqual([])
  })

  it('opens no database transaction', () => {
    const opening = staying.filter((f) => OPENS_TRANSACTION.test(SOURCE.get(f) ?? ''))
    expect(opening).toEqual([])
  })

  it('covers every route that stays, so the rules are not vacuous', () => {
    expect(staying).toEqual(
      expect.arrayContaining([
        'routes/accounts.ts',
        'routes/import.ts',
        'routes/transactions.ts',
        'routes/user-settings.ts',
      ]),
    )
  })

  it('is exempt only while it leaves with Fish Pie and still needs the exemption', () => {
    const stale = LEAVING_WITH_FISH_PIE.filter((f) => {
      if (!SOURCE.has(f)) return true
      const stillTouches = EDGES.some((e) => e.file === f && touchesStorage(e))
      return !stillTouches && !OPENS_TRANSACTION.test(SOURCE.get(f) ?? '')
    })
    expect(stale).toEqual([])
  })
})
