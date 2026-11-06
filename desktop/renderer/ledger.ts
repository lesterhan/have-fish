// The ledger as the window holds it, loaded once per change and shared by every place: the lists
// the pickers offer, and the ledger's list a page at a time. The window holds the pages a list
// draws and the rows a place keeps (its selection, its drafts), never the whole list (see #608).

import type {
  Bridge,
  ListedAccount,
  ListedCategory,
  ListedTransaction,
  Values,
  Wire,
  WireFailure,
} from '../shared/commands'

/** Rows per page: a few views' worth, so a scroll asks again rarely. */
export const PAGE = 100

export type LedgerState = {
  /** How many rows the ledger's list has. */
  total: number
  /** The pages held, by page number: the ones the list draws. */
  pages: ReadonlyMap<number, readonly ListedTransaction[]>
  /** The rows a place asked to keep, wherever they are in the list. A row that's gone isn't. */
  kept: ReadonlyMap<string, ListedTransaction>
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
  total: 0,
  pages: new Map(),
  kept: new Map(),
  accounts: [],
  categories: [],
  income: [],
  assumedFrom: null,
  failure: null,
  loaded: false,
}

/** The row at `index` in the list, if its page is held. */
export const rowAt = (state: LedgerState, index: number): ListedTransaction | undefined =>
  state.pages.get(Math.floor(index / PAGE))?.[index % PAGE]

/** Where the row with `id` is in the list, if its page is held; else -1. */
export function indexIn(state: LedgerState, id: string): number {
  for (const [page, rows] of state.pages) {
    const at = rows.findIndex((t) => t.id === id)
    if (at !== -1) return page * PAGE + at
  }
  return -1
}

/** The row with `id`, kept or held; undefined when it's neither, or gone. */
export const rowWithId = (state: LedgerState, id: string | null): ListedTransaction | undefined =>
  id === null
    ? undefined
    : (state.kept.get(id) ?? [...state.pages.values()].flat().find((t) => t.id === id))

export type LedgerStore = ReturnType<typeof ledgerStore>

type Page = Values['transaction.page']

