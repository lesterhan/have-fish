// Generates a large import CSV for perf-testing the import Review step.
//
//   bun run planning/qa/make-perf-csv.ts 200 > /tmp/perf-200.csv
//
// The header matches test-chequing-import.csv / test-visa-import.csv, so a
// parser configured for either of those auto-detects the output.
//
// Every description is unique, which is deliberate:
//   - no existing import rule matches, so every row lands in `needs-review`
//     (the Review step's default filter)
//   - no two rows share a merchantKey, so the Sort step auto-skips
// You therefore land straight on Review with N unresolved rows — the worst
// case, and the only one where the per-row AccountPicker cost is visible.
//
// Measuring: build for production (`bun run build && bun run preview`) and set
// DevTools CPU throttling to 4-6x. A dev build's HMR overhead and an
// unthrottled desktop both swamp the signal.

const n = Number(process.argv[2] ?? 200)
if (!Number.isInteger(n) || n < 1) {
  console.error('usage: bun run planning/qa/make-perf-csv.ts <rowCount>')
  process.exit(1)
}

const KINDS = [
  'CAFE', 'GROCER', 'PHARMACY', 'HARDWARE', 'BOOKSHOP',
  'BAKERY', 'TAXI', 'CLINIC', 'STATIONER', 'LAUNDRY',
]

const lines = ['Date,Description,Amount,Balance']
let balance = 25000

for (let i = 0; i < n; i++) {
  // Three rows per day, so the sticky day headers get exercised too.
  const day = new Date(Date.UTC(2026, 0, 5))
  day.setUTCDate(day.getUTCDate() + Math.floor(i / 3))
  const date = [
    String(day.getUTCMonth() + 1).padStart(2, '0'),
    String(day.getUTCDate()).padStart(2, '0'),
    day.getUTCFullYear(),
  ].join('/')

  // Deterministic amounts, so two runs at the same row count are identical.
  const amount = -(((i * 37) % 9000) / 100 + 1.99)
  balance += amount

  const desc = `QA ${KINDS[i % KINDS.length]} ${String(i).padStart(4, '0')}`
  lines.push(`${date},${desc},${amount.toFixed(2)},${balance.toFixed(2)}`)
}

console.log(lines.join('\n'))
