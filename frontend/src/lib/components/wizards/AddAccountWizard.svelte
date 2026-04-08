<script lang="ts">
  import { onMount } from 'svelte'
  import Modal from '../ui/Modal.svelte'
  import Button from '../ui/Button.svelte'
  import WizardStepAccount from './WizardStepAccount.svelte'
  import WizardStepParserUpload from './WizardStepParserUpload.svelte'
  import WizardStepParserColumns from './WizardStepParserColumns.svelte'
  import WizardStepParserMultiCurrency from './WizardStepParserMultiCurrency.svelte'
  import WizardStepConfirm from './WizardStepConfirm.svelte'
  import { settingsStore } from '$lib/settings.svelte'

  interface Props {
    type: 'asset' | 'liability'
    open: boolean
    onSuccess?: () => void
  }

  let { type, open = $bindable(), onSuccess }: Props = $props()

  const TITLES = {
    asset: 'Add New Asset Account',
    liability: 'Add New Liability Account',
  }

  const STEP = {
    ACCOUNT: 'account',
    PARSER_UPLOAD: 'parser-upload',
    PARSER_COLUMNS: 'parser-columns',
    PARSER_MULTICURRENCY: 'parser-multicurrency',
    CONFIRM: 'confirm',
  } as const

  type WizardStep = (typeof STEP)[keyof typeof STEP]
  let step = $state<WizardStep>(STEP.ACCOUNT)
  let parserSkipped = $state(false)

  const NEXT: Record<WizardStep, WizardStep | (() => WizardStep)> = {
    [STEP.ACCOUNT]: STEP.PARSER_UPLOAD,
    [STEP.PARSER_UPLOAD]: STEP.PARSER_COLUMNS,
    [STEP.PARSER_COLUMNS]: () => (isMultiCurrency ? STEP.PARSER_MULTICURRENCY : STEP.CONFIRM),
    [STEP.PARSER_MULTICURRENCY]: STEP.CONFIRM,
    [STEP.CONFIRM]: STEP.CONFIRM,
  }

  const BACK: Record<WizardStep, WizardStep | (() => WizardStep)> = {
    [STEP.ACCOUNT]: STEP.ACCOUNT,
    [STEP.PARSER_UPLOAD]: STEP.ACCOUNT,
    [STEP.PARSER_COLUMNS]: STEP.PARSER_UPLOAD,
    [STEP.PARSER_MULTICURRENCY]: STEP.PARSER_COLUMNS,
    [STEP.CONFIRM]: () =>
      parserSkipped ? STEP.PARSER_UPLOAD : isMultiCurrency ? STEP.PARSER_MULTICURRENCY : STEP.PARSER_COLUMNS,
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
      step = STEP.ACCOUNT
      parserSkipped = false
      resetStep1()
      resetStep2()
    }, 200)
  }

  onMount(async () => {
    await settingsStore.load()
  })

  let rootPrefix = $derived.by(() => {
    const s = settingsStore.value
    if (!s) return ''
    return type === 'asset' ? s.defaultAssetsRootPath + ':' : s.defaultLiabilitiesRootPath + ':'
  })

  // --- Step 1 state ---
  let accountPath = $state('')
  let startingBalance = $state('')
  let startingCurrency = $state('CAD')
  let startingDate = $state(todayIso())

  function todayIso(): string {
    return new Date().toISOString().slice(0, 10)
  }

  $effect(() => {
    if (open && rootPrefix && accountPath === '') {
      accountPath = rootPrefix
    }
  })

  function resetStep1() {
    accountPath = ''
    startingBalance = ''
    startingCurrency = 'CAD'
    startingDate = todayIso()
  }

  let step1Valid = $derived(
    accountPath.trim().length > 0 && accountPath.trim() !== rootPrefix.trim(),
  )

  // --- Step 2 state ---
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
    return col.toLowerCase().replace(/"/g, '').replace(/\s/g, '').replace(/\(.*\)/g, '')
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
      const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? ''
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

  let parserUploadValid = $derived(parserName.trim().length > 0 && columns.length > 0)
  let parserColumnsValid = $derived(mappingDate.length > 0 && mappingAmount.length > 0)
  let parserMultiCurrencyValid = $derived(
    mappingSourceAmount.length > 0 &&
      mappingSourceCurrency.length > 0 &&
      mappingTargetAmount.length > 0 &&
      mappingTargetCurrency.length > 0,
  )

  // --- Confirm / submit ---
  let submitting = $state(false)
  let submitError = $state('')

  const BASE = ''

  async function handleConfirm() {
    submitting = true
    submitError = ''
    try {
      const accountRes = await fetch(`${BASE}/api/accounts`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: accountPath.trim() }),
      })
      if (!accountRes.ok) {
        const err = await accountRes.json().catch(() => ({}))
        throw new Error(err.error ?? 'Failed to create account.')
      }
      const account = await accountRes.json()

      const balanceAmount = startingBalance.trim()
      if (balanceAmount && settingsStore.value?.defaultOffsetAccountId) {
        const offsetId = settingsStore.value.defaultOffsetAccountId
        const txRes = await fetch(`${BASE}/api/transactions`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: startingDate,
            description: 'Opening balance',
            postings: [
              { accountId: account.id, amount: balanceAmount, currency: startingCurrency },
              { accountId: offsetId, amount: String(-parseFloat(balanceAmount)), currency: startingCurrency },
            ],
          }),
        })
        if (!txRes.ok) {
          const err = await txRes.json().catch(() => ({}))
          throw new Error(err.error ?? 'Account created but failed to post starting balance.')
        }
      }

      if (!parserSkipped) {
        const columnMapping = {
          date: mappingDate,
          amount: mappingAmount,
          description: mappingDescription || null,
          currency: mappingCurrency || null,
          signColumn: mappingSignColumn || null,
          signNegativeValue: mappingSignColumn ? (mappingSignNegativeValue || null) : null,
          ...(isMultiCurrency && {
            sourceAmount: mappingSourceAmount || null,
            sourceCurrency: mappingSourceCurrency || null,
            targetAmount: mappingTargetAmount || null,
            targetCurrency: mappingTargetCurrency || null,
            feeAmount: mappingFeeAmount || null,
            feeCurrency: mappingFeeCurrency || null,
          }),
        }
        const parserRes = await fetch(`${BASE}/api/parsers`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: parserName.trim(),
            normalizedHeader: buildNormalizedHeader(columns),
            columnMapping,
            isMultiCurrency,
            defaultAccountId: account.id,
          }),
        })
        if (!parserRes.ok) {
          const err = await parserRes.json().catch(() => ({}))
          throw new Error(err.error ?? 'Account created but failed to save parser.')
        }
      }

      onSuccess?.()
      close()
    } catch (e) {
      submitError = e instanceof Error ? e.message : 'Something went wrong.'
    } finally {
      submitting = false
    }
  }
