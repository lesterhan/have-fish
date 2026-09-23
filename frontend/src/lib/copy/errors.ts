/**
 * What the backend's failure codes say to the reader.
 *
 * The API answers a failed request with a code and the values that vary —
 * `{ error: 'FIELD_REQUIRED', detail: { field: 'name' } }` — and never with a sentence.
 * `backend/src/errors.ts` holds the codes and their statuses; this file holds the words.
 * Every code in that registry needs an entry here, and `copy.test.ts` reads the registry's
 * source to check it: a code with no entry renders as itself, which is how `ACCOUNT_NOT_FOUND`
 * would end up on screen.
 *
 * The keys are the codes rather than a prettier camelCase alias. The code is the contract,
 * it is the thing that greps back to the route that produced it, and keeping the two lists
 * identical is what lets the test compare them by name instead of by a mapping that would
 * need maintaining.
 *
 * Two kinds of message live here and it is worth knowing which you are editing:
 *
 * - **Failures the reader can do something about** — an account with entries still in it, a
 *   settlement that needs a conversion account, a CSV with no matching parser. These are the
 *   sentences worth agonising over; most name the fix.
 * - **Failures that mean have-fish sent a bad request** — `FIELD_NOT_UUID`, `INVALID_JSON_BODY`.
 *   The reader cannot fix these and ideally never meets one. They stay short and factual
 *   rather than apologetic; a wall of sorry for a bug helps nobody.
 *
 * The rules from `index.ts` hold here too. A message that varies is a function with named
 * arguments; counts go through `plural`; the one amount in this file goes through
 * `formatCents`, because "off by 1.5" and "off by 1.50" are not the same claim about money.
 */

import { formatCents } from '../money'
import { plural } from './plural'

/**
 * Request fields, as the reader would name them.
 *
 * The backend's `detail.field` is the JSON key — `paymentAccountId` — because that is what
 * the route actually validated and renaming it there would make the failure unsearchable.
 * The translation to English happens once, here. A field with no entry keeps its own name,
 * which is the right answer for a failure nobody was ever meant to see.
 */
const FIELD_NAMES: Record<string, string> = {
  accountId: 'account',
  amount: 'amount',
  categoryId: 'category',
  columnMapping: 'column mapping',
  currency: 'currency',
  date: 'date',
  debtAmount: 'amount owed',
  debtCurrency: 'currency owed',
  defaultAccountId: 'default account',
  defaultCurrency: 'default currency',
  defaultFeeAccountId: 'default fee account',
  description: 'description',
  email: 'email',
  expenseAccountId: 'expense account',
  feeAccountId: 'fee account',
  file: 'file',
  from: 'start',
  fromDate: 'start date',
  fromUserId: 'payer',
  groupId: 'group',
  groupIds: 'groups',
  lines: 'lines',
  months: 'number of months',
  name: 'name',
  note: 'note',
  offsetAccountId: 'offset account',
  pattern: 'pattern',
  payerAccountId: "payer's account",
  paymentAccountId: 'payment account',
  preferredCurrency: 'preferred currency',
  receiverAccountId: "recipient's account",
  settledAmount: 'amount paid',
  settledCurrency: 'currency paid',
  shareWeight: 'share',
  sourceAccountId: 'source account',
  targetAccountId: 'target account',
  throughDate: 'end date',
  to: 'end',
  toUserId: 'recipient',
  transactions: 'transactions',
  types: 'account types',
  weight: 'share',
  weights: 'shares',
}

/** A field as the reader would name it, or its own name when nobody has named it yet. */
function nameOf(field: string): string {
  return FIELD_NAMES[field] ?? field
}

/**
 * The settings an account can be the default for, as the settings screen labels them.
 * `ACCOUNT_IS_A_DEFAULT` names them when it refuses a delete.
 */
const ROLE_NAMES: Record<string, string> = {
  adjustments: 'adjustments',
  conversion: 'conversion',
  offset: 'offset',
}

/** `a, b and c` — list punctuation is formatting, so `Intl` owns it, not this file. */
const AND = new Intl.ListFormat('en-CA', { type: 'conjunction' })
const OR = new Intl.ListFormat('en-CA', { type: 'disjunction' })

/**
 * Why an imported row cannot be built, by the kind of row and the account it is missing.
 *
 * The backend reports these as one code with `{ rowKind, field }` rather than thirteen
 * near-identical sentences, which is what it had. Reading them together is also the first
 * time the four row kinds have been described in one place.
 */
