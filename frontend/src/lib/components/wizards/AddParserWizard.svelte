<script lang="ts">
  import Modal from '../ui/Modal.svelte'
  import Button from '../ui/Button.svelte'
  import Toggle from '../ui/Toggle.svelte'
  import AccountPathInput from '../accounts/AccountPathInput.svelte'
  import { tooltip } from '$lib/tooltip'
  import { createParser, type Account, type CsvParser } from '$lib/api'

  interface Props {
    open: boolean
    accounts: Account[]
    onSuccess?: (parser: CsvParser) => void
  }

  let { open = $bindable(), accounts, onSuccess }: Props = $props()

  const STEP = {
    ACCOUNT_PICK: 'account-pick',
    PARSER_UPLOAD: 'parser-upload',
    PARSER_COLUMNS: 'parser-columns',
    PARSER_MULTICURRENCY: 'parser-multicurrency',
    CONFIRM: 'confirm',
  } as const

  type WizardStep = (typeof STEP)[keyof typeof STEP]

  let step = $state<WizardStep>(STEP.ACCOUNT_PICK)
  let parserSkipped = $state(false)

  // --- Step 1 state ---
  // searchOnly mode gives us a path string; derive the account ID for submit.
  let selectedAccountPath = $state('')
  let selectedAccountId = $derived(
    accounts.find((a) => a.path === selectedAccountPath)?.id ?? '',
  )

  // --- Step 2+ state (parser setup) ---
  let parserName = $state('')
  let columns = $state<string[]>([])
  let mappingDate = $state('')
  let mappingAmount = $state('')
  let mappingDescription = $state('')
  let mappingCurrency = $state('')
  let isMultiCurrency = $state(false)
  let mappingSourceAmount = $state('')
  let mappingSourceCurrency = $state('')
  let mappingTargetAmount = $state('')
  let mappingTargetCurrency = $state('')
  let mappingFeeAmount = $state('')
  let mappingFeeCurrency = $state('')
  let mappingSignColumn = $state('')
  let mappingSignNegativeValue = $state('')
  let detectedHeader = $state('')

  function normalizeColumn(col: string): string {
    return col
      .toLowerCase()
      .replace(/"/g, '')
      .replace(/\s/g, '')
      .replace(/\(.*\)/g, '')
  }

  function buildNormalizedHeader(cols: string[]): string {
    return [...cols].sort().join('|')
  }

  function handleFileUpload(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const firstLine =
        text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? ''
      detectedHeader = firstLine
      const parsed = firstLine
        .split(',')
        .map((c) => normalizeColumn(c.trim()))
        .filter(Boolean)
      columns = [...new Set(parsed)]
      mappingDate = ''
      mappingAmount = ''
      mappingDescription = ''
      mappingCurrency = ''
      mappingSourceAmount = ''
      mappingSourceCurrency = ''
      mappingTargetAmount = ''
      mappingTargetCurrency = ''
      mappingFeeAmount = ''
      mappingFeeCurrency = ''
      mappingSignColumn = ''
      mappingSignNegativeValue = ''
    }
    reader.readAsText(file)
  }

  function resetStep2() {
    parserName = ''
    columns = []
    detectedHeader = ''
    mappingDate = ''
    mappingAmount = ''
    mappingDescription = ''
    mappingCurrency = ''
    isMultiCurrency = false
    mappingSourceAmount = ''
    mappingSourceCurrency = ''
    mappingTargetAmount = ''
    mappingTargetCurrency = ''
    mappingFeeAmount = ''
    mappingFeeCurrency = ''
    mappingSignColumn = ''
    mappingSignNegativeValue = ''
  }

  // Transition tables
  const NEXT: Record<WizardStep, WizardStep | (() => WizardStep)> = {
    [STEP.ACCOUNT_PICK]: STEP.PARSER_UPLOAD,
    [STEP.PARSER_UPLOAD]: STEP.PARSER_COLUMNS,
    [STEP.PARSER_COLUMNS]: () =>
      isMultiCurrency ? STEP.PARSER_MULTICURRENCY : STEP.CONFIRM,
    [STEP.PARSER_MULTICURRENCY]: STEP.CONFIRM,
    [STEP.CONFIRM]: STEP.CONFIRM,
  }

  const BACK: Record<WizardStep, WizardStep | (() => WizardStep)> = {
    [STEP.ACCOUNT_PICK]: STEP.ACCOUNT_PICK,
    [STEP.PARSER_UPLOAD]: STEP.ACCOUNT_PICK,
    [STEP.PARSER_COLUMNS]: STEP.PARSER_UPLOAD,
    [STEP.PARSER_MULTICURRENCY]: STEP.PARSER_COLUMNS,
    [STEP.CONFIRM]: () =>
      parserSkipped
        ? STEP.PARSER_UPLOAD
        : isMultiCurrency
          ? STEP.PARSER_MULTICURRENCY
          : STEP.PARSER_COLUMNS,
  }

  function next() {
    const t = NEXT[step]
    step = typeof t === 'function' ? t() : t
  }

  function back() {
    const t = BACK[step]
    step = typeof t === 'function' ? t() : t
  }

  function skip() {
    resetStep2()
    parserSkipped = true
    step = STEP.CONFIRM
  }

  function close() {
    open = false
    setTimeout(() => {
      step = STEP.ACCOUNT_PICK
      parserSkipped = false
      selectedAccountPath = ''
      resetStep2()
    }, 200)
  }

  // Validation
  let step1Valid = $derived(selectedAccountId.length > 0)

  let parserUploadValid = $derived(
    parserName.trim().length > 0 && columns.length > 0,
  )
  let parserColumnsValid = $derived(
    mappingDate.length > 0 && mappingAmount.length > 0,
  )
  let parserMultiCurrencyValid = $derived(
    mappingSourceAmount.length > 0 &&
      mappingSourceCurrency.length > 0 &&
      mappingTargetAmount.length > 0 &&
      mappingTargetCurrency.length > 0,
  )

  let submitting = $state(false)
  let submitError = $state('')

  async function handleConfirm() {
    submitting = true
    submitError = ''
    try {
      const columnMapping = {
        date: mappingDate,
        amount: mappingAmount,
        description: mappingDescription || null,
        currency: mappingCurrency || null,
        signColumn: mappingSignColumn || null,
        signNegativeValue: mappingSignColumn
          ? mappingSignNegativeValue || null
          : null,
        ...(isMultiCurrency && {
          sourceAmount: mappingSourceAmount || null,
          sourceCurrency: mappingSourceCurrency || null,
          targetAmount: mappingTargetAmount || null,
          targetCurrency: mappingTargetCurrency || null,
          feeAmount: mappingFeeAmount || null,
          feeCurrency: mappingFeeCurrency || null,
        }),
      }
      const newParser = await createParser({
        name: parserName.trim(),
        normalizedHeader: buildNormalizedHeader(columns),
        columnMapping,
        isMultiCurrency,
        defaultAccountId: selectedAccountId,
      })
      onSuccess?.(newParser)
      close()
    } catch (e) {
      submitError = e instanceof Error ? e.message : 'Something went wrong.'
    } finally {
      submitting = false
    }
  }
