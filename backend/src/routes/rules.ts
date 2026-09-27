import { Hono } from 'hono'
import { z } from 'zod'
import type { AppVariables } from '../app'
import { fail, failWith } from '../errors'
import {
  createRule,
  deleteRule,
  listRules,
  mineRules,
  moveRule,
  updateRule,
} from '../rules/rule-service'
import { namesTarget } from '../rules/target'
import { asField, parseBody, text } from '../validation'

// The handlers parse the request and answer; the rules about rules are in `rules/`.

const app = new Hono<{ Variables: AppVariables }>()

// The three id fields a rule's target is drawn from. Both write routes accept them, and null
// is meaningful — it is how a target is cleared — so each is nullable as well as optional.
// `rules/target.ts` says which combinations name a target.
const targetFields = {
  accountId: z.uuid({ error: asField('FIELD_NOT_UUID') }).nullish(),
  groupId: z.uuid({ error: asField('FIELD_NOT_UUID') }).nullish(),
  categoryId: z.uuid({ error: asField('FIELD_NOT_UUID') }).nullish(),
}

// GET /api/rules
// Returns all non-deleted rules (active + suggested + denied) for the current user,
// with the display fields for whichever target kind each rule uses.
app.get('/', async (c) => c.json(await listRules(c.get('userId'))))

// POST /api/rules
// Creates a rule manually. status defaults to 'active'.
// Body: { pattern: string } plus exactly one target:
//   { accountId } — post to an expense account
//   { groupId, categoryId? } — split into a Fish Pie group
const NewRule = z.object({ pattern: text('FIELD_REQUIRED'), ...targetFields })

app.post('/', async (c) => {
  const parsed = await parseBody(c, NewRule)
  if (!parsed.ok) return parsed.response
  const result = await createRule(c.get('userId'), parsed.data)
  if (!result.ok) return failWith(c, result.failure)
  return c.json(result.value, 201)
})

// POST /api/rules/mine
// Analyzes transaction history and writes new 'suggested' rules; `rules/mining.ts` says
// which transactions count and which patterns are suggested.
// Returns { created: number }.
app.post('/mine', async (c) => c.json(await mineRules(c.get('userId'))))

// PATCH /api/rules/:id
// Updates the pattern and/or the target. At least one field required. The target is
// replaced wholesale; `updateRule` says why.
const RulePatch = z.object({ pattern: text('FIELD_EMPTY').optional(), ...targetFields })

app.patch('/:id', async (c) => {
  const parsed = await parseBody(c, RulePatch)
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const target = namesTarget(body) ? body : undefined
  if (body.pattern === undefined && !target) return fail(c, 'NO_FIELDS_TO_UPDATE')

  const result = await updateRule(c.get('userId'), c.req.param('id'), {
    pattern: body.pattern,
    target,
  })
  if (!result.ok) return failWith(c, result.failure)
  return c.json(result.value)
})

// DELETE /api/rules/:id
// Soft-deletes a rule.
app.delete('/:id', async (c) => {
  await deleteRule(c.get('userId'), c.req.param('id'))
  return c.body(null, 204)
})

// A rule's status moves; `moveRule` says which moves exist and from where.

// POST /api/rules/:id/approve — a rule becomes active.
app.post('/:id/approve', async (c) => {
  const result = await moveRule(c.get('userId'), c.req.param('id'), 'approve')
  if (!result.ok) return failWith(c, result.failure)
  return c.json(result.value)
})

// POST /api/rules/:id/deny — a suggestion becomes denied, and is never suggested again.
app.post('/:id/deny', async (c) => {
  const result = await moveRule(c.get('userId'), c.req.param('id'), 'deny')
  if (!result.ok) return failWith(c, result.failure)
  return c.json(result.value)
})

// POST /api/rules/:id/revive — a denied rule becomes a suggestion again.
app.post('/:id/revive', async (c) => {
  const result = await moveRule(c.get('userId'), c.req.param('id'), 'revive')
  if (!result.ok) return failWith(c, result.failure)
  return c.json(result.value)
})

export default app
