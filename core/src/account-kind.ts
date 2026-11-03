export const ACCOUNT_KINDS = [
  'card',
  'cash',
  'bank',
  'loan',
  'category',
  'income',
  'opening',
  'conversion',
] as const

export type AccountKind = (typeof ACCOUNT_KINDS)[number]

/** The kinds I add on purpose: what I have and what I owe. The app makes the rest, or I type them. */
export const ADDABLE_KINDS = ['cash', 'bank', 'card', 'loan'] as const satisfies AccountKind[]
export type AddableKind = (typeof ADDABLE_KINDS)[number]

export const isAddable = (kind: AccountKind): kind is AddableKind =>
  (ADDABLE_KINDS as readonly AccountKind[]).includes(kind)

export const ACCOUNT_CLASSES = ['asset', 'liability', 'expense', 'income', 'equity'] as const
export type AccountClass = (typeof ACCOUNT_CLASSES)[number]

export const ACCOUNT_ROOTS = ['assets', 'liabilities', 'expenses', 'income', 'equity'] as const
export type AccountRoot = (typeof ACCOUNT_ROOTS)[number]

const ClassRoot: Record<AccountClass, AccountRoot> = {
  asset: 'assets',
  liability: 'liabilities',
  expense: 'expenses',
  income: 'income',
  equity: 'equity',
}

const AccountRecord: Record<AccountKind, AccountClass> = {
  card: 'liability',
  cash: 'asset',
  bank: 'asset',
  loan: 'liability',
  category: 'expense',
  income: 'income',
  opening: 'equity',
  conversion: 'equity',
}

export function classOf(kind: AccountKind) {
  return AccountRecord[kind]
}

export function rootOf(kind: AccountKind) {
  return ClassRoot[classOf(kind)]
}
