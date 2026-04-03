// Seed one month of realistic transactions for UI/dashboard development.
//
// Usage:
//   SEED_EMAIL=you@example.com bun run scripts/seed-month.ts 2026-03
//
// The month argument defaults to the current month if omitted.
// Amounts are seeded from the month string — same month always produces the
// same transactions, so the UI looks consistent across reloads.
// Re-running for the same month will insert duplicate transactions.
//
// Model: no income — living off a $30k starting balance in chequing.
// The opening balance is only inserted when seeding the very first month
// (i.e. no existing transactions for this user).

import { db } from '../src/db'
import { user, accounts, transactions, postings } from '../src/db/schema'
import { eq, and, isNull } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const email = process.env.SEED_EMAIL
if (!email) {
  console.error('Usage: SEED_EMAIL=you@example.com bun scripts/seed-month.ts [YYYY-MM]')
  process.exit(1)
}

const monthArg = process.argv[2] ?? new Date().toISOString().slice(0, 7)
if (!/^\d{4}-\d{2}$/.test(monthArg)) {
  console.error('Month must be in YYYY-MM format, e.g. 2026-03')
  process.exit(1)
}

const [year, month] = monthArg.split('-').map(Number)
const daysInMonth = new Date(year, month, 0).getDate()

console.log(`Seeding ${monthArg} for ${email}…`)

// ---------------------------------------------------------------------------
// Seeded PRNG — mulberry32
// Same month → same random values → reproducible transactions
// ---------------------------------------------------------------------------

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return h >>> 0
}

function makePrng(seed: number) {
  let s = seed
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = makePrng(hashStr(monthArg))

// rand float in [min, max]
function rf(min: number, max: number) { return min + rand() * (max - min) }
// rand int in [min, max] inclusive
function ri(min: number, max: number) { return Math.floor(rf(min, max + 1)) }
// pick random element from array
function pick<T>(arr: T[]): T { return arr[Math.floor(rand() * arr.length)] }
// random day in [earliest, daysInMonth]
function randDay(earliest = 4) { return ri(earliest, daysInMonth) }

function fmt(n: number) { return n.toFixed(2) }
function isoDate(d: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Resolve user
// ---------------------------------------------------------------------------

const [foundUser] = await db.select().from(user).where(eq(user.email, email))
if (!foundUser) {
  console.error(`No user found with email ${email}. Run seed-user.ts first.`)
  process.exit(1)
}
const userId = foundUser.id

// ---------------------------------------------------------------------------
// Account definitions
// ---------------------------------------------------------------------------

const ACCOUNT_PATHS = {
  chequing:      'assets:bank:chequing',
  savings:       'assets:bank:savings',
  visa:          'liabilities:bank:visa',
  opening:       'equity:opening-balances',
  rent:          'expenses:housing:rent',
  groceries:     'expenses:food:groceries',
  restaurants:   'expenses:food:restaurants',
  coffee:        'expenses:food:coffee',
  transit:       'expenses:transport:transit',
  gas:           'expenses:transport:gas',
  phone:         'expenses:utilities:phone',
  internet:      'expenses:utilities:internet',
  netflix:       'expenses:subscriptions:netflix',
  spotify:       'expenses:subscriptions:spotify',
  entertainment: 'expenses:entertainment',
  health:        'expenses:health',
  shopping:      'expenses:shopping',
} as const

async function ensureAccount(path: string): Promise<string> {
  const [existing] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.path, path), isNull(accounts.deletedAt)))
  if (existing) return existing.id
  const [created] = await db
    .insert(accounts)
    .values({ userId, path })
    .returning({ id: accounts.id })
  console.log(`  created account: ${path}`)
  return created.id
}

console.log('Ensuring accounts…')
const acctIds: Record<keyof typeof ACCOUNT_PATHS, string> = {} as any
for (const [key, path] of Object.entries(ACCOUNT_PATHS)) {
  acctIds[key as keyof typeof ACCOUNT_PATHS] = await ensureAccount(path)
}

// ---------------------------------------------------------------------------
// Transaction builder
// ---------------------------------------------------------------------------

type PostingInput = { accountId: string; amount: string; currency?: string }

async function insertTx(date: string, description: string, legs: PostingInput[]) {
  await db.transaction(async (tx) => {
    const [newTx] = await tx
      .insert(transactions)
      .values({ userId, date: new Date(date), description })
      .returning()
    await tx.insert(postings).values(
      legs.map((l) => ({
        transactionId: newTx.id,
        accountId: l.accountId,
        amount: l.amount,
        currency: l.currency ?? 'CAD',
      }))
    )
  })
}

let ccTotal = 0

async function ccExpense(date: string, description: string, expAcct: string, amount: number) {
  ccTotal += amount
  await insertTx(date, description, [
    { accountId: acctIds.visa, amount: fmt(-amount) },  // liability increases
    { accountId: expAcct,      amount: fmt(amount) },
  ])
}

async function chequingExpense(date: string, description: string, expAcct: string, amount: number) {
  await insertTx(date, description, [
    { accountId: acctIds.chequing, amount: fmt(-amount) },
    { accountId: expAcct,          amount: fmt(amount) },
  ])
}

