import { describe, expect, it } from 'vitest'
import { rawTimingsIn, rawTypeIn } from './sizes'

describe('rawTypeIn', () => {
  it('catches a font-size that is a number', () => {
    expect(rawTypeIn('.a { font-size: 13px; }')).toEqual(['font-size: 13px'])
  })

  it('catches one in an inline style', () => {
    expect(rawTypeIn('<p style="font-size:0.8rem">x</p>')).toEqual(['font-size: 0.8rem'])
  })

  it('catches a token that is not a type step', () => {
    expect(rawTypeIn('.a { font-size: var(--space-4); }')).toEqual(['font-size: var(--space-4)'])
  })

  it('passes a type token, and a refusal to set one', () => {
    expect(rawTypeIn('.a { font-size: var(--text-small); } .b { font-size: inherit; }')).toEqual([])
  })

  it('ignores a size in a comment', () => {
    expect(rawTypeIn('/* was font-size: 13px */ .a { font-size: var(--text-base); }')).toEqual([])
  })
})

describe('rawTimingsIn', () => {
  it('catches a duration in a transition or an animation', () => {
    expect(rawTimingsIn('.a { transition: opacity 150ms ease-out; }')).toEqual(['150ms'])
    expect(rawTimingsIn('.a { animation: drop .42s both; }')).toEqual(['.42s'])
  })

  it('catches a duration property', () => {
    expect(rawTimingsIn('.a { transition-duration: 1s; }')).toEqual(['1s'])
  })

  it('passes a token, and no time at all', () => {
    expect(
      rawTimingsIn(
        '.a { transition: transform var(--duration-slide) var(--ease-out), visibility 0s; }',
      ),
    ).toEqual([])
  })
})
