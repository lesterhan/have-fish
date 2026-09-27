import { detectDelimiter, normalizeHeader, parseCsv, SUPPORTED_DELIMITERS } from './csv-parser'
import { merchantKey } from './merchant'
import type { ParsedTransaction } from './types'

// What an import preview decides without a database: which saved parser a file belongs
// to, and what each parsed row suggests. `preview-service.ts` loads the parsers, the rules
// and the user's name, and calls these.

/**
 * Find the saved parser whose header fingerprint matches the file, and the rows as that
 * parser's delimiter reads them.
 *
 * The detected delimiter is tried first; if no parser matches, the remaining supported
 * delimiters are tried before giving up. That way a parser built with a manually-overridden
 * delimiter still matches, even when the auto-detector would have guessed a different one
 * for the same file.
 *
 * `rows` is what the last delimiter tried produced, so an empty file comes back with no
 * rows and no parser.
 */
export function matchParser<P extends { normalizedHeader: string }>(
  csv: string,
  parsers: readonly P[],
): { rows: Record<string, string>[]; parser: P | undefined } {
  const detected = detectDelimiter(csv)
  const candidates = [detected, ...SUPPORTED_DELIMITERS.filter((d) => d !== detected)]

  let rows: Record<string, string>[] = []
  for (const delimiter of candidates) {
    rows = parseCsv(csv, delimiter)
    const header = rows[0]
    if (!header) continue
    const fingerprint = normalizeHeader(Object.keys(header))
    const parser = parsers.find((p) => p.normalizedHeader === fingerprint)
    if (parser) return { rows, parser }
  }
  return { rows, parser: undefined }
}

/** An active import rule, as far as the preview reads it. */
export type PreviewRule = {
  pattern: string
  accountId: string | null
  groupId: string | null
  categoryId: string | null
}

/**
 * Stamp each parsed row with what the preview suggests for it.
 *
 * - **Merchant key.** The stem the review clusters repeat merchants by. Stamped on every
 *   row carrying a description, whatever its kind and whether or not a rule matched, so
 *   grouping does not depend on rules existing yet. Omitted when the description
 *   normalizes to nothing, since an empty key would group unrelated rows.
 * - **Rule.** The first active rule whose pattern is a case-insensitive substring of the
 *   description. An account rule suggests the offset account (a regular row) or the
 *   expense account (a cross-currency spend); a split rule suggests a Fish Pie group and
 *   optional category, which the row renders pre-split. First match wins either way, so
 *   the two kinds compete on equal footing. The matching pattern travels with the
 *   suggestion so the UI can name the rule that fired.
 * - **Kind**, for a cross-currency row. A spend (a card purchase, where the counterparty is
 *   a merchant) unless the description contains the user's own name, which marks a
 *   convert-and-park such as a Wise CAD→EUR conversion. Spends dominate, so they are the
 *   default. `userName` is the user's name, trimmed and lower-cased.
 */
export function suggest(
  rows: readonly ParsedTransaction[],
  rules: readonly PreviewRule[],
  userName: string,
) {
  const matchRule = (description: string) =>
    rules.find((r) => description.toLowerCase().includes(r.pattern.toLowerCase()))

  // Turns a matched rule into the suggestion fields for a row. `accountField` differs by
  // row kind, but a split rule suggests the same group/category either way, since both
  // commit through the Fish Pie posting builders.
  const suggestionFor = (
    match: PreviewRule,
    accountField: 'suggestedOffsetAccountId' | 'suggestedExpenseAccountId',
  ) => ({
    ...(match.accountId
      ? { [accountField]: match.accountId }
      : { suggestedGroupId: match.groupId, suggestedCategoryId: match.categoryId }),
    matchedRulePattern: match.pattern,
  })

  return rows.map((t) => {
    const stem = t.description ? merchantKey(t.description) : ''
    const base = stem ? { ...t, merchantKey: stem } : t

    if (t.isTransfer === false) {
      if (!t.description) return base
      const match = matchRule(t.description)
      return match ? { ...base, ...suggestionFor(match, 'suggestedOffsetAccountId') } : base
    }
    if (t.isTransfer === true) {
      const desc = (t.description ?? '').trim().toLowerCase()
      const isOwnTransfer = userName.length > 0 && desc.length > 0 && desc.includes(userName)
      if (isOwnTransfer) return { ...base, suggestedKind: 'transfer' as const }
      const match = t.description ? matchRule(t.description) : undefined
      return {
        ...base,
        suggestedKind: 'spend' as const,
        ...(match ? suggestionFor(match, 'suggestedExpenseAccountId') : {}),
      }
    }
    return base
  })
}
