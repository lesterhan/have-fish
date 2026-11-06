<script lang="ts">
  import { onMount, tick, untrack } from 'svelte'
  import { copy } from '../copy'
  import type { ListedTransaction } from '../shared/commands'
  import type { Values } from './drafts'
  import type { SpendEditor } from './editor'
  import { dayOf, todayIn, understood } from './format'
  import { indexIn, type LedgerStore, rowAt, rowWithId } from './ledger'
  import Picker from './Picker.svelte'
  import { fromOf, fromOptions, toOf, toOptions } from './picker'
  import { type Field as Where, fieldOf, spendWordsFor, wordsFor } from './refusals'
  import Button from './parts/Button.svelte'
  import Header from './parts/Header.svelte'
  import Keys from './parts/Keys.svelte'
  import Notice from './parts/Notice.svelte'
  import { ariaShortcut, MAC } from './shortcuts'
  import Day from './parts/Day.svelte'
  import Field from './parts/Field.svelte'
  import SpendCard from './SpendCard.svelte'
  import SpendList from './SpendList.svelte'

  type Props = {
    hidden: boolean
    /** Every list this place shows, shared with the others. */
    ledger: LedgerStore
    /** Every spend I'm changing, in whichever place: one editor for the window. */
    editor: SpendEditor
    /** After a save: the fields' own undo has nothing left to take back. */
    forgetTyping: () => void
  }
  let { hidden, ledger, editor, forgetTyping }: Props = $props()

  let amount = $state('')
  let description = $state('')
  /** The day the spend happened: today, until I change it. */
  let date = $state(todayIn())
  /** Whether Date holds my choice: until then it follows the calendar, and main dates it. */
  let dateChosen = false
  let error = $state<{ field: Where; words: string } | null>(null)
  let saving = $state(false)
  let amountInput: HTMLInputElement
  let dateInput: HTMLInputElement

  /** The accounts that can pay, and the one a spend comes out of when From is left alone. */
  const payers = $derived($ledger.accounts)
  const assumed = $derived($ledger.assumedFrom)
  let fromText = $state('')
  /** Whether From holds my choice: until a spend is written, a refresh leaves it alone. */
  let fromChosen = false
  let fromPicker: Picker

  /** The categories in use, most used first; what To holds as typed. */
  const categories = $derived($ledger.categories)
  /** The income sources money has come from, most used first. */
  const income = $derived($ledger.income)
  let toText = $state('')
  let toPicker: Picker

  const assumedName = $derived(payers.find((a) => a.id === assumed)?.name)
  const accountOptions = $derived(
    payers.map((a) => ({ id: a.id, name: a.name, hint: copy.accounts.kinds[a.kind] })),
  )
  /** My accounts, then income sources: one of those makes it income. */
  const fromChoices = $derived(fromOptions(accountOptions, income, copy.spends.write.income))
  /** Categories, then my accounts: one of mine makes it a transfer. */
  const toChoices = $derived(toOptions(categories, accountOptions))

  /** The ledger's list, a page at a time: the store holds the pages the list draws. */
  const paged = $derived({
    count: $ledger.total,
    at: (i: number) => rowAt($ledger, i),
    indexOf: (id: string) => indexIn($ledger, id),
  })
  /** Why the lists couldn't load, until they next do. */
  const unloaded = $derived($ledger.failure && wordsFor($ledger.failure))
  /** An undo or redo refused here, until I put it away. */
  let refusal = $state<string | null>(null)
  /** The load failure I put away; a different one shows again. */
  let dismissed = $state<string | null>(null)
  const notice = $derived(refusal ?? (unloaded !== dismissed ? unloaded : null))
  let selectedId = $state<string | null>(null)
  /** The spend written last, while it slides into its row. */
  let justWritten = $state<string | null>(null)
  const drafts = $derived($editor.drafts)
  /** The spend whose details I opened; they stay open while it's the one selected. */
  let openedId = $state<string | null>(null)
  const opened = $derived(openedId !== null && openedId === selectedId ? openedId : null)
  let list: SpendList
  let card: SpendCard | undefined = $state()

  const selected = $derived(rowWithId($ledger, selectedId))
  /** The day the date field means, said under it. */
  const meant = $derived(understood(date))
  const refusalOf = (field: Where) => (error?.field === field ? error.words : null)

  // Each load: Date follows the calendar and From the account used last, unless I chose them,
  // and the selection stays while it's in the ledger, else goes to the newest. Drafts are left
  // alone: they're the window's.
  $effect(() => {
    const state = $ledger
    untrack(() => {
      if (!dateChosen) date = todayIn()
      if (state.loaded && rowWithId(state, selectedId) === undefined) {
        selectedId = rowAt(state, 0)?.id ?? null
      }
      if (!fromChosen) {
        fromText = state.accounts.find((a) => a.id === state.assumedFrom)?.name ?? ''
      }
    })
  })

  // The selection and the drafts stay held however far the list scrolls from them.
  $effect(() => ledger.keep([selectedId, ...drafts.keys()]))

  onMount(() => amountInput.focus())

  /** Coming here from another place: the list, or the amount field while there's nothing in it. */
  export function focus() {
    if ($ledger.total > 0) list.focus()
    else amountInput.focus()
  }

  /** After an undo or redo: the list as it is now, with the spend that came back selected. */
  export async function show(id: string) {
    await ledger.caughtUp()
    if ((await ledger.locate(id)) !== null) selectedId = id
  }

  /** An undo or redo refused while this place is showing. */
  export function refused(words: string) {
    refusal = words
  }

  function dismiss() {
    if (refusal !== null) refusal = null
    else dismissed = unloaded
  }

  async function write(event: SubmitEvent) {
    event.preventDefault()
    if (saving) return
    const from = fromOf(payers, fromText)
    saving = true
    const to = toOf(payers, toText)
    // Left to itself, Date sends nothing: main dates it today, even past midnight.
    const written = await window.haveFish.invoke('spend.write', {
      amount,
      description,
      to,
      from,
      date: dateChosen ? dayOf(date) : '',
    })
    saving = false
    if (written.ok) {
      amount = ''
      description = ''
      toText = ''
      date = todayIn()
      dateChosen = false
      error = null
      // From stays on the account that paid: it's the one used last now.
      fromChosen = false
      forgetTyping()
      await ledger.caughtUp()
      await ledger.locate(written.value.id)
      selectedId = written.value.id
      justWritten = written.value.id
      setTimeout(() => {
        if (justWritten === written.value.id) justWritten = null
      }, 1500)
    } else {
      error = { field: fieldOf(written, to), words: spendWordsFor(written) }
    }
    if (error?.field === 'from') fromPicker.focus()
    else if (error?.field === 'to') toPicker.focus()
    else if (error?.field === 'date') dateInput.focus()
    else amountInput.focus()
  }

  function edit(field: keyof Values, value: string) {
    if (selected !== undefined) editor.edit(selected, field, value)
  }

  function save() {
    if (selectedId !== null) void editor.save([selectedId], false, ledger.caughtUp)
  }

  export function saveAll() {
    void editor.save(editor.current().drafts.keys(), true, ledger.caughtUp)
  }

  let removing = false

  /** The selected spend, gone; selection moves to the next row, and its draft goes too. */
  export async function remove() {
    const id = selectedId
    if (id === null || removing) return
    removing = true
    // The row below it, else the one above: fetched now, since they may not be drawn.
    const at = await ledger.locate(id)
    const next =
      at === null ? null : ((await ledger.rowAt(at + 1)) ?? (await ledger.rowAt(at - 1)))?.id ?? null
    const refused = await editor.remove(id)
    removing = false
    if (refused !== null) {
      error = { field: 'form', words: wordsFor(refused) }
      return
    }
    const wasOpen = opened === id
    selectedId = next
    await ledger.caughtUp()
    // Removed from its card, the cursor goes back to the list; with nothing left, to Amount.
    if (selectedId === null) amountInput.focus()
    else if (wasOpen) list.focus()
  }

  /** Ctrl+N: the amount field, with the details out of its way. Any draft stays. */
  export function newSpend() {
    openedId = null
    amountInput.focus()
  }

  async function open(focus: boolean) {
    openedId = selectedId
    if (!focus) return
    await tick()
    card?.focus()
  }

  /** Esc: what was typed goes back, the details close, and the row stays selected. */
  function close() {
    if (opened !== null) editor.revert(opened)
    openedId = null
    list.focus()
  }
