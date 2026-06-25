// Narration blurb — the one plain-language sentence that sits between the hero and the flow
// tree in the transaction detail modal. This is COPY THE USER WILL TWEAK: tone, wording, and
// which numbers get emphasis are all expected to change, so the templates live here in one
// easy-to-find map rather than hardcoded in the component.
//
// Each template returns structured `BlurbParts` (not a string), so the render bolds numbers
// and accent-colors the "owes you" span without parsing text back apart. Every number/name
// comes from the narration model — nothing in here is a literal amount.
//
// One template per archetype; `blurbFor(n)` dispatches on `n.archetype`. All templates are
// null-safe (a malformed shape produces a sane sentence, never a throw).

import type { Archetype, NarratedTransaction, Branch } from './narration'
import { accountLabel } from './narration'

// A blurb is a flat list of styled segments the render walks:
//   text   → plain
//   emph   → bold (an amount or an account name)
//   accent → accent-colored (the "owes you" relationship span)
export type BlurbSegment =
  | { kind: 'text'; text: string }
  | { kind: 'emph'; text: string }
  | { kind: 'accent'; text: string }
export type BlurbParts = BlurbSegment[]

const t = (text: string): BlurbSegment => ({ kind: 'text', text })
const em = (text: string): BlurbSegment => ({ kind: 'emph', text })
const ac = (text: string): BlurbSegment => ({ kind: 'accent', text })

// "50.00 CAD" — magnitude + code. Sign is conveyed by the surrounding wording, not here.
const money = (amount: string, currency: string): string =>
  `${Math.abs(parseFloat(amount) || 0).toFixed(2)} ${currency}`

// The human party behind a clearing leg: the last path segment, title-cased.
//   assets:receivable:roommates → "Roommates"
const partyName = (path: string): string => {
  const last = path.split(':').filter(Boolean).pop() ?? path
  return last
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

const branchByChip = (n: NarratedTransaction, chip: Branch['chip']): Branch | undefined =>
  n.branches.find((b) => b.chip === chip)

// "You spent 50.00 CAD on Food · Cafe from Chequing."
function directBlurb(n: NarratedTransaction): BlurbParts {
  if (!n.hero) return [t('A transfer with no spend category.')]
  const parts: BlurbParts = [
    t('You spent '),
    em(money(n.hero.amount, n.hero.currency)),
    t(' on '),
    em(n.hero.label),
  ]
  if (n.source) parts.push(t(' from '), em(accountLabel(n.source)))
  parts.push(t('.'))
  return parts
}

// "You fronted 30.00 CAD for Food. Your share is 20.00 CAD; Roommates owes you 10.00 CAD."
function splitBlurb(n: NarratedTransaction): BlurbParts {
  const share = branchByChip(n, 'your-share')
  const owed = branchByChip(n, 'owes-you')
  const fronted = n.source
    ? money(n.source.amount, n.source.currency)
    : n.hero
      ? money(n.hero.amount, n.hero.currency)
      : '—'
  const category = share?.label ?? n.hero?.label ?? 'this'
  const parts: BlurbParts = [t('You fronted '), em(fronted), t(' for '), em(category), t('.')]
  if (share) parts.push(t(' Your share is '), em(money(share.amount, share.currency)), t(';'))
  if (owed) {
    parts.push(t(' '), ac(`${partyName(owed.path)} owes you ${money(owed.amount, owed.currency)}`))
  }
  parts.push(t('.'))
  return parts
}

// "You spent 360.00 CZK on Food · Coffee — 17.24 USD at 20.88 CZK/USD."
function multiCurrencyBlurb(n: NarratedTransaction): BlurbParts {
  if (!n.hero) return [t('A cross-currency transfer.')]
  const c = n.conversion
  const native = c ? `${c.converted.amount} ${c.converted.currency}` : money(n.hero.amount, n.hero.currency)
  const parts: BlurbParts = [t('You spent '), em(native), t(' on '), em(n.hero.label)]
  if (c) parts.push(t(' — '), em(`${c.paid.amount} ${c.paid.currency}`), t(' at '), em(`${c.rate} ${c.rateUnit}`))
  parts.push(t('.'))
  return parts
}

// "2000.00 CAD came into Chequing for Salary." (income / refund)
function inflowBlurb(n: NarratedTransaction): BlurbParts {
  if (!n.hero) return [t('Money came in.')]
  const parts: BlurbParts = [em(money(n.hero.amount, n.hero.currency)), t(' came into ')]
  parts.push(em(n.source ? accountLabel(n.source) : 'your account'))
  parts.push(t(' for '), em(n.hero.label), t('.'))
  return parts
}

// The one map. Edit wording/emphasis per archetype here.
export const blurbTemplates: Record<Archetype, (n: NarratedTransaction) => BlurbParts> = {
  direct: directBlurb,
  split: splitBlurb,
  multiCurrency: multiCurrencyBlurb,
  inflow: inflowBlurb,
}

export function blurbFor(n: NarratedTransaction): BlurbParts {
  return blurbTemplates[n.archetype](n)
}

// Flatten to plain text — for an aria-label or a tooltip on the rendered blurb.
export const blurbText = (parts: BlurbParts): string => parts.map((p) => p.text).join('')
