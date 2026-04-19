<script lang="ts">
  import WizardFormGrid from './WizardFormGrid.svelte'
  import TextInput from '../ui/TextInput.svelte'
  import CurrencyInput from '../ui/CurrencyInput.svelte'

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
    <TextInput
      id="starting-balance"
      inputmode="decimal"
      bind:value={startingBalance}
      placeholder="0.00"
      style="flex: 1; min-width: 0; width: auto"
    />
    <CurrencyInput
      bind:value={startingCurrency}
      style="width: 3.5rem; flex-shrink: 0"
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
</style>
