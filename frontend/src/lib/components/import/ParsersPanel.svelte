<script lang="ts">
  import Panel from '$lib/components/ui/Panel.svelte'
  import Button from '$lib/components/ui/Button.svelte'
  import TableShell from '$lib/components/ui/TableShell.svelte'
  import type { Account, CsvParser } from '$lib/api'

  interface Props {
    parsers: CsvParser[]
    accounts: Account[]
    loading: boolean
    onedit: (parser: CsvParser) => void
    onadd: () => void
  }

  let { parsers, accounts, loading, onedit, onadd }: Props = $props()
</script>

<Panel title="Available Parsers">
  <div class="parsers-toolbar">
    <Button onclick={onadd}>Add parser</Button>
  </div>
  <div class="parsers-table">
    <TableShell
      columns={[
        { label: 'Name' },
        { label: 'Account' },
        { label: 'Multi-currency' },
        { label: 'Fee account' },
        { label: 'Configure' },
      ]}
      {loading}
      empty={parsers.length === 0}
      emptyText="No parsers 🕵️"
    >
      {#each parsers as parser}
        {@const accountPath =
          accounts.find((a) => a.id === parser.defaultAccountId)?.path ?? '—'}
        {@const feePath =
          accounts.find((a) => a.id === parser.defaultFeeAccountId)?.path ??
          '—'}
        <tr>
          <td class="cell-name">{parser.name}</td>
          <td class="cell-mono">{accountPath}</td>
          <td>{parser.isMultiCurrency ? 'Yes' : 'No'}</td>
          <td class="cell-mono">{feePath}</td>
          <td class="cell-actions">
            <Button variant="ghost" square onclick={() => onedit(parser)}
              >⚙️</Button
            >
          </td>
        </tr>
      {/each}
    </TableShell>
  </div>
</Panel>

<style>
  .parsers-toolbar {
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-bevel-mid);
  }

  .parsers-table :global(td) {
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-bevel-mid);
    background: var(--color-window-inset);
  }

  .parsers-table :global(tbody tr:last-child td) {
    border-bottom: none;
  }

  .parsers-table :global(tbody tr:hover td) {
    background: var(--color-accent-light);
  }

  .cell-name {
    font-weight: var(--weight-semibold);
  }

  .cell-mono {
    font-family: var(--font-mono);
  }

  .cell-actions {
    white-space: nowrap;
    padding: 0 var(--sp-xs);
  }
</style>
