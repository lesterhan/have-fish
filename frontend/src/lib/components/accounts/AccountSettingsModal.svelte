<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import {
    updateAccount,
    type Account,
    type AccountType,
    type StoredAccountType,
  } from '$lib/api'
  import { SUPPORTED_CURRENCIES, currencyFlag } from '$lib/currency'
  import Modal from '../ui/Modal.svelte'
  import GradientButton from '../ui/GradientButton.svelte'
  import TextInput from '../ui/TextInput.svelte'
  import Select from '../ui/Select.svelte'
  import Toggle from '../ui/Toggle.svelte'
  import SettingRow from './SettingRow.svelte'
  import { SaveTracker, type SaveState } from './saveState'

  interface Props {
    open: boolean
    account: Account
    /** Whether the account is hidden from the sidebar — lives in user settings, not the account. */
    hidden: boolean
    /** The user-level currency an account with no pin of its own falls back to. */
    preferredCurrency: string
    onupdated: (account: Account) => void
    /** Flips sidebar visibility. Must reject if the write fails, or the row cannot report it. */
    ontogglehidden: () => Promise<void>
  }

  let {
    open = $bindable(),
    account,
    hidden,
    preferredCurrency,
    onupdated,
    ontogglehidden,
  }: Props = $props()

  // --- display name ---------------------------------------------------------------
  // The one free-text control here, and the only one with no natural commit event. A
  // select fires `change` when you pick and a toggle fires when you flip; typing fires
  // nothing that means "I meant that". Blur was the obvious proxy and a poor one — it
  // fires on tab-away and on switching windows, and it does not fire on Escape, so
  // dismissing the modal had to chase the edit down separately.
  //
  // So this one commits explicitly: Enter, or the Save that appears once the field
  // differs from the server. Closing discards, which is honest rather than lossy —
  // an uncommitted edit is one the user was being shown an unclicked Save for.

  let nameValue = $state(untrack(() => account.name ?? ''))
  let nameState = $state<SaveState>({ status: 'idle' })

  const nameSaver = new SaveTracker({
    fallbackMessage: 'Could not save the name',
    onchange: (s) => (nameState = s),
  })

  $effect(() => {
    nameValue = account.name ?? ''
  })

  let nameDirty = $derived(nameValue.trim() !== (account.name ?? ''))
  let nameSaving = $derived(nameState.status === 'saving')

  async function saveName() {
    if (!nameDirty || nameSaving) return
    const next = nameValue.trim()
    const outcome = await nameSaver.run(() =>
      updateAccount(account.id, { name: next || null }),
    )
    if (outcome.status === 'saved') onupdated(outcome.value)
  }

  function handleNameKeydown(e: KeyboardEvent) {
    // Escape is left alone so it reaches the modal, which closes and discards.
    if (e.key === 'Enter') saveName()
  }

  // --- hledger account type -------------------------------------------------------
  // The stored override, or '' for "Auto", which falls back to path inference. Order
  // matches hledger's. Cash and Conversion are override-only — inference never yields them.

  const TYPE_LABELS: Record<StoredAccountType, string> = {
    asset: 'Asset',
    cash: 'Cash',
    liability: 'Liability',
    equity: 'Equity',
    income: 'Income',
    expense: 'Expense',
    conversion: 'Conversion',
  }
  const TYPE_OPTIONS = Object.keys(TYPE_LABELS) as StoredAccountType[]

  let typeValue = $state(untrack(() => account.type ?? ''))
  let typeState = $state<SaveState>({ status: 'idle' })

  const typeSaver = new SaveTracker({
    fallbackMessage: 'Could not save the type',
    onchange: (s) => (typeState = s),
  })

  $effect(() => {
    typeValue = account.type ?? ''
  })

  // What inference would pick, so "Auto" is not a blind choice. An atypical root infers to
  // nothing.
  const inferredLabel = $derived(
    account.inferredType
      ? TYPE_LABELS[account.inferredType as AccountType]
      : 'unclassified',
  )

  async function saveType() {
    const next = typeValue === '' ? null : (typeValue as StoredAccountType)
    const outcome = await typeSaver.run(() =>
      updateAccount(account.id, { type: next }),
    )
    if (outcome.status === 'saved') onupdated(outcome.value)
  }

  // --- sidebar visibility ---------------------------------------------------------

  let showInSidebar = $state(untrack(() => !hidden))
  let visibilityState = $state<SaveState>({ status: 'idle' })

  const visibilitySaver = new SaveTracker({
    fallbackMessage: 'Could not save sidebar visibility',
    onchange: (s) => (visibilityState = s),
  })

  $effect(() => {
    showInSidebar = !hidden
  })

  async function saveVisibility() {
    const outcome = await visibilitySaver.run(ontogglehidden)
    // `hidden` has not moved if the write failed, so this puts the switch back where the
    // server still has it rather than leaving a lie on screen.
    if (outcome.status === 'error') showInSidebar = !hidden
  }

  // --- default currency -----------------------------------------------------------
  // Until now this was reachable only from Quick Entry's currency dropdown, or at account
  // creation — so an account you never opened Quick Entry on had no way to change it.
  //
  // '' is null: no pin, fall back to the user's preferred currency. Same shape as the type
  // row's "Auto", and the reason this is a select rather than the Quick Entry combobox —
  // a free-text currency box cannot express "unset" without treating a blank as an error.

  let currencyValue = $state(untrack(() => account.defaultCurrency ?? ''))
  let currencyState = $state<SaveState>({ status: 'idle' })

  const currencySaver = new SaveTracker({
    fallbackMessage: 'Could not save the currency',
    onchange: (s) => (currencyState = s),
  })

  $effect(() => {
    currencyValue = account.defaultCurrency ?? ''
  })

  async function saveCurrency() {
    const next = currencyValue === '' ? null : currencyValue
    const outcome = await currencySaver.run(() =>
      updateAccount(account.id, { defaultCurrency: next }),
    )
    if (outcome.status === 'saved') onupdated(outcome.value)
  }

  // --- lifecycle ------------------------------------------------------------------

  $effect(() => {
    if (!open) return
    // Reopening resyncs every control from the server, so a standing error from the last
    // visit would sit beside a value that is now correct.
    untrack(() => {
      nameSaver.reset()
      typeSaver.reset()
      currencySaver.reset()
      visibilitySaver.reset()
    })
  })

  /**
   * Closing by any route — Escape, the title bar's ✕, the backdrop, the footer button —
   * drops an uncommitted name, so reopening shows what the server actually holds rather
   * than an edit from some earlier visit that nothing on screen would explain.
   */
  function handleClose() {
    nameValue = account.name ?? ''
  }

  // Modal only fires `onclose` for the routes it owns, so the footer button has to do
  // both halves itself. `handleClose` is idempotent, so an overlap would be harmless.
  function closeModal() {
    open = false
    handleClose()
  }

  onDestroy(() => {
    nameSaver.cancel()
    typeSaver.cancel()
    currencySaver.cancel()
    visibilitySaver.cancel()
  })
