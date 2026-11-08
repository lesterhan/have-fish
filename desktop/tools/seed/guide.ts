// GUIDE.md beside each ledger: what to look for, where, and every balance the app should show.
// tags.json keeps the tags and recurring series by transaction id, for the features to come.

import { minorUnits } from '@have-fish/core/currencies'
import { cents } from '@have-fish/core/money'
import type { Book, Entry, Shape } from './book'

/** What each shape is, and what the app should show for it. */
export const SHAPES: Record<Shape, { title: string; look: string }> = {
  opening: {
    title: 'Starting balances',
    look: 'One per account and currency, from equity:opening.',
  },
  spend: { title: 'Plain spends', look: 'One amount, from an account into a category.' },
  split: {
    title: 'Splits',
    look: 'One payer, several categories: a total and no single category.',
  },
  'pay-split': {
    title: 'Pay days, split',
    look: 'Gross from income, tax and CPP/EI into categories, net into chequing.',
  },
  interest: { title: 'Interest', look: 'Small amounts in from income:interest.' },
  transfer: { title: 'Transfers', look: 'Between my own accounts: neither spending nor income.' },
  'card-payoff': { title: 'Card payments', look: 'Chequing pays the card: owed goes down.' },
  'loan-payment': {
    title: 'Loan payments',
    look: 'One payment: principal off the loan, interest into a category.',
  },
  refund: { title: 'Refunds', look: 'Money back into the account, out of the category.' },
  'wise-conversion': {
    title: 'Wise conversions',
    look: 'CAD out, the fee in fees:fx, the other currency in: five lines through equity:conversion.',
  },
  'wise-foreign': {
    title: 'Wise spends in its own currency',
    look: 'A plain spend, but not in CAD: one amount in USD, EUR, CZK or JPY.',
  },
  'wise-mixed': {
    title: 'Wise spends that convert',
    look: "What the currency's balance couldn't cover, converted from CAD on the spot, with the fee: two currencies, no single amount.",
  },
  'card-foreign': {
    title: 'The CAD card abroad',
    look: 'Foreign amount into the category, CAD off the card; the 2.5% hides in the rate.',
  },
  'card-foreign-fee': {
    title: 'The CAD card abroad, fee shown',
    look: 'As above, with the fee as its own line in fees:fx.',
  },
  'card-fee-later': {
    title: 'Card fees a day later',
    look: 'A plain CAD spend into fees:fx, the day after a spend abroad.',
  },
  'alipay-fee': {
    title: 'Alipay over 200 CNY',
    look: "Alipay's 3% in CNY in fees:fx, then the card converts the whole to CAD.",
  },
  'atm-abroad': {
    title: 'ATMs abroad',
    look: "Six lines: cash and the ATM's fee in local money, CAD and Wise's fee out of Wise.",
  },
  'cash-foreign': { title: 'Cash abroad', look: 'From the wallet, in NTD, CNY or JPY.' },
  remittance: {
    title: 'Money sent to family',
    look: 'CAD out of Wise, NTD into family:support, with the fee.',
  },
  reimbursement: {
    title: 'Expenses paid back',
    look: 'CAD from work into chequing, out of the category the trip went into.',
  },
  edge: { title: 'Odd cases', look: 'Each named for what it tests.' },
}

const ORDER = Object.keys(SHAPES) as Shape[]

/** `cents` as the app would print it, with its currency: `1,234.50 CAD`, `12,000 JPY`. */
export function money(c: number, cur: string): string {
  const places = minorUnits(cur)
  const text = (Math.abs(c) / 100).toLocaleString('en-CA', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })
  return `${c < 0 ? '−' : ''}${text} ${cur}`
}

export type GuideInfo = {
  profile: string
  about: string
  seed: string
  start: string
  today: string
}

