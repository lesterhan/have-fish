import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { z } from 'zod'
import { amountLike, as, asField, defined, parseBody, text } from './validation'

/** Runs one body through one schema and returns what the API would have answered. */
async function reject(schema: z.ZodType, body: unknown, raw?: string) {
  const app = new Hono()
  app.post('/', async (c) => {
    const parsed = await parseBody(c, schema)
    if (!parsed.ok) return parsed.response
    return c.json({ ok: true, data: parsed.data })
  })
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

describe('parseBody', () => {
  const Body = z.object({
    name: z.string(),
    flag: z.boolean().optional(),
    id: z.uuid().optional(),
    count: z.number().int().optional(),
    size: z.number().positive().optional(),
    kind: z.enum(['a', 'b']).optional(),
    nested: z.object({ x: z.string() }).optional(),
    tags: z.array(z.string()).min(1).optional(),
  })

  it('hands back the parsed body when it fits', async () => {
    const { status, body } = await reject(Body, { name: 'ok', flag: true })
    expect(status).toBe(200)
    expect(body.data).toEqual({ name: 'ok', flag: true })
  })

  it('drops keys the schema does not mention, so a handler cannot read one by accident', async () => {
    const { body } = await reject(Body, { name: 'ok', userId: 'someone-elses' })
    expect(body.data).toEqual({ name: 'ok' })
  })

  it('answers INVALID_JSON_BODY for a body that is not JSON', async () => {
    const { status, body } = await reject(Body, null, 'not json at all')
    expect(status).toBe(400)
    expect(body).toEqual({ error: 'INVALID_JSON_BODY' })
  })

  it('answers INVALID_JSON_BODY for JSON that is not an object', async () => {
    for (const notAnObject of [[], 'a string', 7, null]) {
      const { body } = await reject(Body, notAnObject)
      expect(body).toEqual({ error: 'INVALID_JSON_BODY' })
    }
  })

  it('names the missing field rather than its type', async () => {
    const { body } = await reject(Body, {})
    expect(body).toEqual({ error: 'FIELD_REQUIRED', detail: { field: 'name' } })
  })

  it('tells a wrong type apart from an absent one', async () => {
    expect((await reject(Body, { name: 5 })).body).toEqual({
      error: 'FIELD_NOT_STRING',
      detail: { field: 'name' },
    })
    expect((await reject(Body, { name: 'ok', flag: 'yes' })).body).toEqual({
      error: 'FIELD_NOT_BOOLEAN',
      detail: { field: 'flag' },
    })
    expect((await reject(Body, { name: 'ok', nested: 5 })).body).toEqual({
      error: 'FIELD_NOT_OBJECT',
      detail: { field: 'nested' },
    })
    expect((await reject(Body, { name: 'ok', count: 1.5 })).body).toEqual({
      error: 'FIELD_NOT_INTEGER',
      detail: { field: 'count' },
    })
  })

  it('maps the format and range checks onto their codes', async () => {
    expect((await reject(Body, { name: 'ok', id: 'nope' })).body).toEqual({
      error: 'FIELD_NOT_UUID',
      detail: { field: 'id' },
    })
    expect((await reject(Body, { name: 'ok', size: -1 })).body).toEqual({
      error: 'FIELD_NOT_POSITIVE_NUMBER',
      detail: { field: 'size' },
    })
    expect((await reject(Body, { name: 'ok', kind: 'z' })).body).toEqual({
      error: 'FIELD_NOT_IN_SET',
      detail: { field: 'kind', allowed: ['a', 'b'] },
    })
    expect((await reject(Body, { name: 'ok', tags: [] })).body).toEqual({
      error: 'FIELD_EMPTY',
      detail: { field: 'tags' },
    })
  })

  it('names a nested field by its path', async () => {
    expect((await reject(Body, { name: 'ok', nested: {} })).body).toEqual({
      error: 'FIELD_REQUIRED',
      detail: { field: 'nested.x' },
    })
    expect((await reject(Body, { name: 'ok', tags: [1] })).body).toEqual({
      error: 'FIELD_NOT_STRING',
      detail: { field: 'tags[0]' },
    })
  })

  it('reports the first failure only, the way a hand-written guard chain does', async () => {
    const { body } = await reject(Body, { flag: 'yes' })
    expect(body).toEqual({ error: 'FIELD_REQUIRED', detail: { field: 'name' } })
  })
})

describe('as / asField', () => {
  it('lets a check name the code the route already answered with', async () => {
    const Body = z.object({
      postings: z.array(z.unknown()).min(2, { error: as('TOO_FEW_POSTINGS') }),
    })
    expect((await reject(Body, { postings: [1] })).body).toEqual({ error: 'TOO_FEW_POSTINGS' })
  })

  it('carries a detail the schema cannot work out for itself', async () => {
    const Body = z.object({
      from: z.string({ error: as('FIELDS_REQUIRED', { fields: ['from', 'to'] }) }),
    })
    expect((await reject(Body, {})).body).toEqual({
      error: 'FIELDS_REQUIRED',
      detail: { fields: ['from', 'to'] },
    })
  })

  it('fills the field name from wherever the check was applied', async () => {
    const Body = z.object({
      when: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: asField('FIELD_NOT_DATE') }),
    })
    expect((await reject(Body, { when: 'yesterday' })).body).toEqual({
      error: 'FIELD_NOT_DATE',
      detail: { field: 'when' },
    })
  })

  it('answers one code for every way a `text` field can fail', async () => {
    const Body = z.object({ name: text('FIELD_EMPTY') })
    for (const value of [undefined, null, 5, '', '   ']) {
      const { body } = await reject(Body, value === undefined ? {} : { name: value })
      expect(body).toEqual({ error: 'FIELD_EMPTY', detail: { field: 'name' } })
    }
  })

  it('trims what it accepts, so a padded value reaches the handler clean', async () => {
    const Body = z.object({ name: text('FIELD_EMPTY') })
    expect((await reject(Body, { name: '  Groceries  ' })).body.data).toEqual({
      name: 'Groceries',
    })
  })
})

describe('the status comes from the registry', () => {
  it('uses each code’s own status rather than a blanket 400', async () => {
    const Body = z.object({ id: z.uuid({ error: as('ACCOUNT_NOT_FOUND') }) })
    const { status, body } = await reject(Body, { id: 'nope' })
    expect(body).toEqual({ error: 'ACCOUNT_NOT_FOUND' })
    expect(status).toBe(404)
  })
})

describe('amountLike', () => {
  it('takes the string the web app sends and the number a few callers do', async () => {
    const Body = z.object({ amount: amountLike })
    expect((await reject(Body, { amount: '-12.50' })).body.data).toEqual({ amount: '-12.50' })
    expect((await reject(Body, { amount: -12.5 })).body.data).toEqual({ amount: '-12.5' })
  })

  it('tells an absent amount apart from one of the wrong type', async () => {
    const Body = z.object({ amount: amountLike })
    expect((await reject(Body, {})).body).toEqual({
      error: 'FIELD_REQUIRED',
      detail: { field: 'amount' },
    })
    expect((await reject(Body, { amount: { a: 1 } })).body).toEqual({
      error: 'FIELD_INVALID',
      detail: { field: 'amount' },
    })
  })
})

describe('defined', () => {
  it('is a no-op at runtime — parsing already left absent keys out', async () => {
    const Body = z.object({ a: z.string().optional(), b: z.string().optional() })
    const { body } = await reject(Body, { a: 'x' })
    expect(Object.keys(defined(body.data))).toEqual(['a'])
  })
})
