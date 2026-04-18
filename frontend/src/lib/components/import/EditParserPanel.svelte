<script lang="ts">
  import GradientButton from '../ui/GradientButton.svelte'
  import Icon from '../ui/Icon.svelte'
  import Toggle from '../ui/Toggle.svelte'
  import AccountPathInput from '../accounts/AccountPathInput.svelte'
  import {
    updateParser,
    type CsvParser,
    type Account,
    type ColumnMapping,
  } from '$lib/api'
  import { tooltip } from '$lib/tooltip'

  interface Props {
    parser: CsvParser
    accounts: Account[]
    onSuccess?: (updated: CsvParser) => void
    onCancel?: () => void
    onAccountCreated?: (account: Account) => void
  }

  let { parser, accounts, onSuccess, onCancel, onAccountCreated }: Props =
    $props()

  // Derive available columns from the stored normalized header (pipe-separated)
  let columns = $derived(parser.normalizedHeader.split('|').filter(Boolean))

  // Editable state — initialised empty, populated and re-synced by $effect below
  let name = $state('')
  let isMultiCurrency = $state(false)
  let defaultAccountId = $state('')
  let defaultFeeAccountId = $state('')
  let mappingDate = $state('')
  let mappingAmount = $state('')
  let mappingDescription = $state('')
  let mappingCurrency = $state('')
  let mappingSignColumn = $state('')
  let mappingSignNegativeValue = $state('')
  let mappingSourceAmount = $state('')
  let mappingSourceCurrency = $state('')
  let mappingTargetAmount = $state('')
  let mappingTargetCurrency = $state('')
  let mappingFeeAmount = $state('')
  let mappingFeeCurrency = $state('')

  $effect(() => {
    const m = parser.columnMapping as ColumnMapping
    name = parser.name
    isMultiCurrency = parser.isMultiCurrency
    defaultAccountId = parser.defaultAccountId ?? ''
    defaultFeeAccountId = parser.defaultFeeAccountId ?? ''
    mappingDate = m.date ?? ''
    mappingAmount = m.amount ?? ''
    mappingDescription = m.description ?? ''
    mappingCurrency = m.currency ?? ''
    mappingSignColumn = m.signColumn ?? ''
    mappingSignNegativeValue = m.signNegativeValue ?? ''
    mappingSourceAmount = m.sourceAmount ?? ''
    mappingSourceCurrency = m.sourceCurrency ?? ''
    mappingTargetAmount = m.targetAmount ?? ''
    mappingTargetCurrency = m.targetCurrency ?? ''
    mappingFeeAmount = m.feeAmount ?? ''
    mappingFeeCurrency = m.feeCurrency ?? ''
  })

  let saving = $state(false)
  let saveError = $state('')

  let valid = $derived(
    name.trim().length > 0 &&
      mappingDate.length > 0 &&
      mappingAmount.length > 0,
  )

  async function handleSave() {
    saving = true
    saveError = ''
    try {
      const columnMapping: ColumnMapping = {
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
      const updated = await updateParser(parser.id, {
        name: name.trim(),
        columnMapping,
        isMultiCurrency,
        defaultAccountId: defaultAccountId || null,
        defaultFeeAccountId: defaultFeeAccountId || null,
      })
      onSuccess?.(updated)
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'Failed to save parser.'
    } finally {
      saving = false
    }
  }
</script>

<div class="edit-window">
  <div class="section-bar">
    <span class="section-bar-title">EDIT PARSER — {parser.name}</span>
  </div>
  <div class="edit-body">
    <div class="columns">
      <!-- Left: general settings -->
      <section>
        <h3 class="section-heading">General</h3>
        <div class="form-grid">
          <label for="ep-name">Name <span class="required">*</span></label>
          <input
            id="ep-name"
            type="text"
            bind:value={name}
            autocomplete="off"
          />

          <label for="ep-account">Default account</label>
          <AccountPathInput
            {accounts}
            bind:value={defaultAccountId}
            placeholder="Select or create…"
            oncreate={(a) => {
              onAccountCreated?.(a)
              defaultAccountId = a.id
            }}
          />

          <span class="toggle-label">
            Multi-currency
            <button
              type="button"
              class="tooltip-icon"
              use:tooltip={'Enable for banks that encode transfers inline (e.g. Wise).'}
              aria-label="Enable for banks that encode transfers inline (e.g. Wise)."
              >?</button
            >
          </span>
          <Toggle bind:checked={isMultiCurrency} />

          {#if isMultiCurrency}
            <label for="ep-fee-account">Fee account</label>
            <AccountPathInput
              {accounts}
              bind:value={defaultFeeAccountId}
              placeholder="expenses:fees…"
              oncreate={(a) => {
                onAccountCreated?.(a)
                defaultFeeAccountId = a.id
              }}
            />
          {/if}
        </div>
      </section>

      <!-- Right: column mapping -->
      <section>
        <h3 class="section-heading">Column mapping</h3>
        <div class="form-grid">
          <label for="ep-date">Date <span class="required">*</span></label>
          <select id="ep-date" bind:value={mappingDate}>
            <option value="">— select —</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </select>

          <label for="ep-amount">Amount <span class="required">*</span></label>
          <select id="ep-amount" bind:value={mappingAmount}>
            <option value="">— select —</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </select>

          <label for="ep-description">Description</label>
          <select id="ep-description" bind:value={mappingDescription}>
            <option value="">— not mapped —</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </select>

          <label for="ep-currency">Currency</label>
          <select id="ep-currency" bind:value={mappingCurrency}>
            <option value="">— not mapped —</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </select>

          <label for="ep-sign-col" class="toggle-label">
            Direction column
            <button
              type="button"
              class="tooltip-icon"
              use:tooltip={'For banks that put IN/OUT in a separate column (e.g. Wise).'}
              aria-label="For banks that put IN/OUT in a separate column (e.g. Wise)."
              >?</button
            >
          </label>
          <select id="ep-sign-col" bind:value={mappingSignColumn}>
            <option value="">— not mapped —</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </select>

          {#if mappingSignColumn}
            <label for="ep-sign-neg">Negative value</label>
            <input
              id="ep-sign-neg"
              type="text"
              bind:value={mappingSignNegativeValue}
              placeholder="e.g. OUT"
              spellcheck={false}
              autocomplete="off"
            />
          {/if}
        </div>
      </section>
    </div>

    {#if isMultiCurrency}
      <section>
        <h3 class="section-heading">Multi-currency columns</h3>
        <div class="multi-grid">
          <label for="ep-src-amount"
            >Source amount <span class="required">*</span></label
          >
          <select id="ep-src-amount" bind:value={mappingSourceAmount}>
            <option value="">— select —</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </select>

          <label for="ep-src-currency"
            >Source currency <span class="required">*</span></label
          >
          <select id="ep-src-currency" bind:value={mappingSourceCurrency}>
            <option value="">— select —</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </select>

          <label for="ep-tgt-amount"
            >Target amount <span class="required">*</span></label
          >
          <select id="ep-tgt-amount" bind:value={mappingTargetAmount}>
            <option value="">— select —</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </select>

          <label for="ep-tgt-currency"
            >Target currency <span class="required">*</span></label
          >
          <select id="ep-tgt-currency" bind:value={mappingTargetCurrency}>
            <option value="">— select —</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </select>

          <label for="ep-fee-amount">Fee amount</label>
          <select id="ep-fee-amount" bind:value={mappingFeeAmount}>
            <option value="">— not mapped —</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </select>

          <label for="ep-fee-currency">Fee currency</label>
          <select id="ep-fee-currency" bind:value={mappingFeeCurrency}>
            <option value="">— not mapped —</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </select>
        </div>
      </section>
    {/if}

    <div class="edit-footer">
      {#if saveError}
        <p class="save-error">{saveError}</p>
      {/if}
      <div class="footer-actions">
        <GradientButton onclick={onCancel}>Cancel</GradientButton>
        <GradientButton
          onclick={handleSave}
          disabled={saving || !valid}
        >
          <Icon name="floppy" size={12} />{saving ? 'Saving…' : 'Save'}
        </GradientButton>
      </div>
    </div>
  </div>
</div>

<style>
  .edit-window {
    background: var(--color-window);
    border-bottom: 1px solid var(--color-rule);
  }

  .section-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    padding: 4px 12px;
    background: var(--color-section-bar-bg);
    border-top: 1px solid var(--color-section-bar-border-top);
    border-bottom: 1px solid var(--color-section-bar-border-bottom);
  }

  .section-bar-title {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.6px;
    color: var(--color-section-bar-fg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .edit-body {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    padding: var(--sp-sm) var(--sp-md);
    background: var(--color-window);
  }

  .columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sp-lg);
    align-items: start;
  }

  .section-heading {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.8px;
    color: var(--color-text-muted);
    text-transform: uppercase;
    padding-bottom: var(--sp-xs);
    border-bottom: 1px solid var(--color-rule);
    margin-bottom: var(--sp-sm);
  }

  .form-grid {
    display: grid;
    grid-template-columns: 8rem 1fr;
    gap: 5px var(--sp-sm);
    align-items: center;
  }

  /* 4-column layout for multi-currency: label col col label col col */
  .multi-grid {
    display: grid;
    grid-template-columns: 8rem 1fr 8rem 1fr;
    gap: 5px var(--sp-sm);
    align-items: center;
  }

  .form-grid label,
  .multi-grid label {
    font-size: var(--text-xs);
    text-align: right;
    color: var(--color-text-muted);
  }

  .form-grid input,
  .form-grid select,
  .multi-grid select {
    font-size: var(--text-xs);
    font-family: var(--font-sans);
    padding: 3px var(--sp-xs);
    background: var(--color-window-inset);
    box-shadow: var(--shadow-sunken);
    border: none;
    color: var(--color-text);
    width: 100%;
    box-sizing: border-box;
  }

  .form-grid input:focus,
  .form-grid select:focus,
  .multi-grid select:focus {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
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

  .required {
    color: var(--color-amount-negative);
  }

  .edit-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--sp-sm);
    padding-top: var(--sp-sm);
    border-top: 1px solid var(--color-rule);
  }

  .footer-actions {
    display: flex;
    gap: var(--sp-xs);
  }

  .save-error {
    font-size: var(--text-sm);
    color: var(--color-amount-negative);
    background: var(--color-danger-light);
    padding: var(--sp-xs) var(--sp-sm);
    box-shadow: var(--shadow-sunken);
    margin: 0;
  }
</style>
