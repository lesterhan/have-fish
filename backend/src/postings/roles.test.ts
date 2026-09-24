import { describe, expect, it } from 'bun:test'
import { DEFAULT_ROOTS } from './account-type'
import { type ClassifySettings, classifyPosting, classifyPostings, isExpenseSubject } from './roles'

const FEE = 'fee-account-id'
const CONV = 'conversion-account-id'

const settings: ClassifySettings = {
  roots: { ...DEFAULT_ROOTS, tagged: new Map() },
  feeAccountIds: new Set([FEE]),
  conversionAccountIds: new Set([CONV]),
  clearingPrefix: 'assets:receivable',
}

// Builds a posting with a synthetic id so classifyPostings can key it. `accountType` is the
// account's stored hledger override; untagged is the common case, so it defaults to null.
const p = (accountId: string, accountPath: string, accountType: string | null = null) => ({
  id: accountPath,
  accountId,
  accountPath,
  accountType,
})

describe('classifyPosting', () => {
  it('plain 2-leg spend: expense → subject, asset → transfer', () => {
    expect(classifyPosting(p('a1', 'expenses:food:cafe'), settings)).toBe('subject')
    expect(classifyPosting(p('a2', 'assets:chequing'), settings)).toBe('transfer')
  })

  it('income leg is a subject (covers a paycheck, not just expenses)', () => {
    expect(classifyPosting(p('a3', 'income:salary'), settings)).toBe('subject')
  })

  it('liability leg is a transfer (paying a credit card moves money)', () => {
    expect(classifyPosting(p('a4', 'liabilities:visa'), settings)).toBe('transfer')
  })

  it('equity leg is a conversion (FX rate-balancing)', () => {
    expect(classifyPosting(p('a5', 'equity:conversion'), settings)).toBe('conversion')
  })

  it('configured conversion account wins over its expense/equity path', () => {
    // Even if the conversion account were pathed under expenses, the explicit id wins.
    expect(classifyPosting(p(CONV, 'expenses:misc'), settings)).toBe('conversion')
  })

  it('configured fee account is a fee, not a subject, despite living under expenses', () => {
    expect(classifyPosting(p(FEE, 'expenses:banking:fee'), settings)).toBe('fee')
  })

  it('Fish Pie clearing leg is a share', () => {
    expect(classifyPosting(p('a6', 'assets:receivable:roommates'), settings)).toBe('share')
  })

  it('unknown root falls back to transfer (never inflates the spend sum)', () => {
    expect(classifyPosting(p('a7', '花钱:房租'), settings)).toBe('transfer')
    expect(classifyPosting(p('a8', 'uncategorized'), settings)).toBe('transfer')
  })

  // #405: the fallback above is for an account the app has no answer for. Tagging one is an
  // answer, and the classifier used to ignore it — which is how a real spend into an
  // atypically-named category was read as moving money around.
  describe('the stored type override', () => {
    it('classifies a tagged leg under an atypical root by its type', () => {
      expect(classifyPosting(p('a9', '花钱:房租', 'expense'), settings)).toBe('subject')
      expect(classifyPosting(p('a10', '收入:工资', 'income'), settings)).toBe('subject')
      expect(classifyPosting(p('a11', '储蓄:中国银行', 'asset'), settings)).toBe('transfer')
      expect(classifyPosting(p('a12', '欠款:信用卡', 'liability'), settings)).toBe('transfer')
      expect(classifyPosting(p('a13', '换汇:中转', 'equity'), settings)).toBe('conversion')
    })

    it('collapses the two hledger subtypes onto their parents', () => {
      expect(classifyPosting(p('a14', '储蓄:现金', 'cash'), settings)).toBe('transfer')
      expect(classifyPosting(p('a15', '换汇:中转', 'conversion'), settings)).toBe('conversion')
    })

    it('wins against the path, not only fills in for it', () => {
      // A mis-pathed category under the assets root is a spend leg; an investment holding
      // pathed under expenses is not. Either way the tag decides, or it means "sometimes".
      expect(classifyPosting(p('a16', 'assets:groceries', 'expense'), settings)).toBe('subject')
      expect(classifyPosting(p('a17', 'expenses:rrsp', 'equity'), settings)).toBe('conversion')
    })

    it('still lets the explicit fee and conversion designations win', () => {
      // Precedence is unchanged: an account the user named as the fee or FX leg is that leg
      // whatever it is tagged, because the designation is about this user's plumbing.
      expect(classifyPosting(p(FEE, '花钱:手续费', 'expense'), settings)).toBe('fee')
      expect(classifyPosting(p(CONV, '储蓄:中转', 'asset'), settings)).toBe('conversion')
    })

    it('ignores a stored value outside the valid set, falling back to the path', () => {
      // Shouldn't happen — validated on write — but a junk value must not strand the leg.
      expect(classifyPosting(p('a18', 'expenses:food', 'nonsense'), settings)).toBe('subject')
      expect(classifyPosting(p('a19', '花钱:房租', 'nonsense'), settings)).toBe('transfer')
    })
  })
})

