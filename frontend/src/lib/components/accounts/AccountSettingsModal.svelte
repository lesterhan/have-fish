<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import {
    updateAccount,
    updateCoverageConfig,
    type Account,
    type AccountCoverage,
    type AccountType,
    type StoredAccountType,
  } from '$lib/api'
  import {
    AUTOMATIC,
    cycleDayLabel,
    exportModeLabel,
    ordinal,
    planCycleCommit,
    releaseLagLabel,
    toDayChoice,
    type ModeChoice,
  } from '../catch-up/cycleConfig'
  import { SUPPORTED_CURRENCIES, currencyFlag } from '$lib/currency'
  import Modal from '../ui/Modal.svelte'
  import GradientButton from '../ui/GradientButton.svelte'
  import TextInput from '../ui/TextInput.svelte'
  import Select from '../ui/Select.svelte'
  import Toggle from '../ui/Toggle.svelte'
  import TabStrip, { type TabItem } from '../ui/TabStrip.svelte'
  import SettingRow from './SettingRow.svelte'
  import { SaveTracker, type SaveState } from './saveState'

  interface Props {
    open: boolean
    account: Account
    /** Whether the account is hidden from the sidebar — lives in user settings, not the account. */
    hidden: boolean
    /** The user-level currency an account with no pin of its own falls back to. */
    preferredCurrency: string
    /**
     * The account's catch-up state, or null for a type the coach does not track — an expense
     * account is derived from postings, so it has no statement cycle to model. Null hides the
     * whole section rather than showing rows that could never mean anything.
     */
    coverage: AccountCoverage | null
    onupdated: (account: Account) => void
    /** Flips sidebar visibility. Must reject if the write fails, or the row cannot report it. */
    ontogglehidden: () => Promise<void>
    /** Re-reads coverage after a config write — the horizon moves, so the strip must too. */
    oncoveragechanged: () => Promise<void> | void
  }

  let {
    open = $bindable(),
    account,
    hidden,
    preferredCurrency,
    coverage,
    onupdated,
    ontogglehidden,
    oncoveragechanged,
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

  // --- catch-up cycle --------------------------------------------------------------
  // The first editing UI this model has ever had: PATCH /api/coverage/config accepts four
  // fields and, until now, the only caller in the app sent `{ tracked: false }`. A
  // mis-inferred statement cycle could be ranked lower by the coach but never corrected.
  //
  // Every control is a select over an enumerable set, so "automatic" is an option rather
  // than a blank — which is what keeps a real 0-day release lag distinct from no override
  // at all, and makes the 1–31 bounds structural instead of validated.

  const CYCLE_DAYS = Array.from({ length: 31 }, (_, i) => i + 1)
  const RELEASE_LAGS = Array.from({ length: 32 }, (_, i) => i)

  let trackedValue = $state(untrack(() => coverage?.config.tracked ?? true))
  let modeValue = $state<ModeChoice>(
    untrack(() => coverage?.override.exportMode ?? AUTOMATIC),
  )
  // Strings, because that is all a `<select>` ever yields; `toDayChoice` is the one place
  // they turn back into numbers.
  let dayValue = $state(untrack(() => selectValue(coverage?.override.cycleDay)))
  let lagValue = $state(
    untrack(() => selectValue(coverage?.override.releaseLag)),
  )

  function selectValue(pinned: number | null | undefined): string {
    return pinned == null ? AUTOMATIC : String(pinned)
  }

  let trackedState = $state<SaveState>({ status: 'idle' })
  let cycleState = $state<SaveState>({ status: 'idle' })
  let lagState = $state<SaveState>({ status: 'idle' })

  const trackedSaver = new SaveTracker({
    fallbackMessage: 'Could not save tracking',
    onchange: (s) => (trackedState = s),
  })
  const cycleSaver = new SaveTracker({
    fallbackMessage: 'Could not save the statement cycle',
    onchange: (s) => (cycleState = s),
  })
  const lagSaver = new SaveTracker({
    fallbackMessage: 'Could not save the release lag',
    onchange: (s) => (lagState = s),
  })

  $effect(() => {
    trackedValue = coverage?.config.tracked ?? true
    modeValue = coverage?.override.exportMode ?? AUTOMATIC
    dayValue = selectValue(coverage?.override.cycleDay)
    lagValue = selectValue(coverage?.override.releaseLag)
  })

  let inference = $derived({
    mode: coverage?.inferred?.exportMode ?? null,
    day: coverage?.inferred?.cycleDay ?? null,
  })

  // Keyed off the select rather than the saved config, so choosing "statement cycle" reveals
  // the day field immediately — the commit is waiting on that day, so hiding it until the
  // save lands would hide the only thing that can unblock it.
  let showsCycleFields = $derived(
    modeValue === 'cycle' ||
      (modeValue === AUTOMATIC && inference.mode === 'cycle'),
  )

  let cyclePlan = $derived(
    planCycleCommit({ mode: modeValue, day: toDayChoice(dayValue) }, inference),
  )

  async function saveCycle() {
    if (!coverage) return
    const plan = cyclePlan
    // Not an error, so it does not go in the save state: the day row is already on screen
    // carrying `plan.reason` as a note, and the commit goes out when it is answered.
    if (plan.status === 'incomplete') return
    const outcome = await cycleSaver.run(() =>
      updateCoverageConfig(coverage.accountId, plan.patch),
    )
    if (outcome.status === 'saved') await oncoveragechanged()
  }

  async function saveLag() {
    if (!coverage) return
    const choice = toDayChoice(lagValue)
    const releaseLag = choice === AUTOMATIC ? null : choice
    const outcome = await lagSaver.run(() =>
      updateCoverageConfig(coverage.accountId, { releaseLag }),
    )
    if (outcome.status === 'saved') await oncoveragechanged()
  }

  async function saveTracked() {
    if (!coverage) return
    const outcome = await trackedSaver.run(() =>
      updateCoverageConfig(coverage.accountId, { tracked: trackedValue }),
    )
    if (outcome.status === 'saved') await oncoveragechanged()
    // The server still holds the old value, so put the switch back rather than leaving a lie.
    else if (outcome.status === 'error') trackedValue = !trackedValue
  }

  // --- tabs -------------------------------------------------------------------------
  // Three sections of two to four rows each outgrew a single stacked column: the whole modal
  // ran past a 720px viewport, which is the point at which scrolling to reach a setting costs
  // more than a click to reach it.
  //
  // The catch-up tab is absent, not disabled, for an account the coach does not track — there
  // is nothing behind it to enable.

  type TabId = 'identity' | 'preferences' | 'catch-up'

  let activeTab = $state<TabId>('identity')

  // Tabs hide their panels, so an error that a stacked layout showed for free can now sit one
  // click out of sight. Each tab carries a marker for its own rows' failures.
  let tabs = $derived<TabItem[]>(
    [
      {
        id: 'identity',
        label: 'Identity',
        alert: nameState.status === 'error' || typeState.status === 'error',
      },
      {
        id: 'preferences',
        label: 'Preferences',
        alert:
          currencyState.status === 'error' ||
          visibilityState.status === 'error',
      },
      ...(coverage
        ? [
            {
              id: 'catch-up',
              label: 'Catch-up',
              alert:
                trackedState.status === 'error' ||
                cycleState.status === 'error' ||
                lagState.status === 'error',
            },
          ]
        : []),
    ].filter(Boolean) as TabItem[],
  )

  $effect(() => {
    // An account whose type changed out of the coach's reach loses the tab under its feet.
    if (!coverage && activeTab === 'catch-up') activeTab = 'identity'
  })

  // --- lifecycle ------------------------------------------------------------------

  $effect(() => {
    if (!open) return
    // Reopening resyncs every control from the server, so a standing error from the last
    // visit would sit beside a value that is now correct.
    untrack(() => {
      // Reopening starts at the front rather than wherever the last visit ended — the modal
      // resyncs everything from the server, so resuming mid-way would be resuming into state
      // that no longer necessarily holds.
      activeTab = 'identity'
      nameSaver.reset()
      typeSaver.reset()
      currencySaver.reset()
      visibilitySaver.reset()
      trackedSaver.reset()
      cycleSaver.reset()
      lagSaver.reset()
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
    trackedSaver.cancel()
    cycleSaver.cancel()
    lagSaver.cancel()
  })
</script>

<Modal bind:open title="Account settings" onclose={handleClose}>
  <div class="settings">
    <p class="account-path" title={account.path}>{account.path}</p>

    <TabStrip
      {tabs}
      bind:active={activeTab}
      label="Account settings sections"
      panelIdPrefix="account-settings"
    />

    <div
      class="panel"
      role="tabpanel"
      id={`account-settings-panel-${activeTab}`}
      aria-labelledby={`account-settings-tab-${activeTab}`}
    >
      {#if activeTab === 'identity'}
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
      {:else if activeTab === 'preferences'}
        <!-- "Preferences", not "Display": both rows are choices about how the app treats
             this account rather than facts about it, and a currency that pre-selects on
             entry is not a display concern. -->

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
      {:else if activeTab === 'catch-up' && coverage}
        <SettingRow
          label="Track this account"
          hint="Whether the coach asks you to keep this account up to date."
          state={trackedState}
          onretry={saveTracked}
        >
          {#snippet children(labelId)}
            <Toggle
              bind:checked={trackedValue}
              onchange={saveTracked}
              aria-labelledby={labelId}
            />
          {/snippet}
        </SettingRow>

        {#if trackedValue}
          <SettingRow
            label="Statements"
            hint="A card only produces data when its cycle closes; most other accounts export any range."
            controlId="setting-export-mode"
            state={cycleState}
            onretry={saveCycle}
          >
            <Select
              id="setting-export-mode"
              bind:value={modeValue}
              onchange={saveCycle}
            >
              <option value={AUTOMATIC}
                >{exportModeLabel(inference.mode)}</option
              >
              <option value="range">Any date range</option>
              <option value="cycle">Statement cycle</option>
            </Select>
          </SettingRow>

          {#if showsCycleFields}
            <SettingRow
              label="Cycle closes on"
              hint="Clamped to the last day of shorter months."
              controlId="setting-cycle-day"
              state={cycleState}
              note={cyclePlan.status === 'incomplete'
                ? cyclePlan.reason
                : undefined}
              onretry={saveCycle}
            >
              <Select
                id="setting-cycle-day"
                bind:value={dayValue}
                onchange={saveCycle}
              >
                <option value={AUTOMATIC}>{cycleDayLabel(inference.day)}</option
                >
                {#each CYCLE_DAYS as day}
                  <option value={String(day)}>{ordinal(day)}</option>
                {/each}
              </Select>
            </SettingRow>

            <SettingRow
              label="Available after"
              hint="Days between the cycle closing and the statement being downloadable."
              controlId="setting-release-lag"
              state={lagState}
              onretry={saveLag}
            >
              <Select
                id="setting-release-lag"
                bind:value={lagValue}
                onchange={saveLag}
              >
                <option value={AUTOMATIC}
                  >{releaseLagLabel(coverage.inferred?.releaseLag)}</option
                >
                {#each RELEASE_LAGS as days}
                  <option value={String(days)}>
                    {days === 0
                      ? 'Same day'
                      : `${days} ${days === 1 ? 'day' : 'days'}`}
                  </option>
                {/each}
              </Select>
            </SettingRow>
          {/if}
        {/if}
      {/if}
    </div>

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
    width: min(41rem, calc(100vw - 5rem));
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

  .panel {
    /* Held at the tallest panel's height. The window is centre-anchored, so a shorter panel
       would not just shrink the box — it would slide the tab strip up under the pointer that
       just clicked it. Catch-up showing all four rows is the tallest, and it varies within
       itself too, since the cycle rows come and go. Some empty space under a two-row tab is
       the price of a window that holds still. */
    min-height: 17rem;
    padding-top: var(--sp-sm);
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
</style>
