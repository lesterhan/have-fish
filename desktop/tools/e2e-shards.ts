// Runs the e2e suite as several shards at once, each on its own X display. The shortcut tests
// press real keys with xdotool, so two apps on one display would take each other's keys; with a
// display each there is no one to fight. `bun run e2e` builds first, then calls this.

import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** How many shards: `--shards=4` (the default) or `SHARDS=4`. Four matches CI's cores. */
const fromEnv = process.env.SHARDS === undefined ? undefined : Number(process.env.SHARDS)
const shards = argument('--shards') ?? fromEnv ?? 4
if (!Number.isInteger(shards) || shards < 1) {
  console.error(`shards must be a whole number above 0, not ${shards}`)
  process.exit(1)
}

/** One display per shard, from here up: clear of the session's own, and of each other. */
let nextDisplay = 91

/** The suite as CI runs it: every file, the dot reporter. */
const vitest = join('node_modules', '.bin', 'vitest')
const args = ['run', '--config', 'vitest.e2e.config.ts', '--reporter=dot']

const children: ChildProcess[] = []
process.once('SIGINT', () => {
  for (const child of children) child.kill('SIGTERM')
  process.exit(130)
})

for (const tool of ['xvfb-run', 'xdotool']) {
  if (!onPath(tool)) {
    console.error(`${tool} is not on PATH: the suite needs both, or a machine that has CI's.`)
    process.exit(1)
  }
}

// X11 rather than Wayland: the session on a laptop asks for Wayland, which cannot start on a
// virtual display, and the app then exits before its window. The light GTK theme is CI's: a
// laptop in dark mode reports `prefers-color-scheme: dark`, and the theme tests expect light.
const env: NodeJS.ProcessEnv = {
  ...process.env,
  XDG_SESSION_TYPE: 'x11',
  GTK_THEME: 'Adwaita:light',
}
delete env.WAYLAND_DISPLAY

const started = Date.now()
const results = await Promise.all(
  Array.from({ length: shards }, (_, i) => runShard(i + 1, shards, env)),
)
const seconds = ((Date.now() - started) / 1000).toFixed(1)

for (const r of results) {
  console.log(
    `shard ${r.index}/${shards} · display ${r.display} · ${r.seconds.toFixed(1)}s · ${r.code}`,
  )
}
console.log(`${shards} shards in ${seconds}s`)

const failed = results.filter((r) => r.code !== 0)
if (failed.length > 0) {
  console.error(`failed: ${failed.map((r) => r.index).join(', ')}`)
  process.exit(1)
}

type Result = { index: number; display: number; seconds: number; code: number }

/** One shard, on a display of its own, its output prefixed with the shard's number. */
function runShard(index: number, of: number, env: NodeJS.ProcessEnv): Promise<Result> {
  const display = takeDisplay()
  const began = Date.now()
  const child = spawn(
    'xvfb-run',
    [
      '-n',
      String(display),
      // The screen CI's runner has. Some distros' xvfb-run default to 640x480, where the app's
      // window no longer fits and tests about columns or rows fail for no reason of the code's.
      '-s',
      '-screen 0 1280x1024x24',
      vitest,
      ...args,
      `--shard=${index}/${of}`,
    ],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  children.push(child)

  for (const stream of [child.stdout, child.stderr]) {
    if (stream === null) continue
    stream.setEncoding('utf8')
    let rest = ''
    stream.on('data', (chunk: string) => {
      const lines = (rest + chunk).split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) console.log(`[${index}] ${line}`)
    })
    stream.on('end', () => {
      if (rest !== '') console.log(`[${index}] ${rest}`)
    })
  }

  return new Promise((resolve) => {
    child.once('close', (code, signal) => {
      resolve({
        index,
        display,
        seconds: (Date.now() - began) / 1000,
        code: code ?? (signal === null ? 0 : 1),
      })
    })
  })
}

/** A display number nothing else has claimed, skipping stale locks a killed run may leave. */
function takeDisplay(): number {
  while (existsSync(`/tmp/.X${nextDisplay}-lock`)) nextDisplay++
  return nextDisplay++
}

/** `--name=value` from the command line, or undefined. */
function argument(name: string): number | undefined {
  const found = process.argv.find((arg) => arg.startsWith(`${name}=`))
  return found === undefined ? undefined : Number(found.slice(name.length + 1))
}

/** Whether an executable is found in one of `PATH`'s folders. */
function onPath(exe: string): boolean {
  return (process.env.PATH ?? '').split(':').some((dir) => existsSync(join(dir, exe)))
}
