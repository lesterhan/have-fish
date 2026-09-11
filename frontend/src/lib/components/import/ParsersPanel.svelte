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
    <span class="section-bar-title">Parsers</span>
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
    padding: var(--sp-3xs) var(--sp-sm);
  }

  .section-bar-title {
    flex: 1;
    white-space: nowrap;
  }

  .parsers-table :global(th) {
    background: var(--color-window);
    box-shadow: none;
    border-bottom: 1px solid var(--color-rule);
    padding: var(--sp-3xs) var(--sp-sm);
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-wide);
    color: var(--color-text-muted);
    text-transform: uppercase;
  }

  .parsers-table :global(td) {
    padding: var(--sp-2xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-rule-soft);
    background: var(--color-window-inset);
    font-size: var(--text-dense);
  }

  .parsers-table :global(tbody tr:last-child td) {
    border-bottom: none;
  }

  .parsers-table :global(tbody tr:hover td) {
    background: var(--color-accent-chip-bg);
  }

  .cell-name {
    font-size: var(--text-dense);
  }

  .cell-mono {
    font-family: var(--font-mono);
    font-size: var(--text-dense);
  }

  .cell-actions {
    white-space: nowrap;
    padding: var(--sp-4xs) var(--sp-xs);
  }
</style>
