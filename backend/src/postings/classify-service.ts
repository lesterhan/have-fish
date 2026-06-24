import { db } from '../db'
import { userSettings, csvParsers } from '../db/schema'
import { eq, and, isNull, isNotNull } from 'drizzle-orm'
import { CLEARING_PREFIX } from '../fish-pie-accounts'
import { DEFAULT_ROOTS, type AccountTypeRoots } from './account-type'
import type { ClassifySettings } from './roles'

// Assembles the per-user ClassifySettings the role classifier needs: the configured root
// paths, the conversion account (userSettings), and every fee account designated across the
// user's CSV parsers. Falls back to schema defaults when the user has no settings row.
export async function loadClassifySettings(userId: string): Promise<ClassifySettings> {
  const [s] = await db
    .select({
      assetsRootPath: userSettings.defaultAssetsRootPath,
      liabilitiesRootPath: userSettings.defaultLiabilitiesRootPath,
      equityRootPath: userSettings.defaultEquityRootPath,
      expensesRootPath: userSettings.defaultExpensesRootPath,
      incomeRootPath: userSettings.defaultIncomeRootPath,
      conversionAccountId: userSettings.defaultConversionAccountId,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))

  const roots: AccountTypeRoots = {
    assetsRootPath: s?.assetsRootPath ?? DEFAULT_ROOTS.assetsRootPath,
    liabilitiesRootPath: s?.liabilitiesRootPath ?? DEFAULT_ROOTS.liabilitiesRootPath,
    equityRootPath: s?.equityRootPath ?? DEFAULT_ROOTS.equityRootPath,
    expensesRootPath: s?.expensesRootPath ?? DEFAULT_ROOTS.expensesRootPath,
    incomeRootPath: s?.incomeRootPath ?? DEFAULT_ROOTS.incomeRootPath,
  }

  // Fee accounts are configured per CSV parser (e.g. expenses:fees:wise), not globally.
  const feeRows = await db
    .selectDistinct({ id: csvParsers.defaultFeeAccountId })
    .from(csvParsers)
    .where(and(
      eq(csvParsers.userId, userId),
      isNull(csvParsers.deletedAt),
      isNotNull(csvParsers.defaultFeeAccountId),
    ))
  const feeAccountIds = new Set(feeRows.map((r) => r.id).filter((id): id is string => id !== null))

  const conversionAccountIds = new Set<string>()
  if (s?.conversionAccountId) conversionAccountIds.add(s.conversionAccountId)

  return { roots, feeAccountIds, conversionAccountIds, clearingPrefix: CLEARING_PREFIX }
}
