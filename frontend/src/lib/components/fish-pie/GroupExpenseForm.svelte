<script lang="ts">
  import { untrack } from 'svelte'
  import type { GroupMember, GroupExpense } from '$lib/api'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import { initials } from './utils'

  interface CreateExpenseData {
    description: string
    amount: string
    currency: string
    date: string
    paidByUserId: string
  }

  interface Props {
    members: GroupMember[]
    currentUserId: string
    defaultCurrency: string
    initialSliderPct: number
    groupId: string
    myExpenseAccountPath: string | null
    onCreate: (data: CreateExpenseData) => Promise<GroupExpense>
    onSliderChange: (pct: number) => Promise<void>
  }

  let {
    members,
    currentUserId,
    defaultCurrency,
    initialSliderPct,
    groupId,
    myExpenseAccountPath,
    onCreate,
    onSliderChange,
  }: Props = $props()

  let desc = $state('')
  let amount = $state('')
  let currency = $state(untrack(() => defaultCurrency))
  const today = new Date().toISOString().slice(0, 10)
  let date = $state(today)
  let paidBy = $state(untrack(() => currentUserId))
  let error = $state('')
  let submitting = $state(false)
  let added = $state(false)

  let shareSliderPct = $state(untrack(() => initialSliderPct))
  let sliderSaving = $state(false)

  let dateInputEl = $state<HTMLInputElement | null>(null)

  const dateLabel = $derived(
    date === today
      ? 'Today'
      : new Date(date + 'T00:00:00').toLocaleDateString('en-CA', {
          month: 'short',
          day: 'numeric',
        }),
  )

  function openDatePicker() {
    ;(dateInputEl as any)?.showPicker?.()
    dateInputEl?.focus()
  }

  async function handleAdd() {
    if (!amount || parseFloat(amount) <= 0 || submitting) return
    error = ''
    submitting = true
    try {
      await onCreate({
        description: desc.trim() || 'Expense',
        amount,
        currency: currency.trim().toUpperCase(),
        date,
        paidByUserId: paidBy || currentUserId,
      })
      desc = ''
      amount = ''
      added = true
      setTimeout(() => {
        added = false
      }, 1200)
    } catch (e: any) {
      error = e.message ?? 'Failed to add expense'
    } finally {
      submitting = false
    }
  }

  async function handleSliderChange() {
    if (sliderSaving) return
    sliderSaving = true
    try {
      await onSliderChange(shareSliderPct)
    } finally {
      sliderSaving = false
    }
  }
</script>

<div class="section-bar">
  <span class="section-bar-title">Add Expense</span>
</div>

