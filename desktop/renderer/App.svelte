<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { copy } from '../copy'
  import type { ListedTransaction } from '../shared/commands'
  import {
    afterSave,
    type Drafts,
    savedValues,
    type Values,
    withEdit,
    withError,
    without,
  } from './drafts'
  import { NARROW } from './narrow'
  import { type Field, fieldOf, wordsFor } from './refusals'
  import { kept } from './selection'
  import SpendList from './SpendList.svelte'
  import SpendPane from './SpendPane.svelte'

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

  async function save() {
    const id = selectedId
    const draft = id === null ? undefined : drafts.get(id)
    if (id === null || draft === undefined || savingDraft) return
    savingDraft = true
    const sent = { description: draft.description, amount: draft.amount }
    const saved = await window.haveFish.invoke('spend.edit', { id, ...sent })
    if (saved.ok) {
      // The list first, so the pane never shows the old values in between.
      await refresh()
      drafts = afterSave(drafts, id, sent)
    } else {
      drafts = withError(drafts, id, { field: fieldOf(saved), words: wordsFor(saved) })
    }
    savingDraft = false
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
      <span>{copy.spends.write.amount}</span>
      <input
        bind:this={amountInput}
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

  input,
  button {
    font: inherit;
    padding: var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius);
    color: inherit;
    background: transparent;
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
