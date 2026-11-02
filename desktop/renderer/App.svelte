<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { copy } from '../copy'
  import type { ListedTransaction, Typing, WireFailure } from '../shared/commands'
  import { runAction } from './actions'
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
  import { type Field, fieldOf, wordsFor } from './refusals'
  import { afterRemoving, kept } from './selection'
  import { ariaShortcut, MAC, shortcutText } from './shortcuts'
  import SpendList from './SpendList.svelte'
  import SpendPane from './SpendPane.svelte'
  import { type Field as TextField, FieldUndo, type Way, wayOf } from './undo'

  let amount = $state('')
  let description = $state('')
  let error = $state<{ field: Field; words: string } | null>(null)
  let saving = $state(false)
  let amountInput: HTMLInputElement

  let transactions = $state.raw<ListedTransaction[]>([])
  let selectedId = $state<string | null>(null)
  let drafts = $state.raw<Drafts>(new Map())
  let savingDraft = $state(false)
  /** In a narrow window, whether the pane is over the list. */
  let open = $state(false)
  let list: SpendList
  let pane: SpendPane

  const selected = $derived(transactions.find((t) => t.id === selectedId))

  const fieldUndo = new FieldUndo()
  let told: Typing = { undo: false, redo: false }

  // Drafts are left alone: a draft is the window's until it is saved or put back.
  async function refresh() {
    const listed = await window.haveFish.invoke('transaction.list', {})
    if (listed.ok) {
      transactions = listed.value
      selectedId = kept(transactions, selectedId)
    } else error = { field: 'form', words: wordsFor(listed) }
  }

  // Main says when a batch changed the ledger; the list asks again rather than guessing.
  onMount(() => {
    amountInput.focus()
    void refresh()
    return window.haveFish.onChanged(() => void refresh())
  })

  onMount(() =>
    window.haveFish.onAction((id) => runAction(id, { newSpend, saveAll, undo, redo, remove })),
  )

  // Undo and Redo's keys are the window's: a field with your typing keeps its own undo, and
  // anything else goes to the ledger, before Chromium's undo or the menu sees the key.
  onMount(() => {
    const fieldOf = (target: EventTarget | null) => textField(target as Element | null)
    const listeners: [string, (e: Event) => void][] = [
      ['focusin', (e) => withField(fieldOf(e.target), (f) => fieldUndo.entered(f))],
      ['focusout', () => queueMicrotask(tell)],
      ['beforeinput', (e) => withField(fieldOf(e.target), (f) => fieldUndo.changing(f))],
      [
        'input',
        (e) =>
          withField(fieldOf(e.target), (f) =>
            fieldUndo.changed(f, e instanceof InputEvent ? e.inputType : ''),
          ),
      ],
      ['keydown', (e) => e instanceof KeyboardEvent && pressed(e)],
    ]
    for (const [type, listener] of listeners) addEventListener(type, listener, true)
    return () => {
      for (const [type, listener] of listeners) removeEventListener(type, listener, true)
    }
  })

  /** A text field the cursor can be in, or null. */
  function textField(el: Element | null): (TextField & HTMLElement) | null {
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null
  }

  function withField(field: TextField | null, then: (f: TextField) => void) {
    if (field !== null) then(field)
    tell()
  }

  /** Tells main where Undo and Redo would go, when that changes, so the menu names it. */
  function tell() {
    const typing = fieldUndo.typing(textField(document.activeElement))
    if (typing.undo === told.undo && typing.redo === told.redo) return
    told = typing
    window.haveFish.setTyping(typing)
  }

  function pressed(event: KeyboardEvent) {
    const way = wayOf(event, MAC)
    if (way === null || fieldUndo.typing(textField(document.activeElement))[way]) return
    event.preventDefault()
    void ledger(way)
  }

  /** From the menu: the same choice the keys make. */
  function undo() {
    takeBack('undo')
  }

  function redo() {
    takeBack('redo')
  }

  function takeBack(way: Way) {
    if (fieldUndo.typing(textField(document.activeElement))[way]) document.execCommand(way)
    else void ledger(way)
  }

  /** The ledger's undo or redo; then the list selects what came back, and focus stays put. */
  async function ledger(way: Way) {
    const moved = await window.haveFish.invoke(`ledger.${way}`, {})
    if (!moved.ok) {
      error = { field: 'form', words: wordsFor(moved) }
      return
    }
    const [first] = moved.value.ids
    if (first === undefined) return
    await refresh()
    if (transactions.some((t) => t.id === first)) selectedId = first
    tell()
  }

  // A wide window shows the pane beside the list, so there's nothing left open to cover it.
  onMount(() => {
    const narrow = matchMedia(NARROW)
    const widened = () => {
      if (!narrow.matches) open = false
    }
    narrow.addEventListener('change', widened)
    return () => narrow.removeEventListener('change', widened)
  })

  async function write(event: SubmitEvent) {
    event.preventDefault()
    if (saving) return
    saving = true
    const written = await window.haveFish.invoke('spend.write', { amount, description })
    saving = false
    if (written.ok) {
      amount = ''
      description = ''
      error = null
      fieldUndo.forget()
      await refresh()
      selectedId = written.value.id
    } else {
      error = { field: fieldOf(written), words: wordsFor(written) }
    }
    amountInput.focus()
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
      fieldUndo.forget()
      await refresh()
    }
    drafts = afterSaves(drafts, saves)
    savingDraft = false
    tell()
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

  function saveAll() {
    void saveDrafts(drafts.keys(), true)
  }

  let removing = false

  /** The selected spend, gone; selection moves to the next row, and its draft goes too. */
  async function remove() {
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
    fieldUndo.forget()
    selectedId = next
    await refresh()
    // With nothing left to show, the pane's button is gone, and the cursor with it.
    if (selectedId === null) amountInput.focus()
    tell()
  }

  /** Ctrl+N: the amount field, from anywhere, with the pane out of its way. */
  function newSpend() {
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

<svelte:head>
  <title>{copy.app.name}</title>
</svelte:head>

<main>
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
    box-sizing: border-box;
    height: 100vh;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(16rem, 24rem);
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas:
      'write pane'
      'list pane';
    gap: var(--space-6);
    padding: var(--space-4);
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

  label span {
    font-size: var(--font-size-small);
    color: var(--color-muted);
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
