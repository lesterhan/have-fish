import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from './db'
import { accounts, userSettings } from './db/schema'

// Builds the list of origins allowed to make authenticated requests (Better Auth's
// CSRF guard). FRONTEND_URL covers the web app; TRUSTED_ORIGINS is a comma-separated
// list for additional hosts the mobile app may point at (e.g. the tailnet MagicDNS
// URL), kept in env so deployment-specific hostnames stay out of the repo.
export function buildTrustedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    env.FRONTEND_URL ?? 'http://localhost:8888',
    ...(env.TRUSTED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  ]
}

// Better Auth configuration.
// - Email/password only for now (no OAuth, no email verification)
// - Uses the same Drizzle/Postgres DB as the rest of the app
// - BETTER_AUTH_SECRET must be set in .env (a long random string)
// - BETTER_AUTH_URL must be set to the backend's public URL (e.g. http://localhost:8887)
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),
  emailAndPassword: {
    enabled: true,
  },
  user: {
    deleteUser: {
      enabled: true,
    },
  },
  trustedOrigins: buildTrustedOrigins(),
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const [offsetAccount, conversionAccount, adjustmentsAccount] = await db
            .insert(accounts)
            .values([
              { userId: user.id, path: 'expenses:uncategorized' },
              { userId: user.id, path: 'equity:conversions' },
              { userId: user.id, path: 'equity:adjustments' },
            ])
            .returning()

          await db
            .insert(userSettings)
            .values({
              userId: user.id,
              defaultOffsetAccountId: offsetAccount.id,
              defaultConversionAccountId: conversionAccount.id,
              defaultAdjustmentsAccountId: adjustmentsAccount.id,
            })
        },
      },
    },
  },
})
