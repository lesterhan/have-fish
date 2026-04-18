<script lang="ts">
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import TableShell from '$lib/components/ui/TableShell.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
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

<div class="parsers-window">
  <div class="section-bar">
    <span class="section-bar-title">PARSERS</span>
    <GradientButton onclick={onadd}>Add parser</GradientButton>
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
            <GradientButton square onclick={() => onedit(parser)}>
              <Icon name="settings" />
            </GradientButton>
          </td>
        </tr>
      {/each}
    </TableShell>
  </div>
</div>

<style>
  .parsers-window {
    background: var(--color-window);
    border-bottom: 1px solid var(--color-rule);
  }

  .section-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    padding: 4px 12px;
    background: var(--color-section-bar-bg);
    border-top: 1px solid var(--color-section-bar-border-top);
    border-bottom: 1px solid var(--color-section-bar-border-bottom);
  }

  .section-bar-title {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.6px;
    color: var(--color-section-bar-fg);
    flex: 1;
    white-space: nowrap;
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