export function renderGuide(book: Book, info: GuideInfo): string {
  const live = book.entries.filter((e) => e.final.deletedAt === null)
  const pathOf = new Map([...book.accounts.values()].map((a) => [a.id, a.path]))
  const lines: string[] = []
  const out = (...l: string[]) => lines.push(...l)

  out(
    `# The ${info.profile} ledger`,
    '',
    `${info.about}`,
    '',
    `Seed ${info.seed}, ${info.start} to ${info.today}. ${live.length} transactions, ` +
      `${book.entries.length - live.length} deleted, ${book.accounts.size} accounts.`,
    '',
    '## Open it',
    '',
    `- \`bun run try ${info.profile}\` opens the packaged app on it; add \`--dev\` for the dev app.`,
    `- \`bun run seed top-up ${info.profile}\` adds the days since ${info.today}.`,
    `- \`bun run seed snap ${info.profile} <name>\` keeps this state; \`restore\` brings it back.`,
    '',
  )

  out(
    '## Every balance',
    '',
    'What the Accounts screen should show. Zero balances are left out.',
    '',
  )
  out('| Account | Kind | Balance |', '|---|---|---|')
  const balances = book.finalBalances()
  for (const account of [...book.accounts.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    const held = [...(balances.get(account.path) ?? [])].filter(([, c]) => c !== 0)
    const gone = account.deletedAt === null ? '' : ' (deleted)'
    const shown = held.map(([cur, c]) => money(c, cur)).join(' · ') || '0'
    out(`| ${account.path}${gone} | ${account.kind} | ${shown} |`)
  }
  out('')

  out('## What to look for', '')
  const byShape = new Map<Shape, Entry[]>()
  for (const e of live) byShape.set(e.shape, [...(byShape.get(e.shape) ?? []), e])
  for (const shape of ORDER) {
    const found = byShape.get(shape)
    if (!found) continue
    const { title, look } = SHAPES[shape]
    out(`### ${title} (${found.length})`, '', look, '')
    const shown = shape === 'edge' ? found : examples(found)
    for (const e of shown) out(`- ${line(e, pathOf)}`)
    out('')
  }

  const series = groupBy(live, (e) => e.series)
  if (series.size > 0) {
    out('## Recurring', '', 'What a recurring-charges feature should find.', '')
    out('| Series | Times | First to last | Amounts |', '|---|---|---|---|')
    for (const [name, list] of [...series].sort(([a], [b]) => a.localeCompare(b))) {
      const first = list[0]?.final.date ?? ''
      const last = list.at(-1)?.final.date ?? ''
      out(`| ${name} | ${list.length} | ${first} to ${last} | ${amounts(list)} |`)
    }
    out('')
  }

  const tags = groupBy(
    live.flatMap((e) => e.tags.map((tag) => ({ tag, e }))),
    (t) => t.tag,
  )
  if (tags.size > 0) {
    out(
      '## Events',
      '',
      'Tags for when tags exist. They are not in the ledger yet: `tags.json` lists each one by id.',
      '',
    )
    out('| Tag | Dates | Transactions | Spent |', '|---|---|---|---|')
    for (const [tag, list] of tags) {
      const es = list.map((t) => t.e)
      out(
        `| ${tag} | ${es[0]?.final.date} to ${es.at(-1)?.final.date} | ${es.length} | ${spent(es, book)} |`,
      )
    }
    out('')
  }

  const changed = book.entries.filter((e) => e.change !== null)
  if (changed.length > 0) {
    out('## Fixed and deleted', '', 'Each has two versions in the ledger.', '')
    for (const e of changed) {
      const c = e.change
      if (c === null) continue
      const what =
        c.what === 'deleted'
          ? 'saved twice; the copy was deleted'
          : c.what === 'amount'
            ? `saved as ${c.was}, fixed`
            : `saved as "${c.was}", fixed`
      out(`- ${e.doc.date} ${quote(e.final.description || e.doc.description)}: ${what}`)
    }
    out('')
  }
  return lines.join('\n')
}

/** The first, a middle one and the last, so a shape is found wherever it is. */
function examples(list: Entry[]): Entry[] {
  const noted = list.filter((e) => e.note !== null).slice(0, 3)
  const picks = [list[0], list[Math.floor(list.length / 2)], list.at(-1)]
  const seen = new Set<Entry>()
  return [...noted, ...picks]
    .filter((e): e is Entry => {
      if (e === undefined || seen.has(e)) return false
      seen.add(e)
      return true
    })
    .slice(0, 4)
}

function line(e: Entry, pathOf: Map<string, string>): string {
  const legs = e.final.postings
    .map((p) => `${money(cents(p.amount), p.currency)} ${pathOf.get(p.accountId) ?? '?'}`)
    .join(' · ')
  const tags = e.tags.length > 0 ? ` ${e.tags.join(' ')}` : ''
  const note = e.note === null ? '' : ` *${e.note}*`
  return `${e.final.date} ${quote(e.final.description)}${tags}: ${legs}.${note}`
}

const quote = (description: string) =>
  description === '' ? '(no description)' : `**${description}**`

function groupBy<T>(items: T[], key: (t: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    if (k !== null) out.set(k, [...(out.get(k) ?? []), item])
  }
  return out
}

/** A series' amounts: the one, the change, or the range when it varies. */
function amounts(list: Entry[]): string {
  const each = list.map((e) => {
    const leg = e.final.postings.find((p) => cents(p.amount) > 0)
    return { c: leg ? cents(leg.amount) : 0, cur: leg?.currency ?? 'CAD' }
  })
  const distinct = [...new Set(each.map((a) => `${a.c} ${a.cur}`))]
  if (distinct.length === 1 && each[0]) return money(each[0].c, each[0].cur)
  if (distinct.length <= 3) {
    return distinct.map((d) => money(Number(d.split(' ')[0]), d.split(' ')[1] ?? '')).join(' → ')
  }
  const cs = each.map((a) => a.c)
  const cur = each[0]?.cur ?? 'CAD'
  return `varies, ${money(Math.min(...cs), cur)} to ${money(Math.max(...cs), cur)}`
}

/** What a set of transactions put into categories, per currency. */
function spent(list: Entry[], book: Book): string {
  const categories = new Set(
    [...book.accounts.values()].filter((a) => a.kind === 'category').map((a) => a.id),
  )
  const totals = new Map<string, number>()
  for (const e of list) {
    for (const p of e.final.postings) {
      if (categories.has(p.accountId))
        totals.set(p.currency, (totals.get(p.currency) ?? 0) + cents(p.amount))
    }
  }
  return [...totals].map(([cur, c]) => money(c, cur)).join(' · ')
}

/** Tag and series to the live transaction ids that carry them. */
export function renderTags(book: Book): string {
  const live = book.entries.filter((e) => e.final.deletedAt === null)
  const tags: Record<string, string[]> = {}
  const series: Record<string, string[]> = {}
  for (const e of live) {
    for (const tag of e.tags) tags[tag] = [...(tags[tag] ?? []), e.final.id]
    if (e.series !== null) series[e.series] = [...(series[e.series] ?? []), e.final.id]
  }
  return `${JSON.stringify({ tags, series }, null, 2)}\n`
}
