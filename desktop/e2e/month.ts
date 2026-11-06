// A made-up month of a normal life at home, written through the app's own commands so every
// document passes the same checks a typed one does. Dates count back from today, so this week
// always has spends in it.

import type { Page } from 'playwright-core'

type Account = { name: string; kind: 'cash' | 'bank' | 'card' | 'loan'; start: string }

const ACCOUNTS: Account[] = [
  { name: 'tangerine:chequing', kind: 'bank', start: '2140.00' },
  { name: 'tangerine:savings', kind: 'bank', start: '8500.00' },
  { name: 'visa', kind: 'card', start: '312.40' },
  { name: 'wallet', kind: 'cash', start: '60.00' },
  { name: 'car-loan', kind: 'loan', start: '9800.00' },
]

/** What a day's spending is drawn from: what for, its category, cents from and to, who pays. */
const HABITS: [string, string, number, number, string][] = [
  ['Market Street Grocer', 'food:groceries', 2400, 11800, 'visa'],
  ['Corner bakery', 'food:groceries', 450, 1600, 'wallet'],
  ['Bean There', 'food:coffee', 375, 690, 'visa'],
  ['Lunch near work', 'food:restaurants', 1250, 2400, 'visa'],
  ['Pho Saigon', 'food:restaurants', 1800, 4600, 'visa'],
  ['Transit top-up', 'transport:transit', 2000, 4000, 'tangerine:chequing'],
  ['Bike shop', 'transport:bike', 1500, 8900, 'visa'],
  ['Pharmacy', 'health:pharmacy', 900, 4200, 'visa'],
  ['Bookshop', 'fun:books', 1400, 3800, 'visa'],
  ['Cinema', 'fun:going-out', 1500, 3200, 'visa'],
  ['Hardware store', 'home:supplies', 800, 6400, 'visa'],
  ['', '', 500, 3000, 'wallet'],
]

/** The month's fixed points, by days before today. */
const FIXED: { daysAgo: number; amount: string; description: string; from: Payer; to: Payee }[] = [
  {
    daysAgo: 30,
    amount: '1850.00',
    description: 'Rent',
    from: 'tangerine:chequing',
    to: 'home:rent',
  },
  {
    daysAgo: 27,
    amount: '86.40',
    description: 'Hydro',
    from: 'tangerine:chequing',
    to: 'home:utilities',
  },
  { daysAgo: 25, amount: '65.00', description: 'Phone', from: 'visa', to: 'home:phone' },
  {
    daysAgo: 20,
    amount: '2450.00',
    description: 'Pay',
    from: { income: 'salary' },
    to: { account: 'tangerine:chequing' },
  },
  {
    daysAgo: 19,
    amount: '500.00',
    description: 'Put some away',
    from: 'tangerine:chequing',
    to: { account: 'tangerine:savings' },
  },
  {
    daysAgo: 14,
    amount: '410.00',
    description: 'Car payment',
    from: 'tangerine:chequing',
    to: { account: 'car-loan' },
  },
  {
    daysAgo: 12,
    amount: '600.00',
    description: 'Pay off the card',
    from: 'tangerine:chequing',
    to: { account: 'visa' },
  },
  {
    daysAgo: 9,
    amount: '100.00',
    description: 'Cash machine',
    from: 'tangerine:chequing',
    to: { account: 'wallet' },
  },
  {
    daysAgo: 6,
    amount: '2450.00',
    description: 'Pay',
    from: { income: 'salary' },
    to: { account: 'tangerine:chequing' },
  },
  {
    daysAgo: 4,
    amount: '40.00',
    description: 'Sold the old chair',
    from: { income: 'sales' },
    to: { account: 'wallet' },
  },
  {
    daysAgo: 2,
    amount: '86.40',
    description: 'Internet',
    from: 'tangerine:chequing',
    to: 'home:utilities',
  },
]

/** An account by name, or an income source. */
type Payer = string | { income: string }
/** A category by name, or an account by name. */
type Payee = string | { account: string }

type Written = { amount: string; description: string; from: Payer; to: Payee; date: string }

/** The calendar day `daysAgo` before `today`, as `YYYY-MM-DD`. */
function dayBefore(today: Date, daysAgo: number): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The same numbers on every run: mulberry32. */
function random(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** About two spends a day for 35 days, plus the fixed ones: 70 to 80 in all. */
export function aMonth(today: Date): Written[] {
  const next = random(42)
  const spends: Written[] = []
  for (let daysAgo = 34; daysAgo >= 0; daysAgo--) {
    const count = Math.floor(next() * 3) + 1
    for (let i = 0; i < count; i++) {
      const habit = HABITS[Math.floor(next() * HABITS.length)]
      if (habit === undefined) continue
      const [description, category, low, high, from] = habit
      const cents = low + Math.floor(next() * (high - low))
      spends.push({
        amount: (cents / 100).toFixed(2),
        description,
        from,
        to: category,
        date: dayBefore(today, daysAgo),
      })
    }
    for (const f of FIXED.filter((f) => f.daysAgo === daysAgo)) {
      spends.push({ ...f, date: dayBefore(today, daysAgo) })
    }
  }
  return spends
}

/**
 * Adds the accounts, dates their starting balances the day the month began, then writes the
 * month, through `window.haveFish` as the window would.
 */
export async function seed(page: Page, today = new Date()): Promise<number> {
  const plan = { accounts: ACCOUNTS, spends: aMonth(today), began: dayBefore(today, 35) }
  return page.evaluate(async ({ accounts, spends, began }) => {
    type Out = { ok: true; value: unknown } | { ok: false }
    type Invoke = (name: string, input: unknown) => Promise<Out>
    const bridge = (window as unknown as { haveFish: { invoke: Invoke } }).haveFish
    const run = async <T>(name: string, input: unknown) => {
      const out = await bridge.invoke(name, input)
      if (!out.ok) throw new Error(`${name} refused: ${JSON.stringify(out)}`)
      return out.value as T
    }
    const ids = new Map<string, string>()
    for (const a of accounts) {
      const { id } = await run<{ id: string }>('account.add', { ...a, currency: 'CAD' })
      ids.set(a.name, id)
    }
    type Listed = { id: string; description: string; simple: { amount: string } }
    // Only the starting balances so far: one page holds them.
    const first = await run<{ rows: Listed[] }>('transaction.page', { from: 0, limit: 500 })
    for (const t of first.rows) {
      const { id, description, simple } = t
      await run('spend.edit', { id, description, amount: simple.amount, date: began })
    }
    const idOf = (name: string) => {
      const id = ids.get(name)
      if (id === undefined) throw new Error(`no account called ${name}`)
      return id
    }
    for (const s of spends) {
      await run('spend.write', {
        amount: s.amount,
        description: s.description,
        date: s.date,
        from: typeof s.from === 'string' ? idOf(s.from) : s.from,
        to: typeof s.to === 'string' ? { category: s.to } : { account: idOf(s.to.account) },
      })
    }
    return spends.length
  }, plan)
}
