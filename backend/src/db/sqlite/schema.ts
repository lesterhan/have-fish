// The Postgres schema in `db/pg/schema.ts`, translated per L02 for SQLite (#482).
// uuid → text + randomUUID, numeric → text (never numeric(): NUMERIC affinity turns '100.00'
// into 100), timestamp → integer ms, jsonb → text json, boolean → integer, date → text.
// Table and column names are unchanged, so no query changes.
import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

// --- Better Auth tables ---
// These are required by Better Auth and must not be renamed or removed.

// The version of a sync document (see planning/epics/sync-unit.md). It lives on the root row
// only, and `$onUpdate` moves it on every update of that row, so no route has to remember to.
// A change to a transaction's postings alone moves it through the ledger service.
const version = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date())

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull(),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
})

// The person a local build serves (#287, D7). The local build has no sign-in: its first run
// inserts one `user` row directly and records it here, and every request is that user. It is a
// row rather than a setting so the database file knows whose it is wherever it is copied. One
// row at most, by the check. The server build never writes it.
export const localProfile = sqliteTable(
  'local_profile',
  {
    id: text('id').primaryKey().default('local'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [check('local_profile_one_row', sql`${t.id} = 'local'`)],
)

// --- App tables ---

// An account is any named bucket that holds or moves money.
// Examples: "assets:wise:eur", "expenses:food:restaurant", "liabilities:credit-card"
//
// The path is a colon-separated materialized path — it doubles as the hledger account name.
// It keeps the spelling it was typed with; `pathKey` is the same path in the form paths are
// compared in (`pathKey()` in `accounts/paths.ts`, #480). Every lookup and every "at or under"
// goes through the key, and an active path is unique per user by key. The service enforces that
// with a readable refusal and a rule no index can express (one spelling per tree node); the
// index is the backstop for a write that goes around it.
export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    pathKey: text('path_key').notNull(),
    name: text('name'), // optional human-friendly display name; falls back to path when null
    defaultCurrency: text('default_currency'), // ISO 4217 code; pre-selects currency in quick entry
    // hledger account type override: one of asset|liability|equity|income|expense, or null.
    // Null = infer from the path root (see resolveAccountType). Stored value wins when present —
    // the unlock for atypically-named roots that path inference can't classify.
    type: text('type'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: version(),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    uniqueIndex('accounts_user_path_key_idx')
      .on(t.userId, t.pathKey)
      .where(sql`${t.deletedAt} is null`),
  ],
)

// A transaction is a metadata envelope: a date, a description, and a set of postings.
// The money details (amounts, currencies, accounts) live entirely in postings.
export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // A calendar day, `YYYY-MM-DD`, as text (#277, calendar-date.ts). Like the Fish Pie and
    // FX dates below: a date has no time zone, and ISO text compares correctly as a string.
    date: text('date').notNull(),
    description: text('description'),
    // The group expense this transaction belongs to. The single, total forward link: set on
    // every transaction in an expense — the auto-created member txs AND the payer's origin
    // import tx (see groupExpenses.transactionId) — so "which expense?" is one lookup.
    // Used by the read payload, the edit modal's "Remove from group", and DELETE to cascade.
    // No DB FK intentional: groupExpenses already has a FK to transactions (transactionId),
    // so adding a back-reference here would create a circular FK constraint.
    groupExpenseId: text('group_expense_id'),
    // Which bank row an imported transaction came from (#282, import/fingerprint.ts), and the
    // source of its id, so importing the same row twice is refused by the index below.
    // Content-derived, so it is a local convergence device: it never leaves the device in the
    // clear, and a sync relay never gets it as a column (#375). Null for everything else.
    importFingerprint: text('import_fingerprint'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: version(),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    uniqueIndex('transactions_user_import_fingerprint_idx')
      .on(t.userId, t.importFingerprint)
      .where(sql`${t.importFingerprint} is not null`),
  ],
)

