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
import { claimLock, processAlive } from './lockfile'

let dir: string
let lock: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'havefish-lock-'))
  lock = join(dir, 'havefish.lock')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const alive = () => true
const dead = () => false
const holder = { pid: process.pid, port: 47821, launchKey: 'key' }

describe('the single-instance lock', () => {
  it('is taken by the first launch, readable by its owner alone', () => {
    const claim = claimLock(lock)
    expect(claim.kind).toBe('claimed')
    expect(JSON.parse(readFileSync(lock, 'utf8'))).toEqual({ pid: process.pid })
    expect(statSync(lock).mode & 0o777).toBe(0o600)
  })

  it('tells a second launch where the first is listening, once it has said', () => {
    const first = claimLock(lock)
    if (first.kind !== 'claimed') throw new Error('first launch did not get the lock')

    expect(claimLock(lock, alive)).toEqual({ kind: 'starting' })
    first.publish(holder)
    expect(claimLock(lock, alive)).toEqual({ kind: 'running', holder })
  })

  it('is taken over from a process that is gone', () => {
    writeFileSync(lock, JSON.stringify({ ...holder, pid: 999_999 }))
    const claim = claimLock(lock, dead)
    expect(claim.kind).toBe('claimed')
    expect(JSON.parse(readFileSync(lock, 'utf8'))).toEqual({ pid: process.pid })
  })

  it('is left alone while unreadable and new, since someone is writing it', () => {
    writeFileSync(lock, '')
    expect(claimLock(lock, dead)).toEqual({ kind: 'starting' })
  })

  it('is taken over when unreadable and old', () => {
    writeFileSync(lock, '{"pid":')
    const old = new Date(Date.now() - 60_000)
    utimesSync(lock, old, old)
    expect(claimLock(lock, dead).kind).toBe('claimed')
  })

  it('is released by its holder, and only while it is still the holder', () => {
    const claim = claimLock(lock)
    if (claim.kind !== 'claimed') throw new Error('did not get the lock')
    claim.release()
    expect(existsSync(lock)).toBe(false)

    const again = claimLock(lock)
    if (again.kind !== 'claimed') throw new Error('did not get the lock back')
    // Someone else took it over, believing this process gone.
    writeFileSync(lock, JSON.stringify({ ...holder, pid: 999_999 }))
    again.release()
    expect(existsSync(lock)).toBe(true)
  })
})

describe('processAlive', () => {
  it('knows this process is alive and a made-up one is not', () => {
    expect(processAlive(process.pid)).toBe(true)
    expect(processAlive(2 ** 22 + 12_345)).toBe(false)
  })
})
