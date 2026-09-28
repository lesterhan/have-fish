<script lang="ts">
  import GradientButton from '../ui/GradientButton.svelte'
  import Icon from '../ui/Icon.svelte'
  import Toggle from '../ui/Toggle.svelte'
  import TextInput from '../ui/TextInput.svelte'
  import Select from '../ui/Select.svelte'
  import AccountPicker from '../accounts/AccountPicker.svelte'
  import {
    updateParser,
    type CsvParser,
    type Account,
    type ColumnMapping,
  } from '$lib/api'
  import TooltipIcon from '../ui/TooltipIcon.svelte'
  import { copy } from '$lib/copy'

  interface Props {
    parser: CsvParser
    accounts: Account[]
    onSuccess?: ((updated: CsvParser) => void) | undefined
    onCancel?: (() => void) | undefined
    onAccountCreated?: ((account: Account) => void) | undefined
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
      saveError =
        e instanceof Error ? e.message : copy.import.parser.edit.failed
    } finally {
      saving = false
    }
  }
</script>

<div class="edit-window">
  <div class="section-bar">
    <span class="section-bar-title"
      >{copy.import.parser.edit.title(parser.name)}</span
    >
  </div>
  <div class="edit-body">
    <div class="columns">
      <!-- Left: general settings -->
      <section>
        <h3 class="section-heading">{copy.import.parser.edit.general}</h3>
        <div class="form-grid">
          <label for="ep-name"
            >{copy.import.parser.edit.name}
            <span class="required">*</span></label
          >
          <TextInput id="ep-name" bind:value={name} autocomplete="off" />

          <label for="ep-account"
            >{copy.import.parser.edit.defaultAccount}</label
          >
          <AccountPicker
            {accounts}
            bind:value={defaultAccountId}
            placeholder={copy.import.parser.edit.accountPlaceholder}
            oncreate={(a) => {
              onAccountCreated?.(a)
              defaultAccountId = a.id
            }}
          />

          <span class="toggle-label">
            {copy.import.parser.fields.multiCurrency}
            <TooltipIcon label={copy.import.parser.fields.multiCurrencyHint} />
          </span>
          <Toggle bind:checked={isMultiCurrency} />

          {#if isMultiCurrency}
            <label for="ep-fee-account"
              >{copy.import.parser.edit.feeAccount}</label
            >
            <AccountPicker
              {accounts}
              bind:value={defaultFeeAccountId}
              placeholder={copy.import.parser.edit.feePlaceholder}
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
        <h3 class="section-heading">{copy.import.parser.edit.mapping}</h3>
        <div class="form-grid">
          <label for="ep-date"
            >{copy.import.parser.fields.date}
            <span class="required">*</span></label
          >
          <Select id="ep-date" bind:value={mappingDate}>
            <option value="">{copy.import.parser.fields.select}</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </Select>

          <label for="ep-amount"
            >{copy.import.parser.fields.amount}
            <span class="required">*</span></label
          >
          <Select id="ep-amount" bind:value={mappingAmount}>
            <option value="">{copy.import.parser.fields.select}</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </Select>

          <label for="ep-description"
            >{copy.import.parser.fields.description}</label
          >
          <Select id="ep-description" bind:value={mappingDescription}>
            <option value="">{copy.import.parser.fields.notMapped}</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </Select>

          <label for="ep-currency">{copy.import.parser.fields.currency}</label>
          <Select id="ep-currency" bind:value={mappingCurrency}>
            <option value="">{copy.import.parser.fields.notMapped}</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </Select>

          <label for="ep-sign-col" class="toggle-label">
            {copy.import.parser.fields.direction}
            <TooltipIcon label={copy.import.parser.fields.directionHint} />
          </label>
          <Select id="ep-sign-col" bind:value={mappingSignColumn}>
            <option value="">{copy.import.parser.fields.notMapped}</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </Select>

          {#if mappingSignColumn}
            <label for="ep-sign-neg"
              >{copy.import.parser.fields.negativeValue}</label
            >
            <TextInput
              id="ep-sign-neg"
              bind:value={mappingSignNegativeValue}
              placeholder={copy.import.parser.fields.negativePlaceholder}
              spellcheck={false}
              autocomplete="off"
            />
          {/if}
        </div>
      </section>
    </div>

    {#if isMultiCurrency}
      <section>
        <h3 class="section-heading">
          {copy.import.parser.edit.multiCurrency}
        </h3>
        <div class="multi-grid">
          <label for="ep-src-amount"
            >{copy.import.parser.fields.sourceAmount}
            <span class="required">*</span></label
          >
          <Select id="ep-src-amount" bind:value={mappingSourceAmount}>
            <option value="">{copy.import.parser.fields.select}</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </Select>

          <label for="ep-src-currency"
            >{copy.import.parser.fields.sourceCurrency}
            <span class="required">*</span></label
          >
          <Select id="ep-src-currency" bind:value={mappingSourceCurrency}>
            <option value="">{copy.import.parser.fields.select}</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </Select>

          <label for="ep-tgt-amount"
            >{copy.import.parser.fields.targetAmount}
            <span class="required">*</span></label
          >
          <Select id="ep-tgt-amount" bind:value={mappingTargetAmount}>
            <option value="">{copy.import.parser.fields.select}</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </Select>

          <label for="ep-tgt-currency"
            >{copy.import.parser.fields.targetCurrency}
            <span class="required">*</span></label
          >
          <Select id="ep-tgt-currency" bind:value={mappingTargetCurrency}>
            <option value="">{copy.import.parser.fields.select}</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </Select>

          <label for="ep-fee-amount"
            >{copy.import.parser.fields.feeAmount}</label
          >
          <Select id="ep-fee-amount" bind:value={mappingFeeAmount}>
            <option value="">{copy.import.parser.fields.notMapped}</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </Select>

          <label for="ep-fee-currency"
            >{copy.import.parser.fields.feeCurrency}</label
          >
          <Select id="ep-fee-currency" bind:value={mappingFeeCurrency}>
            <option value="">{copy.import.parser.fields.notMapped}</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </Select>
        </div>
      </section>
    {/if}

    <div class="edit-footer">
      {#if saveError}
        <p class="save-error">{saveError}</p>
      {/if}
      <div class="footer-actions">
        <GradientButton onclick={onCancel}
          >{copy.import.parser.edit.cancel}</GradientButton
        >
        <GradientButton onclick={handleSave} disabled={saving || !valid}>
          <Icon name="floppy" size={12} />{saving
            ? copy.import.parser.edit.saving
            : copy.import.parser.edit.save}
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
    padding: var(--sp-3xs) var(--sp-sm);
  }

  .section-bar-title {
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
    font-size: var(--text-micro);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-wide);
    color: var(--color-text-muted);
    text-transform: uppercase;
    padding-bottom: var(--sp-xs);
    border-bottom: 1px solid var(--color-rule);
    margin-bottom: var(--sp-sm);
  }

  .form-grid {
    display: grid;
    grid-template-columns: 8rem 1fr;
    gap: var(--sp-2xs) var(--sp-sm);
    align-items: center;
  }

  /* 4-column layout for multi-currency: label col col label col col */
  .multi-grid {
    display: grid;
    grid-template-columns: 8rem 1fr 8rem 1fr;
    gap: var(--sp-2xs) var(--sp-sm);
    align-items: center;
  }

  .form-grid label,
  .form-grid .toggle-label,
  .multi-grid label {
    font-size: var(--text-dense);
    text-align: right;
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .form-grid :global(.text-input),
  .form-grid :global(.select-shell),
  .multi-grid :global(.select-shell) {
    font-size: var(--text-dense);
    width: 100%;
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    justify-content: flex-end;
  }

  /* A required-field marker is a status, not a figure. */
  .required {
    color: var(--color-danger);
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
    font-size: var(--text-body);
    color: var(--color-danger);
    background: var(--color-danger-light);
    padding: var(--sp-xs) var(--sp-sm);
    margin: 0;
  }
</style>
