<script lang="ts">
  import { levelAbove, spendingAt, trailTo } from '@have-fish/core/spending'
  import { onMount, tick } from 'svelte'
  import { copy } from '../copy'
  import type {
    ListedAccount,
    ListedCategory,
    ListedTransaction,
    Values as Returned,
    WireFailure,
  } from '../shared/commands'
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
  import { todayIn } from './format'
  import { NARROW } from './narrow'
  import { toOf, toOptions } from './picker'
  import { fieldOf, spendWordsFor, wordsFor } from './refusals'
  import { otherText, spendsBehind, spentOf, thisWeek, type Week, weekAfter } from './report'
  import { afterRemoving, kept } from './selection'
  import SpendingList from './SpendingList.svelte'
  import SpendList from './SpendList.svelte'
  import SpendPane from './SpendPane.svelte'

  type Props = {
    hidden: boolean
    /** After a save: the fields' own undo has nothing left to take back. */
    forgetTyping: () => void
  }
  let { hidden, forgetTyping }: Props = $props()

  let week = $state.raw<Week>(thisWeek(todayIn()))
  let report = $state.raw<Returned['report.spending'] | null>(null)
  /** The category whose lines show; `''` is the top. */
  let level = $state('')
  let pickedKey = $state<string | null>(null)
  let error = $state<string | null>(null)

  // For the pane: every spend, and what its To offers.
  let transactions = $state.raw<ListedTransaction[]>([])
  let payers = $state.raw<ListedAccount[]>([])
  let categories = $state.raw<ListedCategory[]>([])
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

  // Drafts are left alone: a draft is the window's until it is saved or put back.
  async function refresh() {
    const shownWeek = week
    const [spending, listed, accounts, used] = await Promise.all([
      window.haveFish.invoke('report.spending', { start: shownWeek.start, end: shownWeek.end }),
      window.haveFish.invoke('transaction.list', {}),
      window.haveFish.invoke('account.list', {}),
      window.haveFish.invoke('category.list', {}),
    ])
    // A week moved on while this was on its way: that one's answer is the one to show.
    if (shownWeek !== week) return
    const refusal = [spending, listed, accounts, used].find((r) => !r.ok)
    error = refusal === undefined || refusal.ok ? null : wordsFor(refusal)
    if (spending.ok) report = spending.value
    if (listed.ok) transactions = listed.value
    if (accounts.ok) payers = accounts.value
    if (used.ok) categories = used.value
  }

  onMount(() => {
    void refresh()
    return window.haveFish.onChanged(() => void refresh())
  })

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
    await refresh()
    if (shown.some((t) => t.id === id)) selectedId = id
  }

  /** An undo or redo refused while this place is showing. */
  export function refused(words: string) {
    error = words
  }

  function goWeek(by: number) {
    week = weekAfter(week, by)
    void refresh()
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
      await refresh()
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
    await refresh()
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
  <div class="week" role="group" aria-label={copy.reports.week.label}>
    <button type="button" aria-label={copy.reports.week.before} onclick={() => goWeek(-1)}>
      {copy.reports.week.earlier}
    </button>
    <p>
      {#if isThisWeek}<strong>{copy.reports.week.thisWeek}</strong>{/if}
      <span class="span">{copy.reports.week.span(week.start, week.end)}</span>
    </p>
    <button type="button" aria-label={copy.reports.week.after} onclick={() => goWeek(1)}>
      {copy.reports.week.later}
    </button>
  </div>

  <nav class="trail" aria-label={copy.reports.trail.label}>
    {#if level === ''}
      <span aria-current="location">{copy.reports.trail.top}</span>
    {:else}
      <button type="button" onclick={() => up('')}>{copy.reports.trail.top}</button>
      {#each trailTo(level) as step, i (step)}
        <span class="between" aria-hidden="true">{copy.reports.trail.between}</span>
        {#if i === trailTo(level).length - 1}
          <span aria-current="location">{step.slice(step.lastIndexOf(':') + 1)}</span>
        {:else}
          <button type="button" onclick={() => up(step)}>
            {step.slice(step.lastIndexOf(':') + 1)}
          </button>
        {/if}
      {/each}
    {/if}
  </nav>

  {#if error !== null}
    <p class="error" role="alert">{error}</p>
  {/if}

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
      'week week'
      'trail trail'
      'error error'
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
        'week'
        'trail'
        'error'
        'breakdown'
        'list';
      align-content: start;
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
    font-size: var(--font-size-small);
  }

  button {
    font: inherit;
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius);
    color: inherit;
    background: transparent;
    cursor: pointer;
  }

  .trail button {
    border-color: transparent;
    text-decoration: underline;
  }

  .error {
    grid-area: error;
    font-size: var(--font-size-small);
    color: var(--color-error);
  }
</style>
