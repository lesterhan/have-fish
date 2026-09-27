import { describe, expect, it } from 'bun:test'
import { computeCurrencyBalances, simplifyDebts } from './balances'

const member = (userId: string) => ({ userId, userName: userId.toUpperCase() })

describe('simplifyDebts', () => {
  it('matches debtors to creditors greedily, in order', () => {
    const transfers = simplifyDebts([
      { userId: 'a', userName: null, net: 60 },
      { userId: 'b', userName: null, net: -30 },
      { userId: 'c', userName: null, net: -30 },
    ])
    expect(transfers.map((t) => [t.fromUserId, t.toUserId, t.amount])).toEqual([
      ['b', 'a', 30],
      ['c', 'a', 30],
    ])
  })

  it('ignores positions under half a cent', () => {
    expect(
      simplifyDebts([
        { userId: 'a', userName: null, net: 0.004 },
        { userId: 'b', userName: null, net: -0.004 },
      ]),
    ).toEqual([])
  })
})

describe('computeCurrencyBalances', () => {
  const members = ['a', 'b', 'c'].map(member)

  it('nets what each member paid against their shares, per currency', () => {
    const balances = computeCurrencyBalances(
      members,
      [
        {
          paidByUserId: 'a',
          amount: '30.00',
          currency: 'CAD',
          splits: [
            { userId: 'a', amount: '10.00' },
            { userId: 'b', amount: '10.00' },
            { userId: 'c', amount: '10.00' },
          ],
        },
        {
          paidByUserId: 'b',
          amount: '8.00',
          currency: 'EUR',
          splits: [
            { userId: 'a', amount: '4.00' },
            { userId: 'b', amount: '4.00' },
          ],
        },
      ],
      [],
    )
    expect(balances).toEqual([
      {
        currency: 'CAD',
        netPositions: [
          { userId: 'a', userName: 'A', amount: '20.00' },
          { userId: 'b', userName: 'B', amount: '-10.00' },
          { userId: 'c', userName: 'C', amount: '-10.00' },
        ],
        transfers: [
          {
            fromUserId: 'b',
            fromUserName: 'B',
            toUserId: 'a',
            toUserName: 'A',
            amount: '10.00',
            currency: 'CAD',
          },
          {
            fromUserId: 'c',
            fromUserName: 'C',
            toUserId: 'a',
            toUserName: 'A',
            amount: '10.00',
            currency: 'CAD',
          },
        ],
      },
      {
        currency: 'EUR',
        netPositions: [
          { userId: 'a', userName: 'A', amount: '-4.00' },
          { userId: 'b', userName: 'B', amount: '4.00' },
          { userId: 'c', userName: 'C', amount: '0.00' },
        ],
        transfers: [
          {
            fromUserId: 'a',
            fromUserName: 'A',
            toUserId: 'b',
            toUserName: 'B',
            amount: '4.00',
            currency: 'EUR',
          },
        ],
      },
    ])
  })

  it('counts a completed settlement as the payer paying the receiver', () => {
    const [cad] = computeCurrencyBalances(
      members.slice(0, 2),
      [
        {
          paidByUserId: 'a',
          amount: '20.00',
          currency: 'CAD',
          splits: [
            { userId: 'a', amount: '10.00' },
            { userId: 'b', amount: '10.00' },
          ],
        },
      ],
      [{ fromUserId: 'b', toUserId: 'a', amount: '10.00', currency: 'CAD' }],
    )
    expect(cad?.netPositions.map((p) => p.amount)).toEqual(['0.00', '0.00'])
    expect(cad?.transfers).toEqual([])
  })
})