</script>

<Modal title="Add Import Parser" bind:open onclose={close}>
  <div class="wizard-body">
    {#if step === STEP.ACCOUNT_PICK}
      <div class="form-grid">
        <label for="account-pick">Account</label>
        <AccountPathInput
          {accounts}
          bind:value={selectedAccountPath}
          placeholder="Select an account…"
          searchOnly
        />
      </div>
    {:else if step === STEP.PARSER_UPLOAD}
      <div class="form-grid">
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
          onchange={handleFileUpload}
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
              aria-label="Enable for banks that encode transfers inline (e.g. Wise). Source, target, and fee columns will be mapped separately."
              >?</button
            >
          </span>
          <Toggle bind:checked={isMultiCurrency} />
        {/if}
      </div>
    {:else if step === STEP.PARSER_COLUMNS}
      <div class="form-grid">
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
          <button
            type="button"
            class="tooltip-icon"
            use:tooltip={'For banks that put IN/OUT in a separate column (e.g. Wise). Select the column and enter the value that means debit/OUT.'}
            aria-label="For banks that put IN/OUT in a separate column (e.g. Wise). Select the column and enter the value that means debit/OUT."
            >?</button
          >
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
      </div>
    {:else if step === STEP.PARSER_MULTICURRENCY}
      <div class="form-grid">
        <label for="map-src-amount"
          >Source amount <span class="required">*</span></label
        >
        <select id="map-src-amount" bind:value={mappingSourceAmount}>
          <option value="">— select —</option>
          {#each columns as col}<option value={col}>{col}</option>{/each}
        </select>

        <label for="map-src-currency"
          >Source currency <span class="required">*</span></label
        >
        <select id="map-src-currency" bind:value={mappingSourceCurrency}>
          <option value="">— select —</option>
          {#each columns as col}<option value={col}>{col}</option>{/each}
        </select>

        <label for="map-tgt-amount"
          >Target amount <span class="required">*</span></label
        >
        <select id="map-tgt-amount" bind:value={mappingTargetAmount}>
          <option value="">— select —</option>
          {#each columns as col}<option value={col}>{col}</option>{/each}
        </select>

        <label for="map-tgt-currency"
          >Target currency <span class="required">*</span></label
        >
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
      </div>
    {:else if step === STEP.CONFIRM}
      <div class="summary">
        <div class="summary-section">
          <h3 class="summary-heading">Account</h3>
          <div class="summary-row">
            <span class="summary-label">Path</span>
            <code class="summary-value">{selectedAccountPath}</code>
          </div>
        </div>

        <div class="summary-section">
          <h3 class="summary-heading">CSV Parser</h3>
          {#if parserSkipped}
            <p class="summary-muted">No parser configured.</p>
          {:else}
            <div class="summary-row">
              <span class="summary-label">Name</span>
              <span class="summary-value">{parserName.trim()}</span>
            </div>
            <div class="summary-row">
              <span class="summary-label">Date column</span>
              <code class="summary-value">{mappingDate}</code>
            </div>
            <div class="summary-row">
              <span class="summary-label">Amount column</span>
              <code class="summary-value">{mappingAmount}</code>
            </div>
            {#if mappingDescription}
              <div class="summary-row">
                <span class="summary-label">Description column</span>
                <code class="summary-value">{mappingDescription}</code>
              </div>
            {/if}
            {#if mappingSignColumn}
              <div class="summary-row">
                <span class="summary-label">Direction column</span>
                <code class="summary-value">{mappingSignColumn}</code>
              </div>
              {#if mappingSignNegativeValue}
                <div class="summary-row">
                  <span class="summary-label">Negative value</span>
                  <code class="summary-value">{mappingSignNegativeValue}</code>
                </div>
              {/if}
            {/if}
            {#if isMultiCurrency}
              <div class="summary-row">
                <span class="summary-label">Multi-currency</span>
                <span class="summary-value">Yes</span>
              </div>
            {/if}
          {/if}
        </div>

        {#if submitError}
          <p class="summary-error">{submitError}</p>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Footer nav -->
  <div class="wizard-footer">
    <div class="footer-left">
      {#if step !== STEP.ACCOUNT_PICK}
        <Button onclick={back}>◀️ Back</Button>
      {/if}
    </div>

    <div class="footer-right">
      {#if step === STEP.ACCOUNT_PICK}
        <Button variant="primary" onclick={next} disabled={!step1Valid}>
          Next ▶️
        </Button>
      {:else if step === STEP.PARSER_UPLOAD}
        <Button onclick={skip}>Skip</Button>
        <Button variant="primary" onclick={next} disabled={!parserUploadValid}>
          Next ▶️
        </Button>
      {:else if step === STEP.PARSER_COLUMNS}
        <Button onclick={skip}>Skip</Button>
        <Button variant="primary" onclick={next} disabled={!parserColumnsValid}>
          Next ▶️
        </Button>
      {:else if step === STEP.PARSER_MULTICURRENCY}
        <Button onclick={skip}>Skip</Button>
        <Button
          variant="primary"
          onclick={next}
          disabled={!parserMultiCurrencyValid}
        >
          Next ▶️
        </Button>
      {:else if step === STEP.CONFIRM}
        <Button variant="primary" onclick={handleConfirm} disabled={submitting}>
          {submitting ? 'Creating…' : 'Confirm'}
        </Button>
      {/if}
    </div>
  </div>
</Modal>

<style>
  .wizard-body {
    min-width: 420px;
  }

  .form-grid {
    display: grid;
    grid-template-columns: 10rem 1fr;
    gap: var(--sp-xs) var(--sp-sm);
    align-items: center;
  }

  .form-grid label,
  .form-grid .field-label {
    font-size: var(--text-sm);
    text-align: right;
  }

  .form-grid input {
    font-size: var(--text-sm);
    font-family: var(--font-sans);
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-window-inset);
    box-shadow: var(--shadow-sunken);
    border: none;
    color: var(--color-text);
    width: 100%;
    box-sizing: border-box;
  }

  .form-grid input:focus {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
  }

  .form-grid select {
    font-size: var(--text-sm);
    font-family: var(--font-sans);
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-window-inset);
    box-shadow: var(--shadow-sunken);
    border: none;
    color: var(--color-text);
    width: 100%;
    box-sizing: border-box;
  }

  .form-grid select:focus {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
  }

  .file-input {
    font-size: var(--text-sm);
    font-family: var(--font-sans);
    background: none !important;
    box-shadow: none !important;
    padding: 0 !important;
    cursor: pointer;
  }

  .detected-header {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    word-break: break-all;
  }

  .required {
    color: var(--color-amount-negative);
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    justify-content: flex-end;
  }

  .tooltip-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-text-muted);
    color: var(--color-window);
    font-size: 10px;
    font-weight: bold;
    cursor: help;
    flex-shrink: 0;
  }

  .summary {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
  }

  .summary-section {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
  }

  .summary-heading {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    padding-bottom: var(--sp-xs);
    border-bottom: 1px solid var(--color-bevel-mid);
    margin-bottom: var(--sp-xs);
  }

  .summary-row {
    display: flex;
    gap: var(--sp-sm);
    font-size: var(--text-sm);
    align-items: baseline;
  }

  .summary-label {
    color: var(--color-text-muted);
    min-width: 9rem;
    text-align: right;
    flex-shrink: 0;
  }

  .summary-value {
    color: var(--color-text);
  }

  .summary-muted {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    font-style: italic;
  }

  .summary-error {
    font-size: var(--text-sm);
    color: var(--color-amount-negative);
    background: var(--color-danger-light);
    padding: var(--sp-xs) var(--sp-sm);
    box-shadow: var(--shadow-sunken);
  }

  .wizard-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: var(--sp-md);
    border-top: 1px solid var(--color-bevel-mid);
    margin-top: var(--sp-md);
  }

  .footer-left,
  .footer-right {
    display: flex;
    gap: var(--sp-xs);
  }
</style>
