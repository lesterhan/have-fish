<script lang="ts">
  import WizardFormGrid from './WizardFormGrid.svelte'
  import TooltipIcon from '../ui/TooltipIcon.svelte'
  import { copy } from '$lib/copy'

  interface Props {
    columns: string[]
    mappingDate: string
    mappingAmount: string
    mappingDescription: string
    mappingCurrency: string
    mappingSignColumn: string
    mappingSignNegativeValue: string
  }

  let {
    columns,
    mappingDate = $bindable(),
    mappingAmount = $bindable(),
    mappingDescription = $bindable(),
    mappingCurrency = $bindable(),
    mappingSignColumn = $bindable(),
    mappingSignNegativeValue = $bindable(),
  }: Props = $props()
</script>

<WizardFormGrid>
  <label for="map-date"
    >{copy.import.parser.fields.date} <span class="required">*</span></label
  >
  <select id="map-date" bind:value={mappingDate}>
    <option value="">{copy.import.parser.fields.select}</option>
    {#each columns as col}<option value={col}>{col}</option>{/each}
  </select>

  <label for="map-amount"
    >{copy.import.parser.fields.amount} <span class="required">*</span></label
  >
  <select id="map-amount" bind:value={mappingAmount}>
    <option value="">{copy.import.parser.fields.select}</option>
    {#each columns as col}<option value={col}>{col}</option>{/each}
  </select>

  <label for="map-description">{copy.import.parser.fields.description}</label>
  <select id="map-description" bind:value={mappingDescription}>
    <option value="">{copy.import.parser.fields.notMapped}</option>
    {#each columns as col}<option value={col}>{col}</option>{/each}
  </select>

  <label for="map-currency">{copy.import.parser.fields.currency}</label>
  <select id="map-currency" bind:value={mappingCurrency}>
    <option value="">{copy.import.parser.fields.notMapped}</option>
    {#each columns as col}<option value={col}>{col}</option>{/each}
  </select>

  <label for="map-sign-column" class="toggle-label">
    {copy.import.parser.fields.direction}
    <TooltipIcon label={copy.import.parser.fields.directionHint} />
  </label>
  <select id="map-sign-column" bind:value={mappingSignColumn}>
    <option value="">{copy.import.parser.fields.notMapped}</option>
    {#each columns as col}<option value={col}>{col}</option>{/each}
  </select>

  {#if mappingSignColumn}
    <label for="map-sign-negative"
      >{copy.import.parser.fields.negativeValue}</label
    >
    <input
      id="map-sign-negative"
      type="text"
      bind:value={mappingSignNegativeValue}
      placeholder={copy.import.parser.fields.negativePlaceholder}
      spellcheck={false}
      autocomplete="off"
    />
  {/if}
</WizardFormGrid>
