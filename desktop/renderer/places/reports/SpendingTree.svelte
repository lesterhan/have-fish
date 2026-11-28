<script lang="ts">
  // The week's spending as a tree, beside the week before: each category's two sums and the
  // change between them, and the categories under a row that's open, a level deeper. Under it,
  // what the week came to against the week before.
  import { copy } from '../../../copy'
  import type { Mark } from '@have-fish/core/rate-for'
  import type { Compared, Uncounted } from '@have-fish/core/spending'
  import {
    type ChangeFigure,
    changeFigureOf,
    changeMarkOf,
    changeOf,
    type Figure,
    figureOf,
    type GuessedFigure,
    lineLabel,
    lookOf,
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
    /** Both weeks' sums in cents, each with its mark and what it couldn't count. */
    sums: Pick<
      Compared,
      'total' | 'before' | 'mark' | 'beforeMark' | 'uncounted' | 'beforeUncounted'
    >
    currency: string
    /** This week's headings, or another week's. */
    thisWeek: boolean
    selectedKey: string | null
    /** A row picked by a click. */
    onpick: (key: string) => void
    /** The keys moved the selection to another row. */
    onselect: (key: string) => void
    onkey: (event: KeyboardEvent) => boolean
    /** A guessed figure clicked: its element, and which row and week it sums. */
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
  const sum = $derived(
    changeFigureOf(changeOf(sums.total, sums.before), sums.uncounted, sums.beforeUncounted),
  )

  export function focus() {
    listbox.focus()
  }

  /** A guessed figure clicked: the popover opens from it, and the click goes no further. */
  function openFix(event: MouseEvent & { currentTarget: HTMLButtonElement }, at: GuessedFigure) {
    event.stopPropagation()
    onguess(event.currentTarget, at)
  }
</script>

<!-- A figure, marked by how sure it is: a guess is the button that opens its days. -->
{#snippet atFigure(at: GuessedFigure, mark: Mark | null, content: Snippet)}
  {@const look = lookOf(mark)}
  {#if look === 'guessed'}<button
      type="button"
      tabindex="-1"
      class="guessed"
      data-guessed
      data-look={look}
      onclick={(event) => openFix(event, at)}
    >{@render content()}</button
    >{:else}<span class:fetched={look === 'fetched'} data-look={look}>{@render content()}</span>{/if}
{/snippet}

<!-- What a figure couldn't count, a line each under it, small and quiet. -->
{#snippet under(lines: Figure['uncounted'])}
  {#each lines as { money, sign } (money.currency)}
    {' '}<span class="uncounted" data-uncounted
      >{#if sign !== null}{copy.reports.tree[sign]}{' '}{/if}<Money of={money} /></span
    >
  {/each}
{/snippet}

{#snippet figure(
  cents: number | null,
  mark: Mark | null,
  uncounted: readonly Uncounted[],
  at: GuessedFigure
)}
  {#if cents === null}
    {copy.reports.tree.dash}
  {:else}
    {@const parts = figureOf(cents, uncounted, currency)}
    {#snippet amount()}
      {#if parts.counted !== null}<Money of={parts.counted} />{/if}
      {@render under(parts.uncounted)}
    {/snippet}
    {@render atFigure(at, mark, amount)}
  {/if}
{/snippet}

{#snippet change(
  moved: ChangeFigure,
  mark: Mark | null,
  beforeMark: Mark | null,
  at: GuessedFigure
)}
  {@const changeMark = changeMarkOf(mark, beforeMark)}
  {#snippet changeText()}
    {#if moved.counted !== null}
      {#if moved.counted.cents > 0}<Money of={moneyOf(moved.counted.cents, currency)} />{' '}{copy
          .reports.tree.change[moved.counted.way]}{:else}{copy.reports.tree.change.same}{/if}
    {/if}
    {@render under(moved.uncounted)}
  {/snippet}
  {@render atFigure(at, changeMark, changeText)}
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
      {@const moved = changeFigureOf(
        changeOf(line.cents, line.before),
        line.uncounted,
        line.beforeUncounted,
      )}
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
        >{@render figure(line.cents, line.mark, line.uncounted, {
          key: line.key,
          week: 'shown',
        })}</span
      >
      {#if shown.cells.includes('before')}
        <span data-cell="before"
          >{@render figure(line.before, line.beforeMark, line.beforeUncounted, {
            key: line.key,
            week: 'before',
          })}</span
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
        >{@render figure(sums.total, sums.mark, sums.uncounted, {
          key: null,
          week: 'shown',
        })}</span
      >
      {#if shown.cells.includes('before')}
        <span class="amount"
          >{@render figure(sums.before, sums.beforeMark, sums.beforeUncounted, {
            key: null,
            week: 'before',
          })}</span
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
    text-decoration: underline wavy var(--color-error);
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-align: inherit;
  }

  .fetched {
    text-decoration: underline dashed var(--color-muted);
  }

  .uncounted {
    display: block;
    font-size: var(--text-small);
    color: var(--color-muted);
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
