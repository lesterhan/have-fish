<script lang="ts">
  import WizardFormGrid from './WizardFormGrid.svelte'
  import TooltipIcon from '../ui/TooltipIcon.svelte'

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
  <label for="map-date">Date <span class="required">*</span></label>
  <select id="map-date" bind:value={mappingDate}>
    <option value="">— select —</option>
    {#each columns as col}<option value={col}>{col}</option>{/each}
  </select>

  <label for="map-amount">Amount <span class="required">*</span></label>
  <select id="map-amount" bind:value={mappingAmount}>
    <option value="">— select —</option>
    {#each columns as col}<option value={col}>{col}</option>{/each}
  </select>

  <label for="map-description">Description</label>
  <select id="map-description" bind:value={mappingDescription}>
    <option value="">— not mapped —</option>
    {#each columns as col}<option value={col}>{col}</option>{/each}
  </select>

  <label for="map-currency">Currency</label>
  <select id="map-currency" bind:value={mappingCurrency}>
    <option value="">— not mapped —</option>
    {#each columns as col}<option value={col}>{col}</option>{/each}
  </select>

  <label for="map-sign-column" class="toggle-label">
    Direction column
    <TooltipIcon label="For banks that put IN/OUT in a separate column (e.g. Wise). Select the column and enter the value that means debit/OUT." />
  </label>
  <select id="map-sign-column" bind:value={mappingSignColumn}>
    <option value="">— not mapped —</option>
    {#each columns as col}<option value={col}>{col}</option>{/each}
  </select>

  {#if mappingSignColumn}
    <label for="map-sign-negative">Negative value</label>
    <input
      id="map-sign-negative"
      type="text"
      bind:value={mappingSignNegativeValue}
      placeholder="e.g. OUT"
      spellcheck={false}
      autocomplete="off"
    />
  {/if}
</WizardFormGrid>
