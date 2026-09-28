<script lang="ts">
  import WizardFormGrid from './WizardFormGrid.svelte'
  import Toggle from '../ui/Toggle.svelte'
  import TooltipIcon from '../ui/TooltipIcon.svelte'
  import { copy } from '$lib/copy'

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
  <label for="parser-name">{copy.import.parser.fields.name}</label>
  <input
    id="parser-name"
    type="text"
    bind:value={parserName}
    placeholder={copy.import.parser.fields.namePlaceholder}
    autocomplete="off"
  />

  <label for="wizard-csv-file">{copy.import.parser.fields.file}</label>
  <input
    id="wizard-csv-file"
    type="file"
    accept=".csv,text/csv"
    onchange={onfileupload}
    class="file-input"
  />

  {#if detectedHeader}
    <span class="field-label">{copy.import.parser.fields.detectedHeader}</span>
    <code class="detected-header">{detectedHeader}</code>
  {/if}

  {#if columns.length > 0}
    <span class="field-label toggle-label">
      {copy.import.parser.fields.multiCurrency}
      <TooltipIcon label={copy.import.parser.fields.multiCurrencyHint} />
    </span>
    <Toggle bind:checked={isMultiCurrency} />
  {/if}
</WizardFormGrid>

<style>
  .file-input {
    font-size: var(--text-body);
    font-family: var(--font-mono);
    background: none;
    box-shadow: none;
    padding: 0;
    cursor: pointer;
  }

  .detected-header {
    font-family: var(--font-mono);
    font-size: var(--text-dense);
    color: var(--color-text-muted);
    word-break: break-all;
  }
</style>
