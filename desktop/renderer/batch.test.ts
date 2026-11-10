import { describe, expect, test } from 'vitest'
import type { ListedTransaction } from '../shared/commands'
import { added, EMPTY, landing, movedBy } from './batch'

/** A line as the batch holds it, named for its description. */
const line = (description: string) => ({ id: description, description }) as ListedTransaction

const coffee = line('coffee')
const lunch = line('lunch')
const tea = line('tea')

describe("a batch: what one opening of the line wrote", () => {
  test('the first line written goes into an empty batch', () => {
    expect(added(EMPTY, coffee)).toEqual({ lines: [coffee], takenBack: [] })
  })

  test('the next line goes on top, newest first', () => {
    expect(added({ lines: [coffee], takenBack: [] }, lunch)).toEqual({
      lines: [lunch, coffee],
      takenBack: [],
    })
  })

  test('a new line drops what was taken back, as a new step drops redo', () => {
    expect(added({ lines: [coffee], takenBack: [tea] }, lunch)).toEqual({
      lines: [lunch, coffee],
      takenBack: [],
    })
  })

  test('an undo of the newest line takes it out of the batch', () => {
    expect(movedBy({ lines: [lunch, coffee], takenBack: [] }, lunch.id)).toEqual({
      lines: [coffee],
      takenBack: [lunch],
    })
  })

  test('a redo puts it back at the top', () => {
    expect(movedBy({ lines: [coffee], takenBack: [lunch] }, lunch.id)).toEqual({
      lines: [lunch, coffee],
      takenBack: [],
    })
  })

  test('only the newest is undone first: an older line leaves the batch alone', () => {
    const batch = { lines: [lunch, coffee], takenBack: [] }
    expect(movedBy(batch, coffee.id)).toBe(batch)
  })

  test('an id in neither leaves the batch alone', () => {
    const batch = { lines: [lunch], takenBack: [coffee] }
    expect(movedBy(batch, tea.id)).toBe(batch)
  })

  test('landing lights every line of the batch, the newest selected', () => {
    const at = landing({ lines: [lunch, coffee], takenBack: [] })
    expect(at.ids).toEqual(new Set([lunch.id, coffee.id]))
    expect(at.newest).toBe(lunch.id)
  })

  test('an empty batch lands nothing', () => {
    const at = landing(EMPTY)
    expect(at.ids).toEqual(new Set())
    expect(at.newest).toBeNull()
  })
})
