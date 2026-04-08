<script lang="ts">
  import WizardFormGrid from './WizardFormGrid.svelte'

  interface Props {
    accountPath: string
    startingBalance: string
    startingCurrency: string
    startingDate: string
    rootPrefix: string
  }

  let {
    accountPath = $bindable(),
    startingBalance = $bindable(),
    startingCurrency = $bindable(),
    startingDate = $bindable(),
    rootPrefix,
  }: Props = $props()
</script>

<WizardFormGrid>
  <label for="account-path">Account path</label>
  <input
    id="account-path"
    type="text"
    bind:value={accountPath}
    placeholder={rootPrefix || 'assets:'}
    spellcheck={false}
    autocomplete="off"
  />

  <label for="starting-balance">
    Starting balance <span class="optional">(optional)</span>
  </label>
  <div class="balance-row">
    <input
      id="starting-balance"
      type="text"
      inputmode="decimal"
      bind:value={startingBalance}
      placeholder="0.00"
      class="balance-amount"
    />
    <input
      type="text"
      bind:value={startingCurrency}
      placeholder="CAD"
      class="balance-currency"
      maxlength={5}
      spellcheck={false}
    />
  </div>

  {#if startingBalance.trim()}
    <label for="starting-date">Balance date</label>
    <input id="starting-date" type="date" bind:value={startingDate} />
  {/if}
</WizardFormGrid>

<style>
  .balance-row {
    display: flex;
    gap: var(--sp-xs);
  }

  /* Override the form-grid's width:100% rule for inputs inside the balance row */
  .balance-row :global(input) {
    width: auto;
  }

  .balance-amount {
    flex: 1;
    min-width: 0;
  }

  .balance-currency {
    width: 3.5rem;
    flex-shrink: 0;
    text-transform: uppercase;
  }
</style>