// ---------------------------------------------------------------------------
// Merchant name pools
// ---------------------------------------------------------------------------

const GROCERS     = ['Loblaws', 'No Frills', 'Sobeys', 'Metro', 'FreshCo', 'T&T Supermarket']
const RESTAURANTS = ['Chipotle', 'Sushi Garden', 'Thai Express', 'Pizza Pizza', 'Ramen House', 'The Keg', 'Local Diner', 'Mucho Burrito', 'Pho 99']
const COFFEES     = ['Tim Hortons', 'Starbucks', 'Second Cup', 'Balzacs Coffee']
const GAS_STN     = ['Petro-Canada', 'Shell', 'Esso', 'Costco Gas']
const TRANSIT     = ['Presto Card Top-up', 'GO Transit', 'TTC Fare']
const ENTERTAIN   = ['Cineplex', 'Steam Purchase', 'Apple App Store', 'Event Tickets']
const HEALTH      = ['Shoppers Drug Mart', 'Rexall Pharmacy', 'Physiotherapy', 'Walk-in Clinic']
const SHOPPING    = ['Amazon', 'Costco', 'IKEA', 'Best Buy', 'H&M', 'Winners', 'Canadian Tire']

// ---------------------------------------------------------------------------
// Seed transactions
// ---------------------------------------------------------------------------

console.log('Inserting transactions…')

// --- Opening balance: insert only if this user has no transactions yet ---
// This means the balance is seeded once regardless of how many months you run.
const existingCount = await db.$count(
  transactions,
  and(eq(transactions.userId, userId), isNull(transactions.deletedAt))
)
if (existingCount === 0) {
  console.log('  inserting $30,000 opening balance for chequing…')
  await insertTx(isoDate(1), 'Opening balance', [
    { accountId: acctIds.chequing, amount: '30000.00' },
    { accountId: acctIds.opening,  amount: '-30000.00' },
  ])
}

// --- Fixed bills from chequing (early in the month) ---
await chequingExpense(isoDate(1),       'Rent',         acctIds.rent,     rf(1500, 1800))
await chequingExpense(isoDate(ri(1,3)), 'Netflix',      acctIds.netflix,  18.99)
await chequingExpense(isoDate(ri(1,3)), 'Spotify',      acctIds.spotify,  11.99)
await chequingExpense(isoDate(5),       'Phone bill',   acctIds.phone,    rf(55, 75))
await chequingExpense(isoDate(5),       'Internet bill', acctIds.internet, rf(75, 90))

// --- Savings transfer mid-month ---
const savingsAmt = rf(300, 500)
await insertTx(isoDate(15), 'Transfer to savings', [
  { accountId: acctIds.chequing, amount: fmt(-savingsAmt) },
  { accountId: acctIds.savings,  amount: fmt(savingsAmt) },
])

// --- Groceries: 4–5 trips ---
for (let i = 0; i < ri(4, 5); i++) {
  await ccExpense(isoDate(randDay()), pick(GROCERS), acctIds.groceries, rf(45, 145))
}

// --- Restaurants: 5–8 meals ---
for (let i = 0; i < ri(5, 8); i++) {
  await ccExpense(isoDate(randDay()), pick(RESTAURANTS), acctIds.restaurants, rf(18, 68))
}

// --- Coffee: 10–15 visits ---
for (let i = 0; i < ri(10, 15); i++) {
  await ccExpense(isoDate(randDay()), pick(COFFEES), acctIds.coffee, rf(4, 8))
}

// --- Gas: 2–4 fill-ups ---
for (let i = 0; i < ri(2, 4); i++) {
  await ccExpense(isoDate(randDay()), pick(GAS_STN), acctIds.gas, rf(55, 85))
}

// --- Transit: 1–3 top-ups/passes ---
for (let i = 0; i < ri(1, 3); i++) {
  await ccExpense(isoDate(randDay()), pick(TRANSIT), acctIds.transit, rf(30, 160))
}

// --- Entertainment: 2–4 outings ---
for (let i = 0; i < ri(2, 4); i++) {
  await ccExpense(isoDate(randDay()), pick(ENTERTAIN), acctIds.entertainment, rf(15, 50))
}

// --- Health: 0–2 visits ---
for (let i = 0; i < ri(0, 2); i++) {
  await ccExpense(isoDate(randDay()), pick(HEALTH), acctIds.health, rf(15, 60))
}

// --- Shopping: 1–3 purchases ---
for (let i = 0; i < ri(1, 3); i++) {
  await ccExpense(isoDate(randDay()), pick(SHOPPING), acctIds.shopping, rf(30, 150))
}

// --- Credit card payment: full balance, around the 20th ---
await insertTx(isoDate(ri(18, 22)), 'Visa payment', [
  { accountId: acctIds.visa,     amount: fmt(ccTotal) },   // liability decreases
  { accountId: acctIds.chequing, amount: fmt(-ccTotal) },  // asset decreases
])

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const txCount = await db.$count(transactions, and(eq(transactions.userId, userId), isNull(transactions.deletedAt)))
console.log(`Done. User now has ${txCount} total transactions.`)
console.log(`  CC charges this month: $${fmt(ccTotal)}`)

process.exit(0)