</script>

<Modal bind:open title="Account settings" onclose={handleClose}>
  <div class="settings">
    <p class="account-path" title={account.path}>{account.path}</p>

    <section class="group">
      <h3 class="group-title">Identity</h3>

      <!-- No `onretry`: the Save button is still on screen after a failure, so a second
           retry affordance beside it would be one button too many. -->
      <SettingRow
        label="Display name"
        hint="Shown instead of the path. Blank falls back to the path."
        controlId="setting-account-name"
        state={nameState}
      >
        <TextInput
          id="setting-account-name"
          bind:value={nameValue}
          placeholder={account.path}
          onkeydown={handleNameKeydown}
          style="width: 15rem; max-width: 100%"
        />
        {#if nameDirty}
          <GradientButton size="sm" onclick={saveName} disabled={nameSaving}>
            Save
          </GradientButton>
        {/if}
      </SettingRow>

      <SettingRow
        label="Type"
        hint="Used on hledger export. Auto infers it from the path."
        controlId="setting-account-type"
        state={typeState}
        onretry={saveType}
      >
        <Select
          id="setting-account-type"
          bind:value={typeValue}
          onchange={saveType}
        >
          <option value="">Auto (inferred: {inferredLabel})</option>
          {#each TYPE_OPTIONS as t}
            <option value={t}>{TYPE_LABELS[t]}</option>
          {/each}
        </Select>
      </SettingRow>
    </section>

    <!-- "Preferences", not "Display": both rows are choices about how the app treats this
         account rather than facts about it, and a currency that pre-selects on entry is not
         a display concern. -->
    <section class="group">
      <h3 class="group-title">Preferences</h3>

      <SettingRow
        label="Default currency"
        hint="Pre-selects the currency when you add a transaction here."
        controlId="setting-account-currency"
        state={currencyState}
        onretry={saveCurrency}
      >
        <Select
          id="setting-account-currency"
          bind:value={currencyValue}
          onchange={saveCurrency}
        >
          <option value="">Default ({preferredCurrency})</option>
          {#each SUPPORTED_CURRENCIES as code}
            <option value={code}>{currencyFlag(code)} {code}</option>
          {/each}
        </Select>
      </SettingRow>

      <SettingRow
        label="Show in sidebar"
        hint="Hidden accounts stay reachable from Accounts."
        state={visibilityState}
        onretry={saveVisibility}
      >
        {#snippet children(labelId)}
          <!-- Toggle wraps its own label element, so it is associated by id rather than
               by the row's `<label for>`. -->
          <Toggle
            bind:checked={showInSidebar}
            onchange={saveVisibility}
            aria-labelledby={labelId}
          />
        {/snippet}
      </SettingRow>
    </section>

    <div class="footer">
      {#if nameDirty}
        <!-- Named at the point of action: this is the click that throws the edit away.
             Scoped to the name, because the other two rows are already on the server —
             a blanket "Discard" would promise to undo a type change it cannot touch. -->
        <span class="unsaved">Closing discards the unsaved name.</span>
      {/if}
      <GradientButton variant="primary" size="lg" onclick={closeModal}>
        Close
      </GradientButton>
    </div>
  </div>
</Modal>

<style>
  .settings {
    /* Wide enough that a server error message sits beside its control rather than
       ellipsizing on the first word; shrinks on a narrow screen. */
    width: min(36rem, calc(100vw - 5rem));
  }

  .account-path {
    margin: 0 0 var(--sp-md);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .group + .group {
    margin-top: var(--sp-md);
  }

  .footer {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    justify-content: flex-end;
    margin-top: var(--sp-lg);
    padding-top: var(--sp-sm);
    border-top: 1px solid var(--color-divider);
  }

  .unsaved {
    margin-right: auto;
    font-size: 11px;
    color: var(--color-text-muted);
  }

  .group-title {
    margin: 0 0 var(--sp-xs);
    padding-bottom: 3px;
    border-bottom: 1px solid var(--color-rule-soft);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: var(--weight-semibold);
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }
</style>
