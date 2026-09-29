// `bun run build:binary`: the local build as one executable file (#288), with the frontend and
// the SQLite migrations inside it. Build the frontend first (`bun run build` in frontend/); the
// package script does both.
//
//   bun run scripts/build-binary.ts [--target linux-x64|linux-arm64] [--outfile dist/havefish]
//
// It writes `dist/entry.ts`, which names every file of `frontend/build` by its own import
// (src/local/embed.ts says why), then compiles that with `--conditions=sqlite`. The target
// defaults to this machine's. PUBLIC_VERSION, which the frontend build stamps too, is what
// `havefish --version` prints ("dev" when unset); the release workflow sets it from the tag.

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

// Each target needs libsql's native addon for that machine, which `bun install` fetches only on
// the machine it runs on: build an arm64 binary on an arm64 machine (the release workflow runs
// one runner per target). A musl or macOS target would be another row here.
const TARGETS = {
  'linux-x64': { bun: 'bun-linux-x64', libsql: '@libsql/linux-x64-gnu' },
  'linux-arm64': { bun: 'bun-linux-arm64', libsql: '@libsql/linux-arm64-gnu' },
} as const
type Target = keyof typeof TARGETS

const { values } = parseArgs({
  options: { outfile: { type: 'string' }, target: { type: 'string' } },
})
const targetName = values.target ?? `linux-${process.arch}`
if (!(targetName in TARGETS)) {
  throw new Error(`no target ${targetName}; one of: ${Object.keys(TARGETS).join(', ')}`)
}
const target = TARGETS[targetName as Target]
const outfile = resolve(values.outfile ?? join(DIST, 'havefish'))
const version = process.env.PUBLIC_VERSION || 'dev'

/**
 * libsql picks its native addon with a computed `require(`@libsql/${target}`)`, which the
 * bundler cannot follow, so the binary would start and then fail to find it (#284). This
 * rewrites that one line to a static require of the addon for the target being built, and
 * the addon is embedded like any other file.
 */
function libsqlAddon(): BunPlugin {
  let addon: string
  try {
    addon = Bun.resolveSync(`${target.libsql}/index.node`, BACKEND)
  } catch {
    throw new Error(
      `${target.libsql} is not installed: build ${targetName} on a ${targetName} machine`,
    )
  }
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
  binaryEntrySource(files, migrations, fromEntry(join(BACKEND, 'src/local/launch')), version),
)

const result = await Bun.build({
  entrypoints: [ENTRY],
  compile: { target: target.bun, outfile },
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
  `${relative(process.cwd(), outfile)}: havefish ${version} for ${targetName}, ${mb} MB, ${files.length} frontend files, ${migrations.length} migrations`,
)
