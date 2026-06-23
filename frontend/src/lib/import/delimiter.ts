// CSV delimiter detection + a quote-aware line splitter for the import wizard.
//
// Kept deliberately framework-free (no Svelte, no DOM) so it mirrors the backend
// detector in backend/src/import/csv-parser.ts. The two must agree on the same
// file: the wizard builds a parser's column fingerprint from the delimiter it
// picks here, and the backend matches an uploaded CSV against that fingerprint.

export const SUPPORTED_DELIMITERS = [',', ';', '\t', '|'] as const
export type Delimiter = (typeof SUPPORTED_DELIMITERS)[number]

// Human labels for the override dropdown.
export const DELIMITER_LABELS: Record<Delimiter, string> = {
  ',': 'Comma  ,',
  ';': 'Semicolon  ;',
  '\t': 'Tab  ⇥',
  '|': 'Pipe  |',
}

// Counts occurrences of `delimiter` in `line` outside of double-quoted fields,
// so a delimiter inside a quoted column (e.g. "Smith, John") isn't counted.
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

// Guesses the field delimiter from a CSV's header (first non-empty) line: the
// candidate occurring most often outside quotes wins, comma on a tie or when
// none appear. Matches detectDelimiter in the backend csv-parser.
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

// Splits one CSV line on `delimiter`, respecting double-quoted fields and the
// "" escape for a literal quote inside a quoted field. Surrounding quotes are
// stripped from each returned field.
export function splitCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        field += '"'
        i++ // skip the escaped quote
      } else {
        inQuotes = !inQuotes
      }
    } else if (!inQuotes && ch === delimiter) {
      fields.push(field)
      field = ''
    } else {
      field += ch
    }
  }
  fields.push(field)
  return fields
}
