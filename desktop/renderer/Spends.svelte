<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { copy } from '../copy'
  import type { ListedTransaction } from '../shared/commands'
  import { indexIn, type LedgerStore, rowAt, rowWithId } from './ledger'
  import { toOf } from './picker'
  import { type Field as Where, fieldOf, spendWordsFor, wordsFor } from './refusals'
  import Button from './parts/Button.svelte'
  import Composer from './parts/Composer.svelte'
  import Header from './parts/Header.svelte'
  import Notice from './parts/Notice.svelte'
  import SpendCard from './SpendCard.svelte'
  import SpendList from './SpendList.svelte'

  type Props = {
    hidden: boolean
    /** Every list this place shows, shared with the others. */
    ledger: LedgerStore
    /** After a save: the fields' own undo has nothing left to take back. */
    forgetTyping: () => void
  }
  let { hidden, ledger, forgetTyping }: Props = $props()

  /** The line that writes a spend, open above today's rows. */
  let composing = $state(false)
  let line: Composer | undefined = $state()
  /** The first run's line opens by itself, once. */
  let openedFirstRun = false

  const accounts = $derived($ledger.accounts)
  const assumedName = $derived(accounts.find((a) => a.id === $ledger.assumedFrom)?.name)
  /** No accounts and no spends: the line teaches with examples in its parts. */
  const firstRun = $derived($ledger.loaded && $ledger.total === 0 && accounts.length === 0)
  const accountOptions = $derived(
    accounts.map((a) => ({ id: a.id, name: a.name, hint: copy.accounts.kinds[a.kind] })),
  )

  /** The ledger's list, a page at a time: the store holds the pages the list draws. */
  const paged = $derived({
    count: $ledger.total,
    at: (i: number) => rowAt($ledger, i),
    indexOf: (id: string) => indexIn($ledger, id),
  })
  /** Why the lists couldn't load, until they next do. */
  const unloaded = $derived($ledger.failure && wordsFor($ledger.failure))
  /** An undo or redo refused here, until I put it away. */
  let refusal = $state<string | null>(null)
  /** The load failure I put away; a different one shows again. */
  let dismissed = $state<string | null>(null)
  const notice = $derived(refusal ?? (unloaded !== dismissed ? unloaded : null))
  let selectedId = $state<string | null>(null)
  /** The spend written last, while it slides into its row. */
  let justWritten = $state<string | null>(null)
  /** The spend whose details I opened; they stay open while it's the one selected. */
  let openedId = $state<string | null>(null)
  const opened = $derived(openedId !== null && openedId === selectedId ? openedId : null)
  let list: SpendList
  let card: SpendCard | undefined = $state()

  // Each load: the selection stays while it's in the ledger, else goes to the newest.
  $effect(() => {
    const state = $ledger
    untrack(() => {
      if (state.loaded && rowWithId(state, selectedId) === undefined) {
        selectedId = rowAt(state, 0)?.id ?? null
      }
    })
  })

  // The selection stays held however far the list scrolls from it, and the open spend keeps its
  // place in the list, so its details stay drawn.
  $effect(() => ledger.keep([selectedId]))
  $effect(() => ledger.hold(opened))

  // Another row selected, the details close: a click selects, and only a second one opens.
  $effect(() => {
    if (openedId !== null && openedId !== selectedId) openedId = null
  })

  // The first run shows the line open, with examples, so writing one is the only thing to do.
  $effect(() => {
    if (firstRun && !openedFirstRun) {
      openedFirstRun = true
      void openLine()
    }
  })

  // Once the ledger is in, the place has the cursor: the list, or the line when nothing is written.
  let tookCursor = false
  $effect(() => {
    const state = $ledger
    if (!state.loaded || tookCursor) return
    tookCursor = true
    untrack(() => {
      if (document.activeElement === document.body) {
        if (state.total > 0) list.focus()
        else void openLine()
      }
    })
  })

  /** Coming here from another place: the line if it's open, else the list. */
  export function focus() {
    if (composing) line?.focus()
    else if ($ledger.total > 0) list.focus()
    else void openLine()
  }

  /** After an undo or redo: the list as it is now, with the spend that came back selected. */
  export async function show(id: string) {
    await ledger.caughtUp()
    if ((await ledger.locate(id)) !== null) selectedId = id
  }

  /** An undo or redo refused while this place is showing. */
  export function refused(words: string) {
    refusal = words
  }

  function dismiss() {
    if (refusal !== null) refusal = null
    else dismissed = unloaded
  }

  /** Ctrl+N or + New: today's page comes in first, then the line opens above it. */
  export async function newSpend() {
    if (composing) {
      line?.focus()
      return
    }
    await openLine()
  }

  async function openLine() {
    openedId = null
    composing = true
    await tick()
    // The line takes the cursor once its carried-over parts are in (Composer's open effect).
    list.toTop()
  }

  /** Esc, or reaching for the ledger: the line closes, and its half-typed draft stays. */
  function closeLine() {
    if (!composing) return
    composing = false
    if ($ledger.total > 0) list.focus()
  }

  /** Written: the line closes, and the new spend shows selected and lit. */
  async function saved(id: string) {
    composing = false
    await ledger.caughtUp()
    await ledger.locate(id)
    selectedId = id
    justWritten = id
    setTimeout(() => {
      if (justWritten === id) justWritten = null
    }, 1500)
    await tick()
    // A new line opened while the ledger caught up keeps the cursor: it isn't done with it.
    if (!composing) list.focus()
  }

  /** R on the selected row: its To picked by path, saved at once; undo takes it back. */
  async function refile(t: ListedTransaction, typed: string): Promise<void> {
    if (t.simple === null) return
    const saved = await window.haveFish.invoke('spend.edit', {
      id: t.id,
      amount: t.simple.amount,
      description: t.description,
      to: toOf(accountOptions, typed),
    })
    if (!saved.ok) {
      refusal = spendWordsFor(saved)
      return
    }
    await ledger.caughtUp()
  }

  let removing = false

  /** The selected spend, gone; selection moves to the next row. */
  export async function remove() {
    const id = selectedId
    if (id === null || removing) return
    removing = true
    // The row below it, else the one above: fetched now, since they may not be drawn.
    const at = await ledger.locate(id)
    const next =
      at === null ? null : ((await ledger.rowAt(at + 1)) ?? (await ledger.rowAt(at - 1)))?.id ?? null
    const removed = await window.haveFish.invoke('spend.remove', { id })
    removing = false
    if (!removed.ok) {
      refusal = wordsFor(removed)
      return
    }
    const wasOpen = opened === id
    selectedId = next
    await ledger.caughtUp()
    // Removed from its card, the cursor goes back to the list; with nothing left, to the line.
    if (selectedId === null) await openLine()
    else if (wasOpen) list.focus()
  }

  async function open(focus: boolean) {
    openedId = selectedId
    if (!focus) return
    await tick()
    card?.focus()
  }

  /** Esc with no chip open: the details close, and the row stays selected. */
  function close() {
    openedId = null
    list.focus()
  }
