import { describe, expect, it } from 'bun:test'
import { returnedRow } from './returning'

describe('returnedRow', () => {
  it('hands back the first row', () => {
    expect(returnedRow([{ id: 'a' }, { id: 'b' }], 'insert accounts')).toEqual({ id: 'a' })
  })

  it('names the statement when there is no row, rather than failing on the first field read', () => {
    expect(() => returnedRow([], 'insert accounts')).toThrow('insert accounts returned no row')
  })

  it('treats a row that is itself falsy as a row', () => {
    expect(returnedRow([0], 'select count')).toBe(0)
    expect(returnedRow([null], 'select nullable')).toBe(null)
  })
})