describe('classifyPostings — canonical shapes', () => {
  it('classifies a fee-bearing cross-currency Wise spend by leg', () => {
    // assets:wise:cad → assets:wise:eur, equity:conversion bridge, fee, the actual spend.
    const legs = [
      { id: 'l1', accountId: 'w-cad', accountPath: 'assets:wise:cad', accountType: null },
      { id: 'l2', accountId: 'w-eur', accountPath: 'assets:wise:eur', accountType: null },
      { id: 'l3', accountId: CONV, accountPath: 'equity:conversion', accountType: null },
      { id: 'l4', accountId: FEE, accountPath: 'expenses:banking:fee', accountType: null },
      { id: 'l5', accountId: 'cafe', accountPath: 'expenses:food:cafe', accountType: null },
    ]
    const roles = classifyPostings(legs, settings)
    expect(roles.get('l1')).toBe('transfer')
    expect(roles.get('l2')).toBe('transfer')
    expect(roles.get('l3')).toBe('conversion')
    expect(roles.get('l4')).toBe('fee')
    expect(roles.get('l5')).toBe('subject')
  })

  it('classifies a Fish Pie 3-leg split', () => {
    const legs = [
      { id: 'l1', accountId: 'visa', accountPath: 'liabilities:visa', accountType: null },
      { id: 'l2', accountId: 'food', accountPath: 'expenses:food', accountType: null },
      {
        id: 'l3',
        accountId: 'recv',
        accountPath: 'assets:receivable:roommates',
        accountType: null,
      },
    ]
    const roles = classifyPostings(legs, settings)
    expect(roles.get('l1')).toBe('transfer')
    expect(roles.get('l2')).toBe('subject')
    expect(roles.get('l3')).toBe('share')
  })

  it('tolerates a malformed cross-currency spend without crashing', () => {
    // The broken shape: the expense account reused as the FX bridge in both currencies,
    // the spend dumped into a balance account. Per-leg classification still returns a role
    // for every leg (it cannot tell the bridge is disguised — heal epic's job).
    const legs = [
      { id: 'l1', accountId: 'usd', accountPath: 'assets:bank:usd', accountType: null },
      { id: 'l2', accountId: 'coffee', accountPath: 'expenses:food:coffee', accountType: null },
      { id: 'l3', accountId: 'coffee', accountPath: 'expenses:food:coffee', accountType: null },
      { id: 'l4', accountId: 'czk', accountPath: 'assets:bank:czk', accountType: null },
    ]
    const roles = classifyPostings(legs, settings)
    expect(roles.size).toBe(4)
    expect([...roles.values()].every((r) => r !== undefined)).toBe(true)
  })
})

describe('isExpenseSubject', () => {
  it('true only for expense-type subject legs', () => {
    expect(isExpenseSubject(p('a', 'expenses:food:cafe'), settings)).toBe(true)
    // income is a subject but not an expense → excluded from the spending total
    expect(isExpenseSubject(p('a', 'income:salary'), settings)).toBe(false)
    // mechanical legs are never spend
    expect(isExpenseSubject(p('a', 'assets:chequing'), settings)).toBe(false)
    expect(isExpenseSubject(p(FEE, 'expenses:banking:fee'), settings)).toBe(false)
    expect(isExpenseSubject(p(CONV, 'equity:conversion'), settings)).toBe(false)
  })

  it('reads the stored override, the same as the classifier', () => {
    expect(isExpenseSubject(p('a', '花钱:房租', 'expense'), settings)).toBe(true)
    expect(isExpenseSubject(p('a', '收入:工资', 'income'), settings)).toBe(false)
    expect(isExpenseSubject(p('a', 'assets:groceries', 'expense'), settings)).toBe(true)
    // Untagged and unrooted is still nothing the app can call a spend.
    expect(isExpenseSubject(p('a', '花钱:房租'), settings)).toBe(false)
  })
})
