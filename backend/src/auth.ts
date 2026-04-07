import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from './db'
import { accounts, userSettings } from './db/schema'

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
  trustedOrigins: [process.env.FRONTEND_URL ?? 'http://localhost:8888'],
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
