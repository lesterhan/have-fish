<script lang="ts">
  // The week's spending as a tree, beside the week before: each category's two sums and the
  // change between them, and the categories under a row that's open, a level deeper. Under it,
  // what the week came to against the week before.
  import { copy } from '../copy'
  import {
    type Change,
    changeOf,
    lineLabel,
    moneyOf,
    treeColumnsOf,
    type TreeRow,
  } from './report'
  import Empty from './parts/Empty.svelte'
  import Headings from './parts/Headings.svelte'
  import Listbox from './parts/Listbox.svelte'
  import Money from './parts/Money.svelte'
  import Path from './parts/Path.svelte'

  type Props = {
    /** The tree's rows, the ones under an open category straight after it. */
    rows: TreeRow[]
    /** This week's sum and the week before's, in cents. */
    total: number
    before: number
    currency: string
    /** This week's headings, or another week's. */
    thisWeek: boolean
    selectedKey: string | null
    /** A row picked by a click. */
    onpick: (key: string) => void
    /** The keys moved the selection to another row. */
    onselect: (key: string) => void
    onkey: (event: KeyboardEvent) => boolean
  }
  let {
    rows,
    total,
    before,
    currency,
    thisWeek,
    selectedKey,
    onpick,
    onselect,
    onkey,
  }: Props = $props()

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
  const sum = $derived(changeOf(total, before))

  export function focus() {
    listbox.focus()
  }
</script>

{#snippet figure(cents: number | null)}
  {#if cents === null}{copy.reports.tree.dash}{:else}<Money
      of={moneyOf(cents, currency)}
    />{/if}
{/snippet}

{#snippet change(moved: Change)}
  {#if moved.cents > 0}<Money of={moneyOf(moved.cents, currency)} />{' '}{copy.reports.tree.change[
      moved.way
    ]}{:else}{copy.reports.tree.change.same}{/if}
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
        {#if line.kind === 'category' && line.level === 1}
          <Path path={`expenses:${line.category}`} />
        {:else if line.kind === 'category'}
          {`:${line.label}`}
        {:else}
          <span class:unsorted={line.kind === 'unsorted'}>{lineLabel(line)}</span>
        {/if}
      </span>
      <span data-cell="shown">{@render figure(line.cents)}</span>
      {#if shown.cells.includes('before')}
        <span data-cell="before">{@render figure(line.before)}</span>
      {/if}
      <span data-cell="change">{@render change(moved)}</span>
    {/snippet}
  </Listbox>
  {#if rows.length === 0}
    <Empty>{copy.reports.tree.empty}</Empty>
  {:else}
    <p class="total" style:grid-template-columns={shown.template}>
      <span>{copy.reports.tree.total}</span>
      <span class="amount">{@render figure(total)}</span>
      {#if shown.cells.includes('before')}
        <span class="amount">{@render figure(before)}</span>
      {/if}
      <span class="change">{@render change(sum)}</span>
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
