import { describe, it, expect } from 'bun:test'
import {
  canSummaryEdit,
  editableSubjectIds,
  initialEditDraft,
  setSubjectAccount,
  isDirty,
  buildSavePlan,
} from './detailEdit'
import type { Posting, PostingRole, Transaction } from '$lib/api'

// Build a posting; id derived from accountPath so fixtures stay terse. accountId == path
// here so payload assertions read clearly.
function p(
  accountPath: string,
  amount: string,
  currency: string,
  role: PostingRole,
  id = accountPath + ':' + amount,
): Posting {
  return {
    id,
    accountId: accountPath,
    accountPath,
    accountName: null,
    amount,
    currency,
    role,
  }
}

function tx(postings: Posting[], over: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx1',
    userId: 'u1',
    date: '2026-06-20T00:00:00.000Z',
    description: 'Lunch',
    groupExpenseId: null,
    groupName: null,
    postings,
    ...over,
  }
}

// Same-currency single-hop spend: one transfer asset out, one subject expense in.
function simpleSpend(): Posting[] {
  return [
    p('assets:chequing', '-50.00', 'CAD', 'transfer'),
    p('expenses:food:cafe', '50.00', 'CAD', 'subject'),
  ]
}

// Fee-bearing cross-currency Wise spend: only the cafe leg is a subject.
function wiseSpend(): Posting[] {
  return [
    p('assets:wise:cad', '-80.00', 'CAD', 'transfer'),
    p('assets:wise:eur', '50.00', 'EUR', 'transfer'),
    p('equity:conversion', '80.00', 'CAD', 'conversion'),
    p('expenses:banking:fee', '0.05', 'EUR', 'fee'),
    p('expenses:food:cafe', '50.00', 'EUR', 'subject'),
  ]
}

// A two-category same-currency split: two subject legs.
function twoCategory(): Posting[] {
  return [
    p('assets:chequing', '-30.00', 'CAD', 'transfer'),
    p('expenses:food', '20.00', 'CAD', 'subject'),
    p('expenses:transport', '10.00', 'CAD', 'subject'),
  ]
}

describe('canSummaryEdit (re-exported)', () => {
  it('true with a subject, false for a subject-less shape', () => {
    expect(canSummaryEdit(simpleSpend())).toBe(true)
    expect(
      canSummaryEdit([
        p('assets:savings', '1000.00', 'CAD', 'transfer'),
        p('equity:opening-balances', '-1000.00', 'CAD', 'conversion'),
      ]),
    ).toBe(false)
  })
})

describe('editableSubjectIds', () => {
  it('returns only the subject leg ids', () => {
    expect([...editableSubjectIds(wiseSpend())]).toEqual([
      'expenses:food:cafe:50.00',
    ])
  })

  it('returns every subject of a multi-category split', () => {
    expect([...editableSubjectIds(twoCategory())]).toEqual([
      'expenses:food:20.00',
      'expenses:transport:10.00',
    ])
  })

  it('is empty for a subject-less shape', () => {
    expect(
      editableSubjectIds([p('assets:a', '1.00', 'CAD', 'transfer')]).size,
    ).toBe(0)
  })
})

describe('initialEditDraft', () => {
  it('slices the date to yyyy-mm-dd and seeds header + subject drafts', () => {
    expect(initialEditDraft(tx(simpleSpend()))).toEqual({
      date: '2026-06-20',
      description: 'Lunch',
      subjects: [
        {
          postingId: 'expenses:food:cafe:50.00',
          accountId: 'expenses:food:cafe',
        },
      ],
    })
  })

  it('represents a null description as an empty string', () => {
    expect(
      initialEditDraft(tx(simpleSpend(), { description: null })).description,
    ).toBe('')
  })
})

describe('setSubjectAccount', () => {
  it('repoints one draft immutably, leaving others untouched', () => {
    const draft = initialEditDraft(tx(twoCategory()))
    const next = setSubjectAccount(
      draft.subjects,
      'expenses:food:20.00',
      'expenses:groceries',
    )
    expect(next).toEqual([
      { postingId: 'expenses:food:20.00', accountId: 'expenses:groceries' },
      {
        postingId: 'expenses:transport:10.00',
        accountId: 'expenses:transport',
      },
    ])
    // original array not mutated
    expect(draft.subjects[0].accountId).toBe('expenses:food')
  })
})

