<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import {
    updateAccount,
    type Account,
    type AccountType,
    type StoredAccountType,
  } from '$lib/api'
  import { toast } from '$lib/toast.svelte'
  import Modal from '../ui/Modal.svelte'
  import TextInput from '../ui/TextInput.svelte'
  import Select from '../ui/Select.svelte'
  import Toggle from '../ui/Toggle.svelte'
  import SettingRow from './SettingRow.svelte'
  import { SaveTracker, type SaveOutcome, type SaveState } from './saveState'

  interface Props {
    open: boolean
    account: Account
    /** Whether the account is hidden from the sidebar — lives in user settings, not the account. */
    hidden: boolean
    onupdated: (account: Account) => void
    /** Flips sidebar visibility. Must reject if the write fails, or the row cannot report it. */
    ontogglehidden: () => Promise<void>
  }

  let {
    open = $bindable(),
    account,
    hidden,
    onupdated,
    ontogglehidden,
  }: Props = $props()

  // --- display name ---------------------------------------------------------------
  // Commits on blur and on Enter. There is no Escape-to-revert any more: in a modal
  // Escape means close, and two meanings for one key is worse than losing a revert that
  // immediate save makes redundant.

  let nameValue = $state(untrack(() => account.name ?? ''))
  let nameState = $state<SaveState>({ status: 'idle' })
  /** The value currently in flight, so blur-then-close does not PATCH the same name twice. */
  let inFlightName: string | null = null

  const nameSaver = new SaveTracker({
    fallbackMessage: 'Could not save the name',
    onchange: (s) => (nameState = s),
  })

  $effect(() => {
    nameValue = account.name ?? ''
  })

  async function saveName(): Promise<SaveOutcome<Account> | null> {
    const next = nameValue.trim()
    if (next === (account.name ?? '') || next === inFlightName) return null

    inFlightName = next
    const outcome = await nameSaver.run(() =>
      updateAccount(account.id, { name: next || null }),
    )
    inFlightName = null
    if (outcome.status === 'saved') onupdated(outcome.value)
    return outcome
  }

  function handleNameKeydown(e: KeyboardEvent) {
    // Escape is left alone so it reaches the modal and closes it.
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

  // --- lifecycle ------------------------------------------------------------------

  $effect(() => {
    if (!open) return
    // Reopening resyncs every control from the server, so a standing error from the last
    // visit would sit beside a value that is now correct.
    untrack(() => {
      // The name keeps its error when the edit is still unsaved — that is not stale
      // history, it is the reason the box does not match the server.
      if (nameValue.trim() === (account.name ?? '')) nameSaver.reset()
      typeSaver.reset()
      visibilitySaver.reset()
    })
  })

  /**
   * Closing by any route — Escape, the close button, the backdrop — commits a name the
   * user typed but never blurred, so a rename typed and then dismissed is not lost.
   *
   * The row is gone by the time the request lands, so a failure has nowhere to be shown
   * but the status bar.
   */
  async function handleClose() {
    const outcome = await saveName()
    if (outcome?.status === 'error') {
      toast.show(`Name not saved: ${outcome.message}`)
    }
  }

  onDestroy(() => {
    nameSaver.cancel()
    typeSaver.cancel()
    visibilitySaver.cancel()
  })
</script>

<Modal bind:open title="Account settings" onclose={handleClose}>
  <div class="settings">
    <p class="account-path" title={account.path}>{account.path}</p>

    <section class="group">
      <h3 class="group-title">Identity</h3>

      <SettingRow
        label="Display name"
        hint="Shown instead of the path. Blank falls back to the path."
        controlId="setting-account-name"
        state={nameState}
        onretry={saveName}
      >
        <TextInput
          id="setting-account-name"
          bind:value={nameValue}
          placeholder={account.path}
          onblur={saveName}
          onkeydown={handleNameKeydown}
          style="width: 15rem; max-width: 100%"
        />
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

    <section class="group">
      <h3 class="group-title">Display</h3>

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
