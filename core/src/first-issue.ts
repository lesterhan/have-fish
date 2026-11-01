// Where a Zod parse failed, as the `{ path, issue }` every malformed-input code carries.

import type { z } from 'zod'

/**
 * Zod's first issue: the field, joined with dots (`postings.1.amount`), and Zod's code. Zod
 * points an extra field at its parent, so the field's own name is added: `weight`, not `''`.
 */
export function firstIssue(error: z.ZodError): { path: string; issue: string } {
  const issue = error.issues[0]
  if (issue === undefined) return { path: '', issue: 'unknown' }
  const path = issue.code === 'unrecognized_keys' ? [...issue.path, issue.keys[0]] : issue.path
  return { path: path.join('.'), issue: issue.code }
}