// A user-defined CSV parser configuration.
// Stores the column fingerprint of a bank's CSV export and a mapping from
// CSV columns to transaction fields. Used to auto-detect the correct parser
// when a CSV is uploaded, and to extract data from each row.
export const csvParsers = sqliteTable('csv_parsers', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  // Pipe-joined sorted normalized column names — the fingerprint used for auto-detection.
  // e.g. "amount|balance|currency|date|description|transaction"
  normalizedHeader: text('normalized_header').notNull(),
  // Maps transaction field names to normalized CSV column names.
  // { date: string, amount: string, description?: string, currency?: string }
  columnMapping: text('column_mapping', { mode: 'json' }).notNull(),
  // The account this parser's CSVs belong to by default. Nullable — not all parsers
  // need a default. Used on the import page to pre-fill the source account dropdown.
  // For multi-currency parsers this is the root path account (e.g. assets:wise),
  // not a leaf account — child accounts are derived from it per row.
  defaultAccountId: text('default_account_id').references(() => accounts.id),
  // When true, the parser supports inline multi-currency transfers (e.g. Wise).
  // Enables transfer column mappings and per-row source account inference.
  isMultiCurrency: integer('is_multi_currency', { mode: 'boolean' }).notNull().default(false),
  // Institution-specific fee account for transfer rows (e.g. expenses:fees:wise).
  // Only relevant when isMultiCurrency is true.
  defaultFeeAccountId: text('default_fee_account_id').references(() => accounts.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: version(),
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
})

// Per-user settings. One row per user, created alongside the user's seed accounts.
// Stores references to accounts that serve as defaults in various workflows.
// defaultOffsetAccountId — pre-selected on the import page as the balancing account
// defaultConversionAccountId — pre-selected when creating cross-currency transfers
export const userSettings = sqliteTable('user_settings', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  defaultOffsetAccountId: text('default_offset_account_id').references(() => accounts.id),
  defaultConversionAccountId: text('default_conversion_account_id').references(() => accounts.id),
  // All accounts whose path starts with defaultAssetsRootPath value are treated as assets.
  defaultAssetsRootPath: text('default_assets_root_path').notNull().default('assets'),
  defaultLiabilitiesRootPath: text('default_liabilities_root_path')
    .notNull()
    .default('liabilities'),
  defaultExpensesRootPath: text('default_expenses_root_path').notNull().default('expenses'),
  defaultEquityRootPath: text('default_equity_root_path').notNull().default('equity'),
  // Accounts under this root are the user's income/revenue. Distinct from equity so the
  // account-type resolver can tell a paycheck (income) from a rate-balancing leg (equity) —
  // before this, everything non-asset/non-liability collapsed to equity.
  defaultIncomeRootPath: text('default_income_root_path').notNull().default('income'),
  // Offset account used when posting reconciliation adjustments (e.g. equity:adjustments).
  defaultAdjustmentsAccountId: text('default_adjustments_account_id').references(() => accounts.id),
  // The user's home currency — used to display converted amounts in the UI.
  // Stored as an ISO 4217 code (e.g. "CAD", "USD", "EUR"). Defaults to CAD.
  preferredCurrency: text('preferred_currency').notNull().default('CAD'),
  // Catch-all JSONB blob for UI display preferences (e.g. hidden currencies).
  // Use this for any new preference rather than adding columns — keeps the table stable.
  preferences: text('preferences', { mode: 'json' })
    .notNull()
    .$defaultFn(() => ({})),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: version(),
})

// Cached daily FX rates fetched from frankfurter.app.
// Rates are global (not per-user) — the same rate applies to all users.
// The unique constraint on (date, baseCurrency, quoteCurrency) prevents double-inserts
// and allows upsert-style conflict handling in the fetch service.
export const fxRates = sqliteTable('fx_rates', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  date: text('date').notNull(), // YYYY-MM-DD
  baseCurrency: text('base_currency').notNull(), // e.g. "EUR"
  quoteCurrency: text('quote_currency').notNull(), // e.g. "CAD"
  rate: text('rate').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

// A rule matches a description substring to an expense account.
// status: 'active' = applied during import preview; 'suggested' = mined, awaiting user action;
// 'denied' = a suggestion the user hid. Denied rules keep their row (not soft-deleted) so their
// pattern stays in mining's skip-set and is never re-suggested. Approving a suggestion flips it to
// 'active'; denying flips it to 'denied'; reviving flips 'denied' back to 'suggested'.
// An import rule points a description pattern at exactly one target: either an expense
// account (accountId) or a Fish Pie split (groupId, with an optional categoryId).
//
// A split rule deliberately stores no expense account: the payer's expense leg is derived
// from the category at posting-build time, the same way a manual split does it. Storing it
// here would be a second source of truth that silently goes stale when the category's
// account mapping changes.
export const importRules = sqliteTable(
  'import_rules',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    pattern: text('pattern').notNull(),
    accountId: text('account_id').references(() => accounts.id),
    groupId: text('group_id').references(() => expenseGroups.id, { onDelete: 'cascade' }),
    categoryId: text('category_id').references(() => groupCategories.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('active'),
    matchCount: integer('match_count').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: version(),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    // Exactly one target, and a category only alongside a group. routes/rules.ts validates
    // this too and is what produces a readable 400 — this is the backstop for writes that
    // never reach the route: /api/rules/mine inserts directly, later stories add their own
    // rule-writing paths, and Drizzle Studio bypasses the app entirely.
    check(
      'import_rules_one_target',
      sql`(${t.accountId} IS NOT NULL AND ${t.groupId} IS NULL AND ${t.categoryId} IS NULL)
        OR (${t.accountId} IS NULL AND ${t.groupId} IS NOT NULL)`,
    ),
  ],
)

// --- Fish Pie (shared expense) tables ---

export const expenseGroups = sqliteTable('expense_groups', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  defaultCurrency: text('default_currency'),
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
})

