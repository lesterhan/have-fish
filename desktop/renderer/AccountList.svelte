<script lang="ts">
  // The accounts as a tree under their roots: each root a band with what it comes to, each child
  // indented under its parent and named from it (`:chequing`), and a parent nobody added there
  // for its children's total, never selected.
  import { copy } from '../copy'
  import { accountColumnsOf, type AccountRow, accountGroups } from './balances'
  import Band from './parts/Band.svelte'
  import Headings from './parts/Headings.svelte'
  import Listbox from './parts/Listbox.svelte'
  import Money from './parts/Money.svelte'
  import Path from './parts/Path.svelte'

  type Props = {
    /** What shows: every account, and the parents their names imply. */
    rows: AccountRow[]
    selectedId: string | null
    onselect: (id: string) => void
    /** Show the pane, in a narrow window. */
    onopen: () => void
  }
  let { rows, selectedId, onselect, onopen }: Props = $props()

  let listbox: ReturnType<typeof Listbox<AccountRow>>

  const groups = $derived(accountGroups(rows))
  const names = copy.accounts.list.columns
  // The list's width, not the window's: beside the pane it runs out first, and Kind goes before a
  // name does.
  let width = $state(0)
  const shown = $derived(accountColumnsOf(width))
  const headings = $derived([
    { name: names.account },
    ...(shown.cells.includes('kind') ? [{ name: names.kind }] : []),
    { name: names.balance, end: true },
  ])

  export function focus() {
    listbox.focus()
  }

  function onkey(event: KeyboardEvent): boolean {
    if (event.key !== 'Enter') return false
    event.preventDefault()
    onopen()
    return true
  }
</script>

<div class="list" bind:clientWidth={width}>
  <Headings columns={shown.template} names={headings} />
  <Listbox
    bind:this={listbox}
    items={rows}
    idOf={(r) => r.account?.id ?? r.key}
    active={selectedId}
    label={copy.accounts.list.label}
    idPrefix="account"
    columns={shown.template}
    groups={groups.map((g) => g.count)}
    disabled={(r) => r.account === undefined}
    onactive={onselect}
    onpick={(id) => {
      onselect(id)
      onopen()
    }}
    {onkey}
  >
    {#snippet band(g)}
      {@const group = groups[g]}
      {#if group}
        <Band net={group.total.map((b) => b.money)}><Path path={group.root} /></Band>
      {/if}
    {/snippet}
    {#snippet row(r)}
      {@const a = r.account}
      <span data-cell="name" style:padding-inline-start="calc({r.depth} * var(--space-4))"
        >{r.depth > 0 ? `:${r.label}` : r.label}</span
      >
      {#if shown.cells.includes('kind')}
        <span data-cell="kind">{a ? copy.accounts.kinds[a.kind] : ''}</span>
      {/if}
      <span data-cell="balance"
        >{#each r.balance as { money, owed }, i (money.currency)}{#if i > 0}{' · '}{/if}{#if owed}{`${copy.accounts.owed} `}{/if}<Money
            of={money}
          />{/each}</span
      >
    {/snippet}
  </Listbox>
</div>

<style>
  .list {
    grid-area: list;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
  }

  [data-cell='balance'] {
    justify-self: end;
  }
</style>
