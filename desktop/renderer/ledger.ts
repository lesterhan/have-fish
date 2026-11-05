// The ledger as the window holds it: every list the places show, loaded once per change and
// shared by all of them. A place derives what it shows from here and never asks main for a
// list itself.

import type {
  Bridge,
  ListedAccount,
  ListedCategory,
  ListedTransaction,
  WireFailure,
} from '../shared/commands'

export type LedgerState = {
  transactions: ListedTransaction[]
  /** My accounts, which can pay or be paid into. */
  accounts: ListedAccount[]
  /** The categories in use, most used first. */
  categories: ListedCategory[]
  /** The income sources money has come from, most used first. */
  income: ListedCategory[]
  /** The account a spend comes out of when From is left alone. */
  assumedFrom: string | null
  /** Why the last load didn't get every list; null once one does. */
  failure: WireFailure | null
  /** Whether a load has finished yet. */
  loaded: boolean
}

const EMPTY: LedgerState = {
  transactions: [],
  accounts: [],
  categories: [],
  income: [],
  assumedFrom: null,
  failure: null,
  loaded: false,
}

export type LedgerStore = ReturnType<typeof ledgerStore>

/** The store over `bridge`. Nothing loads until `start`. */
export function ledgerStore(bridge: Pick<Bridge, 'invoke' | 'onChanged'>) {
  let state = EMPTY
  const listeners = new Set<(state: LedgerState) => void>()
  /** The load on its way, and the one queued behind it. */
  let running: Promise<void> | null = null
  let queued: Promise<void> | null = null

  async function load(): Promise<void> {
    const answers = await Promise.all([
      bridge.invoke('transaction.list', {}),
      bridge.invoke('account.list', {}),
      bridge.invoke('category.list', {}),
      bridge.invoke('income.list', {}),
      bridge.invoke('spend.assumedFrom', {}),
    ])
    const [listed, accounts, categories, income, from] = answers
    state = {
      transactions: listed.ok ? listed.value : state.transactions,
      accounts: accounts.ok ? accounts.value : state.accounts,
      categories: categories.ok ? categories.value : state.categories,
      income: income.ok ? income.value : state.income,
      assumedFrom: from.ok ? from.value.id : state.assumedFrom,
      failure: answers.find((a): a is WireFailure => !a.ok) ?? null,
      loaded: true,
    }
    for (const listener of listeners) listener(state)
  }

  /**
   * A load that starts after this call. One already on its way started too early to count, so a
   * second waits behind it; any more calls meanwhile share that second.
   */
  function refresh(): Promise<void> {
    if (running === null) {
      running = load().finally(() => {
        running = null
      })
      return running
    }
    queued ??= running.then(() => {
      queued = null
      return refresh()
    })
    return queued
  }

  return {
    /** Loads now, and again after each change main announces. Returns the stop. */
    start(): () => void {
      void refresh()
      return bridge.onChanged(() => void refresh())
    },
    /** Svelte's store contract: `$ledger` in a component. */
    subscribe(listener: (state: LedgerState) => void): () => void {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },
    current: (): LedgerState => state,
    /**
     * Resolves once the store holds the ledger as it is now. After a write, main's notice has
     * started a load (it arrives before the command's answer), so this waits for that one; with
     * none on its way, it starts one.
     */
    caughtUp(): Promise<void> {
      return queued ?? running ?? refresh()
    },
  }
}
