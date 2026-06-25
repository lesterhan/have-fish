// Narration blurb — the one plain-language sentence that sits between the hero and the flow
// tree in the transaction detail modal. This is COPY THE USER WILL TWEAK: tone, wording, and
// which numbers get emphasis are all expected to change, so the templates live here in one
// easy-to-find map rather than hardcoded in the component.
//
// Each template returns structured `BlurbParts` (not a string), so the render can bold the
// figures without parsing text back apart. Only the *numbers* are emphasized — account and
// category names ride as plain text, so a bold label doesn't run into the bold amount beside
// it. Every number/name comes from the narration model — nothing here is a literal amount.
//
// One template per archetype; `blurbFor(n)` dispatches on `n.archetype`. All templates are
// null-safe (a malformed shape produces a sane sentence, never a throw).

import type { Archetype, NarratedTransaction, Branch } from './narration'
import { accountLabel } from './narration'

// A blurb is a flat list of segments the render walks:
//   text   → plain
//   emph   → bold (a money figure)
//   break  → a hard line break (splits a two-clause blurb across two lines)
export type BlurbSegment =
  | { kind: 'text'; text: string }
  | { kind: 'emph'; text: string }
  | { kind: 'break' }
export type BlurbParts = BlurbSegment[]

const t = (text: string): BlurbSegment => ({ kind: 'text', text })
const em = (text: string): BlurbSegment => ({ kind: 'emph', text })
const br: BlurbSegment = { kind: 'break' }

// A magnitude at 2dp — "50.00". Sign is conveyed by the surrounding wording, not here.
const money = (amount: string): string => `${Math.abs(parseFloat(amount) || 0).toFixed(2)}`

// An amount as two segments: the number emphasized (bold), the currency CODE demoted to
// plain text. A bold all-caps code shouts on the page, so only the figure is emphasized.
//   "50.00 CAD" → [ emph "50.00", text " CAD" ]
const moneyParts = (amount: string, currency: string): BlurbParts => [
  em(money(amount)),
  t(` ${currency}`),
]

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
    ...moneyParts(n.hero.amount, n.hero.currency),
    t(' on '),
    t(n.hero.label),
  ]
  if (n.source) parts.push(t(' from '), t(accountLabel(n.source)))
  parts.push(t('.'))
  return parts
}

// Two lines:
//   "You fronted 500.00 CZK for Food"
//   "Your share is 150.00 CZK, Household owes you 350.00 CZK."
function splitBlurb(n: NarratedTransaction): BlurbParts {
  const share = branchByChip(n, 'your-share')
  const owed = branchByChip(n, 'owes-you')
  const fronted = n.source ?? n.hero
  const category = share?.label ?? n.hero?.label ?? 'this'

  const parts: BlurbParts = [t('You fronted ')]
  if (fronted) parts.push(...moneyParts(fronted.amount, fronted.currency))
  else parts.push(t('—'))
  parts.push(t(' for '), t(category))

  if (share || owed) {
    parts.push(br)
    if (share) parts.push(t('Your share is '), ...moneyParts(share.amount, share.currency))
    if (share && owed) parts.push(t(', '))
    if (owed) {
      parts.push(t(`${partyName(owed.path)} owes you `), ...moneyParts(owed.amount, owed.currency))
    }
  }
  parts.push(t('.'))
  return parts
}

// "You spent 360.00 CZK on Food · Coffee. Which was converted from 17.24 USD."
// Two sentences: the native price, then the gross that left the source asset.
function multiCurrencyBlurb(n: NarratedTransaction): BlurbParts {
  if (!n.hero) return [t('A cross-currency transfer.')]
  const c = n.conversion
  const parts: BlurbParts = [
    t('You spent '),
    ...moneyParts(n.hero.amount, n.hero.currency),
    t(' on '),
    t(n.hero.label),
    t('.'),
  ]
  if (c) parts.push(br)
  if (c) parts.push(t(' Which was converted from '), ...moneyParts(c.paid.amount, c.paid.currency), t('.'))
  return parts
}

// "2000.00 CAD came into Chequing for Salary." (income / refund)
function inflowBlurb(n: NarratedTransaction): BlurbParts {
  if (!n.hero) return [t('Money came in.')]
  const parts: BlurbParts = [...moneyParts(n.hero.amount, n.hero.currency), t(' came into ')]
  parts.push(t(n.source ? accountLabel(n.source) : 'your account'))
  parts.push(t(' for '), t(n.hero.label), t('.'))
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

// Flatten to plain text — for an aria-label or a tooltip on the rendered blurb. Line breaks
// become newlines.
export const blurbText = (parts: BlurbParts): string =>
  parts.map((p) => (p.kind === 'break' ? '\n' : p.text)).join('')
