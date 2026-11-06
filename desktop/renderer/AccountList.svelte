<script lang="ts">
  import { copy } from '../copy'
  import type { ListedAccount } from '../shared/commands'
  import type { AccountRow } from './balances'
  import Money from './parts/Money.svelte'
  import Listbox from './parts/Listbox.svelte'

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

  let listbox: ReturnType<typeof Listbox<AccountRow>>

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

<div class="list">
  <!-- A parent nobody added is there for its children's total, and never selected. -->
  <Listbox
    bind:this={listbox}
    items={rows}
    idOf={(r) => r.account?.id ?? r.key}
    active={selectedId}
    label={copy.accounts.list.label}
    idPrefix="account"
    columns="minmax(0, 1fr) 7rem 7rem auto"
    disabled={(r) => r.account === undefined}
    onactive={onselect}
    onpick={(id) => {
      onselect(id)
      onopen()
    }}
    {onkey}
  >
    {#snippet row(r)}
      {@const a = r.account}
      <span class="name" class:parent={!a} style:--depth={r.depth}>{r.label}</span>
      <span class="kind">{a ? copy.accounts.kinds[a.kind] : ''}</span>
      <span class="currency" class:code={a?.currency != null}>
        {a ? (a.currency ?? copy.accounts.anyCurrency) : ''}
      </span>
      <span class="balance"
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
    min-height: 0;
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

  .name.parent {
    color: var(--color-muted);
  }

  /* A currency code is data; "Any currency" is words. */
  .code {
    font-family: var(--font-figures);
  }
</style>
