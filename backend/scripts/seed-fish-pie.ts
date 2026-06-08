// Seed a Fish Pie group with a partner and realistic shared expenses.
//
// Usage:
//   SEED_EMAIL=you@example.com SEED_PARTNER_EMAIL=partner@example.com \
//     bun run scripts/seed-fish-pie.ts
//
// Both users must already exist (run seed-user.ts for each first).
// Idempotent on the group: re-running creates another group with the same name.
// Expenses always reproduce the same set — seeded from the group name string.

import { db } from '../src/db'
import { auth } from '../src/auth'
import {
  user,
  accounts,
  expenseGroups,
  expenseGroupMembers,
  groupExpenses,
  groupExpenseSplits,
  transactions,
  postings,
} from '../src/db/schema'
import { ensureSharedAccount, ensureUncategorizedAccount } from '../src/fish-pie-accounts'
import { eq, and, isNull } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// CLI / env
// ---------------------------------------------------------------------------

const email = process.env.SEED_EMAIL
const partnerEmail = process.env.SEED_PARTNER_EMAIL
const partnerPassword = process.env.SEED_PARTNER_PASSWORD ?? 'password123'

if (!email || !partnerEmail) {
  console.error('Usage: SEED_EMAIL=you@example.com SEED_PARTNER_EMAIL=partner@example.com bun run scripts/seed-fish-pie.ts')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Seeded PRNG — same group name always yields the same expenses
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

const GROUP_NAME = 'Housing'
const rand = makePrng(hashStr(GROUP_NAME))

function rf(min: number, max: number) { return min + rand() * (max - min) }
function ri(min: number, max: number) { return Math.floor(rf(min, max + 1)) }
function pick<T>(arr: T[]): T { return arr[Math.floor(rand() * arr.length)] }
function fmt(n: number) { return n.toFixed(2) }

// Dates spread across the last ~60 days
function recentDate(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Resolve users
// ---------------------------------------------------------------------------

const [foundUser] = await db.select().from(user).where(eq(user.email, email))
if (!foundUser) {
  console.error(`No user with email ${email}. Run seed-user.ts first.`)
  process.exit(1)
}

let [foundPartner] = await db.select().from(user).where(eq(user.email, partnerEmail))
if (!foundPartner) {
  console.log(`Partner ${partnerEmail} not found — creating…`)
  const result = await auth.api.signUpEmail({
    body: { email: partnerEmail, password: partnerPassword, name: partnerEmail.split('@')[0] },
  })
  if (!result.user) {
    console.error('Failed to create partner account:', result)
    process.exit(1)
  }
  const [created] = await db.select().from(user).where(eq(user.email, partnerEmail))
  foundPartner = created
}

const userId = foundUser.id
const partnerId = foundPartner.id

console.log(`Seeding Fish Pie group "${GROUP_NAME}"`)
console.log(`  Primary user: ${email} (${userId.slice(0, 8)}…)`)
console.log(`  Partner:      ${partnerEmail} (${partnerId.slice(0, 8)}…)`)

// ---------------------------------------------------------------------------
// Ensure expense accounts exist for each user
// ---------------------------------------------------------------------------

async function ensureAccount(ownerId: string, path: string): Promise<string> {
  const [existing] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, ownerId), eq(accounts.path, path), isNull(accounts.deletedAt)))
  if (existing) return existing.id
  const [created] = await db.insert(accounts).values({ userId: ownerId, path }).returning({ id: accounts.id })
  console.log(`  created account ${path} for ${ownerId.slice(0, 8)}…`)
  return created.id
}

const myHousingAccountId = await ensureAccount(userId, 'expenses:housing')
const partnerHousingAccountId = await ensureAccount(partnerId, 'expenses:housing')

// ---------------------------------------------------------------------------
// Create group + members
// ---------------------------------------------------------------------------

const [group] = await db
  .insert(expenseGroups)
  .values({ name: GROUP_NAME, defaultCurrency: 'CAD', createdBy: userId })
  .returning()

await db.insert(expenseGroupMembers).values([
  { groupId: group.id, userId, shareWeight: 1, defaultExpenseAccountId: myHousingAccountId },
  { groupId: group.id, userId: partnerId, shareWeight: 1, defaultExpenseAccountId: partnerHousingAccountId },
])

console.log(`  created group ${group.id.slice(0, 8)}…`)

// ---------------------------------------------------------------------------
// Ensure shared:<slug> accounts for both users
// ---------------------------------------------------------------------------

