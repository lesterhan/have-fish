// What each currency I hold cost me in home cents, day by day: the average of what arrived at a
// known cost, from the ledger's own transactions. Derived each time it is asked, never stored.

import { type AccountKind, isAddable } from './account-kind'
import { type Rate, ratio } from './rates'
import { type ShapeLeg, shapeOf } from './shapes'

/** A transaction as the pool reads it: its day, and its legs. */
export type PoolTransaction = { readonly date: string; readonly legs: readonly ShapeLeg[] }

/** What one currency held and cost me after a day it moved. */
export type PoolDay = {
  readonly date: string
  /** What one cent of it cost in home cents; null until any of it has a known cost. */
  readonly rate: Rate | null
  /** Cents held at a known cost. */
  readonly known: number
  /** Cents held of unknown cost; below zero once more went out than came in. */
  readonly unknown: number
}

/** Each currency but the home one, by code: a day for each day it moved, in order. */
export type Pools = ReadonlyMap<string, readonly PoolDay[]>

// The cost in millionths of a cent: exact fractions grow with every conversion.
const SCALE = 1_000_000n

/** What one currency holds as the pool goes: the three figures its PoolDay will hold. */
type Running = { rate: Rate | null; known: number; unknown: number }

/** One currency moving on a day, in one of the day's three phases. */
type Move =
  | { phase: 1; kind: 'arrive'; currency: string; cents: number; cost: bigint | null }
  | { phase: 2; kind: 'carry'; from: string; to: string; out: number; into: number }
  | { phase: 3; kind: 'depart'; currency: string; cents: number }
  | { phase: 3; kind: 'debt'; currency: string; cents: number; rate: Rate }

