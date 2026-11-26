<script lang="ts">
  // The week's spending as a tree, beside the week before: each category's two sums and the
  // change between them, and the categories under a row that's open, a level deeper. Under it,
  // what the week came to against the week before.
  import { copy } from '../../../copy'
  import type { Mark } from '@have-fish/core/rate-for'
  import type { Compared } from '@have-fish/core/spending'
  import {
    type Change,
    changeOf,
    guessed,
    type GuessedFigure,
    lineLabel,
    moneyOf,
    treeColumnsOf,
    type TreeRow,
  } from './report'
  import Empty from '../../parts/Empty.svelte'
  import Headings from '../../parts/Headings.svelte'
  import Listbox from '../../parts/Listbox.svelte'
  import Money from '../../parts/Money.svelte'
  import Path from '../../parts/Path.svelte'
  import type { Snippet } from 'svelte'

  type Props = {
    /** The tree's rows, the ones under an open category straight after it. */
    rows: TreeRow[]
    /** This week's sums and the week before's, in cents, each with its mark. */
    sums: Pick<Compared, 'total' | 'before' | 'mark' | 'beforeMark'>
    currency: string
    /** This week's headings, or another week's. */
    thisWeek: boolean
    selectedKey: string | null
    /** A row picked by a click. */
    onpick: (key: string) => void
    /** The keys moved the selection to another row. */
    onselect: (key: string) => void
    onkey: (event: KeyboardEvent) => boolean
    /** An underlined figure clicked: its element, and which row and week it sums. */
    onguess: (anchor: HTMLElement, figure: GuessedFigure) => void
  }
  let { rows, sums, currency, thisWeek, selectedKey, onpick, onselect, onkey, onguess }: Props =
    $props()

  let listbox: ReturnType<typeof Listbox<TreeRow>>
  // The tree's width, not the window's: beside the spends it runs out first, and Last week goes
  // before a name does.
  let width = $state(0)
  const shown = $derived(treeColumnsOf(width))
  const names = copy.reports.tree.headings
  const headings = $derived([
    { name: names.name },
    { name: thisWeek ? names.thisWeek.shown : names.another.shown, end: true },
    ...(shown.cells.includes('before')
      ? [{ name: thisWeek ? names.thisWeek.before : names.another.before, end: true }]
      : []),
    { name: names.change, end: true },
  ])
  const sum = $derived(changeOf(sums.total, sums.before))

  export function focus() {
    listbox.focus()
  }

  /** A guessed figure clicked: the popover opens from it, and the click goes no further. */
  function openFix(event: MouseEvent & { currentTarget: HTMLButtonElement }, at: GuessedFigure) {
    event.stopPropagation()
    onguess(event.currentTarget, at)
  }
</script>

<!-- A guessed figure's money or words, as the button that opens its rates; else plain. -->
{#snippet atFigure(at: GuessedFigure, pressable: boolean, content: Snippet)}
  {#if pressable}<button
      type="button"
      tabindex="-1"
      class="guessed"
      data-guessed
      onclick={(event) => openFix(event, at)}
    >{@render content()}</button
    >{:else}<span>{@render content()}</span>{/if}
{/snippet}

{#snippet figure(cents: number | null, mark: Mark | null, at: GuessedFigure)}
  {#if cents === null}
    {copy.reports.tree.dash}
  {:else}
    {#snippet amount()}<Money of={moneyOf(cents, currency)} />{/snippet}
    {@render atFigure(at, guessed(mark), amount)}
  {/if}
{/snippet}

{#snippet change(
  moved: Change,
  mark: Mark | null,
  beforeMark: Mark | null,
  at: GuessedFigure
)}
  {@const changeGuessed = guessed(mark) || guessed(beforeMark)}
  {#snippet changeText()}
    {#if moved.cents > 0}<Money of={moneyOf(moved.cents, currency)} />{' '}{copy.reports.tree
        .change[moved.way]}{:else}{copy.reports.tree.change.same}{/if}
  {/snippet}
  {@render atFigure(at, changeGuessed, changeText)}
{/snippet}

<div class="tree" bind:clientWidth={width}>
  <Headings columns={shown.template} names={headings} />
  <Listbox
    bind:this={listbox}
    items={rows}
    idOf={(r) => r.key}
    active={selectedKey}
    label={copy.reports.tree.label}
    idPrefix="spending"
    columns={shown.template}
    tree={(row) => row}
    onactive={onselect}
    {onpick}
    {onkey}
  >
    {#snippet row(line)}
      {@const moved = changeOf(line.cents, line.before)}
      <span
        data-cell="name"
        style:padding-inline-start="calc({line.level - 1} * var(--space-4))"
      >
        {#if line.open !== undefined}
          <span class="opens" aria-hidden="true"
            >{line.open ? copy.reports.tree.open : copy.reports.tree.closed}</span
          >
        {/if}
        {#if line.holds === 'category' && line.level === 1}
          <Path path={`expenses:${line.category}`} />
        {:else if line.holds === 'category'}
          {`:${line.label}`}
        {:else}
          <span class:unsorted={line.holds === 'unsorted'}>{lineLabel(line)}</span>
        {/if}
      </span>
      <span data-cell="shown"
        >{@render figure(line.cents, line.mark, { key: line.key, week: 'shown' })}</span
      >
      {#if shown.cells.includes('before')}
        <span data-cell="before"
          >{@render figure(line.before, line.beforeMark, { key: line.key, week: 'before' })}</span
        >
      {/if}
      <span data-cell="change"
        >{@render change(moved, line.mark, line.beforeMark, { key: line.key, week: 'both' })}</span
      >
    {/snippet}
  </Listbox>
  {#if rows.length === 0}
    <Empty>{copy.reports.tree.empty}</Empty>
  {:else}
    <p class="total" style:grid-template-columns={shown.template}>
      <span>{copy.reports.tree.total}</span>
      <span class="amount"
        >{@render figure(sums.total, sums.mark, { key: null, week: 'shown' })}</span
      >
      {#if shown.cells.includes('before')}
        <span class="amount"
          >{@render figure(sums.before, sums.beforeMark, { key: null, week: 'before' })}</span
        >
      {/if}
      <span class="change"
        >{@render change(sum, sums.mark, sums.beforeMark, { key: null, week: 'both' })}</span
      >
    </p>
  {/if}
</div>

<style>
  .tree {
    display: grid;
    align-content: start;
    gap: var(--space-2);
    min-height: 0;
  }

  [data-cell='name'] {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .opens,
  .unsorted {
    color: var(--color-muted);
  }

  .guessed {
    text-decoration: underline;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-align: inherit;
  }

  [data-cell='shown'],
  [data-cell='before'],
  [data-cell='change'],
  .amount,
  .change {
    font-family: var(--font-figures);
    font-variant-numeric: tabular-nums;
    text-align: end;
  }

  .total {
    display: grid;
    column-gap: var(--space-3);
    align-items: center;
    margin: 0;
    padding: var(--space-2);
    border-block-start: var(--border-width) solid var(--color-border);
    font-weight: var(--weight-strong);
  }
</style>
