import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { db } from '../db'
import { accounts, csvParsers, userSettings } from '../db/schema'
import { CLEARING_PREFIX } from '../fish-pie-accounts'
import {
  type AccountTypeContext,
  type AccountTypeRoots,
  DEFAULT_ROOTS,
  tagsFrom,
} from './account-type'
import type { ClassifySettings } from './roles'

// Assembles the per-user ClassifySettings the role classifier needs: the account-type context
// (roots and tagged ancestors), the conversion account (userSettings), and every fee account
// designated across the user's CSV parsers.
export async function loadClassifySettings(userId: string): Promise<ClassifySettings> {
  const roots = await loadAccountTypeContext(userId)
  const [s] = await db
    .select({ conversionAccountId: userSettings.defaultConversionAccountId })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))

  // Fee accounts are configured per CSV parser (e.g. expenses:fees:wise), not globally.
  const feeRows = await db
    .selectDistinct({ id: csvParsers.defaultFeeAccountId })
    .from(csvParsers)
    .where(
      and(
        eq(csvParsers.userId, userId),
        isNull(csvParsers.deletedAt),
        isNotNull(csvParsers.defaultFeeAccountId),
      ),
    )
  const feeAccountIds = new Set(feeRows.map((r) => r.id).filter((id): id is string => id !== null))

  const conversionAccountIds = new Set<string>()
  if (s?.conversionAccountId) conversionAccountIds.add(s.conversionAccountId)

  return { roots, feeAccountIds, conversionAccountIds, clearingPrefix: CLEARING_PREFIX }
}

// Loads this user's configured account-type root paths, falling back to schema defaults when
// no settings row exists.
export async function loadAccountTypeRoots(userId: string): Promise<AccountTypeRoots> {
  const [s] = await db
    .select({
      assetsRootPath: userSettings.defaultAssetsRootPath,
      liabilitiesRootPath: userSettings.defaultLiabilitiesRootPath,
      equityRootPath: userSettings.defaultEquityRootPath,
      expensesRootPath: userSettings.defaultExpensesRootPath,
      incomeRootPath: userSettings.defaultIncomeRootPath,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
  return {
    assetsRootPath: s?.assetsRootPath ?? DEFAULT_ROOTS.assetsRootPath,
    liabilitiesRootPath: s?.liabilitiesRootPath ?? DEFAULT_ROOTS.liabilitiesRootPath,
    equityRootPath: s?.equityRootPath ?? DEFAULT_ROOTS.equityRootPath,
    expensesRootPath: s?.expensesRootPath ?? DEFAULT_ROOTS.expensesRootPath,
    incomeRootPath: s?.incomeRootPath ?? DEFAULT_ROOTS.incomeRootPath,
  }
}

// Everything the resolver needs for this user: the roots, and every active account that
// carries a type override, by path, so an untagged account can inherit from its nearest tagged
// ancestor. The one loader every account-type consumer goes through, so none of them can
// resolve without the tags. A caller that already holds all the user's accounts can build the
// same thing with `tagsFrom` and skip the second query.
export async function loadAccountTypeContext(userId: string): Promise<AccountTypeContext> {
  const roots = await loadAccountTypeRoots(userId)
  const rows = await db
    .select({ path: accounts.path, type: accounts.type })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNull(accounts.deletedAt), isNotNull(accounts.type)))
  return { ...roots, tagged: tagsFrom(rows) }
}