const IMPORT_ROW_ACCOUNTS: Record<string, Record<string, string>> = {
  'cross-currency-spend': {
    sourceAccountId: 'A spend in another currency needs the account the money left.',
    expenseAccountId: 'A spend in another currency needs the expense it was spent on.',
    conversionAccountId:
      'A spend in another currency needs a conversion account to bridge the two currencies.',
    feeAccountId: 'A spend in another currency with a fee needs an account for the fee.',
  },
  transfer: {
    sourceAccountId: 'A transfer between currencies needs the account the money left.',
    targetAccountId: 'A transfer between currencies needs the account the money arrived in.',
    conversionAccountId:
      'A transfer between currencies needs a conversion account to bridge the two currencies.',
    feeAccountId: 'A transfer between currencies needs an account for the fee.',
  },
  'same-currency-transfer': {
    sourceAccountId: 'A transfer needs the account the money left.',
    targetAccountId: 'A transfer needs the account the money arrived in.',
    feeAccountId: 'A transfer needs an account for the fee.',
  },
  regular: {
    offsetAccountId: 'Every row needs an offset account — the other side of the entry.',
    sourceAccountId: 'This row needs an account of its own, or one chosen for the whole import.',
  },
}

export const errorsCopy = {
  UNAUTHORIZED: 'Your session has ended. Sign in again.',

  // --- have-fish sent a request the API would not take -----------------------------------
  INVALID_JSON_BODY: 'That request was malformed. Reload the page and try again.',
  FIELD_REQUIRED: ({ field }: { field: string }) => `${nameOf(field)} is required.`,
  FIELDS_REQUIRED: ({ fields }: { fields: string[] }) =>
    `${AND.format(fields.map(nameOf))} are all required.`,
  FIELD_EMPTY: ({ field }: { field: string }) => `${nameOf(field)} cannot be empty.`,
  FIELD_INVALID: ({ field }: { field: string }) => `${nameOf(field)} is not valid.`,
  FIELD_NOT_STRING: ({ field }: { field: string }) => `${nameOf(field)} must be text.`,
  FIELD_NOT_BOOLEAN: ({ field }: { field: string }) => `${nameOf(field)} must be yes or no.`,
  FIELD_NOT_OBJECT: ({ field }: { field: string }) => `${nameOf(field)} is the wrong shape.`,
  FIELD_NOT_UUID: ({ field }: { field: string }) => `${nameOf(field)} is not a valid id.`,
  FIELD_NOT_DATE: ({ field }: { field: string }) =>
    `${nameOf(field)} must be a date, written YYYY-MM-DD.`,
  FIELD_NOT_MONTH: ({ field }: { field: string }) =>
    `${nameOf(field)} must be a month, written YYYY-MM.`,
  FIELD_NOT_INTEGER: ({ field }: { field: string }) => `${nameOf(field)} must be a whole number.`,
  FIELD_NOT_POSITIVE_INTEGER: ({ field }: { field: string }) =>
    `${nameOf(field)} must be a whole number above zero.`,
  FIELD_NOT_POSITIVE_NUMBER: ({ field }: { field: string }) =>
    `${nameOf(field)} must be more than zero.`,
  FIELD_NOT_IN_SET: ({ field, allowed }: { field: string; allowed: string[] }) =>
    `${nameOf(field)} must be ${OR.format(allowed)}.`,
  FIELD_OUT_OF_RANGE: ({ field, min, max }: { field: string; min: number; max: number }) =>
    `${nameOf(field)} must be between ${min} and ${max}.`,
  NO_FIELDS_TO_UPDATE: 'Nothing was changed, so there is nothing to save.',
  RANGE_OUT_OF_ORDER: ({ from, to }: { from: string; to: string }) =>
    `${nameOf(from)} must fall on or before ${nameOf(to)}.`,
  RANGE_TOO_LONG: ({ months }: { months: number }) =>
    plural(
      months,
      'That range is too long — ask for one month at a time.',
      `That range is too long — ask for at most ${months} months at a time.`,
    ),

  // --- currency ---------------------------------------------------------------------------
  UNSUPPORTED_CURRENCY: ({ currency }: { currency?: string }) =>
    currency
      ? `have-fish does not know a currency called ${currency}.`
      : 'That is not a currency have-fish knows.',
  FX_RATE_UNAVAILABLE: 'No exchange rate is available for those two currencies yet.',
  FX_RATE_UNAVAILABLE_FOR_DATE: 'No exchange rate was published for that date.',

  // --- accounts ----------------------------------------------------------------------------
  ACCOUNT_NOT_FOUND: 'That account no longer exists.',
  ACCOUNTS_NOT_FOUND: 'One or more of those accounts no longer exists.',
  ACCOUNT_NOT_YOURS: 'That account is not one of yours.',
  ACCOUNT_PATH_INVALID: 'That is not a valid account path.',
  ACCOUNT_TYPE_INVALID: ({ type }: { type: string }) => `${type} is not an account type.`,
  ACCOUNT_INCLUDE_INVALID: ({ value }: { value: string }) =>
    `${value} is not something this listing can include.`,
  ACCOUNT_INCLUDE_UNFILED_WITH_TYPES:
    'Unfiled accounts have no type yet, so they cannot be filtered by one.',
  ACCOUNT_HAS_ENTRIES: ({ entries }: { entries: number }) =>
    plural(
      entries,
      'This account holds one entry. Move or delete it first.',
      `This account holds ${entries} entries. Move or delete them first.`,
    ),
  ACCOUNT_IS_A_DEFAULT: ({ roles }: { roles: string[] }) =>
    `This is your default ${AND.format(roles.map((r) => ROLE_NAMES[r] ?? r))} account. Point that setting somewhere else first.`,
  SETTING_ACCOUNT_NOT_FOUND: ({ field }: { field: string }) =>
    `The account you chose for ${nameOf(field)} no longer exists.`,
  CYCLE_ACCOUNT_NEEDS_CYCLE_DAY: 'An account on a statement cycle needs a statement day.',

  RECEIVABLE_NOT_CREATABLE: 'Receivable accounts are made by Fish Pie, not by hand.',
  RECEIVABLE_NOT_RENAMABLE: 'Fish Pie maintains the receivable accounts, so their names are fixed.',
  RECEIVABLE_NOT_A_RENAME_TARGET:
    'Nothing can be moved in among the receivable accounts — Fish Pie owns them.',
  RECEIVABLE_NOT_DELETABLE: 'Fish Pie maintains this account, and would only make it again.',

  RENAME_TARGET_INVALID: 'That is not a valid path to rename to.',
  RENAME_TARGET_SAME_AS_SOURCE: 'That account already has that name.',
  RENAME_TARGET_EXISTS: ({ path }: { path: string }) =>
    `${path} already exists. Moving one account onto another is a merge, not a rename.`,
  RENAME_NO_MATCH: 'No account matches that path.',

  // --- transactions -------------------------------------------------------------------------
  TRANSACTION_NOT_FOUND: 'That transaction no longer exists.',
  POSTING_NOT_FOUND: 'That line no longer exists.',
  TOO_FEW_POSTINGS: ({ index }: { index?: number } = {}) =>
    index === undefined
      ? 'A transaction needs at least two lines.'
      : `The transaction at row ${index + 1} needs at least two lines.`,
  POSTINGS_DO_NOT_BALANCE: ({
    currency,
    sum,
    index,
  }: {
    currency: string
    sum?: number
    index?: number
  }) => {
    const where = index === undefined ? 'The' : `Row ${index + 1}: the`
    const off = sum === undefined ? '' : ` They are out by ${formatCents(Math.round(sum * 100))}.`
    return `${where} ${currency} lines do not add up to zero.${off}`
  },
  TRANSACTION_NOT_MALFORMED: 'That transaction is already sound — there is nothing to repair.',
  HEAL_WOULD_UNBALANCE: ({ currency }: { currency: string; sum: number }) =>
    `Repairing this would leave the ${currency} lines unbalanced, so nothing was changed.`,

  // --- reports --------------------------------------------------------------------------------
  PREFIX_OUTSIDE_EXPENSES: 'Nothing under that path is an expense account.',

  // --- import and parsers ------------------------------------------------------------------------
  CSV_EMPTY: 'That file has a header and no rows.',
  NO_PARSER_MATCHED:
    'No saved parser matches this file’s columns. Set one up under Import Parsers in Settings.',
  PARSER_NOT_FOUND: 'That parser no longer exists.',
  PARSER_MAPPING_INCOMPLETE: 'A parser needs at least a date column and an amount column.',
  IMPORT_ROW_MISSING_ACCOUNT: ({ rowKind, field }: { rowKind: string; field: string }) =>
    IMPORT_ROW_ACCOUNTS[rowKind]?.[field] ?? `This row still needs ${nameOf(field)}.`,
  GROUP_SPLIT_MALFORMED: 'A split has to say which row it is for and which group it goes to.',
  GROUP_SPLIT_ROW_OUT_OF_RANGE: ({ rowIndex }: { rowIndex: number }) =>
    `A split points at row ${rowIndex + 1}, which is not in this file.`,

  // --- rules ------------------------------------------------------------------------------------
  RULE_NOT_FOUND: 'That rule no longer exists.',
  RULE_TARGET_AMBIGUOUS: 'A rule posts to an account or splits into a group — not both.',
  RULE_TARGET_MISSING: 'A rule needs somewhere to post: an account, or a Fish Pie group.',
  RULE_CATEGORY_WITHOUT_GROUP:
    'A category only means something inside its group, so choose the group as well.',

  // --- Fish Pie: groups and the people in them ----------------------------------------------------
  GROUP_NOT_FOUND: 'That group no longer exists, or you are not in it.',
  GROUPS_NOT_FOUND: 'One or more of those groups no longer exists.',
  MEMBER_NOT_FOUND: 'That person is not in this group.',
  CATEGORY_NOT_FOUND: 'That category no longer exists.',
  EXPENSE_NOT_FOUND: 'That expense no longer exists.',
  SETTLEMENT_NOT_FOUND: 'That settlement no longer exists.',
  INVITE_NOT_FOUND: 'That invitation is no longer open.',
  USER_NOT_FOUND: 'Your account could not be found. Sign in again.',
  NOT_A_GROUP_MEMBER: 'You are not in that group.',
  ONLY_RECIPIENT_CAN_CONFIRM: 'Only the person being paid can confirm a settlement.',
  NOT_THE_PAYER_OR_GROUP_CREATOR:
    'Only the person who paid, or whoever created the group, can change this expense.',
  NOT_A_PARTY_OR_GROUP_CREATOR:
    'Only the two people settling up, or whoever created the group, can delete this.',
  NOT_THE_INVITER_OR_GROUP_CREATOR:
    'Only the person who sent this invitation, or whoever created the group, can cancel it.',
  NOT_THE_GROUP_CREATOR: 'Only whoever created this group can change it.',
  NOT_A_MEMBER_OF_ALL_GROUPS: 'You can only merge groups you are in.',
  NAMED_USER_NOT_A_MEMBER: ({ field }: { field: string }) =>
    `The ${nameOf(field)} you chose is not in this group.`,
  NO_USER_WITH_EMAIL: 'Nobody with that email has an account here yet.',
  ALREADY_A_MEMBER: 'They are already in this group.',
  INVITE_ALREADY_PENDING: 'They already have an invitation waiting.',

  // --- Fish Pie: categories and shares ---------------------------------------------------------------
  CATEGORY_NOT_IN_GROUP: 'That category is not in this group.',
  CATEGORY_ARCHIVED: 'That category is archived, so nothing new can go in it.',
  WEIGHT_USER_NOT_A_MEMBER: 'A share was set for someone who is not in this group.',
  WEIGHT_DUPLICATE_USER: 'Somebody was given two shares.',
  WEIGHTS_INCOMPLETE: 'Shares have to cover everyone in the group, or be cleared entirely.',

  // --- Fish Pie: expenses and settling up --------------------------------------------------------------
  PAYER_NOT_A_MEMBER: 'The person who paid is not in this group.',
  PAYER_ACCOUNT_NOT_FOUND: 'That account does not belong to the person who paid.',
  RECEIVER_ACCOUNT_NOT_FOUND: 'That account does not belong to the person being paid.',
  ONLY_PAYER_CAN_SETTLE: 'Only the person paying can start a settlement.',
  SETTLEMENT_SAME_USER: 'You cannot settle up with yourself.',
  SETTLEMENT_NATIVE_AMOUNT_MISMATCH:
    'A settlement in the same currency has to be for the whole amount owed.',
  SETTLEMENT_FX_RATE_REQUIRED: 'A settlement in another currency needs an exchange rate.',
  SETTLEMENT_ALREADY_CONFIRMED: 'That settlement was already confirmed.',
  SETTLEMENT_NEEDS_BATCH_CONFIRM: 'That settlement is part of a batch — confirm the batch instead.',
  CONVERSION_ACCOUNT_REQUIRED:
    'Settling across currencies needs a conversion account. Choose one in Settings.',

  // --- Fish Pie: merging groups ----------------------------------------------------------------------------
  MERGE_NEEDS_TWO_GROUPS: 'Merging needs at least two different groups.',
  MERGE_MEMBERS_DIFFER: 'Groups can only merge when they hold exactly the same people.',
  MERGE_GROUPS_EMPTY: 'Those groups have nobody in them.',
} as const

/** What the API sends when a request fails. Anything else is a failure it did not author. */
type Failure = { error: string; detail?: Record<string, unknown> }

function isFailure(body: unknown): body is Failure {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { error?: unknown }).error === 'string'
  )
}

/**
 * The sentence for one failed response body.
 *
 * `fallback` is for the failures the API did not author — a proxy timing out, a 500 from an
 * unhandled throw, an HTML error page — where there is no code to look up. A code that has
 * no entry here also lands on the fallback rather than printing itself, so the worst case of
 * a frontend older than its backend is a vague message rather than `ACCOUNT_NOT_FOUND`.
 */
export function errorMessage(body: unknown, fallback: string): string {
  if (!isFailure(body)) return fallback
  const entry = (errorsCopy as Record<string, unknown>)[body.error]
  if (typeof entry === 'string') return entry
  if (typeof entry === 'function') {
    try {
      return (entry as (detail: Record<string, unknown>) => string)(body.detail ?? {})
    } catch {
      // A message that varies got no detail, or the wrong shape of it — a backend newer or
      // older than this build. The reader gets the vague sentence; what they must never get
      // is a thrown TypeError from inside the code that renders errors.
      return fallback
    }
  }
  return fallback
}
