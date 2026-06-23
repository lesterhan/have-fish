import { describe, it, expect } from 'bun:test'
import { detectDelimiter, parseCsv, normalizeHeader } from './csv-parser'

describe('detectDelimiter', () => {
  it('detects comma', () => {
    expect(detectDelimiter('Date,Amount,Description\n2026-01-01,10,Coffee')).toBe(',')
  })

  it('detects semicolon (EU-style export)', () => {
    expect(detectDelimiter('Date;Amount;Description\n2026-01-01;10;Coffee')).toBe(';')
  })

  it('detects tab', () => {
    expect(detectDelimiter('Date\tAmount\tDescription')).toBe('\t')
  })

  it('detects pipe', () => {
    expect(detectDelimiter('Date|Amount|Description')).toBe('|')
  })

  it('ignores delimiters inside quoted header fields', () => {
    // The quoted comma must not out-vote the three real semicolons.
    expect(detectDelimiter('"Name, full";Amount;Date')).toBe(';')
  })

  it('defaults to comma for a single-column file', () => {
    expect(detectDelimiter('Description\nCoffee')).toBe(',')
  })

  it('skips leading blank lines when finding the header', () => {
    expect(detectDelimiter('\n\nDate;Amount;Note')).toBe(';')
  })
})

describe('parseCsv', () => {
  it('parses a semicolon-delimited file via auto-detection', () => {
    const rows = parseCsv('Date;Amount;Description\n2026-01-01;10.00;Coffee')
    expect(rows).toEqual([{ date: '2026-01-01', amount: '10.00', description: 'Coffee' }])
  })

  it('parses a tab-delimited file', () => {
    const rows = parseCsv('Date\tAmount\n2026-01-01\t10.00')
    expect(rows).toEqual([{ date: '2026-01-01', amount: '10.00' }])
  })

  it('honours an explicit delimiter override', () => {
    // Auto-detect would pick comma, but the file is really pipe-delimited with a
    // comma living inside a value.
    const rows = parseCsv('Date|Description\n2026-01-01|Smith, John', '|')
    expect(rows).toEqual([{ date: '2026-01-01', description: 'Smith, John' }])
  })

  it('respects quoted fields containing the delimiter', () => {
    const rows = parseCsv('Date;Description\n2026-01-01;"Smith; John"')
    expect(rows).toEqual([{ date: '2026-01-01', description: 'Smith; John' }])
  })

  it('produces a fingerprint that matches across delimiters', () => {
    const comma = normalizeHeader(Object.keys(parseCsv('Date,Amount,Description\n2026-01-01,10,x')[0]))
    const semi = normalizeHeader(Object.keys(parseCsv('Date;Amount;Description\n2026-01-01;10;x')[0]))
    expect(comma).toBe(semi)
  })
})
