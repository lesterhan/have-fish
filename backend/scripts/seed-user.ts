// Create a user account. Idempotent — skips silently if the email already exists.
//
// Usage:
//   SEED_EMAIL=you@example.com SEED_PASSWORD=yourpassword bun run scripts/seed-user.ts

import { auth } from '../src/auth'
import { db } from '../src/db'
import { user } from '../src/db/schema'
import { eq } from 'drizzle-orm'

const email = process.env.SEED_EMAIL
const password = process.env.SEED_PASSWORD

if (!email || !password) {
  console.error('Usage: SEED_EMAIL=you@example.com SEED_PASSWORD=yourpassword bun run scripts/seed-user.ts')
  process.exit(1)
}

const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
if (existing) {
  console.log(`User already exists: ${email} (${existing.id.slice(0, 8)}…) — skipping`)
  process.exit(0)
}

const result = await auth.api.signUpEmail({
  body: { email, password, name: email.split('@')[0] },
})

if (result.user) {
  console.log(`Created user: ${result.user.email} (${result.user.id.slice(0, 8)}…)`)
} else {
  console.error('Failed to create user:', result)
  process.exit(1)
}

process.exit(0)
