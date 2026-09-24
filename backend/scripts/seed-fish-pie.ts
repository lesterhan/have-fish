// Seed a Fish Pie group with a partner and realistic shared expenses.
//
// Usage:
//   SEED_EMAIL=you@example.com SEED_PARTNER_EMAIL=partner@example.com \
//     bun run scripts/seed-fish-pie.ts
//
// The primary user must already exist (run seed-user.ts first); the partner is created
// if missing. Expenses always reproduce the same set — seeded from the group name
// string — dated between 10 and 60 days ago, and written through the same service the
// app uses, so their postings are what the app would write.
//
// Safe to re-run: if the primary user already has a group of this name, nothing is
// written.

import { db } from '../src/db'
import { returnedRow } from '../src/db/returning'
import { auth } from '../src/auth'
import { user, accounts, expenseGroups, expenseGroupMembers } from '../src/db/schema'
import { createGroupExpenseInTx } from '../src/fish-pie-expense-service'
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
function pick<T>(arr: T[]): T {
  const item = arr[Math.floor(rand() * arr.length)]
  if (item === undefined) throw new Error('pick() from an empty array')
  return item
}
function fmt(n: number) { return n.toFixed(2) }

// Dates spread across the last ~60 days, by the local calendar. Never in the future.
function recentDate(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - Math.max(daysAgo, 0))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function monthName(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00`).toLocaleString('en-CA', { month: 'long' })
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
    body: { email: partnerEmail, password: partnerPassword, name: partnerEmail.split('@')[0] ?? partnerEmail },
  })
  if (!result.user) {
    console.error('Failed to create partner account:', result)
    process.exit(1)
  }
  const [created] = await db.select().from(user).where(eq(user.email, partnerEmail))
  if (!created) {
    console.error(`Created partner ${partnerEmail} but could not read it back`)
    process.exit(1)
  }
  foundPartner = created
}

const userId = foundUser.id
const partnerId = foundPartner.id

console.log(`Seeding Fish Pie group "${GROUP_NAME}"`)
console.log(`  Primary user: ${email} (${userId.slice(0, 8)}…)`)
console.log(`  Partner:      ${partnerEmail} (${partnerId.slice(0, 8)}…)`)

const [existingGroup] = await db
  .select({ id: expenseGroups.id })
  .from(expenseGroups)
  .where(
    and(
      eq(expenseGroups.name, GROUP_NAME),
      eq(expenseGroups.createdBy, userId),
      isNull(expenseGroups.deletedAt),
    ),
  )
if (existingGroup) {
  console.log(`  group "${GROUP_NAME}" already exists (${existingGroup.id.slice(0, 8)}…) — skipping`)
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Ensure expense and payment accounts exist for each user
// ---------------------------------------------------------------------------

async function ensureAccount(ownerId: string, path: string): Promise<string> {
  const [existing] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, ownerId), eq(accounts.path, path), isNull(accounts.deletedAt)))
  if (existing) return existing.id
  const created = returnedRow(
    await db.insert(accounts).values({ userId: ownerId, path }).returning({ id: accounts.id }),
    'insert accounts',
  )
  console.log(`  created account ${path} for ${ownerId.slice(0, 8)}…`)
  return created.id
}

const myHousingAccountId = await ensureAccount(userId, 'expenses:housing')
const partnerHousingAccountId = await ensureAccount(partnerId, 'expenses:housing')
const paymentAccountIds: Record<string, string> = {
  [userId]: await ensureAccount(userId, 'assets:bank:chequing'),
  [partnerId]: await ensureAccount(partnerId, 'assets:bank:chequing'),
}

// ---------------------------------------------------------------------------
// The expenses — mix of payers, a few categories
// ---------------------------------------------------------------------------

type ExpenseSpec = { date: string; description: string; amount: string; payerId: string }

const UTILITIES = ['Hydro bill', 'Gas bill', 'Internet bill', 'Water bill']
const SUPPLIES  = ['Home supplies', 'Cleaning supplies', 'Light bulbs / hardware']
const REPAIRS   = ['Plumber visit', 'Handyman fix', 'Window repair']

const firstRent = recentDate(58)
const secondRent = recentDate(28)
const expenses: ExpenseSpec[] = [
  // Fixed recurring (paid by primary user)
  { date: firstRent,  description: `Rent — ${monthName(firstRent)}`,  amount: fmt(ri(1200, 1600)), payerId: userId },
  { date: secondRent, description: `Rent — ${monthName(secondRent)}`, amount: fmt(ri(1200, 1600)), payerId: userId },
  // Utilities — alternate payers
  { date: recentDate(ri(45, 55)), description: pick(UTILITIES), amount: fmt(rf(80, 140)), payerId: userId },
  { date: recentDate(ri(30, 44)), description: pick(UTILITIES), amount: fmt(rf(80, 140)), payerId: partnerId },
  { date: recentDate(ri(10, 29)), description: pick(UTILITIES), amount: fmt(rf(80, 140)), payerId: userId },
  // Supplies — mostly partner pays
  { date: recentDate(ri(40, 50)), description: pick(SUPPLIES), amount: fmt(rf(30, 60)), payerId: partnerId },
  { date: recentDate(ri(15, 39)), description: pick(SUPPLIES), amount: fmt(rf(20, 50)), payerId: partnerId },
  // One-off repair
  { date: recentDate(ri(20, 35)), description: pick(REPAIRS), amount: fmt(rf(120, 350)), payerId: userId },
]

// ---------------------------------------------------------------------------
// Group, members and every expense in one transaction, so a run that fails partway
// leaves no half-seeded group for the next run to skip. Each expense goes through the
// same service the app uses: splits, and every member's postings as the app writes them.
// ---------------------------------------------------------------------------

const members = [
  { userId, shareWeight: 1, defaultExpenseAccountId: myHousingAccountId },
  { userId: partnerId, shareWeight: 1, defaultExpenseAccountId: partnerHousingAccountId },
]

await db.transaction(async (tx) => {
  const group = returnedRow(
    await tx
      .insert(expenseGroups)
      .values({ name: GROUP_NAME, defaultCurrency: 'CAD', createdBy: userId })
      .returning(),
    'insert expenseGroups',
  )
  await tx.insert(expenseGroupMembers).values(members.map((m) => ({ groupId: group.id, ...m })))
  console.log(`  created group ${group.id.slice(0, 8)}…`)

  for (const e of expenses) {
    await createGroupExpenseInTx(tx, {
      group,
      members,
      payerId: e.payerId,
      description: e.description,
      amount: e.amount,
      currency: 'CAD',
      date: e.date,
      paymentAccountId: paymentAccountIds[e.payerId],
    })
    const payerName = e.payerId === userId ? email : partnerEmail
    console.log(`  [expense] ${e.date} ${e.description.padEnd(28)} CAD ${e.amount}  paid by ${payerName}`)
  }
})

console.log(`\nDone. Group "${GROUP_NAME}" seeded with ${expenses.length} expenses.`)

process.exit(0)