describe('isDirty', () => {
  it('false for an untouched draft', () => {
    const t = tx(simpleSpend())
    expect(isDirty(t, initialEditDraft(t))).toBe(false)
  })

  it('true when a subject account is repointed', () => {
    const t = tx(simpleSpend())
    const d = initialEditDraft(t)
    d.subjects = setSubjectAccount(
      d.subjects,
      'expenses:food:cafe:50.00',
      'expenses:groceries',
    )
    expect(isDirty(t, d)).toBe(true)
  })

  it('true when the date changes', () => {
    const t = tx(simpleSpend())
    expect(isDirty(t, { ...initialEditDraft(t), date: '2026-06-21' })).toBe(
      true,
    )
  })

  it('true when the description changes, ignoring surrounding whitespace', () => {
    const t = tx(simpleSpend())
    expect(isDirty(t, { ...initialEditDraft(t), description: 'Brunch' })).toBe(
      true,
    )
    // whitespace-only change is not dirty (description compared trimmed)
    expect(
      isDirty(t, { ...initialEditDraft(t), description: '  Lunch  ' }),
    ).toBe(false)
  })
})

describe('buildSavePlan', () => {
  it('is a no-op plan for a clean draft', () => {
    const t = tx(simpleSpend())
    expect(buildSavePlan(t, initialEditDraft(t))).toEqual({
      recategorize: null,
      patch: null,
    })
  })

  it('emits a balanced recategorize payload and no patch on an account change', () => {
    const t = tx(wiseSpend())
    const d = initialEditDraft(t)
    d.subjects = setSubjectAccount(
      d.subjects,
      'expenses:food:cafe:50.00',
      'expenses:food:bar',
    )
    const plan = buildSavePlan(t, d)
    expect(plan.patch).toBeNull()
    expect(plan.recategorize).not.toBeNull()
    // only the subject leg moved; mechanical legs pass through unchanged
    expect(plan.recategorize).toEqual([
      { accountId: 'assets:wise:cad', amount: '-80.00', currency: 'CAD' },
      { accountId: 'assets:wise:eur', amount: '50.00', currency: 'EUR' },
      { accountId: 'equity:conversion', amount: '80.00', currency: 'CAD' },
      { accountId: 'expenses:banking:fee', amount: '0.05', currency: 'EUR' },
      { accountId: 'expenses:food:bar', amount: '50.00', currency: 'EUR' },
    ])
  })

  it('preserves per-currency balance through a recategorize (amounts untouched)', () => {
    const t = tx(simpleSpend())
    const d = initialEditDraft(t)
    d.subjects = setSubjectAccount(
      d.subjects,
      'expenses:food:cafe:50.00',
      'expenses:groceries',
    )
    const plan = buildSavePlan(t, d)
    const byCcy = new Map<string, number>()
    for (const leg of plan.recategorize!) {
      byCcy.set(
        leg.currency,
        (byCcy.get(leg.currency) ?? 0) +
          Math.round(parseFloat(leg.amount) * 100),
      )
    }
    for (const sum of byCcy.values()) expect(sum).toBe(0)
  })

  it('emits only a patch when just the header changed', () => {
    const t = tx(simpleSpend())
    const plan = buildSavePlan(t, {
      ...initialEditDraft(t),
      date: '2026-06-22',
      description: 'Dinner',
    })
    expect(plan.recategorize).toBeNull()
    expect(plan.patch).toEqual({ date: '2026-06-22', description: 'Dinner' })
  })

  it('patches description to null when cleared', () => {
    const t = tx(simpleSpend())
    const plan = buildSavePlan(t, {
      ...initialEditDraft(t),
      description: '   ',
    })
    expect(plan.patch).toEqual({ description: null })
  })

  it('emits both parts when account and header both changed', () => {
    const t = tx(simpleSpend())
    const d = { ...initialEditDraft(t), date: '2026-06-23' }
    d.subjects = setSubjectAccount(
      d.subjects,
      'expenses:food:cafe:50.00',
      'expenses:groceries',
    )
    const plan = buildSavePlan(t, d)
    expect(plan.recategorize).not.toBeNull()
    expect(plan.patch).toEqual({ date: '2026-06-23' })
  })
})
