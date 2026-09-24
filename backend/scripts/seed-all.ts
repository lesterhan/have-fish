// Seed everything needed for local development in one shot.
//
// Creates two users, seeds two months of transactions for the primary user,
// and creates a shared Fish Pie group with expenses.
//
// Usage:
//   SEED_EMAIL=you@example.com SEED_PASSWORD=pass \
//   SEED_PARTNER_EMAIL=partner@example.com \
//     bun run scripts/seed-all.ts
//
// Optional env vars:
//   SEED_PARTNER_PASSWORD  — partner account password (default: password123)
//
// Seeds the previous and the current month, never past today. Safe to re-run: existing
// users, transactions and the Fish Pie group are left as they are, and a later run fills
// in the days of the current month that have passed since.

const email = process.env.SEED_EMAIL
const password = process.env.SEED_PASSWORD
const partnerEmail = process.env.SEED_PARTNER_EMAIL
const partnerPassword = process.env.SEED_PARTNER_PASSWORD ?? 'password123'

if (!email || !password || !partnerEmail) {
  console.error(
    'Usage: SEED_EMAIL=you@example.com SEED_PASSWORD=pass SEED_PARTNER_EMAIL=partner@example.com bun run scripts/seed-all.ts'
  )
  process.exit(1)
}

function run(script: string, env: Record<string, string> = {}, args: string[] = []) {
  console.log(`\n→ ${script} ${args.join(' ')}`)
  const result = Bun.spawnSync(
    ['bun', 'run', `scripts/${script}`, ...args],
    {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'inherit', 'inherit'],
      cwd: import.meta.dir + '/..',
    }
  )
  if (result.exitCode !== 0) {
    console.error(`\n✗ ${script} failed (exit ${result.exitCode})`)
    process.exit(result.exitCode ?? 1)
  }
}

// Current and previous month in YYYY-MM format, by the local calendar. Day 1 so that
// stepping back from the 31st does not roll over into the same month.
function monthStr(offset: number): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

console.log('=== seed-all ===')
console.log(`Primary user:  ${email}`)
console.log(`Partner:       ${partnerEmail}`)

// 1. Create users (idempotent)
run('seed-user.ts', { SEED_EMAIL: email, SEED_PASSWORD: password })
run('seed-user.ts', { SEED_EMAIL: partnerEmail, SEED_PASSWORD: partnerPassword })

// 2. Seed two months of personal transactions for primary user
const prevMonth = monthStr(-1)
const currMonth = monthStr(0)
run('seed-month.ts', { SEED_EMAIL: email }, [prevMonth])
run('seed-month.ts', { SEED_EMAIL: email }, [currMonth])

// 3. Seed Fish Pie group
run('seed-fish-pie.ts', {
  SEED_EMAIL: email,
  SEED_PARTNER_EMAIL: partnerEmail,
  SEED_PARTNER_PASSWORD: partnerPassword,
})

console.log('\n=== done ===')
console.log(`Login: ${email} / ${password}`)
console.log(`Partner login: ${partnerEmail} / ${partnerPassword}`)
