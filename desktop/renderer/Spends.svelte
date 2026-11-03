<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { copy } from '../copy'
  import type { ListedAccount, ListedTransaction, WireFailure } from '../shared/commands'
  import {
    afterSaves,
    type Drafts,
    type Sending,
    savedValues,
    toSend,
    type Values,
    withEdit,
    without,
  } from './drafts'
  import { NARROW } from './narrow'
  import Picker from './Picker.svelte'
  import { fromOf } from './picker'
  import { type Field, fieldOf, wordsFor } from './refusals'
  import { afterRemoving, kept } from './selection'
  import { ariaShortcut, MAC, shortcutText } from './shortcuts'
  import SpendList from './SpendList.svelte'
  import SpendPane from './SpendPane.svelte'

  type Props = {
    hidden: boolean
    /** After a save: the fields' own undo has nothing left to take back. */
    forgetTyping: () => void
  }
  let { hidden, forgetTyping }: Props = $props()

  let amount = $state('')
  let description = $state('')
  let error = $state<{ field: Field; words: string } | null>(null)
  let saving = $state(false)
  let amountInput: HTMLInputElement

  /** The accounts that can pay, and the one a spend comes out of when From is left alone. */
  let payers = $state.raw<ListedAccount[]>([])
  let assumed = $state<string | null>(null)
  let fromText = $state('')
  /** Whether From holds my choice: until a spend is written, a refresh leaves it alone. */
  let fromChosen = false
  let fromPicker: Picker

  const assumedName = $derived(payers.find((a) => a.id === assumed)?.name)
  const fromOptions = $derived(
    payers.map((a) => ({ id: a.id, name: a.name, hint: copy.accounts.kinds[a.kind] })),
  )

  let transactions = $state.raw<ListedTransaction[]>([])
  let selectedId = $state<string | null>(null)
  let drafts = $state.raw<Drafts>(new Map())
  let savingDraft = $state(false)
  /** In a narrow window, whether the pane is over the list. */
  let open = $state(false)
  let list: SpendList
  let pane: SpendPane

  const selected = $derived(transactions.find((t) => t.id === selectedId))

  // Drafts are left alone: a draft is the window's until it is saved or put back.
  async function refresh() {
    const [listed, accounts, from] = await Promise.all([
      window.haveFish.invoke('transaction.list', {}),
      window.haveFish.invoke('account.list', {}),
      window.haveFish.invoke('spend.assumedFrom', {}),
    ])
    if (listed.ok) {
      transactions = listed.value
      selectedId = kept(transactions, selectedId)
    } else error = { field: 'form', words: wordsFor(listed) }
    if (accounts.ok && from.ok) {
      payers = accounts.value
      assumed = from.value.id
      if (!fromChosen) fromText = payers.find((a) => a.id === assumed)?.name ?? ''
    } else if (!accounts.ok) error = { field: 'form', words: wordsFor(accounts) }
    else if (!from.ok) error = { field: 'form', words: wordsFor(from) }
  }

  // Main says when a batch changed the ledger; the list asks again rather than guessing.
  onMount(() => {
    amountInput.focus()
    void refresh()
    return window.haveFish.onChanged(() => void refresh())
  })

  // A wide window shows the pane beside the list, so there's nothing left open to cover it.
  onMount(() => {
    const narrow = matchMedia(NARROW)
    const widened = () => {
      if (!narrow.matches) open = false
    }
    narrow.addEventListener('change', widened)
    return () => narrow.removeEventListener('change', widened)
  })

  /** Coming here from another place: the list, or the amount field while there's nothing in it. */
  export function focus() {
    if (transactions.length > 0) list.focus()
    else amountInput.focus()
  }

  /** After an undo or redo: the list as it is now, with the spend that came back selected. */
  export async function show(id: string) {
    await refresh()
    if (transactions.some((t) => t.id === id)) selectedId = id
  }

  /** An undo or redo refused while this place is showing. */
  export function refused(words: string) {
    error = { field: 'form', words }
  }

  async function write(event: SubmitEvent) {
    event.preventDefault()
    if (saving) return
    const from = fromOf(payers, fromText)
    if (from === undefined) {
      error = { field: 'from', words: copy.spends.write.notMine }
      fromPicker.focus()
      return
    }
    saving = true
    const written = await window.haveFish.invoke('spend.write', { amount, description, from })
    saving = false
    if (written.ok) {
      amount = ''
      description = ''
      error = null
      // From stays on the account that paid: it's the one used last now.
      fromChosen = false
      forgetTyping()
      await refresh()
      selectedId = written.value.id
    } else {
      error = { field: fieldOf(written), words: wordsFor(written) }
    }
    if (error?.field === 'from') fromPicker.focus()
    else amountInput.focus()
  }

  function edit(field: keyof Values, value: string) {
    const saved = selected && savedValues(selected)
    if (selected === undefined || !saved) return
    drafts = withEdit(drafts, selected.id, saved, field, value)
  }

  function revert() {
    if (selectedId !== null) drafts = without(drafts, selectedId)
  }

  /** Each draft is its own batch, so one that's refused doesn't hold back the rest. */
  async function saveDrafts(ids: Iterable<string>, all: boolean) {
    const sending = toSend(drafts, ids)
    if (sending.length === 0 || savingDraft) return
    savingDraft = true
    const saves = await (all ? sentAll(sending) : sentOne(sending))
    // The list first, so the pane never shows the old values in between.
    if (saves.some((s) => s.error === null)) {
      forgetTyping()
      await refresh()
    }
    drafts = afterSaves(drafts, saves)
    savingDraft = false
  }

  const refusedFor = (refused: WireFailure | null) =>
    refused && { field: fieldOf(refused), words: wordsFor(refused) }

  /** The pane's Save: the spend showing, as its own step. */
  async function sentOne(sending: Sending[]) {
    return Promise.all(
      sending.map(async (s) => {
        const saved = await window.haveFish.invoke('spend.edit', { id: s.id, ...s.sent })
        return { ...s, error: refusedFor(saved.ok ? null : saved) }
      }),
    )
  }

  /** Ctrl+S's drafts go as one command, so undo takes them back as one step. */
  async function sentAll(sending: Sending[]) {
    const edits = sending.map(({ id, sent }) => ({ id, ...sent }))
    const saved = await window.haveFish.invoke('spend.saveAll', { edits })
    if (!saved.ok) return sending.map((s) => ({ ...s, error: refusedFor(saved) }))
    return sending.map((s, i) => ({ ...s, error: refusedFor(saved.value[i]?.refused ?? null) }))
  }

  function save() {
    if (selectedId !== null) void saveDrafts([selectedId], false)
  }

  export function saveAll() {
    void saveDrafts(drafts.keys(), true)
  }

  let removing = false

  /** The selected spend, gone; selection moves to the next row, and its draft goes too. */
  export async function remove() {
    const id = selectedId
    if (id === null || removing) return
    removing = true
    const next = afterRemoving(transactions, id)
    const removed = await window.haveFish.invoke('spend.remove', { id })
    removing = false
    if (!removed.ok) {
      error = { field: 'form', words: wordsFor(removed) }
      return
    }
    drafts = without(drafts, id)
    selectedId = next
    forgetTyping()
    await refresh()
    // With nothing left to show, the pane's button is gone, and the cursor with it.
    if (selectedId === null) amountInput.focus()
  }

  /** Ctrl+N: the amount field, with the pane out of its way. */
  export function newSpend() {
    open = false
    amountInput.focus()
  }

  async function openPane(focus: boolean) {
    open = matchMedia(NARROW).matches
    if (!focus) return
    await tick()
    pane.focus()
  }

  function closePane() {
    open = false
    list.focus()
  }
