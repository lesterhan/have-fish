// One-time script to create the initial user.
// Usage: bun run scripts/seed-user.ts
// Run this once after first deploy to set up your account.

import { auth } from '../src/auth'

const email = process.env.SEED_EMAIL
const password = process.env.SEED_PASSWORD

if (!email || !password) {
  console.error('Usage: SEED_EMAIL=you@example.com SEED_PASSWORD=yourpassword bun run src/seed-user.ts')
  process.exit(1)
}

const result = await auth.api.signUpEmail({
  body: { email, password, name: 'Admin' },
})

if (result.user) {
  console.log(`Created user: ${result.user.email} (id: ${result.user.id})`)
} else {
  console.error('Failed to create user:', result)
}

process.exit(0)
