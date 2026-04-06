<script lang="ts">
  import { updateAccount, type Account } from '$lib/api'
  import { tooltip } from '$lib/tooltip'

  interface Props {
    account: Account
    onupdated: (account: Account) => void
    hidden?: boolean
    ontogglehidden?: () => void
    balances?: { currency: string; amount: string }[]
  }

  let { account, onupdated, hidden = false, ontogglehidden, balances }: Props = $props()

  let editing = $state(false)
  let inputValue = $state('')
  let saving = $state(false)
  let inputEl = $state<HTMLInputElement | undefined>(undefined)

  $effect(() => {
    if (editing) inputEl?.focus()
  })

  function startEditing() {
    inputValue = account.name ?? ''
    editing = true
  }

  let saveOnBlur = true

  async function save() {
    if (saving) return
    saving = true
    try {
      const name = inputValue.trim() || null
      const updated = await updateAccount(account.id, { name })
      onupdated(updated)
    } finally {
      saving = false
      editing = false
    }
  }

  function cancel() {
    editing = false
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      saveOnBlur = false
      save()
    } else if (e.key === 'Escape') {
      saveOnBlur = false
      cancel()
    }
  }

  function handleBlur() {
    if (saveOnBlur) save()
    saveOnBlur = true
  }

  function formatAmount(amount: string): string {
    const n = parseFloat(amount)
    if (isNaN(n)) return amount
    return new Intl.NumberFormat('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n))
  }

  function isNegative(amount: string): boolean {
    return parseFloat(amount) < 0
  }
</script>

<header class="account-header">
  <div class="header-left">
    {#if editing}
      <input
        bind:this={inputEl}
        bind:value={inputValue}
        class="name-input"
        placeholder={account.path}
        disabled={saving}
        onkeydown={handleKeydown}
        onblur={handleBlur}
        aria-label="Account name"
      />
    {:else}
      <h1 class="account-name">
        {account.name ?? account.path}
      </h1>
    {/if}
    <p class="account-path">{account.path}</p>
  </div>

  <div class="header-right">
    <div class="header-actions">
      <button
        class="action-btn"
        use:tooltip={account.name ? 'Change account name' : 'Add an account name'}
        onclick={startEditing}
        aria-label={account.name ? 'Edit account name' : 'Add account name'}
      >
        Rename
      </button>
      {#if ontogglehidden}
        <button
          class="action-btn"
          class:is-hidden={hidden}
          use:tooltip={hidden ? 'Show in sidebar' : 'Hide from sidebar'}
          onclick={ontogglehidden}
          aria-label={hidden ? 'Show account in sidebar' : 'Hide account from sidebar'}
        >
          {hidden ? 'Show' : 'Hide'}
        </button>
      {/if}
    </div>

    {#if balances && balances.length > 0}
      <div class="balance-block">
        <span class="balance-label">Current Balance</span>
        <div class="balance-amounts">
          {#each balances as b}
            <span class="balance-amount" class:negative={isNegative(b.amount)}>
              {isNegative(b.amount) ? '−' : ''}{formatAmount(b.amount)}
              <span class="balance-currency">{b.currency}</span>
            </span>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</header>

<style>
  .account-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    padding: var(--sp-lg) var(--sp-xl);
    margin-bottom: var(--sp-xl);
    background: var(--color-window-raised);
    border-left: 4px solid var(--color-accent);
    border-bottom: 1px solid var(--color-border);
    gap: var(--sp-xl);
  }

  /* --- Left: account identity --- */

  .header-left {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
    min-width: 0;
  }

  .account-name {
    font-family: var(--font-serif);
    font-size: var(--text-3xl);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
    line-height: var(--leading-tight);
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .account-path {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin: 0;
  }

  .name-input {
    font-size: var(--text-3xl);
    font-weight: var(--weight-semibold);
    font-family: var(--font-serif);
    color: var(--color-text);
    background: var(--color-window-inset);
    border: 1px solid var(--color-border);
    padding: 2px var(--sp-xs);
    width: 100%;
    outline: none;
  }

  .name-input:focus {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
  }

  /* --- Right: balance + actions --- */

  .header-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--sp-sm);
    flex-shrink: 0;
  }

  .header-actions {
    display: flex;
    gap: var(--sp-xs);
  }

  .action-btn {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--weight-normal);
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
    background: none;
    border: 1px solid transparent;
    padding: 2px var(--sp-xs);
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease), border-color var(--duration-fast) var(--ease);
  }

  .action-btn:hover {
    color: var(--color-text);
    border-color: var(--color-border);
  }

  .action-btn.is-hidden {
    color: var(--color-accent-mid);
  }

  .balance-block {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }

  .balance-label {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .balance-amounts {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }

  .balance-amount {
    font-family: var(--font-mono);
    font-size: var(--text-2xl);
    font-weight: var(--weight-semibold);
    color: var(--color-amount-positive);
    line-height: var(--leading-tight);
  }

  .balance-amount.negative {
    color: var(--color-amount-negative);
  }

  .balance-currency {
    font-size: var(--text-sm);
    font-weight: var(--weight-normal);
    opacity: 0.75;
    margin-left: 4px;
  }
</style>