export const expenseGroupMembers = sqliteTable(
  'expense_group_members',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    groupId: text('group_id')
      .notNull()
      .references(() => expenseGroups.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    shareWeight: integer('share_weight').notNull().default(1),
    // Account where this member's share of group expenses is posted (e.g. expenses:food).
    // Null = falls back to uncategorized account.
    defaultExpenseAccountId: text('default_expense_account_id').references(() => accounts.id),
    // Account the payer pays from when manually creating an expense (e.g. liabilities:visa).
    // Required by the UI when creating a manual expense; stored so it can be pre-filled next time.
    defaultPaymentAccountId: text('default_payment_account_id').references(() => accounts.id),
    joinedAt: integer('joined_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    unique().on(t.groupId, t.userId),
    index('expense_group_members_user_id_idx').on(t.userId),
  ],
)

export const expenseGroupInvites = sqliteTable(
  'expense_group_invites',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    groupId: text('group_id')
      .notNull()
      .references(() => expenseGroups.id, { onDelete: 'cascade' }),
    invitedByUserId: text('invited_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    inviteeEmail: text('invitee_email').notNull(),
    status: text('status').notNull().default('pending'), // 'pending' | 'accepted' | 'declined'
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('expense_group_invites_group_id_idx').on(t.groupId),
    index('expense_group_invites_invitee_email_idx').on(t.inviteeEmail),
  ],
)

// A spending category within a group (Food, Housing, …). Shared vocabulary for the
// whole group; each member maps it to their own expense account via
// groupCategoryMemberAccounts. Soft-archived via archivedAt — archived categories are
// hidden from create flows but still resolvable for existing expenses that point at them.
export const groupCategories = sqliteTable(
  'group_categories',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    groupId: text('group_id')
      .notNull()
      .references(() => expenseGroups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('group_categories_group_id_idx').on(t.groupId)],
)

// One member's private mapping of a category to their own expense account.
// Self-owned: each member manages only their own row.
export const groupCategoryMemberAccounts = sqliteTable(
  'group_category_member_accounts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    categoryId: text('category_id')
      .notNull()
      .references(() => groupCategories.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
  },
  (t) => [unique().on(t.categoryId, t.userId)],
)

// The group's agreed split weight for a member within a category (Housing 60/40,
// Food 70/30). Shared, not private: any member may set the whole vector — the
// agreement is implied. A category's weights apply only when every current member
// has one; otherwise the split falls back to group member weights.
export const groupCategoryWeights = sqliteTable(
  'group_category_weights',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    categoryId: text('category_id')
      .notNull()
      .references(() => groupCategories.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    weight: integer('weight').notNull(),
  },
  (t) => [unique().on(t.categoryId, t.userId)],
)

export const groupExpenses = sqliteTable(
  'group_expenses',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    groupId: text('group_id')
      .notNull()
      .references(() => expenseGroups.id, { onDelete: 'cascade' }),
    // Spending category for this expense. Null = uncategorized (legacy/pre-categories).
    // No cascade: archiving/deleting a category must not delete its expenses.
    categoryId: text('category_id').references(() => groupCategories.id, { onDelete: 'set null' }),
    paidByUserId: text('paid_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    amount: text('amount').notNull(),
    currency: text('currency').notNull(),
    date: text('date').notNull(), // YYYY-MM-DD
    // Marks the origin import transaction for an expense logged from a CSV import (paid by the
    // importer): the externally-owned bank line this expense was spawned from. Its purpose is
    // lifecycle, not lookup — it flags the one tx that must be preserved (postings patched in
    // place) rather than regenerated on edit. The belongs-to link is transactions.groupExpenseId.
    // Null for manually-created expenses and pre-integration ones.
    transactionId: text('transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('group_expenses_group_id_idx').on(t.groupId),
    index('group_expenses_category_id_idx').on(t.categoryId),
  ],
)

export const groupExpenseSplits = sqliteTable(
  'group_expense_splits',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    expenseId: text('expense_id')
      .notNull()
      .references(() => groupExpenses.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    amount: text('amount').notNull(),
  },
  (t) => [unique().on(t.expenseId, t.userId)],
)

export const groupSettlements = sqliteTable(
  'group_settlements',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    groupId: text('group_id')
      .notNull()
      .references(() => expenseGroups.id, { onDelete: 'cascade' }),
    fromUserId: text('from_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    toUserId: text('to_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // The debt being cleared, in its own currency. Balance math nets on these.
    amount: text('amount').notNull(),
    currency: text('currency').notNull(),
    // The cash actually paid. Null ⇒ native settlement (settledAmount == amount,
    // settledCurrency == currency, no FX). Non-null ⇒ cross-currency: the debt above
    // was cleared by paying settledAmount of settledCurrency at fxRate.
    settledAmount: text('settled_amount'),
    settledCurrency: text('settled_currency'),
    fxRate: text('fx_rate'),
    // Settlements created together (one combined cash transaction) share a batchId.
    // Drives combined confirm + cascade delete. Null on legacy single settlements.
    batchId: text('batch_id'),
    date: text('date').notNull(),
    note: text('note'),
    status: text('status').notNull().default('pending'),
    payerAccountId: text('payer_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    payerTransactionId: text('payer_transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    receiverTransactionId: text('receiver_transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('group_settlements_group_id_idx').on(t.groupId),
    index('group_settlements_batch_id_idx').on(t.batchId),
  ],
)

// A posting is one leg of a transaction — money moving in or out of one account.
// Every transaction has at least two postings, and they must balance to zero per currency.
// Negative amount = money leaving the account (expense/debit).
// Positive amount = money entering the account (income/credit).
export const postings = sqliteTable(
  'postings',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    transactionId: text('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    amount: text('amount').notNull(),
    currency: text('currency').notNull().default('CAD'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('postings_transaction_id_idx').on(t.transactionId),
    index('postings_account_id_idx').on(t.accountId),
  ],
)

// An assertion that one account's ledger is complete for an inclusive date range.
//
// The fact the rest of the app could never express: "this account is done through date D."
// Last-transaction-date cannot say it — a quiet account and a neglected one look identical,
// and neither ever reads *finished*. Coverage is therefore asserted, never inferred.
//
// Intervals rather than a single high-water date, because imports arrive out of order:
// August often gets done before July does. A watermark would either lie about July or refuse
// to advance past it; intervals say "you have Jan-Feb and Aug, Mar-Jul is missing" instead.
//
// Append-only with soft delete, so every assertion keeps its provenance and can be undone.
// Rows may overlap or nest freely — writers never reconcile against what is already stored;
// readers coalesce via mergeCoverage(). See coverage/intervals.ts.
export const accountCoverage = sqliteTable(
  'account_coverage',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    // Both bounds inclusive. A single covered day is fromDate === throughDate.
    fromDate: text('from_date').notNull(),
    throughDate: text('through_date').notNull(),
    // How the assertion was made: 'import' (a statement was ingested), 'reconcile' (the balance
    // matched the bank), 'manual' (the user vouched for the range), 'empty' (the user confirmed
    // nothing happened). Provenance only — all four carry equal weight when merging.
    source: text('source').notNull(),
    note: text('note'), // optional context, e.g. the statement filename
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    // Every read is "this user's coverage for this account, in date order".
    index('account_coverage_user_account_from_idx').on(t.userId, t.accountId, t.fromDate),
    // routes/coverage.ts validates both of these and is what produces a readable 400. These are
    // the backstop for writes that never reach the route: later stories have import and reconcile
    // insert directly, and Drizzle Studio bypasses the app entirely. An inverted range would
    // silently corrupt every merge downstream, so it must not be storable at all.
    check('account_coverage_range_ordered', sql`${t.fromDate} <= ${t.throughDate}`),
    check(
      'account_coverage_source_valid',
      sql`${t.source} IN ('import', 'reconcile', 'manual', 'empty')`,
    ),
  ],
)
