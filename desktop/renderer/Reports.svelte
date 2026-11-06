<script lang="ts">
  import { levelAbove, spendingAt, trailTo } from '@have-fish/core/spending'
  import { onMount, tick, untrack } from 'svelte'
  import { copy } from '../copy'
  import type { ListedTransaction, Values as Returned, WireFailure } from '../shared/commands'
  import {
    afterSaves,
    type Drafts,
    editOf,
    type Sending,
    savedValues,
    toSend,
    type Values,
    withEdit,
    without,
  } from './drafts'
  import { day, todayIn } from './format'
  import type { LedgerState, LedgerStore } from './ledger'
  import { NARROW } from './narrow'
  import { toOf, toOptions } from './picker'
  import { fieldOf, spendWordsFor, wordsFor } from './refusals'
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
  import SpendList from './SpendList.svelte'
  import SpendPane from './SpendPane.svelte'

  type Props = {
    hidden: boolean
    /** Every list this place shows, shared with the others. */
    ledger: LedgerStore
    /** After a save: the fields' own undo has nothing left to take back. */
    forgetTyping: () => void
  }
  let { hidden, ledger, forgetTyping }: Props = $props()

  let week = $state.raw<Week>(thisWeek(todayIn()))
  let report = $state.raw<Returned['report.spending'] | null>(null)
  /** The category whose lines show; `''` is the top. */
  let level = $state('')
  let pickedKey = $state<string | null>(null)
  let error = $state<string | null>(null)

  /** The week's spends under the level, and any with a draft: asked of main, never the store. */
  let transactions = $state.raw<ListedTransaction[]>([])
  // For the pane: what its To offers.
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
  let drafts = $state.raw<Drafts>(new Map())
  let savingDraft = $state(false)
  /** In a narrow window, whether the pane is over the list. */
  let open = $state(false)

  let breakdown: SpendingList
  let list: SpendList
  let pane: SpendPane

  const spent = $derived(report === null ? [] : spentOf(report))
  const at = $derived(spendingAt(spent, level))
  const picked = $derived(at.lines.find((l) => l.key === pickedKey))
  const shown = $derived(spendsBehind(transactions, spent, level, picked))
  // The spend picked while it's still behind the line; else the newest that is.
  const current = $derived(kept(shown, selectedId))
  const selected = $derived(shown.find((t) => t.id === current))
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

  // A wide window shows the pane beside the list, so there's nothing left open to cover it.
  onMount(() => {
    const narrow = matchMedia(NARROW)
    const widened = () => {
      if (!narrow.matches) open = false
    }
    narrow.addEventListener('change', widened)
    return () => narrow.removeEventListener('change', widened)
  })

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
    const saved = selected && savedValues(selected)
    if (selected === undefined || !saved) return
    drafts = withEdit(drafts, selected.id, saved, field, value)
  }

  function revert() {
    if (current !== null) drafts = without(drafts, current)
  }

  const refusedFor = (refused: WireFailure | null, to?: Parameters<typeof fieldOf>[1]) =>
    refused && { field: fieldOf(refused, to), words: spendWordsFor(refused) }

  /** A draft as main takes it, sending where it goes only if that changed. */
  const sent = (s: Sending) => {
    const saved = transactions.find((t) => t.id === s.id)
    return editOf(s, saved?.to, (typed) => toOf(payers, typed), saved?.date)
  }

  /** Each draft is its own batch here; Ctrl+S's are one step to undo. */
  async function saveDrafts(ids: Iterable<string>, all: boolean) {
    const sending = toSend(drafts, ids)
    if (sending.length === 0 || savingDraft) return
    savingDraft = true
    const edits = sending.map(sent)
    const saves = all
      ? await window.haveFish.invoke('spend.saveAll', { edits }).then((saved) =>
          sending.map((s, i) => ({
            ...s,
            error: saved.ok
              ? refusedFor(saved.value[i]?.refused ?? null, edits[i]?.to)
              : refusedFor(saved),
          })),
        )
      : await Promise.all(
          sending.map(async (s, i) => {
            const saved = await window.haveFish.invoke('spend.edit', edits[i] ?? sent(s))
            return { ...s, error: refusedFor(saved.ok ? null : saved, edits[i]?.to) }
          }),
        )
    // The report first, so the pane never shows the old values in between.
    if (saves.some((s) => s.error === null)) {
      forgetTyping()
      await caughtUp()
    }
    drafts = afterSaves(drafts, saves)
    savingDraft = false
  }

  function save() {
    if (current !== null) void saveDrafts([current], false)
  }

  export function saveAll() {
    void saveDrafts(drafts.keys(), true)
  }

  let removing = false

  /** The selected spend, gone; selection moves to the next one behind the line. */
  export async function remove() {
    const id = current
    if (id === null || removing) return
    removing = true
    const next = afterRemoving(shown, id)
    const removed = await window.haveFish.invoke('spend.remove', { id })
    removing = false
    if (!removed.ok) {
      error = wordsFor(removed)
      return
    }
    drafts = without(drafts, id)
    selectedId = next
    forgetTyping()
    await caughtUp()
  }

  async function openPane(focus: boolean) {
    open = matchMedia(NARROW).matches
    if (!focus) return
    await tick()
    pane.focus()
  }

  function closePane() {
    open = false
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
        {copy.reports.week.span(day(week.start, todayIn()), day(week.end, todayIn()))}
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
    onopen={openPane}
    onremove={remove}
  />

  <SpendPane
    bind:this={pane}
    label={copy.reports.pane.label}
    idPrefix="report-pane"
    transaction={selected}
    draft={selected && drafts.get(selected.id)}
    toOptions={toChoices}
    saving={savingDraft}
    {open}
    onedit={edit}
    onrevert={revert}
    onsave={save}
    onback={closePane}
    onremove={remove}
  />
</main>

<style>
  /* The breakdown on the left; the spends behind the line picked, and the one picked, on the right. */
  main {
    min-height: 0;
    overflow-y: auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-rows: auto auto auto minmax(8rem, 1fr) auto;
    grid-template-areas:
      'top top'
      'week week'
      'trail trail'
      'breakdown list'
      'breakdown pane';
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

  /* Under the list here, not beside it: the pane's rule goes across its top. */
  @media not (max-width: 44rem) {
    main :global(.pane) {
      padding-inline-start: 0;
      padding-block-start: var(--space-4);
      border-inline-start: none;
      border-block-start: var(--border-width) solid var(--color-rule);
    }
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
