import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  claimLock,
  type HolderCheck,
  heldBy,
  pidNamespace,
  processAlive,
  STARTING_GRACE_MS,
} from './lockfile'

let dir: string
let lock: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'havefish-lock-'))
  lock = join(dir, 'havefish.lock')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const HERE = 'pid:[4026531836]'
const SANDBOX = 'pid:[4026532263]'
const holder = { pid: 2, port: 47821, launchKey: 'key' }

/** A check with every answer spelled out: who answers, and which pids exist. */
function check(opts: {
  answers?: boolean
  patientAnswers?: boolean
  alive?: boolean
  namespace?: string
}): HolderCheck & { asked: boolean[] } {
  const asked: boolean[] = []
  return {
    asked,
    answers: async (_holder, patient) => {
      asked.push(patient)
      return patient ? (opts.patientAnswers ?? false) : (opts.answers ?? false)
    },
    alive: () => opts.alive ?? false,
    namespace: opts.namespace ?? HERE,
  }
}

const writeLock = (contents: object, ageMs = 0) => {
  writeFileSync(lock, JSON.stringify(contents))
  const at = new Date(Date.now() - ageMs)
  utimesSync(lock, at, at)
}

const contents = () => JSON.parse(readFileSync(lock, 'utf8')) as Record<string, unknown>

describe('the single-instance lock', () => {
  it('is taken by the first launch, readable by its owner alone', async () => {
    const claim = await claimLock(lock, check({}))
    expect(claim.kind).toBe('claimed')
    expect(contents()).toEqual({ pid: process.pid, pidNs: HERE, claim: expect.any(String) })
    expect(statSync(lock).mode & 0o777).toBe(0o600)
  })

  it('tells a second launch where the first is listening, once it has said', async () => {
    const first = await claimLock(lock, check({ alive: true }))
    if (first.kind !== 'claimed') throw new Error('first launch did not get the lock')

    expect(await claimLock(lock, check({ alive: true }))).toEqual({ kind: 'starting' })
    first.publish(holder)
    expect(contents()).toMatchObject({ ...holder, pidNs: HERE })
    expect(await claimLock(lock, check({ answers: true }))).toEqual({ kind: 'running', holder })
  })

  describe('a holder that has said where it listens', () => {
    it('is handed over to when it answers, whatever its pid says', async () => {
      writeLock({ ...holder, pidNs: SANDBOX })
      const asking = check({ answers: true, alive: false })
      expect(await claimLock(lock, asking)).toEqual({ kind: 'running', holder })
      expect(asking.asked).toEqual([false])
    })

    it('is taken over from when it does not answer and its pid is gone', async () => {
      writeLock({ ...holder, pidNs: HERE })
      const asking = check({ alive: false })
      expect((await claimLock(lock, asking)).kind).toBe('claimed')
      expect(contents().pid).toBe(process.pid)
      expect(asking.asked).toEqual([false])
    })

    // The Flatpak case (#516): every sandbox's first process is pid 2, so a dead holder's pid
    // is some live process in the next sandbox. Not asked, because it is not this sandbox's.
    it('is taken over from when it does not answer, from another pid namespace', async () => {
      writeLock({ ...holder, pidNs: SANDBOX })
      const asking = check({ alive: true, patientAnswers: true })
      expect((await claimLock(lock, asking)).kind).toBe('claimed')
      expect(asking.asked).toEqual([false])
    })

    it('is given longer when its pid is alive here, and handed over to if it answers then', async () => {
      writeLock({ ...holder, pidNs: HERE })
      const asking = check({ alive: true, patientAnswers: true })
      expect(await claimLock(lock, asking)).toEqual({ kind: 'running', holder })
      expect(asking.asked).toEqual([false, true])
    })

    // A pid reused since a reboot: alive, and nothing to do with have-fish.
    it('is taken over from when its pid is alive here but it never answers', async () => {
      writeLock({ ...holder, pidNs: HERE })
      const asking = check({ alive: true })
      expect((await claimLock(lock, asking)).kind).toBe('claimed')
      expect(asking.asked).toEqual([false, true])
    })

    it('is read from a lockfile written before #516, which names no namespace', async () => {
      writeLock(holder)
      expect(await claimLock(lock, check({ answers: true }))).toEqual({ kind: 'running', holder })
      writeLock(holder)
      expect(await claimLock(lock, check({ alive: true, patientAnswers: true }))).toEqual({
        kind: 'running',
        holder,
      })
    })
  })

  describe('a holder that has not said where it listens yet', () => {
    it('is waited for while its pid is alive here, and taken over from when it is not', async () => {
      writeLock({ pid: 2, pidNs: HERE })
      expect(await claimLock(lock, check({ alive: true }))).toEqual({ kind: 'starting' })
      expect((await claimLock(lock, check({ alive: false }))).kind).toBe('claimed')
    })

    it('is waited for from another namespace until it has had long enough to start', async () => {
      writeLock({ pid: 2, pidNs: SANDBOX })
      expect(await claimLock(lock, check({ alive: false }))).toEqual({ kind: 'starting' })
      writeLock({ pid: 2, pidNs: SANDBOX }, STARTING_GRACE_MS + 1000)
      expect((await claimLock(lock, check({ alive: true }))).kind).toBe('claimed')
    })
  })

  it('is left alone while unreadable and new, since someone is writing it', async () => {
    writeFileSync(lock, '')
    expect(await claimLock(lock, check({}))).toEqual({ kind: 'starting' })
  })

  it('is taken over when unreadable and old', async () => {
    writeFileSync(lock, '{"pid":')
    const old = new Date(Date.now() - 60_000)
    utimesSync(lock, old, old)
    expect((await claimLock(lock, check({}))).kind).toBe('claimed')
  })

  it('is released by its holder, and only while it is still that claim', async () => {
    const claim = await claimLock(lock, check({}))
    if (claim.kind !== 'claimed') throw new Error('did not get the lock')
    claim.release()
    expect(existsSync(lock)).toBe(false)

    const again = await claimLock(lock, check({}))
    if (again.kind !== 'claimed') throw new Error('did not get the lock back')
    // Taken over by an instance that believed this one gone, with the very same pid: in
    // another sandbox, it is pid 2 as well.
    writeFileSync(lock, JSON.stringify({ ...holder, pid: process.pid, claim: 'someone else' }))
    again.release()
    expect(existsSync(lock)).toBe(true)
  })
})

describe('heldBy', () => {
  it('says whether the lock still names the instance that published this key', async () => {
    const claim = await claimLock(lock, check({}))
    if (claim.kind !== 'claimed') throw new Error('did not get the lock')
    claim.publish({ ...holder, version: '0.1.0' })
    expect(contents().version).toBe('0.1.0')
    expect(heldBy(lock, holder)).toBe(true)
    expect(heldBy(lock, { launchKey: 'another' })).toBe(false)
    claim.release()
    expect(heldBy(lock, holder)).toBe(false)
  })
})

describe('processAlive', () => {
  it('knows this process is alive and a made-up one is not', () => {
    expect(processAlive(process.pid)).toBe(true)
    expect(processAlive(2 ** 22 + 12_345)).toBe(false)
  })
})

describe('pidNamespace', () => {
  it.skipIf(process.platform !== 'linux')('names the namespace this process sees pids in', () => {
    expect(pidNamespace()).toMatch(/^pid:\[\d+\]$/)
  })
})
