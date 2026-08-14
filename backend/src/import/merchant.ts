// Merchant normalization — shared by import preview (grouping rows by merchant) and
// rule mining (deriving a rule pattern from history). Both must agree: a stem shown
// in the preview has to equal the pattern mining would store for the same merchant,
// or a cluster and the rule covering it would never line up.

// Strip trailing transaction-specific noise (store/terminal numbers, reference codes,
// dates, times) so near-duplicate descriptions from the same merchant collapse to one
// group. Import-time matching is case-insensitive substring (see routes/import.ts), so a
// shortened stem like "LOBLAWS" generalizes across every store location and reference.
export function cleanDescription(raw: string): string {
  let s = raw.trim().replace(/\s+/g, ' ')
  let prev: string
  // Peel trailing noise tokens repeatedly — a description can end in several stacked.
  do {
    prev = s
    s = s
      .replace(/\s*#\s*\d+$/i, '') // store/terminal number: "#042"
      .replace(/\s+\d{4}-\d{2}-\d{2}$/, '') // ISO date: 2025-06-22
      .replace(/\s+\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?$/, '') // date: 06/22 or 06-22-2025
      .replace(/\s+\d{1,2}:\d{2}(:\d{2})?$/, '') // time: 14:30
      .replace(/\s+[a-z]{0,3}\d{4,}$/i, '') // long ref/auth code, optionally letter-prefixed
      .replace(/[\s*#-]+$/, '') // dangling separators
      .trim()
  } while (s !== prev)
  return s
}

// The grouping key for a description: its cleaned stem, falling back to the raw
// description when cleaning leaves too little to match on. A one- or two-character
// stem would match nearly everything as a substring, so those keep their full text.
// Returns '' for a description with no usable content; callers should not group on it.
export function merchantKey(raw: string): string {
  const cleaned = cleanDescription(raw)
  return cleaned.length >= 3 ? cleaned : raw.trim()
}
