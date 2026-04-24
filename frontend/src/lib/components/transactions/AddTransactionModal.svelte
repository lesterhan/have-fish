<script lang="ts">
  import { untrack } from 'svelte'
  import Modal from '$lib/components/ui/Modal.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import CurrencyInput from '$lib/components/ui/CurrencyInput.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import { createTransaction, fetchFxRate, type Account, type Transaction } from '$lib/api'
  import { toISODate } from '$lib/date'

  interface Props {
    accounts: Account[]
    defaultOffsetAccountId?: string | null
    preferredCurrency?: string
    open: boolean
    onclose: () => void
    oncreated?: (tx: Transaction) => void
    onaccountcreated?: (account: Account) => void
  }

  let {
    accounts,
    defaultOffsetAccountId,
    preferredCurrency = 'CAD',
    open = $bindable(),
    onclose,
    oncreated,
    onaccountcreated,
  }: Props = $props()

  // --- Form state ---
  // Two fixed postings — amounts are independent so the balance indicator is meaningful.
  let date = $state(toISODate(new Date()))
  let description = $state('')
  let postings = $state([
    { accountId: '', amount: '', currency: 'CAD' },
    {
      accountId: untrack(() => defaultOffsetAccountId ?? ''),
      amount: '',
      currency: 'CAD',
    },
  ])
  let submitting = $state(false)
  let submitError = $state('')

  // Reset all fields whenever the modal opens.
  $effect(() => {
    if (open) {
      date = toISODate(new Date())
      description = ''
      postings = [
        { accountId: '', amount: '', currency: 'CAD' },
        {
          accountId: defaultOffsetAccountId ?? '',
          amount: '',
          currency: 'CAD',
        },
      ]
      submitting = false
      submitError = ''
    }
  })

  // Per-currency balance — same logic as TransactionEditModal.
  // Skip unparseable amounts while the user is still typing.
  let balances = $derived.by(() => {
    const map = new Map<string, number>()
    for (const p of postings) {
      const n = parseFloat(p.amount)
      if (!isNaN(n)) map.set(p.currency, (map.get(p.currency) ?? 0) + n)
    }
    return map
  })

  let balanced = $derived(
    balances.size > 0 &&
      [...balances.values()].every((v) => Math.abs(v) < 0.005),
  )

  let canSubmit = $derived(
    balanced && postings.every((p) => p.accountId !== '') && !submitting,
  )

  // FX rate hint — one entry per unique foreign currency.
  // null = rate unavailable for this date; undefined = not yet fetched.
  let fxRates = $state(new Map<string, string | null>())
  let fxLoading = $state(false)
  // Incremented on every effect run; lets async callbacks detect they are stale.
  let fxVersion = 0

  // Unique foreign currencies that have a parseable non-zero amount.
  let foreignCurrencies = $derived.by(() => {
    const seen = new Set<string>()
    for (const p of postings) {
      const cur = p.currency.toUpperCase()
      if (cur === preferredCurrency.toUpperCase()) continue
      const n = parseFloat(p.amount)
      if (!isNaN(n) && Math.abs(n) > 0) seen.add(cur)
    }
    return [...seen]
  })

  // For a given foreign currency, the largest absolute posting amount — used as
  // the representative "transaction size" to show in the converted hint.
  function maxAbsAmount(currency: string): number {
    let max = 0
    for (const p of postings) {
      if (p.currency.toUpperCase() !== currency) continue
      const n = Math.abs(parseFloat(p.amount))
      if (!isNaN(n) && n > max) max = n
    }
    return max
  }

  $effect(() => {
    const currencies = foreignCurrencies
    const d = date
    const preferred = preferredCurrency.toUpperCase()
    const version = ++fxVersion

    if (currencies.length === 0) {
      fxRates = new Map()
      fxLoading = false
      return
    }

    fxLoading = true
    const timer = setTimeout(async () => {
      const entries = await Promise.all(
        currencies.map(async (cur) => {
          const result = await fetchFxRate(d, cur, preferred)
          return [cur, result?.rate ?? null] as [string, string | null]
        }),
      )
      // Discard results if a newer effect run has since started
      if (fxVersion !== version) return
      fxRates = new Map(entries)
      fxLoading = false
    }, 300)

    return () => clearTimeout(timer)
  })

  function addPosting() {
    postings.push({
      accountId: '',
      amount: '',
      currency: postings[0]?.currency ?? 'CAD',
    })
  }

  function removePosting(i: number) {
    postings.splice(i, 1)
  }

  function handleAmountBlur(i: number) {
    const n = parseFloat(postings[i].amount)
    if (!isNaN(n) && postings[i].amount.trim() !== '') {
      postings[i].amount = n.toFixed(2)
    }
  }

  async function handleSubmit() {
    submitting = true
    submitError = ''
    try {
      const result = await createTransaction({
        date,
        description: description.trim() || undefined,
        postings: postings.map((p) => ({
          accountId: p.accountId,
          amount: p.amount,
          currency: p.currency,
        })),
      })
      oncreated?.(result)
      onclose()
    } catch (e) {
      submitError = e instanceof Error ? e.message : 'Failed to add transaction'
    } finally {
      submitting = false
    }
  }
</script>

