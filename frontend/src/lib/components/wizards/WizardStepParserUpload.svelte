<script lang="ts">
  import WizardFormGrid from './WizardFormGrid.svelte'
  import Toggle from '../ui/Toggle.svelte'
  import { tooltip } from '$lib/tooltip'

  interface Props {
    parserName: string
    columns: string[]
    isMultiCurrency: boolean
    detectedHeader: string
    onfileupload: (e: Event) => void
  }

  let {
    parserName = $bindable(),
    columns = $bindable(),
    isMultiCurrency = $bindable(),
    detectedHeader = $bindable(),
    onfileupload,
  }: Props = $props()
</script>

<WizardFormGrid>
  <label for="parser-name">Parser name</label>
  <input
    id="parser-name"
    type="text"
    bind:value={parserName}
    placeholder="e.g. Imre Trust Visa"
    autocomplete="off"
  />

  <label for="wizard-csv-file">CSV file</label>
  <input
    id="wizard-csv-file"
    type="file"
    accept=".csv,text/csv"
    onchange={onfileupload}
    class="file-input"
  />

  {#if detectedHeader}
    <span class="field-label">Detected header</span>
    <code class="detected-header">{detectedHeader}</code>
  {/if}

  {#if columns.length > 0}
    <span class="field-label toggle-label">
      Multi-currency
      <button
        type="button"
        class="tooltip-icon"
        use:tooltip={'Enable for banks that encode transfers inline (e.g. Wise). Source, target, and fee columns will be mapped separately.'}
        aria-label="Multi-currency help">?</button
      >
    </span>
    <Toggle bind:checked={isMultiCurrency} />
  {/if}
</WizardFormGrid>

<style>
  .file-input {
    font-size: var(--text-sm);
    font-family: var(--font-mono);
    background: none;
    box-shadow: none;
    padding: 0;
    cursor: pointer;
  }

  .detected-header {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    word-break: break-all;
  }
</style>
