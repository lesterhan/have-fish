<script lang="ts">
  import WizardFormGrid from './WizardFormGrid.svelte'

  interface Props {
    columns: string[]
    mappingSourceAmount: string
    mappingSourceCurrency: string
    mappingTargetAmount: string
    mappingTargetCurrency: string
    mappingFeeAmount: string
    mappingFeeCurrency: string
  }

  let {
    columns,
    mappingSourceAmount = $bindable(),
    mappingSourceCurrency = $bindable(),
    mappingTargetAmount = $bindable(),
    mappingTargetCurrency = $bindable(),
    mappingFeeAmount = $bindable(),
    mappingFeeCurrency = $bindable(),
  }: Props = $props()
</script>

<WizardFormGrid>
  <label for="map-src-amount">Source amount <span class="required">*</span></label>
  <select id="map-src-amount" bind:value={mappingSourceAmount}>
    <option value="">— select —</option>
    {#each columns as col}<option value={col}>{col}</option>{/each}
  </select>

  <label for="map-src-currency">Source currency <span class="required">*</span></label>
  <select id="map-src-currency" bind:value={mappingSourceCurrency}>
    <option value="">— select —</option>
    {#each columns as col}<option value={col}>{col}</option>{/each}
  </select>

  <label for="map-tgt-amount">Target amount <span class="required">*</span></label>
  <select id="map-tgt-amount" bind:value={mappingTargetAmount}>
    <option value="">— select —</option>
    {#each columns as col}<option value={col}>{col}</option>{/each}
  </select>

  <label for="map-tgt-currency">Target currency <span class="required">*</span></label>
  <select id="map-tgt-currency" bind:value={mappingTargetCurrency}>
    <option value="">— select —</option>
    {#each columns as col}<option value={col}>{col}</option>{/each}
  </select>

  <label for="map-fee-amount">Fee amount</label>
  <select id="map-fee-amount" bind:value={mappingFeeAmount}>
    <option value="">— not mapped —</option>
    {#each columns as col}<option value={col}>{col}</option>{/each}
  </select>

  <label for="map-fee-currency">Fee currency</label>
  <select id="map-fee-currency" bind:value={mappingFeeCurrency}>
    <option value="">— not mapped —</option>
    {#each columns as col}<option value={col}>{col}</option>{/each}
  </select>
</WizardFormGrid>
