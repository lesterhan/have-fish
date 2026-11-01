import { expect, test } from 'vitest'
import { z } from 'zod'
import { firstIssue } from './first-issue'

const Schema = z.strictObject({ a: z.strictObject({ b: z.string() }), n: z.int() })
const issueOf = (input: unknown) => {
  const result = Schema.safeParse(input)
  if (result.success) throw new Error('parsed')
  return firstIssue(result.error)
}

test('names the field, joined with dots, and Zod’s code', () => {
  expect(issueOf({ a: { b: 1 }, n: 1 })).toEqual({ path: 'a.b', issue: 'invalid_type' })
})

test('names an extra field itself, not its parent', () => {
  expect(issueOf({ a: { b: '', c: 1 }, n: 1 })).toEqual({
    path: 'a.c',
    issue: 'unrecognized_keys',
  })
})

test('the whole input is the empty path', () => {
  expect(issueOf('text')).toEqual({ path: '', issue: 'invalid_type' })
})
