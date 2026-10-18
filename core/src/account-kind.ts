export const ACCOUNT_KINDS = [
  'card',
  'cash',
  'bank',
  'category',
  'income',
  'opening',
  'conversion',
] as const

export type AccountKind = (typeof ACCOUNT_KINDS)[number]

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
