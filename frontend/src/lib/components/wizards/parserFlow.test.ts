import { describe, expect, it } from 'bun:test'
import { type FlowState, PARSER_STEP, parserFlow } from './parserFlow'

const flow = parserFlow('account')
const start: FlowState<'account'> = { step: 'account', parserSkipped: false }

describe('parserFlow', () => {
  it('walks forward through the parser steps to confirm', () => {
    let s = flow.next(start, false)
    expect(s.step).toBe(PARSER_STEP.UPLOAD)
    s = flow.next(s, false)
    expect(s.step).toBe(PARSER_STEP.COLUMNS)
    s = flow.next(s, false)
    expect(s).toEqual({ step: PARSER_STEP.CONFIRM, parserSkipped: false })
  })

  it('takes the multi-currency step only when the parser is multi-currency', () => {
    const columns = { step: PARSER_STEP.COLUMNS, parserSkipped: false } as const
    expect(flow.next(columns, true).step).toBe(PARSER_STEP.MULTICURRENCY)
    expect(flow.next(flow.next(columns, true), true).step).toBe(PARSER_STEP.CONFIRM)
  })

  it('walks back from confirm the way it came', () => {
    const confirm = { step: PARSER_STEP.CONFIRM, parserSkipped: false } as const
    expect(flow.back(confirm, false).step).toBe(PARSER_STEP.COLUMNS)
    expect(flow.back(confirm, true).step).toBe(PARSER_STEP.MULTICURRENCY)
    expect(flow.back({ step: PARSER_STEP.UPLOAD, parserSkipped: false }, false).step).toBe(
      'account',
    )
    expect(flow.back(start, false)).toEqual(start)
  })

  it('skip lands on confirm with the parser marked skipped', () => {
    expect(flow.skip()).toEqual({ step: PARSER_STEP.CONFIRM, parserSkipped: true })
  })

  it('back from a skipped confirm returns to the upload step', () => {
    expect(flow.back(flow.skip(), false).step).toBe(PARSER_STEP.UPLOAD)
  })

  // BUG-001 (#256): skip, go back, fill the parser in, and submit. The flag set by skip
  // used to survive the trip back, so confirm said "No parser configured" and submit
  // dropped the parser the user had just mapped.
  it('a parser filled in after skip-then-back reaches confirm not skipped', () => {
    let s = flow.skip()
    s = flow.back(s, false)
    expect(s.parserSkipped).toBe(false)
    s = flow.next(s, false)
    s = flow.next(s, false)
    expect(s).toEqual({ step: PARSER_STEP.CONFIRM, parserSkipped: false })
  })

  it('the same holds when the parser turns out multi-currency', () => {
    let s = flow.back(flow.skip(), false)
    s = flow.next(s, true)
    s = flow.next(s, true)
    s = flow.next(s, true)
    expect(s).toEqual({ step: PARSER_STEP.CONFIRM, parserSkipped: false })
  })

  it('next on confirm stays put and keeps the skip', () => {
    expect(flow.next(flow.skip(), false)).toEqual(flow.skip())
  })
})
