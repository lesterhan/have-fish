// Pure render helpers for TransactionDetail.svelte. The frontend has no component-render
// harness, so every non-trivial display decision the modal makes — the header tag, the chip
// wording + color tone, the hero's sign/direction, the multi-currency inline note, the date
// string — lives here as a pure function the unit tests can pin. The .svelte file stays a
// dumb walk over the narration model (narration.ts) and these helpers.

import type { NarratedTransaction, Chip, Branch } from './narration'

// --- header tag ---------------------------------------------------------------------------

// The accent pill beside the payee: a Fish Pie split names its group; an inflow says whether
// money came back (refund of an expense) or in (income). Direct/multi-currency spends get no
// tag. Null = no pill.
export function headerTag(
  n: NarratedTransaction,
  groupName: string | null,
): { label: string } | null {
  if (n.archetype === 'split') {
    return { label: groupName ? `Split · ${groupName}` : 'Split' }
  }
  if (n.archetype === 'inflow') {
    const path = n.hero?.path ?? ''
    return { label: path.startsWith('income') ? 'Income' : 'Refund' }
  }
  return null
}

// --- role chips ---------------------------------------------------------------------------

// Ledger jargon → the plain meaning the chip shows.
const CHIP_LABELS: Record<Chip, string> = {
  'the-spend': 'the spend',
  'your-share': 'your share',
  'owes-you': 'owes you',
  'you-owe': 'you owe',
  'fx-fee': 'FX fee',
  deposit: 'deposit',
}

export function chipLabel(chip: Chip): string {
  return CHIP_LABELS[chip]
}

// The color tone a chip (and its branch amount) wears:
//   accent   → the "owes you" receivable relationship (app accent)
//   positive → money landing in an account (deposit) — green
//   amber    → an FX fee — caution
//   neutral  → everything else (the spend / your share / you owe)
export type Tone = 'accent' | 'positive' | 'amber' | 'neutral'

export function chipTone(chip: Chip): Tone {
  if (chip === 'owes-you') return 'accent'
  if (chip === 'deposit') return 'positive'
  if (chip === 'fx-fee') return 'amber'
  return 'neutral'
}

// --- hero ---------------------------------------------------------------------------------

// How the headline amount reads: magnitude at 2dp, a leading `+` on an inflow, and the
// positive flag the render uses to color it green.
export type HeroDisplay = {
  label: string
  path: string
  amount: string
  currency: string
  sign: '+' | ''
  positive: boolean
}

export function heroDisplay(n: NarratedTransaction): HeroDisplay | null {
  if (!n.hero) return null
  return {
    label: n.hero.label,
    path: n.hero.path,
    amount: heroAmount(n),
    currency: n.hero.currency,
    sign: n.hero.inflow ? '+' : '',
    positive: n.hero.inflow,
  }
}

// The headline magnitude. For most archetypes it is the hero leg itself; for a split the
// hero shows the *full bill you fronted* (your share + what others owe), not just your slice
// — so the big number matches what left the account. That total is the source outflow when
// it is same-currency as the hero (the cleanest reading, and correct for a multi-category
// split); otherwise fall back to hero + the relational (owes-you / you-owe) branches.
function heroAmount(n: NarratedTransaction): string {
  const heroAbs = Math.abs(parseFloat(n.hero!.amount) || 0)
  if (n.archetype !== 'split') return heroAbs.toFixed(2)

  if (n.source && n.source.currency === n.hero!.currency) {
    return Math.abs(parseFloat(n.source.amount) || 0).toFixed(2)
  }
  const relational = n.branches
    .filter(
      (b) =>
        (b.chip === 'owes-you' || b.chip === 'you-owe') && b.currency === n.hero!.currency,
    )
    .reduce((sum, b) => sum + Math.abs(parseFloat(b.amount) || 0), 0)
  return (heroAbs + relational).toFixed(2)
}

// --- branch ordering ----------------------------------------------------------------------

// The flow tree reads top-to-bottom in meaning order, not raw posting order: what the money
// bought first (the spend / your share / a deposit), then the relationship it created (who
// owes whom), then the mechanical FX fee last. Stable — ties keep input order.
const CHIP_RANK: Record<Chip, number> = {
  'the-spend': 0,
  'your-share': 0,
  deposit: 0,
  'owes-you': 1,
  'you-owe': 1,
  'fx-fee': 2,
}

export function orderedBranches(branches: Branch[]): Branch[] {
  return branches
    .map((b, i) => ({ b, i }))
    .sort((x, y) => CHIP_RANK[x.b.chip] - CHIP_RANK[y.b.chip] || x.i - y.i)
    .map(({ b }) => b)
}

// --- branch amount ------------------------------------------------------------------------

// Branch amounts always show magnitude; the chip + tone convey direction.
export function branchAmount(amount: string): string {
  return Math.abs(parseFloat(amount) || 0).toFixed(2)
}

// --- multi-currency inline note -----------------------------------------------------------

// The "converted @ rate" hint that rides the-spend branch on a cross-currency spend and (in
// story 5) opens the conversion expander. Null unless a conversion was derived.
//   "17.24 USD @ 20.88 CZK/USD"
export function convertedNote(n: NarratedTransaction): string | null {
  const c = n.conversion
  if (!c) return null
  return `${c.paid.amount} ${c.paid.currency} @ ${c.rate} ${c.rateUnit}`
}

// --- date ---------------------------------------------------------------------------------

// The transaction date as "Wed, Jun 24, 2026". Parsed at local midnight so the stored UTC
// calendar date is not shifted by the viewer's timezone.
export function formatTxDate(date: string): string {
  const d = new Date(date.substring(0, 10) + 'T00:00:00')
  return d.toLocaleDateString('en', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
