import Papa from 'papaparse'

// Parses a raw CSV string into an array of row objects with normalized headers.
// Normalization: lowercase, whitespace removed, parenthetical suffixes stripped.
// e.g. "Transaction Type (CAD)" → "transactiontype"
export function parseCsv(csv: string): Record<string, string>[] {
  return Papa.parse<Record<string, string>>(csv, {
    header: true,
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
