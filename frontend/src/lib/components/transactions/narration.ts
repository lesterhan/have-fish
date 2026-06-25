// Layered narration model for the redesigned TransactionDetail modal. Turns a flat list of
// role-classified postings into a structure that *reads* like what happened: a hero (what the
// money was for), the real source asset, role-chipped branches (how it moved), the FX
// conversion math, and a per-currency balance check.
//
// This is the load-bearing model for the Flow Narration epic. It is pure (no Svelte) and
// exhaustively unit-tested against the four canonical archetypes plus the inflow-sign case
// and malformed shapes (see narration.test.ts). The render (story 4/5) is dumb over this.
//
// NOTE: this supersedes the legacy `narrate.ts`, whose flatter shape (`subjects` / `movement`)
// is still consumed by the spending rows + the soon-to-be-retired SummaryEditModal. Those
// migrate (or get deleted) in later stories; until then both models coexist by design.
//
// Roles come from the backend classifier (src/postings/roles.ts), exposed on the GET payload:
//   subject    → the meaningful economic leg (the spend / the paycheck / a refund). The hero.
//   transfer   → asset/liability move. The source the money left (or landed in, on an inflow).
//   conversion → FX rate-balancing equity bridge leg. Never a branch — only conversion math.
//   fee        → bank/transfer fee. An `fx-fee` branch.
//   share      → Fish Pie clearing leg (receivable = owed to you / payable = you owe).

import type { Posting } from '$lib/api'

// The chip that labels a branch with its *meaning* instead of ledger jargon.
export type Chip = 'the-spend' | 'your-share' | 'owes-you' | 'you-owe' | 'fx-fee' | 'deposit'

// simple   → 1 asset out → 1 expense in (or a same-currency multi-category split).
// split    → has a Fish Pie share leg (someone owes / is owed).
// multiCurrency → an FX conversion bridge is present.
// inflow   → income or refund: the subject is stored negative, money lands in an asset.
export type Archetype = 'simple' | 'split' | 'multiCurrency' | 'inflow'

// The headline — what the money was for. Amount is kept signed as stored; `inflow` tells the
// render to show it green with a leading `+`.
export type Hero = {
  posting: Posting
  label: string
  path: string
  amount: string
  currency: string
  inflow: boolean
} | null

// A non-source, non-conversion leg, tagged with the chip that explains its role.
export type Branch = {
  posting: Posting
  chip: Chip
  label: string
  path: string
  amount: string
  currency: string
}

// FX conversion math, derived from the two equity bridge legs. Present only on a genuine
// cross-currency transaction (≥2 conversion legs spanning ≥2 currencies).
export type Conversion = {
  // What actually left the source asset (its currency).
  paid: { amount: string; currency: string }
  // What it became in the subject's native currency.
  converted: { amount: string; currency: string }
  // The FX fee, if one was charged.
  fee: { amount: string; currency: string } | null
  // converted / paid, expressed native-per-source (e.g. "20.88").
  rate: string
  // The rate's unit, e.g. "CZK/USD".
  rateUnit: string
}

// Per-currency sum-zero assertion across all legs (incl. the conversion bridge).
export type Balances = {
  ok: boolean
  byCurrency: { currency: string; sum: string }[]
}

export type NarratedTransaction = {
  archetype: Archetype
  hero: Hero
  // The asset the money left (outflow) or landed in (inflow). Null when there is no transfer
  // leg (e.g. an opening-balance equity entry).
  source: Posting | null
  branches: Branch[]
  conversion: Conversion | null
  // Every raw leg, in input order, incl. the equity bridges — for the "All postings" expander.
  allPostings: Posting[]
  balances: Balances
}

// --- amount helpers (integer cents — never trust float sums of `numeric(12,2)` strings) ---

const cents = (a: string): number => Math.round((parseFloat(a) || 0) * 100)
const fromCents = (c: number): string => (c / 100).toFixed(2)
const abs2 = (a: string): string => Math.abs(parseFloat(a) || 0).toFixed(2)

// --- label resolution -------------------------------------------------------------------

const titleCaseWord = (seg: string): string =>
  seg
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')

// Derive a friendly label from an account path: drop the root segment, title-case the last
// one or two segments, joined with ` · `.
//   expenses:housing:rent → "Housing · Rent"
//   expenses:food         → "Food"
//   assets:receivable:roommates → "Receivable · Roommates"
export function prettifyPath(path: string): string {
  const segs = path.split(':').filter(Boolean)
  if (segs.length === 0) return path
  const body = segs.length > 1 ? segs.slice(1) : segs
  return body.slice(-2).map(titleCaseWord).join(' · ')
}

// The display label for an account: its explicit `name` if set, else a prettified path.
export function accountLabel(p: { accountName: string | null; accountPath: string }): string {
  return p.accountName && p.accountName.trim() ? p.accountName : prettifyPath(p.accountPath)
}

// --- role/path predicates ---------------------------------------------------------------

const isPayable = (path: string): boolean =>
  path.startsWith('liabilities:payable') || path.includes(':payable:')

// A share leg is a receivable unless it is explicitly a payable.
const shareChip = (path: string): Chip => (isPayable(path) ? 'you-owe' : 'owes-you')

