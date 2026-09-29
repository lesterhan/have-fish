<script lang="ts">
  import WizardFormGrid from './WizardFormGrid.svelte'
  import { copy } from '$lib/copy'

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
  <label for="map-src-amount"
    >{copy.import.parser.fields.sourceAmount}
    <span class="required">*</span></label
  >
  <select id="map-src-amount" bind:value={mappingSourceAmount}>
    <option value="">{copy.import.parser.fields.select}</option>
    {#each columns as col}<option value={col}>{col}</option>{/each}
  </select>

  <label for="map-src-currency"
    >{copy.import.parser.fields.sourceCurrency}
    <span class="required">*</span></label
  >
  <select id="map-src-currency" bind:value={mappingSourceCurrency}>
    <option value="">{copy.import.parser.fields.select}</option>
    {#each columns as col}<option value={col}>{col}</option>{/each}
  </select>

  <label for="map-tgt-amount"
    >{copy.import.parser.fields.targetAmount}
    <span class="required">*</span></label
  >
  <select id="map-tgt-amount" bind:value={mappingTargetAmount}>
    <option value="">{copy.import.parser.fields.select}</option>
    {#each columns as col}<option value={col}>{col}</option>{/each}
  </select>

  <label for="map-tgt-currency"
    >{copy.import.parser.fields.targetCurrency}
    <span class="required">*</span></label
  >
  <select id="map-tgt-currency" bind:value={mappingTargetCurrency}>
    <option value="">{copy.import.parser.fields.select}</option>
    {#each columns as col}<option value={col}>{col}</option>{/each}
  </select>

  <label for="map-fee-amount">{copy.import.parser.fields.feeAmount}</label>
  <select id="map-fee-amount" bind:value={mappingFeeAmount}>
    <option value="">{copy.import.parser.fields.notMapped}</option>
    {#each columns as col}<option value={col}>{col}</option>{/each}
  </select>

  <label for="map-fee-currency">{copy.import.parser.fields.feeCurrency}</label>
  <select id="map-fee-currency" bind:value={mappingFeeCurrency}>
    <option value="">{copy.import.parser.fields.notMapped}</option>
    {#each columns as col}<option value={col}>{col}</option>{/each}
  </select>
</WizardFormGrid>
