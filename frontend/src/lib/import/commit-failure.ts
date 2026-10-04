// The sentence for a refused import commit, naming the row the way the review step does.
//
// The backend names a bad row by its position in the request, and the request leaves out the
// rows the user skipped, so its "row 412" is not the review's row 412 once anything above it
// was skipped. `sent` is the preview index of each row that was sent, in order: the detail's
// index is mapped back through it before the message is written.

import { errorMessage } from '../copy/errors'
import { importCopy } from '../copy/import'

export function commitFailureMessage(body: unknown, sent: readonly number[]): string {
  return errorMessage(inPreviewRows(body, sent), importCopy.commit.failed)
}

/** The refusal with its row index mapped from the request's rows onto the preview's. */
export function inPreviewRows(body: unknown, sent: readonly number[]): unknown {
  if (typeof body !== 'object' || body === null) return body
  const detail = (body as { detail?: unknown }).detail
  if (typeof detail !== 'object' || detail === null) return body
  const index = (detail as { index?: unknown }).index
  if (typeof index !== 'number') return body
  const previewIndex = sent[index]
  // An index past what was sent means the two sides disagree about the request. Keeping the
  // backend's number is wrong by the skipped rows at most; inventing one would be worse.
  if (previewIndex === undefined) return body
  return { ...body, detail: { ...detail, index: previewIndex } }
}