/** The store over `bridge`. Nothing loads until `start`. */
export function ledgerStore(bridge: Pick<Bridge, 'invoke' | 'onChanged'>) {
  let state = EMPTY
  const listeners = new Set<(state: LedgerState) => void>()
  /** The load on its way, and the one queued behind it. */
  let running: Promise<void> | null = null
  let queued: Promise<void> | null = null
  /** Counts loads started: an answer asked for before the latest is older than it, and dropped. */
  let epoch = 0
  /** The pages the list draws: what a load fetches. */
  let wanted: number[] = [0]
  /** The ids a place keeps. */
  let keeping = new Set<string>()

  function emit(next: LedgerState) {
    state = next
    for (const listener of listeners) listener(state)
  }

  const pageAsk = (page: number) =>
    bridge.invoke('transaction.page', { from: page * PAGE, limit: PAGE })

  async function load(): Promise<void> {
    const mine = ++epoch
    const pages = wanted
    const asked = [...keeping]
    const [kept, accounts, categories, income, from, ...answers] = await Promise.all([
      asked.length === 0
        ? Promise.resolve({ ok: true, value: [] } as Wire<ListedTransaction[]>)
        : bridge.invoke('transaction.get', { ids: asked }),
      bridge.invoke('account.list', {}),
      bridge.invoke('category.list', {}),
      bridge.invoke('income.list', {}),
      bridge.invoke('spend.assumedFrom', {}),
      ...pages.map(pageAsk),
    ])
    if (mine !== epoch) return
    const all = [kept, accounts, categories, income, from, ...answers]
    const held = new Map<number, readonly ListedTransaction[]>()
    let total = state.total
    pages.forEach((page, i) => {
      const answer = answers[i] as Wire<Page>
      if (answer.ok) {
        held.set(page, answer.value.rows)
        total = answer.value.total
      } else {
        const old = state.pages.get(page)
        if (old !== undefined) held.set(page, old)
      }
    })
    emit({
      total,
      pages: held,
      kept: kept.ok ? keptAfter(new Set(asked), kept.value, held) : state.kept,
      accounts: accounts.ok ? accounts.value : state.accounts,
      categories: categories.ok ? categories.value : state.categories,
      income: income.ok ? income.value : state.income,
      assumedFrom: from.ok ? from.value.id : state.assumedFrom,
      failure: all.find((a): a is WireFailure => !a.ok) ?? null,
      loaded: true,
    })
  }

  /** What's kept after a load: what it found of what it asked, and the rest as they were. */
  function keptAfter(
    asked: Set<string>,
    found: readonly ListedTransaction[],
    held: ReadonlyMap<number, readonly ListedTransaction[]>,
  ): Map<string, ListedTransaction> {
    const byId = new Map(found.map((t) => [t.id, t]))
    const kept = new Map<string, ListedTransaction>()
    for (const id of keeping) {
      const row = asked.has(id)
        ? byId.get(id)
        : (rowWithId({ ...state, pages: held }, id) ?? state.kept.get(id))
      if (row !== undefined) kept.set(id, row)
    }
    return kept
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

  /** Fetches `page` unless it's held, and holds it. */
  async function fetchPage(page: number): Promise<void> {
    if (state.pages.has(page)) return
    const mine = epoch
    const answer = await pageAsk(page)
    // A load started since will fetch what's wanted as it is now.
    if (mine !== epoch || !answer.ok) return
    emit({
      ...state,
      total: answer.value.total,
      pages: new Map(state.pages).set(page, answer.value.rows),
    })
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
    /** The rows the list draws, `from` up to `to`: their pages are fetched, the rest dropped. */
    view(from: number, to: number): void {
      const first = Math.floor(from / PAGE)
      const last = Math.floor(Math.max(to - 1, from) / PAGE)
      wanted = Array.from({ length: last - first + 1 }, (_, i) => first + i)
      const pages = new Map([...state.pages].filter(([page]) => wanted.includes(page)))
      if (pages.size !== state.pages.size) emit({ ...state, pages })
      for (const page of wanted) void fetchPage(page)
    },
    /** The row at `index`, its page fetched if it isn't held; undefined past the end. */
    async rowAt(index: number): Promise<ListedTransaction | undefined> {
      if (index < 0) return undefined
      await fetchPage(Math.floor(index / PAGE))
      return rowAt(state, index)
    },
    /** Where the row with `id` is, with its page fetched; null when it's gone. */
    async locate(id: string): Promise<number | null> {
      const at = indexIn(state, id)
      if (at !== -1) return at
      const asked = await bridge.invoke('transaction.position', { id })
      if (!asked.ok || asked.value.at === null) return null
      await fetchPage(Math.floor(asked.value.at / PAGE))
      return asked.value.at
    },
    /** Keeps these rows wherever the list is: a place's selection and drafts. */
    keep(ids: Iterable<string | null>): void {
      keeping = new Set([...ids].filter((id): id is string => id !== null))
      const kept = new Map<string, ListedTransaction>()
      const missing: string[] = []
      for (const id of keeping) {
        const row = rowWithId(state, id)
        if (row === undefined) missing.push(id)
        else kept.set(id, row)
      }
      const same =
        kept.size === state.kept.size && [...kept.keys()].every((id) => state.kept.has(id))
      if (!same) emit({ ...state, kept })
      if (missing.length > 0) void fetchKept(missing)
    },
  }

  async function fetchKept(ids: string[]): Promise<void> {
    const mine = epoch
    const found = await bridge.invoke('transaction.get', { ids })
    if (mine !== epoch || !found.ok) return
    const kept = new Map(state.kept)
    for (const t of found.value) if (keeping.has(t.id)) kept.set(t.id, t)
    emit({ ...state, kept })
  }
}