<Modal title="New Transaction" {open} {onclose}>
  <div class="modal-body">
    <!-- Date + description — always-visible inputs (creation form, not edit-in-place) -->
    <div class="header-row">
      <TextInput
        type="date"
        aria-label="Date"
        bind:value={date}
        disabled={submitting}
        style="color: var(--color-text-muted); flex-shrink: 0"
      />
      <TextInput
        bind:value={description}
        placeholder="Description (optional)"
        aria-label="Description"
        disabled={submitting}
        class="desc-input"
        style="font-family: var(--font-sans); font-weight: var(--weight-semibold); color: var(--color-accent-mid); flex: 1; min-width: 0"
      />
    </div>

    <!-- Posting rows — same grid as TransactionEditModal (account | amount | currency) -->
    <div class="postings">
      {#each postings as posting, i}
        <div class="posting-row">
          <div class="posting-account-cell">
            <AccountPathInput
              {accounts}
              bind:value={posting.accountId}
              oncreate={(a) => {
                onaccountcreated?.(a)
              }}
            />
          </div>
          <TextInput
            inputmode="decimal"
            aria-label="Amount"
            bind:value={posting.amount}
            placeholder="0.00"
            onblur={() => handleAmountBlur(i)}
            disabled={submitting}
            style="width: 10ch; text-align: right"
          />
          <CurrencyInput bind:value={posting.currency} style="width: 4rem; flex-shrink: 0" />
          <button
            class="delete-btn"
            title="Remove posting"
            aria-label="Remove posting"
            disabled={postings.length <= 2}
            onclick={() => removePosting(i)}>×</button
          >
        </div>
      {/each}
    </div>

    <button class="add-posting-btn" onclick={addPosting}>+ Add posting</button>

    <hr class="divider" />

    <!-- Balance indicator — same as TransactionEditModal -->
    <div class="balance-row">
      <span class="balance-label">Balance</span>
      {#if balanced}
        <span class="balance-ok">✓ 0.00</span>
      {:else}
        <div class="balance-errors">
          {#each [...balances.entries()] as [cur, total]}
            {#if Math.abs(total) >= 0.005}
              <span class="balance-bad" title="Balance must be zero">
                {total > 0 ? '+' : ''}{total.toFixed(2)}
                {cur}
              </span>
            {/if}
          {/each}
        </div>
      {/if}
    </div>

    {#if foreignCurrencies.length > 0}
      <div class="fx-hints">
        {#if fxLoading}
          <span class="fx-hint fx-loading">fetching rate…</span>
        {:else}
          {#each foreignCurrencies as cur}
            {@const rate = fxRates.get(cur)}
            {#if rate === null}
              <span class="fx-hint fx-unavailable">rate unavailable for {date}</span>
            {:else if rate !== undefined}
              {@const converted = (maxAbsAmount(cur) * parseFloat(rate)).toFixed(2)}
              <span class="fx-hint">
                1 {cur} = {parseFloat(rate).toFixed(4)} {preferredCurrency.toUpperCase()}
                &nbsp;·&nbsp;
                ≈ {converted} {preferredCurrency.toUpperCase()}
              </span>
            {/if}
          {/each}
        {/if}
      </div>
    {/if}

    {#if submitError}
      <p class="save-error" role="alert">{submitError}</p>
    {/if}

    <div class="footer">
      <div class="footer-actions">
        <GradientButton disabled={submitting} onclick={onclose}>Cancel</GradientButton>
        <GradientButton active disabled={!canSubmit} onclick={handleSubmit}>
          {submitting ? 'Adding…' : 'Add'}
        </GradientButton>
      </div>
    </div>
  </div>
</Modal>

<style>
  /* Matches TransactionEditModal's .modal-body exactly */
  .modal-body {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    min-width: 460px;
  }

  /* ---- Header row: date + description ---- */
  .header-row {
    display: flex;
    align-items: baseline;
    gap: var(--sp-md);
  }

  :global(.desc-input::placeholder) {
    font-weight: var(--weight-normal);
    color: var(--color-text-muted);
  }

  /* ---- Postings list — identical grid to TransactionEditModal ---- */
  .postings {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .posting-row {
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    align-items: center;
    gap: var(--sp-xs);
    padding: 2px 0;
  }

  .posting-account-cell {
    min-width: 0;
  }


  /* ---- Delete + add posting buttons — same as TransactionEditModal ---- */
  .delete-btn {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0 var(--sp-xs);
    line-height: 1;
    height: 20px;
    outline: none;
    transition: color var(--duration-fast) var(--ease);
  }

  .delete-btn:hover:not(:disabled) {
    color: var(--color-danger);
  }

  .delete-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .delete-btn:focus-visible {
    outline: 1px dotted var(--color-text);
    outline-offset: 1px;
  }

  .add-posting-btn {
    align-self: flex-start;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
    outline: none;
    transition: color var(--duration-fast) var(--ease);
  }

  .add-posting-btn:hover {
    color: var(--color-text);
  }

  .add-posting-btn:focus-visible {
    outline: 1px dotted var(--color-text);
    outline-offset: 2px;
  }

  /* ---- Divider + balance — copied verbatim from TransactionEditModal ---- */
  .divider {
    border: none;
    border-top: 1px solid var(--color-divider);
    margin: 0;
  }

  .balance-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .balance-label {
    color: var(--color-text-muted);
  }

  .balance-ok {
    color: var(--color-success);
  }

  .balance-errors {
    display: flex;
    gap: var(--sp-sm);
  }

  .balance-bad {
    color: var(--color-danger);
  }

  /* ---- FX rate hint ---- */
  .fx-hints {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .fx-hint {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .fx-unavailable {
    font-family: var(--font-sans);
    font-style: italic;
  }

  .fx-loading {
    font-family: var(--font-sans);
    font-style: italic;
  }

  /* ---- Footer ---- */
  .save-error {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-danger);
    margin: 0;
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    padding-top: var(--sp-xs);
    border-top: 1px solid var(--color-divider);
  }

  .footer-actions {
    display: flex;
    gap: var(--sp-sm);
  }
</style>
