// `bun run seed …` and `bun run try …`. `run.ts` bundles this file and runs it on Electron's
// Node, so it loads the better-sqlite3 build the app ships.

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { calendarDateAt, isCalendarDate } from '@have-fish/core/calendar-date'
import { profileNamed, refuseIfOpen, seedInto, topUp } from './commands'
import { PROFILES } from './profiles'
import { record } from './record'
import {
  DESKTOP,
  hasLedger,
  packaged,
  readSeeded,
  realFolders,
  restore,
  sandbox,
  snap,
  snapshots,
  type Where,
} from './sandbox'

const HELP = `Seeded ledgers for trying the app by hand. Each lives in desktop/.sandbox/<profile>/.

  bun run seed <profile>                 build it afresh (refused while the app has it open)
  bun run seed top-up <profile>          add the days since it was seeded, up to today
  bun run seed snap <profile> <name>     keep the ledger as it is now
  bun run seed restore <profile> <name>  put a kept ledger back
  bun run seed list                      the profiles, and what's seeded
  bun run try <profile>                  open the packaged app on it, seeding it first if need be
  bun run scenes:record                  the scenes' fixtures, from fresh seeds (starter, year)

Options:
  --today YYYY-MM-DD   the last day of the ledger (default: today)
  --seed <text>        another seed, for a different ledger of the same shape (default: 1)
  --fresh              with try: seed it again first
  --dev                with try: the dev app (bun run dev) instead of the packaged one
  --no-sandbox         with try: pass Chromium's --no-sandbox, if it won't start without it
  --real               with seed: write the packaged app's own folder, if no ledger is there yet

Profiles:
${Object.entries(PROFILES)
  .map(([name, p]) => `  ${name.padEnd(9)}${p.about}`)
  .join('\n')}`

type Args = { words: string[]; flags: Map<string, string | true> }

function parse(argv: string[]): Args {
  const words: string[] = []
  const flags = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? ''
    if (!a.startsWith('--')) words.push(a)
    else if (['--today', '--seed'].includes(a)) flags.set(a, argv[++i] ?? '')
    else flags.set(a, true)
  }
  return { words, flags }
}

function todayFrom(args: Args): string {
  const now = calendarDateAt(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone)
  const asked = args.flags.get('--today')
  if (asked === undefined) return now
  if (typeof asked !== 'string' || !isCalendarDate(asked))
    throw new Error('--today takes YYYY-MM-DD')
  if (asked > now) throw new Error(`--today can't be after today (${now})`)
  return asked
}

const seedOf = (args: Args) => {
  const s = args.flags.get('--seed')
  return typeof s === 'string' && s !== '' ? s : '1'
}

// `\x1b[K` clears what the last count left on the line.
const progress = (done: number) =>
  process.stdout.write(`\r\x1b[K  ${done.toLocaleString()} written`)

function where(args: Args, profile: string): Where {
  profileNamed(profile)
  return args.flags.has('--real') ? realFolders() : sandbox(profile)
}

function warnIfStale() {
  if (packaged()?.stale) {
    console.log(
      '\n! The packaged app is older than the source: it would refuse this ledger. Run `bun run package`.',
    )
  }
}

function seed(args: Args, profile: string) {
  const at = where(args, profile)
  console.log(`Seeding ${profile}…`)
  const r = seedInto(at, profile, { seed: seedOf(args), today: todayFrom(args), progress })
  console.log(
    `\r\x1b[K  ${r.transactions.toLocaleString()} transactions, ${r.accounts} accounts, ` +
      `${r.changes} fixed or deleted, in ${(r.ms / 1000).toFixed(1)}s`,
  )
  console.log(`  ledger  ${at.data}`)
  if (!at.real) console.log(`  guide   ${join(at.root, 'GUIDE.md')}`)
  warnIfStale()
}

function list() {
  for (const [name, p] of Object.entries(PROFILES)) {
    const at = sandbox(name)
    const seeded = readSeeded(at)
    const state = seeded
      ? `seeded ${seeded.start} to ${seeded.today}, seed ${seeded.seed}`
      : 'not seeded'
    const snaps = snapshots(at)
    console.log(
      `${name.padEnd(9)}${state}${snaps.length ? `; snapshots: ${snaps.join(', ')}` : ''}`,
    )
    console.log(`         ${p.about}`)
  }
}

/** The environment for the app: its folders, and none of this script's Node-only switches. */
function appEnv(at: Where): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...at.env, NODE_OPTIONS: '' }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

function tryApp(args: Args, profile: string) {
  const at = sandbox(profile)
  profileNamed(profile)
  if (args.flags.has('--fresh') || readSeeded(at) === null) seed(args, profile)
  refuseIfOpen(at)
  const dev = args.flags.has('--dev')
  let exe: string
  let argv: string[] = []
  if (dev) {
    exe = 'bun'
    argv = ['run', 'dev']
  } else {
    const app = packaged()
    if (app === null) throw new Error('no packaged app in dist/: run `bun run package` first')
    if (app.stale && hasLedger(at)) {
      throw new Error(
        'the packaged app is older than the source and would refuse this ledger: run `bun run package`',
      )
    }
    exe = app.exe
  }
  if (args.flags.has('--no-sandbox')) argv.push('--no-sandbox')
  console.log(
    `Opening ${dev ? 'the dev app' : 'the packaged app'} on ${profile}. Quit it to come back here.`,
  )
  const child = spawn(exe, argv, { cwd: DESKTOP, env: appEnv(at), stdio: 'inherit' })
  child.on('exit', (code) => process.exit(code ?? 0))
}

function main(argv: string[]) {
  const [tool, ...rest] = argv
  const args = parse(rest)
  const [first, second, third] = args.words
  if (tool === 'try') {
    if (!first) throw new Error('try which profile?')
    return tryApp(args, first)
  }
  if (tool === 'record') {
    record(['starter', 'year'], join(DESKTOP, 'scenes', 'fixtures'))
    return console.log('Recorded scenes/fixtures/starter.json and scenes/fixtures/year.json')
  }
  switch (first) {
    case undefined:
    case 'help':
      return console.log(HELP)
    case 'list':
      return list()
    case 'top-up': {
      if (!second) throw new Error('top up which profile?')
      const at = sandbox(second)
      const r = topUp(at, { today: todayFrom(args), progress })
      if (r.transactions === 0 && r.accounts === 0) return console.log(`${second} is up to date`)
      console.log(`\r\x1b[K  ${r.transactions.toLocaleString()} transactions added after ${r.from}`)
      return warnIfStale()
    }
    case 'snap':
    case 'restore': {
      if (!second || !third) throw new Error(`${first} <profile> <name>`)
      const at = sandbox(second)
      if (first === 'restore') {
        refuseIfOpen(at)
        restore(at, third)
      } else snap(at, third)
      return console.log(`${first === 'snap' ? 'Kept' : 'Restored'} ${second} as ${third}`)
    }
    default:
      return seed(args, first)
  }
}

try {
  main(process.argv.slice(2))
} catch (e) {
  console.error(`\nseed: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