// The chip for a non-source, non-conversion branch.
//   fee                         → fx-fee
//   share                       → owes-you / you-owe
//   subject, negative (inflow)  → deposit (money came in)
//   subject, positive, in split → your-share (your slice of a fronted bill)
//   subject, positive           → the-spend
//   transfer destination        → deposit (positive) / the-spend (negative, atypical)
function chipFor(p: Posting, hasShare: boolean): Chip {
  if (p.role === 'fee') return 'fx-fee'
  if (p.role === 'share') return shareChip(p.accountPath)
  if (p.role === 'subject') {
    if (parseFloat(p.amount) < 0) return 'deposit'
    return hasShare ? 'your-share' : 'the-spend'
  }
  return parseFloat(p.amount) >= 0 ? 'deposit' : 'the-spend'
}

// --- the model --------------------------------------------------------------------------

export function narrateTransaction(postings: Posting[]): NarratedTransaction {
  const subjects = postings.filter((p) => p.role === 'subject')
  const transfers = postings.filter((p) => p.role === 'transfer')
  const convLegs = postings.filter((p) => p.role === 'conversion')
  const hasShare = postings.some((p) => p.role === 'share')

  // Hero = the largest-abs subject leg. Inflow when stored negative (income/refund).
  const heroPosting =
    subjects.length > 0
      ? subjects.reduce((best, p) =>
          Math.abs(parseFloat(p.amount)) > Math.abs(parseFloat(best.amount)) ? p : best,
        )
      : null
  const inflow = heroPosting ? parseFloat(heroPosting.amount) < 0 : false
  const hero: Hero = heroPosting
    ? {
        posting: heroPosting,
        label: accountLabel(heroPosting),
        path: heroPosting.accountPath,
        amount: heroPosting.amount,
        currency: heroPosting.currency,
        inflow,
      }
    : null

  // Source = the asset that moved. Outflow → most-negative transfer; inflow → most-positive
  // (the account the money landed in). Null when there is no transfer leg.
  let source: Posting | null = null
  if (transfers.length > 0) {
    const sorted = [...transfers].sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount))
    source = inflow ? sorted[sorted.length - 1] : sorted[0]
  }

  // Conversion = a genuine FX bridge: ≥2 equity:conversions legs across ≥2 currencies, with
  // one bridge matching the subject (native) currency and one matching the source currency.
  let conversion: Conversion | null = null
  const convCurrencies = new Set(convLegs.map((c) => c.currency))
  if (convLegs.length >= 2 && convCurrencies.size >= 2 && hero && source) {
    const nativeCcy = hero.currency
    const sourceCcy = source.currency
    const nativeBridge = convLegs.find((c) => c.currency === nativeCcy)
    const sourceBridge = convLegs.find((c) => c.currency === sourceCcy)
    if (nativeBridge && sourceBridge && nativeCcy !== sourceCcy) {
      const paidAbs = Math.abs(parseFloat(source.amount))
      const nativeAbs = Math.abs(parseFloat(nativeBridge.amount))
      const sourceAbs = Math.abs(parseFloat(sourceBridge.amount))
      const rateNum = sourceAbs > 0 ? nativeAbs / sourceAbs : 0
      const feeLeg = postings.find((p) => p.role === 'fee')
      conversion = {
        paid: { amount: paidAbs.toFixed(2), currency: sourceCcy },
        converted: { amount: nativeAbs.toFixed(2), currency: nativeCcy },
        fee: feeLeg ? { amount: abs2(feeLeg.amount), currency: feeLeg.currency } : null,
        // ≥1 rates read naturally at 2dp ("20.88"); sub-1 rates need more to stay meaningful.
        rate: rateNum >= 1 ? rateNum.toFixed(2) : rateNum.toFixed(4),
        rateUnit: `${nativeCcy}/${sourceCcy}`,
      }
    }
  }

  // Archetype drives the header tag + blurb selection (story 3).
  let archetype: Archetype
  if (conversion) archetype = 'multiCurrency'
  else if (hasShare) archetype = 'split'
  else if (inflow) archetype = 'inflow'
  else archetype = 'simple'

  // Branches = every non-source, non-conversion leg, chipped. The equity bridges are never
  // branches; they live only in the conversion math + the All-postings expander.
  const branches: Branch[] = postings
    .filter((p) => p !== source && p.role !== 'conversion')
    .map((p) => ({
      posting: p,
      chip: chipFor(p, hasShare),
      label: accountLabel(p),
      path: p.accountPath,
      amount: p.amount,
      currency: p.currency,
    }))

  // Balances = per-currency sum across every leg; should be zero within rounding.
  const byCcy = new Map<string, number>()
  for (const p of postings) byCcy.set(p.currency, (byCcy.get(p.currency) ?? 0) + cents(p.amount))
  const byCurrency = [...byCcy].map(([currency, c]) => ({ currency, sum: fromCents(c) }))
  const ok = byCurrency.every((b) => Math.abs(parseFloat(b.sum)) < 0.005)

  return {
    archetype,
    hero,
    source,
    branches,
    conversion,
    allPostings: postings,
    balances: { ok, byCurrency },
  }
}
