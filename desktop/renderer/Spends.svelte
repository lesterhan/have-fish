<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { copy } from '../copy'
  import type { ListedTransaction } from '../shared/commands'
  import { added, EMPTY, landing, movedBy } from './batch'
  import { type Cursor, type CursorMoment, cursorFor } from './cursor'
  import { todayIn } from './format'
  import { indexIn, type LedgerStore, rowAt, rowWithId } from './ledger'
  import { toOf } from './picker'
  import { wordsFor } from './refusals'
  import Batch from './Batch.svelte'
  import Composer from './Composer.svelte'
  import Button from './parts/Button.svelte'
  import Header from './parts/Header.svelte'
  import Notice from './parts/Notice.svelte'
  import SpendCard from './SpendCard.svelte'
  import SpendList from './SpendList.svelte'
  import type { SpendActions } from './spendActions'

  type Props = {
    hidden: boolean
    /** Every list this place shows, shared with the others. */
    ledger: LedgerStore
    /** What a spend can do, shared with the others. */
    actions: SpendActions
    /** After a save: the fields' own undo has nothing left to take back. */
    forgetTyping: () => void
  }
  let { hidden, ledger, actions, forgetTyping }: Props = $props()

  /** The line that writes a spend, open above today's rows. */
  let composing = $state(false)
  let line: Composer | undefined = $state()
  /** The first run's line opens by itself, once. */
  let openedFirstRun = false
  const loaded = $derived($ledger.loaded)

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
  /** What this opening of the line has written, under it, newest first. */
  let batch = $state(EMPTY)
  /** The rows a batch landed on, lit until each row's light fades. */
  let landed = $state<ReadonlySet<string>>(new Set())
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
      untrack(() => showLine())
    }
  })

  // Once the ledger is in, the place has the cursor: the list, or the line when nothing is written.
  $effect(() => {
    if (loaded) untrack(() => void move('loaded'))
  })

  /** Asks where the cursor goes after `moment`, and puts it there. */
  function move(moment: CursorMoment, cardWasOpen = false): Promise<void> {
    return place(
      cursorFor(moment, { total: $ledger.total, composing, hidden, cardWasOpen }),
    )
  }

  /** The one place the ledger moves the cursor on a load or a save, once what changed is drawn. */
  async function place(cursor: Cursor | null): Promise<void> {
    if (cursor === null) return
    if (cursor === 'line') showLine()
    await tick()
    if (cursor === 'line') line?.focus()
    else if (cursor === 'list') list.focus()
    else card?.focus()
  }

  /** Opens the line above today's rows, the newest page in view; any open card closes. */
  function showLine() {
    if (composing) return
    openedId = null
    composing = true
    landed = new Set()
    list.toTop()
  }

  /** Coming here from another place: the line if it's open, else the list. */
  export function focus() {
    void move('cameHere')
  }

  /** After an undo or redo: the list as it is now, with the spend that came back selected. */
  export async function show(id: string) {
    await ledger.caughtUp()
    // With the line open, an undo or redo moves its newest line, out of the batch or back in.
    if (composing) batch = movedBy(batch, id)
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
    await move('newSpend')
  }

  /** Esc, Done, a picker's Esc, or reaching for the ledger: close now, or once the row is in. */
  function closeLine() {
    if (!composing) return
    line?.close()
  }

  /** The line is done: it closes, and its batch lands on its days. */
  async function land() {
    if (!composing) return
    composing = false
    if (batch.lines.length === 0) {
      await move('lineClosed')
      return
    }
    // The newest line's page comes in first, so it has a row to be selected and lit where it lands.
    const at = landing(batch)
    if (at.newest !== null) await ledger.locate(at.newest)
    landed = at.ids
    selectedId = at.newest
    batch = EMPTY
    await move('lineClosed')
  }

  /** Written: the row drops into the batch under the line, once the ledger has caught up. */
  async function saved(id: string) {
    await ledger.caughtUp()
    const at = await ledger.locate(id)
    const row = at === null ? undefined : await ledger.rowAt(at)
    if (row !== undefined) batch = added(batch, row)
  }

  /** The fresh line is ready: the cursor comes back to it, by cursor.ts, as after a write. */
  function freshLine() {
    void move('written')
  }

  /** R on the selected row: its To picked by path, saved at once; undo takes it back. */
  async function saveRefile(t: ListedTransaction, typed: string): Promise<void> {
    const saved = await actions.refile(t, typed, (text) => toOf(accountOptions, text))
    if (!saved.ok) {
      refusal = saved.words
      return
    }
    await ledger.caughtUp()
  }

  /** R from the menu: the selected row's To becomes a path picker. */
  export function refile() {
    list.refile()
  }

  /** P from the menu: the open spend's postings, shown or hidden. */
  export function postings() {
    card?.togglePostings()
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
    const removed = await actions.remove(id)
    removing = false
    if (!removed.ok) {
      refusal = removed.words
      return
    }
    const wasOpen = opened === id
    selectedId = next
    await ledger.caughtUp()
    // Removed from its card, the cursor goes back to the list; with nothing left, to the line.
    await move('removed', wasOpen)
  }

  async function open(focus: boolean) {
    openedId = selectedId
    if (focus) await move('cardOpened')
  }

  /** Esc with no chip open: the details close, and the row stays selected. */
  function close() {
    openedId = null
    void move('cardClosed')
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
    {landed}
    onlanded={() => (landed = new Set())}
    onselect={(id) => (selectedId = id)}
    {opened}
    onopen={open}
    oncardkey={(event) => card?.keydown(event) ?? false}
    onclose={close}
    onremove={remove}
    onrefile={saveRefile}
    loadPaths={() => ledger.paths()}
    dimmed={composing}
    onstepback={closeLine}
  >
    {#snippet composer()}
      <div class="write">
        <Composer
          bind:this={line}
          {actions}
          open={composing}
          {firstRun}
          {accounts}
          {assumedName}
          loadPaths={() => ledger.paths()}
          onclose={land}
          onsaved={saved}
          onfresh={freshLine}
          {forgetTyping}
        />
        {#if batch.lines.length > 0}<Batch {batch} today={todayIn()} />{/if}
      </div>
    {/snippet}
    {#snippet details(t: ListedTransaction)}
      <SpendCard
        bind:this={card}
        {actions}
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

  /* The line, and its batch under it. */
  .write {
    display: grid;
    gap: var(--space-2);
    min-height: 0;
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