<div class="expense-form-wrap">
  <div class="field">
    <span class="field-label">Description</span>
    <TextInput
      bind:value={desc}
      placeholder="What was this for?"
      class="fill-input"
    />
  </div>

  <div class="amount-row">
    <div class="field field-amount">
      <span class="field-label">Amount</span>
      <TextInput
        bind:value={amount}
        placeholder="0.00"
        type="number"
        min="0"
        step="0.01"
        class="fill-input amount-text"
      />
    </div>
  </div>

  <div class="date-chip-outer">
    <div class="field">
      <div class="date-chip-wrap">
        <button class="date-chip" onclick={openDatePicker}>
          <span class="date-chip-icon"><Icon name="calendar" /></span>
          <span class="date-chip-label">{dateLabel}</span>
          <Icon name="chevron-down-line" size={10} />
        </button>
        <input
          bind:this={dateInputEl}
          type="date"
          class="date-input-hidden"
          bind:value={date}
        />
      </div>
    </div>
  </div>

  <div class="field">
    <span class="field-label">Paid by</span>
    <div class="payer-chips">
      {#each members as m, i (m.id)}
        {@const pct =
          i === 0
            ? Math.round(shareSliderPct)
            : Math.round(100 - shareSliderPct)}
        {@const selected = paidBy === m.userId}
        <button
          class="payer-chip"
          class:selected
          onclick={() => (paidBy = m.userId)}
        >
          <div class="chip-avatar" class:selected>
            {initials(m.userName)}
          </div>
          <div class="chip-info">
            <span class="chip-name">{m.userName}</span>
            <span class="chip-share">{pct}% share</span>
          </div>
        </button>
      {/each}
    </div>
  </div>

  <div class="share-slider-wrap">
    <div class="share-slider-labels">
      <span class="share-slider-name">{members[0].userName}</span>
      <span class="share-slider-pcts">
        <span>{Math.round(shareSliderPct)}%</span>
        <span class="share-slider-divider">/</span>
        <span>{Math.round(100 - shareSliderPct)}%</span>
      </span>
      <span class="share-slider-name share-slider-name--right"
        >{members[1].userName}</span
      >
    </div>
    <input
      type="range"
      class="share-slider-track"
      min="1"
      max="99"
      step="1"
      bind:value={shareSliderPct}
      onchange={handleSliderChange}
    />
  </div>

  <div class="add-cta">
    <GradientButton
      active={added}
      onclick={handleAdd}
      disabled={submitting || !amount || parseFloat(amount) <= 0}
    >
      {added ? '✓ Added' : 'Add Expense'}
    </GradientButton>
  </div>

  <p class="expense-account-hint">
    Posting to <span class="hint-account">{myExpenseAccountPath ?? 'uncategorized'}</span>
    · <a href="/fish-pie/{groupId}/settings" class="hint-link">Change</a>
  </p>

  {#if error}
    <span class="form-error">{error}</span>
  {/if}
</div>

<style>
  .section-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 14px;
    background: var(--color-section-bar-bg);
    color: var(--color-section-bar-fg);
    border-top: 1px solid var(--color-section-bar-border-top);
    border-bottom: 1px solid var(--color-section-bar-border-bottom);
  }

  .section-bar-title {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
  }

  .expense-form-wrap {
    background: var(--color-window);
    padding: 12px 22px;
    border-bottom: 1px solid var(--color-rule);
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field-label {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .expense-form-wrap :global(.fill-input) {
    width: 100%;
    box-sizing: border-box;
  }

  .amount-row {
    display: flex;
    align-items: flex-end;
  }

  .field-amount {
    flex: 1;
    min-width: 0;
  }

  .expense-form-wrap :global(.amount-text) {
    font-family: var(--font-mono);
    font-size: var(--text-2xl);
    height: 64px;
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-xl);
  }

  .date-chip-outer {
    display: flex;
  }

  .date-chip-wrap {
    position: relative;
  }

  .date-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    background: linear-gradient(
      180deg,
      var(--color-btn-gradient-hi),
      var(--color-rule-soft)
    );
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-xl);
    cursor: pointer;
    color: var(--color-text);
    white-space: nowrap;
    transition: border-color var(--duration-fast) var(--ease);
  }

  .date-chip:hover {
    border-color: var(--color-accent);
  }

  .date-chip-icon {
    font-size: 12px;
    line-height: 1;
  }

  .date-chip-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 700;
  }

  .date-input-hidden {
    position: absolute;
    opacity: 0;
    pointer-events: none;
    width: 0;
    height: 0;
    top: 0;
    left: 0;
  }

  .payer-chips {
    display: flex;
    gap: var(--sp-xs);
    flex-wrap: wrap;
  }

  .payer-chip {
    flex: 1;
    min-width: 100px;
    padding: 8px 12px;
    background: linear-gradient(
      180deg,
      var(--color-btn-gradient-hi),
      var(--color-rule-soft)
    );
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-xl);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    transition:
      background var(--duration-fast) var(--ease),
      border-color var(--duration-fast) var(--ease),
      box-shadow var(--duration-fast) var(--ease);
  }

  .payer-chip:hover:not(.selected) {
    background: linear-gradient(
      180deg,
      var(--color-btn-gradient-hi),
      var(--color-accent-chip-bg)
    );
    border-color: var(--color-accent);
  }

  .payer-chip.selected {
    background: linear-gradient(
      180deg,
      var(--color-accent),
      color-mix(in srgb, var(--color-accent) 80%, black)
    );
    border-color: var(--color-accent);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.25);
  }

  .chip-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--color-window-inset);
    border: 1px solid var(--color-border);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: 8px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition:
      background var(--duration-fast) var(--ease),
      color var(--duration-fast) var(--ease),
      border-color var(--duration-fast) var(--ease);
  }

  .chip-avatar.selected {
    background: color-mix(in srgb, var(--color-accent-fg) 25%, transparent);
    border-color: color-mix(in srgb, var(--color-accent-fg) 50%, transparent);
    color: var(--color-accent-fg);
  }

  .chip-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    text-align: left;
    min-width: 0;
  }

  .chip-name {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color var(--duration-fast) var(--ease);
  }

  .payer-chip.selected .chip-name {
    color: var(--color-btn-gradient-hi);
  }

  .chip-share {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--color-text-muted);
    transition: color var(--duration-fast) var(--ease);
  }

  .payer-chip.selected .chip-share {
    color: color-mix(in srgb, var(--color-accent-fg) 65%, transparent);
  }

  .share-slider-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .share-slider-labels {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--color-text-muted);
  }

  .share-slider-name {
    width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .share-slider-name--right {
    text-align: right;
  }

  .share-slider-pcts {
    display: flex;
    align-items: center;
    gap: 3px;
    font-weight: 700;
    color: var(--color-text);
  }

  .share-slider-divider {
    color: var(--color-text-muted);
    font-weight: 400;
  }

  .share-slider-track {
    width: 100%;
    cursor: pointer;
    accent-color: var(--color-accent);
  }

  .add-cta :global(.btn) {
    width: 100%;
    height: 36px;
    font-size: var(--text-sm);
  }

  .expense-account-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    margin: 0;
  }

  .hint-account {
    color: var(--color-text);
    font-weight: 700;
  }

  .hint-link {
    color: var(--color-accent-mid);
    text-decoration: none;
  }

  .hint-link:hover {
    text-decoration: underline;
  }

  .form-error {
    font-size: var(--text-xs);
    color: var(--color-amount-negative);
    font-family: var(--font-sans);
    display: block;
  }

  @media (max-width: 600px) {
    .expense-form-wrap {
      padding: 10px 14px;
    }

    .amount-row {
      flex-wrap: wrap;
    }

    .payer-chips {
      gap: var(--sp-xs);
    }

    .payer-chip {
      min-width: 80px;
    }
  }
</style>
