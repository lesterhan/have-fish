<script lang="ts">
  import { levelAbove, spendingAt, trailTo } from '@have-fish/core/spending'
  import { tick, untrack } from 'svelte'
  import { copy } from '../copy'
  import type { ListedTransaction, Values as Returned, WireFailure } from '../shared/commands'
  import type { Values } from './drafts'
  import type { SpendEditor } from './editor'
  import { todayIn } from './format'
  import Day from './parts/Day.svelte'
  import type { LedgerState, LedgerStore } from './ledger'
  import { toOptions } from './picker'
  import { wordsFor } from './refusals'
  import {
    idsWanted,
    otherText,
    spendsBehind,
    spentOf,
    thisWeek,
    type Week,
    weekAfter,
  } from './report'
  import { afterRemoving, kept } from './selection'
  import Button from './parts/Button.svelte'
  import Header from './parts/Header.svelte'
  import Notice from './parts/Notice.svelte'
  import SpendingList from './SpendingList.svelte'
  import SpendCard from './SpendCard.svelte'
  import SpendList from './SpendList.svelte'

  type Props = {
    hidden: boolean
    /** Every list this place shows, shared with the others. */
    ledger: LedgerStore
    /** Every spend I'm changing, in whichever place: one editor for the window. */
    editor: SpendEditor
  }
  let { hidden, ledger, editor }: Props = $props()

  let week = $state.raw<Week>(thisWeek(todayIn()))
  let report = $state.raw<Returned['report.spending'] | null>(null)
  /** The category whose lines show; `''` is the top. */
  let level = $state('')
  let pickedKey = $state<string | null>(null)
  let error = $state<string | null>(null)

  /** The week's spends under the level, and any with a draft: asked of main, never the store. */
  let transactions = $state.raw<ListedTransaction[]>([])
  // For the card: what its To offers.
  const payers = $derived($ledger.accounts)
  const categories = $derived($ledger.categories)
  /** Why the lists or the report couldn't load, until they next do. */
  let reportFailure = $state<WireFailure | null>(null)
  const unloaded = $derived.by(() => {
    const failure = $ledger.failure ?? reportFailure
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
  const drafts = $derived($editor.drafts)
  /** The spend whose details I opened; they stay open while it's the one selected. */
  let openedId = $state<string | null>(null)

  let breakdown: SpendingList
  let list: SpendList
  let card: SpendCard | undefined = $state()

  const spent = $derived(report === null ? [] : spentOf(report))
  const at = $derived(spendingAt(spent, level))
  const picked = $derived(at.lines.find((l) => l.key === pickedKey))
  const shown = $derived(spendsBehind(transactions, spent, level, picked))
  // The spend picked while it's still behind the line; else the newest that is.
  const current = $derived(kept(shown, selectedId))
  const selected = $derived(shown.find((t) => t.id === current))
  const opened = $derived(openedId !== null && openedId === current ? openedId : null)

  // Another row selected, the details close: a click selects, and only a second one opens.
  $effect(() => {
    if (openedId !== null && openedId !== current) openedId = null
  })
  const isThisWeek = $derived(week.start === thisWeek(todayIn()).start)
  const other = $derived(report && otherText(report.other))

  const fromOptions = $derived(
    payers.map((a) => ({ id: a.id, name: a.name, hint: copy.accounts.kinds[a.kind] })),
  )
  const toChoices = $derived(toOptions(categories, fromOptions))

  /** The store load the report was last asked for, and that ask. */
  let reportedFor: LedgerState | null = null
  let reporting: Promise<void> = Promise.resolve()

  /** The shown week's spending, asked of main. A week moved on meanwhile wins. */
  async function loadReport() {
    const shownWeek = week
    const spending = await window.haveFish.invoke('report.spending', {
      start: shownWeek.start,
      end: shownWeek.end,
    })
    if (shownWeek !== week) return
    if (spending.ok) {
      report = spending.value
      reportFailure = null
      await loadSpends(idsWanted(spentOf(spending.value), level, drafts.keys()))
    } else reportFailure = spending
  }

  let spendsAsked = 0

  /** The spends with these ids, as the list shows them. The latest ask wins. */
  async function loadSpends(ids: string[]) {
    const mine = ++spendsAsked
    if (ids.length === 0) {
      transactions = []
      return
    }
    const found = await window.haveFish.invoke('transaction.get', { ids })
    if (mine !== spendsAsked) return
    if (found.ok) transactions = found.value
    else reportFailure = found
  }

  // Another level, or a new draft: the spends it wants. A report's own load asks for them too.
  const wanted = $derived(idsWanted(spent, level, drafts.keys()).sort().join(' '))
  $effect(() => {
    const ids = wanted
    untrack(() => void loadSpends(ids === '' ? [] : ids.split(' ')))
  })

  function reportFor(state: LedgerState): Promise<void> {
    reportedFor = state
    reporting = loadReport()
    return reporting
  }

  // Showing, with a ledger the report hasn't seen: ask again. Hidden, it waits until it shows.
  // Drafts are left alone: a draft is the window's until it is saved or put back.
  $effect(() => {
    const state = $ledger
    if (!hidden && state !== reportedFor) void reportFor(state)
  })

  /** After a write: the lists, then the report, as they are now; one ask for each. */
  async function caughtUp() {
    await ledger.caughtUp()
    const state = ledger.current()
    await (state === reportedFor ? reporting : reportFor(state))
  }

  /** Coming here from another place: the breakdown. */
  export function focus() {
    breakdown.focus()
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
    void reportFor(ledger.current())
  }

  function into(category: string) {
    level = category
    pickedKey = null
  }

  /** Out a level, with the category I was in picked. */
  function up(to = levelAbove(level)) {
    if (level === '') return
    const left = trailTo(level)[trailTo(to).length] ?? level
    level = to
    pickedKey = `category:${left}`
  }

  function edit(field: keyof Values, value: string) {
    if (selected !== undefined) editor.edit(selected, field, value)
  }

  function save() {
    if (current !== null) void editor.save([current], false, caughtUp)
  }

  export function saveAll() {
    void editor.save(editor.current().drafts.keys(), true, caughtUp)
  }

  let removing = false

  /** The selected spend, gone; selection moves to the next one behind the line. */
  export async function remove() {
    const id = current
    if (id === null || removing) return
    removing = true
    const next = afterRemoving(shown, id)
    const refused = await editor.remove(id)
    removing = false
    if (refused !== null) {
      error = wordsFor(refused)
      return
    }
    const wasOpen = opened === id
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

  /** Esc: what was typed goes back, the details close, and the row stays selected. */
  function close() {
    if (opened !== null) editor.revert(opened)
    openedId = null
    list.focus()
  }
</script>

<main class="reports" {hidden}>
  <div class="top">
    <Header title={copy.app.places.reports} />
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

  <nav class="trail" aria-label={copy.reports.trail.label}>
    {#if level === ''}
      <span aria-current="location">{copy.reports.trail.top}</span>
    {:else}
      <Button variant="quiet" onclick={() => up('')}>{copy.reports.trail.top}</Button>
      {#each trailTo(level) as step, i (step)}
        <span class="between" aria-hidden="true">{copy.reports.trail.between}</span>
        {#if i === trailTo(level).length - 1}
          <span aria-current="location">{step.slice(step.lastIndexOf(':') + 1)}</span>
        {:else}
          <Button variant="quiet" onclick={() => up(step)}>
            {step.slice(step.lastIndexOf(':') + 1)}
          </Button>
        {/if}
      {/each}
    {/if}
  </nav>

  <div class="left">
    <SpendingList
      bind:this={breakdown}
      lines={at.lines}
      total={at.total}
      currency={report?.currency ?? ''}
      {pickedKey}
      onpick={(key) => (pickedKey = key)}
      oninto={into}
      onup={() => up()}
    />
    {#if other}
      <p class="other">{other}</p>
    {/if}
  </div>

  <SpendList
    bind:this={list}
    label={copy.reports.spends.label}
    idPrefix="reported"
    transactions={shown}
    selectedId={current}
    {drafts}
    onselect={(id) => (selectedId = id)}
    {opened}
    onopen={open}
    onclose={close}
    onremove={remove}
  >
    {#snippet details(t: ListedTransaction)}
      <SpendCard
        bind:this={card}
        label={copy.reports.card.label}
        idPrefix="report-pane"
        transaction={t}
        draft={drafts.get(t.id)}
        toOptions={toChoices}
        saving={$editor.saving}
        onedit={edit}
        onsave={save}
        onclose={close}
        onremove={remove}
      />
    {/snippet}
  </SpendList>
</main>

<style>
  /* The breakdown on the left; the spends behind the line picked on the right, opening in place. */
  main {
    min-height: 0;
    overflow-y: auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-rows: auto auto auto minmax(8rem, 1fr);
    grid-template-areas:
      'top top'
      'week week'
      'trail trail'
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

  /* NARROW in narrow.ts. */
  @media (max-width: 44rem) {
    main {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: none;
      grid-template-areas:
        'top'
        'week'
        'trail'
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

  .trail {
    grid-area: trail;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .between,
  .other {
    color: var(--color-muted);
  }

  .other {
    font-size: var(--text-quiet);
  }

  .top {
    grid-area: top;
    display: grid;
    gap: var(--space-3);
  }
</style>
