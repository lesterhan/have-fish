/**
 * Pure submit helpers for the Add screen — disabled-state logic, request-body
 * assembly, and the offline-queue signal. Kept free of any React Native / expo
 * import so they unit-test under `bun test`; `api.ts` imports the error class
 * from here (not the reverse) to avoid pulling RN modules into this module.
 */

/** A description-less expense falls back to this (handoff default). */
export const DEFAULT_DESCRIPTION = 'Untitled'

/**
 * Thrown by `createExpense` when the request couldn't reach the server and was
 * enqueued for retry. The UI treats this as a soft "queued" outcome, not a hard
 * error — the expense will sync when connectivity returns.
 */
export class ExpenseQueuedError extends Error {
  constructor() {
    super('Saved offline — will sync when you’re back online')
    this.name = 'ExpenseQueuedError'
  }
}

/** Classify a caught submit error into the outcome the UI should show. */
export function submitOutcome(error: unknown): 'queued' | 'error' {
  return error instanceof ExpenseQueuedError ? 'queued' : 'error'
}

/**
 * Whether the Add button is enabled: a positive amount **and** a resolved
 * payment account (the payer's per-group default). A payer with no default
 * account cannot submit — the UI surfaces a guard instead.
 */
export function canSubmit(amount: string, paymentAccountId: string | null): boolean {
  const n = parseFloat(amount)
  return Number.isFinite(n) && n > 0 && Boolean(paymentAccountId)
}

export interface ExpenseDraft {
  description: string
  amount: string
  currency: string
  date: string
  paidByUserId: string
  paymentAccountId: string
  categoryId: string | null
}

export interface ExpenseBody {
  description: string
  amount: string
  currency: string
  date: string
  paidByUserId: string
  paymentAccountId: string
  categoryId: string | null
}

/**
 * Assemble the `createExpense` body from the screen's draft: trim the
 * description (empty → {@link DEFAULT_DESCRIPTION}) and normalise the amount to
 * a 2-decimal string — the only place the amount is parsed to a number.
 */
export function buildExpenseBody(draft: ExpenseDraft): ExpenseBody {
  return {
    description: draft.description.trim() || DEFAULT_DESCRIPTION,
    amount: parseFloat(draft.amount).toFixed(2),
    currency: draft.currency,
    date: draft.date,
    paidByUserId: draft.paidByUserId,
    paymentAccountId: draft.paymentAccountId,
    categoryId: draft.categoryId,
  }
}
