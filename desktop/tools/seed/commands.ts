// What the command line does, as functions the tests can call too.

import { renderGuide, renderTags } from './guide'
import { PROFILES } from './profiles'
import {
  hasLedger,
  open,
  prepare,
  readSeeded,
  removeLedger,
  runningApp,
  type Seeded,
  type Where,
  write,
  writeNotes,
} from './sandbox'

export type SeedOptions = {
  seed: string
  today: string
  /** The real time now; tests pin it. */
  nowMs?: number
  progress?: (done: number) => void
}

export type Report = { transactions: number; accounts: number; changes: number; ms: number }

export function profileNamed(name: string) {
  const profile = PROFILES[name]
  if (!profile) {
    throw new Error(`no profile called ${name}: try ${Object.keys(PROFILES).join(', ')}`)
  }
  return profile
}

export function refuseIfOpen(where: Where) {
  const pid = runningApp(where)
  if (pid !== null) throw new Error(`the app (pid ${pid}) has this ledger open: quit it first`)
}

/** A new ledger for `name` in `where`, replacing any ledger there but the real one. */
export function seedInto(where: Where, name: string, options: SeedOptions): Report {
  const t = Date.now()
  const profile = profileNamed(name)
  refuseIfOpen(where)
  if (where.real && hasLedger(where)) {
    throw new Error('there is already a ledger in the real folder: move it away first')
  }
  prepare(where)
  removeLedger(where)
  const nowMs = options.nowMs ?? Date.now()
  const seeded = { profile: name, seed: options.seed, today: options.today }

  if (!profile.ledger) {
    writeNotes(
      where,
      { ...seeded, start: options.today },
      `# The ${name} ledger\n\n${profile.about}\n`,
      '{}\n',
    )
    return { transactions: 0, accounts: 0, changes: 0, ms: Date.now() - t }
  }
  const ledger = open(where, nowMs)
  try {
    const built = profile.build({ ...seeded, deviceId: ledger.meta.deviceId, nowMs })
    if (built === null) throw new Error(`${name} built nothing`)
    const wrote = write(ledger, built.book, '', options.progress)
    finishNotes(where, { ...seeded, start: built.start }, built.book, profile.about)
    return { ...wrote, ms: Date.now() - t }
  } finally {
    ledger.close()
  }
}

/** Carries a seeded ledger forward to `today`, writing only what's dated after its last day. */
export function topUp(where: Where, options: Omit<SeedOptions, 'seed'>): Report & { from: string } {
  const t = Date.now()
  const seeded = readSeeded(where)
  if (seeded === null || !hasLedger(where))
    throw new Error('nothing seeded here yet: seed it first')
  const profile = profileNamed(seeded.profile)
  if (!profile.grows) throw new Error(`${seeded.profile} has no days to add: seed it again instead`)
  refuseIfOpen(where)
  const none = { transactions: 0, accounts: 0, changes: 0, ms: 0, from: seeded.today }
  if (options.today <= seeded.today) return none

  const nowMs = options.nowMs ?? Date.now()
  const ledger = open(where, nowMs)
  try {
    const built = profile.build(
      { seed: seeded.seed, today: options.today, deviceId: ledger.meta.deviceId, nowMs },
      seeded.start,
    )
    if (built === null) return none
    const wrote = write(ledger, built.book, seeded.today, options.progress)
    finishNotes(where, { ...seeded, today: options.today }, built.book, profile.about)
    return { ...wrote, ms: Date.now() - t, from: seeded.today }
  } finally {
    ledger.close()
  }
}

function finishNotes(
  where: Where,
  seeded: Seeded,
  book: Parameters<typeof renderTags>[0],
  about: string,
) {
  const guide = renderGuide(book, {
    profile: seeded.profile,
    about,
    seed: seeded.seed,
    start: seeded.start,
    today: seeded.today,
  })
  writeNotes(where, seeded, guide, renderTags(book))
}
