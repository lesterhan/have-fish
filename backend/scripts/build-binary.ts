// `bun run build:binary`: the local build as one executable file (#288), with the frontend and
// the SQLite migrations inside it. Build the frontend first (`bun run build` in frontend/); the
// package script does both.
//
//   bun run scripts/build-binary.ts [--outfile dist/havefish]
//
// It writes `dist/entry.ts`, which names every file of `frontend/build` by its own import
// (src/local/embed.ts says why), then compiles that for linux-x64 with `--conditions=sqlite`.

import { readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import type { BunPlugin } from 'bun'
import { readMigrations } from '../src/db/sqlite/migrate'
import { binaryEntrySource } from '../src/local/embed'

const BACKEND = resolve(import.meta.dir, '..')
const FRONTEND_BUILD = resolve(BACKEND, '../frontend/build')
const DIST = join(BACKEND, 'dist')
const ENTRY = join(DIST, 'entry.ts')

// One target for now. Another needs its own libsql addon below (a musl or arm64 build).
const TARGET = 'bun-linux-x64'
const LIBSQL_ADDON = '@libsql/linux-x64-gnu'

const { values } = parseArgs({ options: { outfile: { type: 'string' } } })
const outfile = resolve(values.outfile ?? join(DIST, 'havefish'))

/**
 * libsql picks its native addon with a computed `require(`@libsql/${target}`)`, which the
 * bundler cannot follow, so the binary would start and then fail to find it (#284). This
 * rewrites that one line to a static require of the addon for the target being built, and
 * the addon is embedded like any other file.
 */
function libsqlAddon(): BunPlugin {
  const addon = Bun.resolveSync(`${LIBSQL_ADDON}/index.node`, BACKEND)
  return {
    name: 'libsql-addon',
    setup(build) {
      build.onLoad({ filter: /node_modules\/libsql\/index\.js$/ }, async (args) => {
        const source = await Bun.file(args.path).text()
        const patched = source.replace(
          // biome-ignore lint/suspicious/noTemplateCurlyInString: libsql's source, matched as text
          'require(`@libsql/${target}`)',
          `require(${JSON.stringify(addon)})`,
        )
        if (patched === source) throw new Error(`libsql's addon loader has changed: ${args.path}`)
        return { contents: patched, loader: 'js' }
      })
    },
  }
}

/** A path as the entry imports it: relative to `dist/`, and starting with a dot. */
function fromEntry(path: string): string {
  const rel = relative(DIST, path)
  return rel.startsWith('.') ? rel : `./${rel}`
}

const files = readdirSync(FRONTEND_BUILD, { recursive: true, encoding: 'utf8' })
  .filter((rel) => statSync(join(FRONTEND_BUILD, rel)).isFile())
  .sort()
  .map((rel) => ({
    servedAs: `/${rel.split('\\').join('/')}`,
    source: fromEntry(join(FRONTEND_BUILD, rel)),
  }))
if (files.length === 0) {
  throw new Error(`nothing in ${FRONTEND_BUILD}: run \`bun run build\` in frontend/ first`)
}

const migrations = readMigrations()
await Bun.write(
  ENTRY,
  binaryEntrySource(files, migrations, fromEntry(join(BACKEND, 'src/local/launch'))),
)

const result = await Bun.build({
  entrypoints: [ENTRY],
  compile: { target: TARGET, outfile },
  conditions: ['sqlite'],
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [libsqlAddon()],
})
if (!result.success) {
  for (const message of result.logs) console.error(message)
  process.exit(1)
}

const mb = (statSync(outfile).size / 1024 / 1024).toFixed(1)
console.log(
  `${relative(process.cwd(), outfile)}: ${mb} MB, ${files.length} frontend files, ${migrations.length} migrations`,
)
