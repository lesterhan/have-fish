<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { copy } from '../copy'
  import type { ListedAccount } from '../shared/commands'
  import AccountList from './AccountList.svelte'
  import AccountPane from './AccountPane.svelte'
  import { type AccountField, accountFieldOf, type Adding, lockOf } from './accounts'
  import { NARROW } from './narrow'
  import { wordsFor } from './refusals'
  import { kept } from './selection'
  import { ariaShortcut, MAC, shortcutText } from './shortcuts'

  type Props = {
    hidden: boolean
    /** After a save: the fields' own undo has nothing left to take back. */
    forgetTyping: () => void
  }
  let { hidden, forgetTyping }: Props = $props()

  let accounts = $state.raw<ListedAccount[]>([])
  let selectedId = $state<string | null>(null)
  let adding = $state(false)
  let saving = $state(false)
  let error = $state<{ field: AccountField; words: string } | null>(null)
  /** In a narrow window, whether the pane is over the list. */
  let open = $state(false)
  let list: AccountList
  let pane: AccountPane
  let addButton: HTMLButtonElement

  const selected = $derived(accounts.find((a) => a.id === selectedId))

  async function refresh() {
    const listed = await window.haveFish.invoke('account.list', {})
    if (listed.ok) {
      accounts = listed.value
      selectedId = kept(accounts, selectedId)
    } else error = { field: 'form', words: wordsFor(listed) }
  }

  onMount(() => {
    void refresh()
    return window.haveFish.onChanged(() => void refresh())
  })

  onMount(() => {
    const narrow = matchMedia(NARROW)
    const widened = () => {
      if (!narrow.matches) open = false
    }
    narrow.addEventListener('change', widened)
    return () => narrow.removeEventListener('change', widened)
  })

  /** Coming here from another place: the list, or Add account while there's nothing in it. */
  export function focus() {
    if (adding) pane.focusName()
    else if (accounts.length > 0) list.focus()
    else addButton.focus()
  }

  /** After an undo or redo: the list as it is now, with the account that came back selected. */
  export async function show(id: string) {
    await refresh()
    if (accounts.some((a) => a.id === id)) selectedId = id
  }

  /** An undo or redo refused while this place is showing. */
  export function refused(words: string) {
    error = { field: 'form', words }
  }

  /** An empty pane to add one in: Name, Kind, Currency. */
  export async function startAdding() {
    adding = true
    error = null
    open = matchMedia(NARROW).matches
    await pane.start()
  }

  async function add(fields: Adding) {
    if (saving) return
    saving = true
    const added = await window.haveFish.invoke('account.add', {
      name: fields.name,
      kind: fields.kind,
      currency: lockOf(fields.currency),
      start: fields.start,
    })
    saving = false
    if (!added.ok) {
      error = { field: accountFieldOf(added), words: wordsFor(added) }
      if (error.field === 'name') pane.focusName()
      if (error.field === 'start') void pane.focusStart()
      return
    }
    adding = false
    error = null
    open = false
    forgetTyping()
    await refresh()
    selectedId = added.value.id
    list.focus()
  }

  /** A starting balance for the account showing. */
  async function start(amount: string) {
    const id = selectedId
    if (saving || id === null) return
    saving = true
    const started = await window.haveFish.invoke('account.start', { id, amount })
    saving = false
    if (!started.ok) {
      error = { field: accountFieldOf(started), words: wordsFor(started) }
      if (error.field === 'start') void pane.focusStart()
      return
    }
    error = null
    forgetTyping()
    await refresh()
    list.focus()
  }

  async function cancel() {
    adding = false
    error = null
    open = false
    await tick()
    focus()
  }

  /** Choosing an account puts away a half-filled pane: there's little in it to lose. */
  function select(id: string) {
    selectedId = id
    adding = false
    error = null
  }

  function closePane() {
    if (adding) void cancel()
    else {
      open = false
      list.focus()
    }
  }
</script>

<main class="accounts" {hidden}>
  <button
    bind:this={addButton}
    type="button"
    class="add"
    aria-keyshortcuts={ariaShortcut('addAccount', MAC)}
    onclick={() => void startAdding()}
  >
    {copy.accounts.add}
    <kbd aria-hidden="true">{shortcutText('addAccount', MAC)}</kbd>
  </button>

  <AccountList
    bind:this={list}
    {accounts}
    {selectedId}
    onselect={select}
    onopen={() => (open = matchMedia(NARROW).matches)}
  />

  <AccountPane
    bind:this={pane}
    account={selected}
    {adding}
    {saving}
    {error}
    {open}
    onadd={(fields) => void add(fields)}
    onstart={(amount) => void start(amount)}
    oncancel={() => void cancel()}
    onback={closePane}
  />
</main>

<style>
  main {
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(16rem, 24rem);
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas:
      'add pane'
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
        'add'
        'list';
    }
  }

  .add {
    grid-area: add;
    justify-self: start;
    font: inherit;
    padding: var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius);
    color: inherit;
    background: transparent;
    cursor: pointer;
  }

  kbd {
    font: inherit;
    font-size: var(--font-size-small);
    color: var(--color-muted);
    margin-inline-start: var(--space-2);
  }
</style>