</script>

<main class="spends" {hidden}>
  <div class="top">
    <Header title={copy.app.places.ledger}>
      <Button
        action="newSpend"
        variant={composing ? 'plain' : 'primary'}
        onclick={() => void newSpend()}
      >
        {copy.spends.composer.new}
      </Button>
    </Header>
    {#if notice}<Notice words={notice} ondismiss={dismiss} />{/if}
  </div>

  <SpendList
    bind:this={list}
    {paged}
    onrange={(from, to) => ledger.view(from, to)}
    onmissing={async (index) => {
      const row = await ledger.rowAt(index)
      if (row !== undefined) selectedId = row.id
    }}
    days={$ledger.days}
    nets={$ledger.nets}
    {selectedId}
    written={justWritten}
    onselect={(id) => (selectedId = id)}
    {opened}
    onopen={open}
    oncardkey={(event) => card?.keydown(event) ?? false}
    onclose={close}
    onremove={remove}
    onrefile={refile}
    loadPaths={() => ledger.paths()}
    dimmed={composing}
    onstepback={closeLine}
  >
    {#snippet composer()}
      <Composer
        bind:this={line}
        open={composing}
        {firstRun}
        {accounts}
        {assumedName}
        loadPaths={() => ledger.paths()}
        onclose={closeLine}
        onsaved={saved}
        {forgetTyping}
      />
    {/snippet}
    {#snippet details(t: ListedTransaction)}
      <SpendCard
        bind:this={card}
        transaction={t}
        toOptions={accountOptions}
        loadPaths={() => ledger.paths()}
        onSaved={() => ledger.caughtUp()}
        onclose={close}
        onremove={remove}
      />
    {/snippet}
  </SpendList>
</main>

<style>
  /* The header, then the ledger with its line at the top. */
  main {
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas:
      'top'
      'list';
    gap: var(--space-3);
    padding: var(--space-4);
  }

  .top {
    grid-area: top;
    display: grid;
    gap: var(--space-3);
  }

  main[hidden] {
    display: none;
  }

  /* NARROW in narrow.ts. */
  @media (max-width: 44rem) {
    main {
      padding: var(--space-3);
    }
  }
</style>
