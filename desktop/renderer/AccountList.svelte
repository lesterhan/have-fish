<script lang="ts">
  import { copy } from '../copy'
  import type { ListedAccount } from '../shared/commands'
  import type { AccountRow } from './balances'
  import { movedBy } from './selection'

  type Props = {
    /** What shows: every account, and the parents their names imply. */
    rows: AccountRow[]
    /** The accounts the arrows move through, in the order they show. */
    accounts: ListedAccount[]
    selectedId: string | null
    onselect: (id: string) => void
    /** Show the pane, in a narrow window. */
    onopen: () => void
  }
  let { rows, accounts, selectedId, onselect, onopen }: Props = $props()

  let list: HTMLOListElement

  export function focus() {
    list.focus()
  }

  const optionId = (id: string) => `account-${id}`

  // Keeps the selected row in view as the keys move it.
  $effect(() => {
    if (selectedId !== null) {
      document.getElementById(optionId(selectedId))?.scrollIntoView({ block: 'nearest' })
    }
  })

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      onopen()
      return
    }
    const to = movedBy(accounts, selectedId, event.key)
    if (to === undefined) return
    event.preventDefault()
    if (to !== null) onselect(to)
  }

  function onclick(event: MouseEvent) {
    const id = (event.target as Element).closest<HTMLElement>('[role=option]')?.dataset.id
    if (id === undefined) return
    onselect(id)
    onopen()
  }
</script>

<ol
  bind:this={list}
  role="listbox"
  aria-label={copy.accounts.list.label}
  tabindex="0"
  aria-activedescendant={selectedId === null ? undefined : optionId(selectedId)}
  {onkeydown}
  {onclick}
>
  {#each rows as row (row.key)}
    {@const a = row.account}
    {#if a}
      <li id={optionId(a.id)} role="option" aria-selected={a.id === selectedId} data-id={a.id}>
        <span class="name" style:--depth={row.depth}>{row.label}</span>
        <span class="kind">{copy.accounts.kinds[a.kind]}</span>
        <span class="currency" class:code={a.currency !== null}>
          {a.currency ?? copy.accounts.anyCurrency}
        </span>
        <span class="balance">{row.balance}</span>
      </li>
    {:else}
      <!-- A parent nobody added: there for its children's total, never selected. -->
      <li role="option" aria-selected="false" aria-disabled="true" class="parent">
        <span class="name" style:--depth={row.depth}>{row.label}</span>
        <span></span>
        <span></span>
        <span class="balance">{row.balance}</span>
      </li>
    {/if}
  {/each}
</ol>

<style>
  ol {
    grid-area: list;
    overflow-y: auto;
    list-style: none;
    margin: 0;
    padding: 0;
    /* One set of columns for every row, so the balances line up. */
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto auto;
    align-content: start;
  }

  li {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    gap: var(--space-3);
    padding: var(--space-2);
    border-bottom: var(--border-width) solid var(--color-rule);
    cursor: default;
  }

  li[aria-selected='true'] {
    background: var(--color-selected);
  }

  .name {
    padding-inline-start: calc(var(--depth) * var(--space-4));
    font-family: var(--font-serif);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kind {
    color: var(--color-muted);
  }

  .currency {
    text-align: end;
  }

  .balance {
    text-align: end;
    font-family: var(--font-figures);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .parent .name {
    color: var(--color-muted);
  }

  /* A currency code is data; "Any currency" is words. */
  .code {
    font-family: var(--font-figures);
  }
</style>
