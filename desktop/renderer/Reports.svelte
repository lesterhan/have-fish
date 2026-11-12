<script lang="ts">
  import { comparedAt } from '@have-fish/core/spending'
  import { format } from '@have-fish/core/money'
  import { tick, untrack } from 'svelte'
  import { copy } from '../copy'
  import type { ListedTransaction } from '../shared/commands'
  import { todayIn } from './format'
  import Day from './parts/Day.svelte'
  import type { LedgerStore } from './ledger'

  import { toOf } from './picker'
  import { query } from './query'
  import { wordsFor } from './refusals'
  import {
    otherText,
    spendsBehind,
    spentOf,
    thisWeek,
    treeKey,
    treeRows,
    type Week,
    weekAfter,
    weekSpending,
  } from './report'
  import { afterRemoving, kept } from './selection'
  import Button from './parts/Button.svelte'
  import Empty from './parts/Empty.svelte'
  import Header from './parts/Header.svelte'
  import Notice from './parts/Notice.svelte'
  import SpendingTree from './SpendingTree.svelte'
  import SpendCard from './SpendCard.svelte'
  import SpendList from './SpendList.svelte'
  import type { SpendActions } from './spendActions'

  type Props = {
    hidden: boolean
    /** Every list this place shows, shared with the others. */
    ledger: LedgerStore
    /** What a spend can do, shared with the others. */
    actions: SpendActions
  }
  let { hidden, ledger, actions }: Props = $props()

  let week = $state.raw<Week>(thisWeek(todayIn()))
  /** The week, the week before it for each row's comparison, and the week's spends. */
  const spending = query(window.haveFish, ['report.spending', 'transaction.get'], weekSpending)
  spending.set(untrack(() => week))
  $effect(() => spending.start())
  $effect(() => spending.show(!hidden))
  const report = $derived($spending.value?.report ?? null)
  const earlier = $derived($spending.value?.earlier ?? null)
  /** The categories that are open in the tree, by name. */
  let opened = $state.raw<ReadonlySet<string>>(new Set())
  /** The tree's selected row, by its key. */
  let selectedKey = $state<string | null>(null)
  let error = $state<string | null>(null)

  /** The week's spends, and any with a draft: asked of main, never the store. */
  const transactions = $derived($spending.value?.spends ?? [])
  // For the card: the accounts a To can name.
  const payers = $derived($ledger.accounts)
  /** Why the lists or the report couldn't load, until they next do. */
  const unloaded = $derived.by(() => {
    const failure = $ledger.failure ?? $spending.failure
    return failure && wordsFor(failure)
  })
  /** The load failure I put away; a different one shows again. */
  let dismissed = $state<string | null>(null)
  /** A refusal stays until I put it away, as does a load failure. */
  const notice = $derived(error ?? (unloaded !== dismissed ? unloaded : null))

  function dismiss() {
    if (error !== null) error = null
    else dismissed = unloaded
  }
  let selectedId = $state<string | null>(null)
  /** The spend whose details I opened; they stay open while it's the one selected. */
  let openedId = $state<string | null>(null)

  let tree: SpendingTree
  let list: SpendList
  let card: SpendCard | undefined = $state()

  const spent = $derived(report === null ? [] : spentOf(report))
  const beforeSpent = $derived(earlier === null ? [] : spentOf(earlier))
  const rows = $derived(treeRows(spent, beforeSpent, opened))
  /** The week's two sums, for the header line and the tree's foot. */
  const sums = $derived(comparedAt(spent, beforeSpent, ''))
  const picked = $derived(rows.find((r) => r.key === selectedKey))
  const shown = $derived(spendsBehind(transactions, spent, picked))
  // The spend picked while it's still behind the line; else the newest that is.
  const current = $derived(kept(shown, selectedId))
  const openedSpend = $derived(openedId !== null && openedId === current ? openedId : null)

  // Another row selected, the details close: a click selects, and only a second one opens.
  $effect(() => {
    if (openedId !== null && openedId !== current) openedId = null
  })

  // A row the tree no longer shows, as when the week moves: nothing is selected.
  $effect(() => {
    if (selectedKey !== null && !rows.some((r) => r.key === selectedKey)) selectedKey = null
  })

  const isThisWeek = $derived(week.start === thisWeek(todayIn()).start)
  const other = $derived(report && otherText(report.other))
  const sumsLine = $derived(
    report === null || earlier === null
      ? ''
      : (isThisWeek ? copy.reports.sum.thisWeek : copy.reports.sum.another)(
          format(sums.total),
          format(sums.before),
        ),
  )

  const accountOptions = $derived(
    payers.map((a) => ({ id: a.id, name: a.name, hint: copy.accounts.kinds[a.kind] })),
  )

  /** After a write: the lists, then the report, as they are now. */
  async function caughtUp() {
    await ledger.caughtUp()
    await spending.caughtUp()
  }

  /** R on the selected row: its To picked by path, saved at once; undo takes it back. */
  async function saveRefile(t: ListedTransaction, typed: string): Promise<void> {
    const saved = await actions.refile(t, typed, (text) => toOf(accountOptions, text))
    if (!saved.ok) {
      error = saved.words
      return
    }
    await caughtUp()
  }

  /** R from the menu: the selected row's To becomes a path picker. */
  export function refile() {
    list.refile()
  }

  /** P from the menu: the open spend's postings, shown or hidden. */
  export function postings() {
    card?.togglePostings()
  }

  /** Coming here from another place: the tree. */
  export function focus() {
    tree.focus()
  }

  /** After an undo or redo: the report as it is now, with the spend that came back selected. */
  export async function show(id: string) {
    await caughtUp()
    if (shown.some((t) => t.id === id)) selectedId = id
  }

  /** An undo or redo refused while this place is showing. */
  export function refused(words: string) {
    error = words
  }

  function goWeek(by: number) {
    week = weekAfter(week, by)
    spending.set(week)
  }

  /** A category opens or closes. */
  function toggle(category: string) {
    const next = new Set(opened)
    if (!next.delete(category)) next.add(category)
    opened = next
  }

  /** A row picked: the first click selects it, and a second opens or closes it. */
  function pick(key: string) {
    const row = rows.find((r) => r.key === key)
    if (row === undefined) return
    if (row.key === selectedKey && row.opens) toggle(row.category)
    else selectedKey = key
  }

  /** The tree's keys: → and ← open and close, Enter too; the rest move the selection. */
  function onkey(event: KeyboardEvent): boolean {
    const move = treeKey(rows, selectedKey, event.key)
    if (move === null) return false
    event.preventDefault()
    if ('toggle' in move) toggle(move.toggle)
    else selectedKey = move.active
    return true
  }

  let removing = false

  /** The selected spend, gone; selection moves to the next one behind the line. */
  export async function remove() {
    const id = current
    if (id === null || removing) return
    removing = true
    const next = afterRemoving(shown, id)
    const removed = await actions.remove(id)
    removing = false
    if (!removed.ok) {
      error = removed.words
      return
    }
    const wasOpen = openedSpend === id
    selectedId = next
    await caughtUp()
    if (wasOpen) list.focus()
  }

  async function open(focus: boolean) {
    openedId = current
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

<main class="reports" {hidden}>
  <div class="top">
    <Header title={copy.reports.title} line={sumsLine} />
    {#if notice}<Notice words={notice} ondismiss={dismiss} />{/if}
  </div>

  <div class="week" role="group" aria-label={copy.reports.week.label}>
    <Button aria-label={copy.reports.week.before} onclick={() => goWeek(-1)}>
      {copy.reports.week.earlier}
    </Button>
    <p>
      {#if isThisWeek}<strong>{copy.reports.week.thisWeek}</strong>{/if}
      <span class="span">
        <Day date={week.start} until={week.end} />
      </span>
    </p>
    <Button aria-label={copy.reports.week.after} onclick={() => goWeek(1)}>
      {copy.reports.week.later}
    </Button>
  </div>

  <div class="left">
    <SpendingTree
      bind:this={tree}
      {rows}
      total={sums.total}
      before={sums.before}
      currency={report?.currency ?? ''}
      thisWeek={isThisWeek}
      {selectedKey}
      onpick={pick}
      onselect={(key) => (selectedKey = key)}
      {onkey}
    />
    {#if other}
      <p class="other">{other}</p>
    {/if}
  </div>

  <div class="spends">
    <SpendList
      bind:this={list}
      label={copy.reports.spends.label}
      idPrefix="reported"
      transactions={shown}
      selectedId={current}
      onselect={(id) => (selectedId = id)}
      opened={openedSpend}
      onopen={open}
      oncardkey={(event) => card?.keydown(event) ?? false}
      onclose={close}
      onremove={remove}
      onrefile={saveRefile}
      loadPaths={() => ledger.paths()}
    >
      {#snippet details(t: ListedTransaction)}
        <SpendCard
          bind:this={card}
          {actions}
          label={copy.reports.card.label}
          idPrefix="report-pane"
          transaction={t}
          toOptions={accountOptions}
          loadPaths={() => ledger.paths()}
          onSaved={caughtUp}
          onclose={close}
          onremove={remove}
        />
      {/snippet}
    </SpendList>
    {#if picked !== undefined && shown.length === 0}
      <Empty>{copy.reports.spends.nothing}</Empty>
    {/if}
  </div>
</main>

<style>
  /* The tree on the left; the spends behind the row picked on the right, opening in place. */
  main {
    min-height: 0;
    overflow-y: auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-rows: auto auto minmax(8rem, 1fr);
    grid-template-areas:
      'top top'
      'week week'
      'breakdown list';
    column-gap: var(--space-6);
    row-gap: var(--space-2);
    padding: var(--space-4);
  }

  main[hidden] {
    display: none;
  }

  .left {
    grid-area: breakdown;
    display: grid;
    align-content: start;
    gap: var(--space-2);
    min-height: 0;
    overflow-y: auto;
  }

  .spends {
    grid-area: list;
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    min-height: 0;
  }

  /* NARROW in narrow.ts. */
  @media (max-width: 44rem) {
    main {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: none;
      grid-template-areas:
        'top'
        'week'
        'breakdown'
        'list';
      align-content: start;
      padding: var(--space-3);
    }
  }

  p {
    margin: 0;
  }

  .week {
    grid-area: week;
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .week p {
    display: flex;
    gap: var(--space-2);
  }

  .span {
    font-family: var(--font-figures);
    font-variant-numeric: tabular-nums;
    color: var(--color-muted);
  }

  .other {
    font-size: var(--text-quiet);
    color: var(--color-muted);
  }

  .top {
    grid-area: top;
    display: grid;
    gap: var(--space-3);
  }
</style>
