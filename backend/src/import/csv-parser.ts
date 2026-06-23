import Papa from 'papaparse'

// The delimiters we support, in priority order for tie-breaking (comma wins ties).
// Banks in EU/locale-specific exports commonly use ';'; some use tab or pipe.
export const SUPPORTED_DELIMITERS = [',', ';', '\t', '|'] as const
export type Delimiter = (typeof SUPPORTED_DELIMITERS)[number]

// Counts how many times `delimiter` appears in `line` outside of double-quoted
// fields, so a delimiter inside a quoted column (e.g. "Smith, John") isn't counted.
function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (!inQuotes && ch === delimiter) {
      count++
    }
  }
  return count
}

// Guesses the field delimiter of a CSV by inspecting its header (first non-empty)
// line: the candidate that occurs most often outside quotes wins, comma on a tie
// or when none appear. Deterministic so the import wizard and the import preview
// always agree on the same file.
export function detectDelimiter(csv: string): Delimiter {
  const headerLine = csv.split(/\r?\n/).find((l) => l.trim().length > 0) ?? ''
  let best: Delimiter = ','
  let bestCount = -1
  for (const d of SUPPORTED_DELIMITERS) {
    const count = countOutsideQuotes(headerLine, d)
    if (count > bestCount) {
      best = d
      bestCount = count
    }
  }
  return best
}

// Parses a raw CSV string into an array of row objects with normalized headers.
// Normalization: lowercase, whitespace removed, parenthetical suffixes stripped.
// e.g. "Transaction Type (CAD)" → "transactiontype"
//
// The delimiter is auto-detected from the header when not supplied. Pass an
// explicit delimiter to force a specific one (e.g. retrying a different guess).
export function parseCsv(csv: string, delimiter?: Delimiter): Record<string, string>[] {
  return Papa.parse<Record<string, string>>(csv, {
    header: true,
    delimiter: delimiter ?? detectDelimiter(csv),
    transformHeader: (h) =>
      h
        .toLowerCase()
        .replace(/\s/g, '')
        .replace(/\(.*\)/g, ''),
    dynamicTyping: false,
    skipEmptyLines: true,
  }).data
}

// Produces the normalized fingerprint for a set of column names.
// Used both when saving a parser config and when detecting which parser
// matches an uploaded CSV — must be identical in both places.
export function normalizeHeader(columns: string[]): string {
  return columns
    .map((c) =>
      c
        .toLowerCase()
        .replace(/\s/g, '')
        .replace(/\(.*\)/g, '')
    )
    .sort()
    .join('|')
}
