import { describe, it, expect } from 'bun:test'
import { bumpCoverage, onCoverageChange } from './coverageRefresh'

describe('coverageRefresh', () => {
  it('notifies every subscriber', () => {
    const seen: string[] = []
    const offA = onCoverageChange(() => seen.push('a'))
    const offB = onCoverageChange(() => seen.push('b'))

    bumpCoverage()

    expect(seen.sort()).toEqual(['a', 'b'])
    offA()
    offB()
  })

  it('stops notifying after unsubscribe', () => {
    let calls = 0
    const off = onCoverageChange(() => calls++)

    bumpCoverage()
    off()
    bumpCoverage()

    expect(calls).toBe(1)
  })

  // A listener that unsubscribes in response to a bump must not make the set skip the next
  // one mid-iteration — the reason the listeners are copied before the loop.
  it('still reaches later subscribers when one unsubscribes during the bump', () => {
    let reached = false
    let off: () => void = () => {}
    off = onCoverageChange(() => off())
    const offB = onCoverageChange(() => {
      reached = true
    })

    bumpCoverage()

    expect(reached).toBe(true)
    offB()
  })

  it('is a no-op with nothing subscribed', () => {
    expect(() => bumpCoverage()).not.toThrow()
  })
})