</script>

<Modal title={TITLES[type]} bind:open onclose={close}>
  <div class="wizard-body">
    {#if step === STEP.ACCOUNT}
      <WizardStepAccount
        bind:accountPath
        bind:startingBalance
        bind:startingCurrency
        bind:startingDate
        {rootPrefix}
      />
    {:else if step === STEP.PARSER_UPLOAD}
      <WizardStepParserUpload
        bind:parserName
        bind:columns
        bind:isMultiCurrency
        bind:detectedHeader
        onfileupload={handleFileUpload}
      />
    {:else if step === STEP.PARSER_COLUMNS}
      <WizardStepParserColumns
        {columns}
        bind:mappingDate
        bind:mappingAmount
        bind:mappingDescription
        bind:mappingCurrency
        bind:mappingSignColumn
        bind:mappingSignNegativeValue
      />
    {:else if step === STEP.PARSER_MULTICURRENCY}
      <WizardStepParserMultiCurrency
        {columns}
        bind:mappingSourceAmount
        bind:mappingSourceCurrency
        bind:mappingTargetAmount
        bind:mappingTargetCurrency
        bind:mappingFeeAmount
        bind:mappingFeeCurrency
      />
    {:else if step === STEP.CONFIRM}
      <WizardStepConfirm
        {accountPath}
        {startingBalance}
        {startingCurrency}
        {startingDate}
        hasOffsetAccount={!!settingsStore.value?.defaultOffsetAccountId}
        {parserSkipped}
        {parserName}
        {mappingDate}
        {mappingAmount}
        {mappingDescription}
        {mappingSignColumn}
        {mappingSignNegativeValue}
        {isMultiCurrency}
        {submitError}
      />
    {/if}
  </div>

  <div class="wizard-footer">
    <div class="footer-left">
      {#if step !== STEP.ACCOUNT}
        <Button onclick={back}>◀️ Back</Button>
      {/if}
    </div>
    <div class="footer-right">
      {#if step === STEP.ACCOUNT}
        <Button variant="primary" onclick={next} disabled={!step1Valid}>Next ▶️</Button>
      {:else if step === STEP.PARSER_UPLOAD}
        <Button onclick={skip}>Skip</Button>
        <Button variant="primary" onclick={next} disabled={!parserUploadValid}>Next ▶️</Button>
      {:else if step === STEP.PARSER_COLUMNS}
        <Button onclick={skip}>Skip</Button>
        <Button variant="primary" onclick={next} disabled={!parserColumnsValid}>Next ▶️</Button>
      {:else if step === STEP.PARSER_MULTICURRENCY}
        <Button onclick={skip}>Skip</Button>
        <Button variant="primary" onclick={next} disabled={!parserMultiCurrencyValid}>Next ▶️</Button>
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
