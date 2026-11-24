<script lang="ts">
  // The Accounts tab: the list of accounts, the pane beside it, and adding one.
  import { onMount, tick, untrack } from 'svelte'
  import { copy } from '../../../copy'
  import AccountList from './AccountList.svelte'
  import AccountPane from './AccountPane.svelte'
  import { type AccountField, accountFieldOf, type Adding, lockOf } from './accounts'
  import { accountRows } from './balances'
  import type { LedgerStore } from '../../ledger/ledger'
  import { NARROW } from '../../narrow'
  import { wordsFor } from '../../ledger/refusals'
  import { kept } from '../../ledger/selection'
  import Button from '../../parts/Button.svelte'

  type Props = {
    hidden: boolean
    /** Every list this place shows, shared with the others. */
    ledger: LedgerStore
    /** After a save: the fields' own undo has nothing left to take back. */
    forgetTyping: () => void
  }
  let { hidden, ledger, forgetTyping }: Props = $props()

  const accounts = $derived($ledger.accounts)
  let selectedId = $state<string | null>(null)
  let adding = $state(false)
  let saving = $state(false)
  let error = $state<{ field: AccountField; words: string } | null>(null)
  /** In a narrow window, whether the pane is over the list. */
  let open = $state(false)
  let list: AccountList
  let pane: AccountPane
  let addButton: Button

  const selected = $derived(accounts.find((a) => a.id === selectedId))
  /** The list as a tree, parents rolled up; and the accounts in it, in the order it shows them. */
  const rows = $derived(accountRows(accounts))
  const ordered = $derived(rows.flatMap((r) => (r.account ? [r.account] : [])))

  // Each load: the selection stays where it can.
  $effect(() => {
    const now = ordered
    untrack(() => {
      selectedId = kept(now, selectedId)
    })
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
    else if (ordered.length > 0) list.focus()
    else addButton.focus()
  }

  /** After an undo or redo: the list as it is now, with the account that came back selected. */
  export async function show(id: string) {
    await ledger.caughtUp()
    if (ledger.current().accounts.some((a) => a.id === id)) selectedId = id
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
      cost: fields.cost,
    })
    saving = false
    if (!added.ok) {
      error = { field: accountFieldOf(added), words: wordsFor(added) }
      if (error.field === 'name') pane.focusName()
      if (error.field === 'start') void pane.focusStart()
      if (error.field === 'cost') void pane.focusCost()
      return
    }
    adding = false
    error = null
    open = false
    forgetTyping()
    await ledger.caughtUp()
    selectedId = added.value.id
    list.focus()
  }

  /** A starting balance for the account showing, and what it cost. */
  async function start(amount: string, cost: string) {
    const id = selectedId
    if (saving || id === null) return
    saving = true
    const started = await window.haveFish.invoke('account.start', { id, amount, cost })
    saving = false
    if (!started.ok) {
      error = { field: accountFieldOf(started), words: wordsFor(started) }
      if (error.field === 'start') void pane.focusStart()
      if (error.field === 'cost') void pane.focusCost()
      return
    }
    error = null
    forgetTyping()
    await ledger.caughtUp()
    list.focus()
  }

  /** What the account showing's start cost, said after it. */
  async function cost(text: string) {
    const id = selectedId
    if (saving || id === null) return
    saving = true
    const costed = await window.haveFish.invoke('account.cost', { id, cost: text })
    saving = false
    if (!costed.ok) {
      error = { field: accountFieldOf(costed), words: wordsFor(costed) }
      if (error.field === 'cost') void pane.focusCost()
      return
    }
    error = null
    forgetTyping()
    await ledger.caughtUp()
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

<div
  class="tab"
  role="tabpanel"
  id="accounts-panel-accounts"
  aria-labelledby="accounts-tab-accounts"
  {hidden}
>
  <div class="head">
    <Button
      bind:this={addButton}
      variant="quiet"
      action="addAccount"
      onclick={() => void startAdding()}
    >
      {copy.accounts.add}
    </Button>
  </div>

  <AccountList
    bind:this={list}
    {rows}
    {selectedId}
    onselect={select}
    onopen={() => (open = matchMedia(NARROW).matches)}
  />

  <div class="pane">
    <AccountPane
    bind:this={pane}
    account={selected}
    {adding}
    {saving}
    {error}
    {open}
    onadd={(fields) => void add(fields)}
    onstart={(amount, cost) => void start(amount, cost)}
    oncost={(text) => void cost(text)}
    oncancel={() => void cancel()}
    onback={closePane}
  />
  </div>
</div>

<style>
  .tab {
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(16rem, 24rem);
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas:
      'head pane'
      'list pane';
    gap: var(--space-2) var(--space-6);
  }

  .tab[hidden] {
    display: none;
  }

  .head {
    grid-area: head;
    display: flex;
  }

  .pane {
    grid-area: pane;
    display: grid;
    min-height: 0;
  }

  /* NARROW in narrow.ts. */
  @media (max-width: 44rem) {
    .tab {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas:
        'head'
        'list';
    }

    /* The pane slides over the list, out of the grid. */
    .pane {
      display: contents;
    }
  }
</style>
