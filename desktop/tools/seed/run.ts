// Runs `cli.ts` on Electron's Node, which loads the better-sqlite3 build the app ships. Node can
// strip the types itself but not resolve the app's extensionless imports, so Bun bundles it first.
//   bun tools/seed/run.ts seed <args>   or   bun tools/seed/run.ts try <args>

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import electron from 'electron'

const desktop = join(import.meta.dirname, '..', '..')
const out = join(desktop, 'out', 'seed', 'cli.mjs')

const built = spawnSync(
  'bun',
  [
    'build',
    join(import.meta.dirname, 'cli.ts'),
    '--target=node',
    '--format=esm',
    '--external=better-sqlite3',
    `--outfile=${out}`,
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] },
)
if (built.status !== 0) process.exit(built.status ?? 1)

const ran = spawnSync(electron as unknown as string, [out, ...process.argv.slice(2)], {
  cwd: desktop,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
})
process.exit(ran.status ?? 1)
