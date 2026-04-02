import { pgTable, numeric, text, timestamp, uuid, boolean, jsonb } from 'drizzle-orm/pg-core'

// --- Better Auth tables ---
// These are required by Better Auth and must not be renamed or removed.

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
})

// --- App tables ---

// An account is any named bucket that holds or moves money.
// Examples: "assets:wise:eur", "expenses:food:restaurant", "liabilities:credit-card"
//
// The path is a colon-separated materialized path — it doubles as the hledger account name.
// Path is unique per user (enforced at the application layer).
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
})

// A transaction is a metadata envelope: a date, a description, and a set of postings.
// The money details (amounts, currencies, accounts) live entirely in postings.
export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  date: timestamp('date').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
})

// A user-defined CSV parser configuration.
// Stores the column fingerprint of a bank's CSV export and a mapping from
// CSV columns to transaction fields. Used to auto-detect the correct parser
// when a CSV is uploaded, and to extract data from each row.
export const csvParsers = pgTable('csv_parsers', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  // Pipe-joined sorted normalized column names — the fingerprint used for auto-detection.
  // e.g. "amount|balance|currency|date|description|transaction"
  normalizedHeader: text('normalized_header').notNull(),
  // Maps transaction field names to normalized CSV column names.
  // { date: string, amount: string, description?: string, currency?: string }
  columnMapping: jsonb('column_mapping').notNull(),
  // The account this parser's CSVs belong to by default. Nullable — not all parsers
  // need a default. Used on the import page to pre-fill the source account dropdown.
  // For multi-currency parsers this is the root path account (e.g. assets:wise),
  // not a leaf account — child accounts are derived from it per row.
  defaultAccountId: uuid('default_account_id').references(() => accounts.id),
  // When true, the parser supports inline multi-currency transfers (e.g. Wise).
  // Enables transfer column mappings and per-row source account inference.
  isMultiCurrency: boolean('is_multi_currency').notNull().default(false),
  // Institution-specific fee account for transfer rows (e.g. expenses:fees:wise).
  // Only relevant when isMultiCurrency is true.
  defaultFeeAccountId: uuid('default_fee_account_id').references(() => accounts.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
})

// Per-user settings. One row per user, created alongside the user's seed accounts.
// Stores references to accounts that serve as defaults in various workflows.
// defaultOffsetAccountId — pre-selected on the import page as the balancing account
// defaultConversionAccountId — pre-selected when creating cross-currency transfers
export const userSettings = pgTable('user_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  defaultOffsetAccountId: uuid('default_offset_account_id').references(() => accounts.id),
  defaultConversionAccountId: uuid('default_conversion_account_id').references(() => accounts.id),
  // All accounts whose path starts with defaultAssetsRootPath value are treated as assets.
  defaultAssetsRootPath: text('default_assets_root_path').notNull().default('assets'),
  defaultLiabilitiesRootPath: text('default_liabilities_root_path').notNull().default('liabilities'),
  defaultExpensesRootPath: text('default_expenses_root_path').notNull().default('expenses'),
  // Catch-all JSONB blob for UI display preferences (e.g. hidden currencies).
  // Use this for any new preference rather than adding columns — keeps the table stable.
  preferences: jsonb('preferences').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// A posting is one leg of a transaction — money moving in or out of one account.
// Every transaction has at least two postings, and they must balance to zero per currency.
// Negative amount = money leaving the account (expense/debit).
// Positive amount = money entering the account (income/credit).
export const postings = pgTable('postings', {
  id: uuid('id').primaryKey().defaultRandom(),
  transactionId: uuid('transaction_id')
    .notNull()
    .references(() => transactions.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('CAD'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
})