const mySharedId = await ensureSharedAccount(userId, group)
const partnerSharedId = await ensureSharedAccount(partnerId, group)

console.log(`  shared accounts: ${mySharedId.slice(0, 8)}… / ${partnerSharedId.slice(0, 8)}…`)

// ---------------------------------------------------------------------------
// Helpers to insert an expense + splits + auto-postings
// ---------------------------------------------------------------------------

const members = [
  { userId, shareWeight: 1, defaultExpenseAccountId: myHousingAccountId, sharedAccountId: mySharedId },
  { userId: partnerId, shareWeight: 1, defaultExpenseAccountId: partnerHousingAccountId, sharedAccountId: partnerSharedId },
]

function computeSplits(amount: string, payerId: string) {
  const total = parseFloat(amount)
  const splits = members.map((m) => ({
    userId: m.userId,
    amount: fmt(total / members.length),
  }))
  // Assign rounding remainder to payer
  const splitTotal = splits.reduce((s, sp) => s + parseFloat(sp.amount), 0)
  const remainder = fmt(total - splitTotal)
  if (parseFloat(remainder) !== 0) {
    const payerSplit = splits.find((s) => s.userId === payerId)!
    payerSplit.amount = fmt(parseFloat(payerSplit.amount) + parseFloat(remainder))
  }
  return splits
}

async function seedExpense(
  date: string,
  description: string,
  amount: number,
  currency: string,
  payerId: string,
) {
  const amountStr = fmt(amount)
  const splits = computeSplits(amountStr, payerId)

  await db.transaction(async (tx) => {
    const [expense] = await tx
      .insert(groupExpenses)
      .values({ groupId: group.id, paidByUserId: payerId, description, amount: amountStr, currency, date })
      .returning()

    await tx.insert(groupExpenseSplits).values(
      splits.map((s) => ({ expenseId: expense.id, userId: s.userId, amount: s.amount })),
    )

    for (const split of splits) {
      const member = members.find((m) => m.userId === split.userId)!
      const [t] = await tx
        .insert(transactions)
        .values({
          userId: split.userId,
          date: new Date(`${date}T00:00:00Z`),
          description,
          groupExpenseId: expense.id,
        })
        .returning()

      await tx.insert(postings).values([
        { transactionId: t.id, accountId: member.defaultExpenseAccountId, amount: `-${split.amount}`, currency },
        { transactionId: t.id, accountId: member.sharedAccountId, amount: split.amount, currency },
      ])
    }
  })

  const payerName = payerId === userId ? email : partnerEmail
  console.log(`  [expense] ${date} ${description.padEnd(28)} ${currency} ${amountStr}  paid by ${payerName}`)
}

// ---------------------------------------------------------------------------
// Seed expenses — mix of payers, a few categories
// ---------------------------------------------------------------------------

console.log('Inserting expenses…')

const UTILITIES = ['Hydro bill', 'Gas bill', 'Internet bill', 'Water bill']
const SUPPLIES  = ['Home supplies', 'Cleaning supplies', 'Light bulbs / hardware']
const REPAIRS   = ['Plumber visit', 'Handyman fix', 'Window repair']

// Fixed recurring (paid by primary user)
await seedExpense(recentDate(58), 'Rent — May',             ri(1200, 1600), 'CAD', userId)
await seedExpense(recentDate(28), 'Rent — June',            ri(1200, 1600), 'CAD', userId)

// Utilities — alternate payers
await seedExpense(recentDate(ri(45, 55)), pick(UTILITIES),  rf(80, 140),   'CAD', userId)
await seedExpense(recentDate(ri(30, 44)), pick(UTILITIES),  rf(80, 140),   'CAD', partnerId)
await seedExpense(recentDate(ri(10, 29)), pick(UTILITIES),  rf(80, 140),   'CAD', userId)

// Supplies — mostly partner pays
await seedExpense(recentDate(ri(40, 50)), pick(SUPPLIES),   rf(30, 60),    'CAD', partnerId)
await seedExpense(recentDate(ri(15, 39)), pick(SUPPLIES),   rf(20, 50),    'CAD', partnerId)

// One-off repair
await seedExpense(recentDate(ri(20, 35)), pick(REPAIRS),    rf(120, 350),  'CAD', userId)

console.log(`\nDone. Group "${GROUP_NAME}" seeded with ${8} expenses.`)
console.log(`  Run "bun run migrate:fish-pie" if you want auto-postings for existing expenses`)
console.log(`  (this script already posts them — no need to run that for new data)`)

process.exit(0)