/** Each currency's days, from the transactions, whatever order they come in. */
export function poolsOf(
  transactions: readonly PoolTransaction[],
  kindOf: (accountId: string) => AccountKind | undefined,
  home: string,
): Pools {
  const ordered = [...transactions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const byDay: { date: string; transactions: PoolTransaction[] }[] = []
  for (const transaction of ordered) {
    const last = byDay.at(-1)
    if (last !== undefined && last.date === transaction.date) last.transactions.push(transaction)
    else byDay.push({ date: transaction.date, transactions: [transaction] })
  }

  const held = new Map<string, Running>()
  const pools = new Map<string, PoolDay[]>()
  for (const { date, transactions: sameDay } of byDay) {
    const moves = sameDay.flatMap((transaction) => movesOf(transaction.legs, kindOf, home))
    // Within a day every arrival comes before every departure, whatever order they were written
    // in: home-cost arrivals, then exchanges from another currency, then departures.
    moves.sort((a, b) => a.phase - b.phase)
    for (const move of moves) apply(move, held)
    for (const currency of new Set(moves.flatMap(currenciesOf))) {
      const running = held.get(currency)
      if (running === undefined) continue
      const moved: PoolDay = {
        date,
        rate: running.rate,
        known: running.known,
        unknown: running.unknown,
      }
      const days = pools.get(currency)
      if (days === undefined) pools.set(currency, [moved])
      else days.push(moved)
    }
  }
  return pools
}

/** The last day the currency moved on or before `date`: what it costs on a day it didn't. */
export function costOn(pools: Pools, currency: string, date: string): PoolDay | null {
  const days = pools.get(currency)
  if (days === undefined) return null
  let [low, high] = [0, days.length]
  while (low < high) {
    const middle = (low + high) >>> 1
    const day = days[middle]
    if (day !== undefined && day.date <= date) low = middle + 1
    else high = middle
  }
  return days[low - 1] ?? null
}

/** What the transaction moves, by the shape it takes and the kinds of its accounts. */
function movesOf(
  legs: readonly ShapeLeg[],
  kindOf: (accountId: string) => AccountKind | undefined,
  home: string,
): Move[] {
  const conversion = legs.some((leg) => kindOf(leg.accountId) === 'conversion')
  const shape = legs.length === 4 && conversion ? shapeOf(legs, kindOf) : null

  if (shape !== null && shape.shape === 'exchange') {
    const { from, to } = shape
    if (to.currency !== home) {
      if (from.currency === home) {
        return [
          {
            phase: 1,
            kind: 'arrive',
            currency: to.currency,
            cents: to.cents,
            cost: BigInt(-from.cents) * SCALE,
          },
        ]
      }
      return [
        {
          phase: 2,
          kind: 'carry',
          from: from.currency,
          to: to.currency,
          out: -from.cents,
          into: to.cents,
        },
      ]
    }
    // The home currency arrived. Only what left is of this pool.
    if (from.currency === home) return []
    return [{ phase: 3, kind: 'depart', currency: from.currency, cents: -from.cents }]
  }

  if (shape !== null && shape.shape === 'start' && shape.via !== undefined) {
    const { account, opening } = shape
    if (account.currency === home) return []
    if (account.cents > 0) {
      return [
        {
          phase: 1,
          kind: 'arrive',
          currency: account.currency,
          cents: account.cents,
          cost: BigInt(-opening.cents) * SCALE,
        },
      ]
    }
    return [
      {
        phase: 3,
        kind: 'debt',
        currency: account.currency,
        cents: -account.cents,
        rate: ratio(-account.cents, opening.cents),
      },
    ]
  }

  return netted(legs, kindOf, home)
}

/** What a transaction with no known cost moves, by the net of its own accounts' legs. */
function netted(
  legs: readonly ShapeLeg[],
  kindOf: (accountId: string) => AccountKind | undefined,
  home: string,
): Move[] {
  const moved = new Map<string, number>()
  for (const leg of legs) {
    const kind = kindOf(leg.accountId)
    if (kind === undefined || !isAddable(kind) || leg.currency === home) continue
    moved.set(leg.currency, (moved.get(leg.currency) ?? 0) + leg.cents)
  }
  const moves: Move[] = []
  for (const [currency, cents] of moved) {
    if (cents > 0) moves.push({ phase: 1, kind: 'arrive', currency, cents, cost: null })
    if (cents < 0) moves.push({ phase: 3, kind: 'depart', currency, cents: -cents })
  }
  return moves
}

/** The currencies a move touches, so a day is written for each of them. */
function currenciesOf(move: Move): string[] {
  return move.kind === 'carry' ? [move.from, move.to] : [move.currency]
}

function apply(move: Move, held: Map<string, Running>): void {
  switch (move.kind) {
    case 'arrive': {
      if (move.cost === null) heldOf(held, move.currency).unknown += move.cents
      else arriveAtCost(held, move.currency, move.cents, move.cost)
      return
    }
    case 'carry': {
      // The two currencies move in one step: the share of what arrived bought with known-cost
      // money carries its cost, and the rest is of unknown cost.
      const from = heldOf(held, move.from)
      const rate = from.rate
      const taken = rate === null ? 0 : Math.min(move.out, from.known)
      from.known -= taken
      from.unknown -= move.out - taken
      const bought = Number(half(BigInt(move.into) * BigInt(taken), BigInt(move.out)))
      if (rate !== null && bought > 0) {
        arriveAtCost(held, move.to, bought, half(BigInt(taken) * SCALE * rate.num, rate.den))
      }
      heldOf(held, move.to).unknown += move.into - bought
      return
    }
    case 'depart': {
      depart(held, move.currency, move.cents)
      return
    }
    case 'debt': {
      // A start I owe lowers what is held like a spend, and sets the rate only where the
      // currency has none: a debt never weighs the next conversion's average.
      const running = heldOf(held, move.currency)
      depart(held, move.currency, move.cents)
      if (running.rate === null) running.rate = move.rate
      return
    }
  }
}

/** `cents` at a known `cost`, in millionths: the new average over what the currency now holds. */
function arriveAtCost(
  held: Map<string, Running>,
  currency: string,
  cents: number,
  cost: bigint,
): void {
  const running = heldOf(held, currency)
  const before =
    running.rate === null || running.known === 0
      ? 0n
      : half(BigInt(running.known) * SCALE * running.rate.num, running.rate.den)
  running.rate = lowest(before + cost, BigInt(running.known + cents) * SCALE)
  running.known += cents
}

/** `cents` leave: what is of known cost first, then what is of unknown cost. */
function depart(held: Map<string, Running>, currency: string, cents: number): void {
  const running = heldOf(held, currency)
  const taken = Math.min(cents, running.known)
  running.known -= taken
  running.unknown -= cents - taken
}

/** The currency's figures, started empty the first time it moves. */
function heldOf(held: Map<string, Running>, currency: string): Running {
  const found = held.get(currency)
  if (found !== undefined) return found
  const started: Running = { rate: null, known: 0, unknown: 0 }
  held.set(currency, started)
  return started
}

/** `n` over `d`, rounded half up: both at or above zero, and `d` above it. */
function half(n: bigint, d: bigint): bigint {
  const whole = n / d
  return (n % d) * 2n >= d ? whole + 1n : whole
}

/** The pair in lowest terms, both parts whole and above zero. */
function lowest(num: bigint, den: bigint): Rate {
  let [a, b] = [num, den]
  while (b > 0n) [a, b] = [b, a % b]
  return { num: num / a, den: den / a }
}
