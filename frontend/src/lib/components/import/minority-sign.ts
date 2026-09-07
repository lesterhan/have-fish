/**
 * Which sign, if either, is the minority in a previewed statement.
 *
 * V5 says colour marks the minority sign, and on an import that cannot be hard-coded. A
 * chequing statement is mostly negative, so the refunds are the minority; a *credit card*
 * statement imported as liabilities has its sign flipped — a charge increases what you owe
 * and reads positive — so the minority is negative. Deciding it per screen from the rows in
 * front of you is the only reading that survives both, and getting it wrong is not a subtle
 * miss: hard-coding "tint the positives" painted fifteen ordinary card charges green.
 *
 * Returns `0` when neither sign is a clear minority, in which case nothing is tinted: colour
 * that marks half the rows marks nothing.
 */
export function minoritySign(amounts: readonly number[]): -1 | 0 | 1 {
  let positive = 0
  let negative = 0
  for (const n of amounts) {
    if (!Number.isFinite(n) || n === 0) continue
    if (n > 0) positive++
    else negative++
  }

  if (positive === 0 || negative === 0) return 0
  // A "minority" that is 45% of the rows is not one. Two thirds is the line: below it the
  // list has no dominant sign to fall back to, so tinting either one is just colouring.
  const total = positive + negative
  if (positive < negative && negative / total >= 2 / 3) return 1
  if (negative < positive && positive / total >= 2 / 3) return -1
  return 0
}