</script>

<main class="spends" {hidden}>
  <form class="write" aria-label={copy.spends.write.label} onsubmit={write} novalidate>
    <label>
      <span>
        {copy.spends.write.amount}
        <kbd aria-hidden="true">{shortcutText('newSpend', MAC)}</kbd>
      </span>
      <input
        bind:this={amountInput}
        aria-keyshortcuts={ariaShortcut('newSpend', MAC)}
        bind:value={amount}
        name="amount"
        inputmode="decimal"
        autocomplete="off"
        maxlength="64"
        aria-invalid={error?.field === 'amount'}
        aria-describedby={error?.field === 'amount' ? 'amount-error' : undefined}
      />
    </label>
    {#if error?.field === 'amount'}
      <p class="error" id="amount-error" role="alert">{error.words}</p>
    {/if}

    <label>
      <span>{copy.spends.write.description}</span>
      <input
        bind:value={description}
        name="description"
        autocomplete="off"
        maxlength="500"
        aria-invalid={error?.field === 'description'}
        aria-describedby={error?.field === 'description' ? 'description-error' : undefined}
      />
    </label>
    {#if error?.field === 'description'}
      <p class="error" id="description-error" role="alert">{error.words}</p>
    {/if}

    <span class="field">
      <label for="write-from">{copy.spends.write.from}</label>
      <Picker
        bind:this={fromPicker}
        id="write-from"
        name="from"
        options={fromOptions}
        bind:text={fromText}
        placeholder={assumedName ?? copy.spends.write.wallet}
        listLabel={copy.spends.write.fromList}
        invalid={error?.field === 'from'}
        describedby={error?.field === 'from' ? 'from-error' : undefined}
        onchoose={() => (fromChosen = true)}
      />
    </span>
    {#if error?.field === 'from'}
      <p class="error" id="from-error" role="alert">{error.words}</p>
    {/if}

    <button type="submit" disabled={saving}>{copy.spends.write.submit}</button>
    {#if error?.field === 'form'}
      <p class="error" role="alert">{error.words}</p>
    {/if}
  </form>

  <SpendList
    bind:this={list}
    {transactions}
    {selectedId}
    {drafts}
    onselect={(id) => (selectedId = id)}
    onopen={openPane}
    onremove={remove}
  />

  <SpendPane
    bind:this={pane}
    transaction={selected}
    draft={selected && drafts.get(selected.id)}
    saving={savingDraft}
    {open}
    onedit={edit}
    onrevert={revert}
    onsave={save}
    onback={closePane}
    onremove={remove}
  />
</main>

<style>
  main {
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(16rem, 24rem);
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas:
      'write pane'
      'list pane';
    gap: var(--space-6);
    padding: var(--space-4);
  }

  main[hidden] {
    display: none;
  }

  /* NARROW in narrow.ts. */
  @media (max-width: 44rem) {
    main {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas:
        'write'
        'list';
    }
  }

  form {
    grid-area: write;
    display: grid;
    gap: var(--space-2);
  }

  label {
    display: grid;
    gap: var(--space-1);
  }

  label span,
  .field label {
    font-size: var(--font-size-small);
    color: var(--color-muted);
  }

  .field {
    display: grid;
    gap: var(--space-1);
  }

  kbd {
    font: inherit;
    margin-inline-start: var(--space-2);
  }

  input,
  button {
    font: inherit;
    padding: var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius);
    color: inherit;
    background: transparent;
  }

  input[name='amount'] {
    font-family: var(--font-figures);
    font-variant-numeric: tabular-nums;
  }

  input[aria-invalid='true'] {
    border-color: var(--color-error);
  }

  button {
    justify-self: start;
    cursor: pointer;
  }

  .error {
    margin: 0;
    font-size: var(--font-size-small);
    color: var(--color-error);
  }
</style>