</script>

<main class="spends" {hidden}>
  <div class="top">
    <Header title={copy.app.places.ledger} />
    {#if notice}<Notice words={notice} ondismiss={dismiss} />{/if}
  </div>

  <form class="write" aria-label={copy.spends.write.label} onsubmit={write} novalidate>
    <Field id="amount" label={copy.spends.write.amount} error={refusalOf('amount')} figures>
      {#snippet keys()}<Keys action="newSpend" />{/snippet}
      {#snippet children(describedby)}
        <input
          bind:this={amountInput}
          id="amount"
          aria-keyshortcuts={ariaShortcut('newSpend', MAC)}
          bind:value={amount}
          name="amount"
          inputmode="decimal"
          autocomplete="off"
          maxlength="64"
          aria-invalid={error?.field === 'amount'}
          aria-describedby={describedby}
        />
      {/snippet}
    </Field>

    <Field id="description" label={copy.spends.write.description} error={refusalOf('description')}>
      {#snippet children(describedby)}
        <input
          id="description"
          bind:value={description}
          name="description"
          autocomplete="off"
          maxlength="500"
          aria-invalid={error?.field === 'description'}
          aria-describedby={describedby}
        />
      {/snippet}
    </Field>

    <Field id="to" label={copy.spends.write.to} error={refusalOf('to')}>
      {#snippet children(describedby)}
        <Picker
          bind:this={toPicker}
          id="to"
          name="to"
          options={toChoices}
          bind:text={toText}
          placeholder={copy.spends.write.unsorted}
          listLabel={copy.spends.write.toList}
          invalid={error?.field === 'to'}
          {describedby}
          onchoose={() => {}}
          newOption={copy.spends.write.newCategory}
        />
      {/snippet}
    </Field>

    <Field id="from" label={copy.spends.write.from} error={refusalOf('from')}>
      {#snippet children(describedby)}
        <Picker
          bind:this={fromPicker}
          id="from"
          name="from"
          options={fromChoices}
          bind:text={fromText}
          placeholder={assumedName ?? copy.spends.write.wallet}
          listLabel={copy.spends.write.fromList}
          invalid={error?.field === 'from'}
          {describedby}
          onchoose={() => (fromChosen = true)}
          newOption={copy.spends.write.newIncome}
        />
      {/snippet}
    </Field>

    <!-- Typed the short way too (`y`, `-3`, `mon`, `10-31`); what it means shows under it. -->
    <Field id="date" label={copy.spends.write.date} error={refusalOf('date')} figures>
      {#snippet note()}{#if meant !== null}<Day date={meant} />{/if}{/snippet}
      {#snippet children(describedby)}
        <input
          id="date"
          bind:this={dateInput}
          bind:value={date}
          oninput={() => (dateChosen = true)}
          name="date"
          autocomplete="off"
          maxlength="10"
          aria-invalid={error?.field === 'date'}
          aria-describedby={describedby}
        />
      {/snippet}
    </Field>

    <Button type="submit" variant="primary" disabled={saving}>{copy.spends.write.submit}</Button>
    {#if error?.field === 'form'}
      <p class="error" role="alert">{error.words}</p>
    {/if}
  </form>

  <SpendList
    bind:this={list}
    {paged}
    onrange={(from, to) => ledger.view(from, to)}
    onmissing={async (index) => {
      const row = await ledger.rowAt(index)
      if (row !== undefined) selectedId = row.id
    }}
    days={$ledger.days}
    nets={$ledger.nets}
    {selectedId}
    written={justWritten}
    {drafts}
    onselect={(id) => (selectedId = id)}
    {opened}
    onopen={open}
    onclose={close}
    onremove={remove}
  >
    {#snippet details(t: ListedTransaction)}
      <SpendCard
        bind:this={card}
        transaction={t}
        draft={drafts.get(t.id)}
        toOptions={toChoices}
        saving={$editor.saving}
        onedit={edit}
        onsave={save}
        onclose={close}
        onremove={remove}
      />
    {/snippet}
  </SpendList>
</main>

<style>
  /* The form beside the list, which has the rest: a spend's details open inside it. */
  main {
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(14rem, 18rem) minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas:
      'top top'
      'write list';
    gap: var(--space-4) var(--space-6);
    padding: var(--space-4);
  }

  .top {
    grid-area: top;
    display: grid;
    gap: var(--space-3);
  }

  main[hidden] {
    display: none;
  }

  /* NARROW in narrow.ts. */
  @media (max-width: 44rem) {
    main {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto auto minmax(0, 1fr);
      grid-template-areas:
        'top'
        'write'
        'list';
      padding: var(--space-3);
    }
  }

  form {
    grid-area: write;
    align-self: start;
    display: grid;
    gap: var(--space-2);
  }

  .error {
    margin: 0;
    font-size: var(--text-small);
    color: var(--color-error);
  }
</style>
