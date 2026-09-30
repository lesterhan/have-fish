// The local build's log file (#492): the owner's alone, and never more than two files.

import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogger } from '../logging'
import { localLogLevel, openLogFile, previousLog } from './log-file'

describe('openLogFile', () => {
  let dir: string
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const fresh = () => {
    dir = mkdtempSync(join(tmpdir(), 'havefish-log-'))
    return join(dir, 'havefish.log')
  }

  it('makes a file only its owner can read, and writes to it as each line is logged', () => {
    const path = fresh()
    const logger = createLogger(openLogFile(path), 'info')
    logger.info({ port: 47821 }, 'local app listening')

    expect(statSync(path).mode & 0o777).toBe(0o600)
    // Synchronous: the line is on disk before the call returns, so a crash cannot lose it.
    const [line] = readFileSync(path, 'utf8').trim().split('\n')
    expect(JSON.parse(line ?? '')).toMatchObject({ port: 47821, msg: 'local app listening' })
  })

  it('appends to the log a previous run left, and narrows it to the owner', () => {
    const path = fresh()
    writeFileSync(path, '{"msg":"yesterday"}\n', { mode: 0o644 })
    createLogger(openLogFile(path), 'info').info('today')

    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readFileSync(path, 'utf8')).toStartWith('{"msg":"yesterday"}\n')
    expect(readFileSync(path, 'utf8')).toContain('"msg":"today"')
    expect(existsSync(previousLog(path))).toBe(false)
  })

  it('moves a log past the limit aside, replacing the one kept before it', () => {
    const path = fresh()
    writeFileSync(previousLog(path), 'the oldest\n')
    writeFileSync(path, 'x'.repeat(100))
    createLogger(openLogFile(path, 100), 'info').info('after rotating')

    expect(readFileSync(previousLog(path), 'utf8')).toBe('x'.repeat(100))
    expect(readFileSync(path, 'utf8')).not.toContain('x'.repeat(100))
    expect(readFileSync(path, 'utf8')).toContain('"msg":"after rotating"')
  })

  it('leaves a log under the limit where it is', () => {
    const path = fresh()
    writeFileSync(path, 'x'.repeat(99))
    openLogFile(path, 100)
    expect(existsSync(previousLog(path))).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe('x'.repeat(99))
  })
})

describe('localLogLevel', () => {
  it('is info unless LOG_LEVEL says otherwise, whatever NODE_ENV is', () => {
    expect(localLogLevel({})).toBe('info')
    expect(localLogLevel({ NODE_ENV: 'development' })).toBe('info')
    expect(localLogLevel({ LOG_LEVEL: '' })).toBe('info')
    expect(localLogLevel({ LOG_LEVEL: 'debug' })).toBe('debug')
  })
})
