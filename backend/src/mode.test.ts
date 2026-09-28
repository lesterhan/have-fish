import { describe, expect, it } from 'bun:test'
import { readMode } from './mode'

describe('readMode', () => {
  it('is the server build when HAVEFISH_MODE is unset or empty, so the hosted deploy needs nothing new', () => {
    expect(readMode(undefined)).toBe('server')
    expect(readMode('')).toBe('server')
    expect(readMode('server')).toBe('server')
  })

  it('reads local', () => {
    expect(readMode('local')).toBe('local')
  })

  it('refuses anything else rather than guessing', () => {
    expect(() => readMode('Local')).toThrow('HAVEFISH_MODE is "Local"')
    expect(() => readMode('desktop')).toThrow('"local" or "server"')
  })
})
