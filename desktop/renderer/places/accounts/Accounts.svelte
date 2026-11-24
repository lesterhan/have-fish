<script lang="ts">
  // Accounts: its tabs, the notice under them, and what App asks of the place.
  import { tick } from 'svelte'
  import { copy } from '../../../copy'
  import AccountsTab from './AccountsTab.svelte'
  import type { LedgerStore } from '../../ledger/ledger'
  import { wordsFor } from '../../ledger/refusals'
  import Empty from '../../parts/Empty.svelte'
  import Notice from '../../parts/Notice.svelte'
  import Tabs from '../../parts/Tabs.svelte'

  type Props = {
    hidden: boolean
    /** Every list this place shows, shared with the others. */
    ledger: LedgerStore
    /** After a save: the fields' own undo has nothing left to take back. */
    forgetTyping: () => void
  }
  let { hidden, ledger, forgetTyping }: Props = $props()

  /** The place's views: its accounts, and what each currency cost me. */
  const TAB_LIST = [
    { id: 'accounts', label: copy.accounts.tabs.accounts },
    { id: 'currencies', label: copy.accounts.tabs.currencies },
  ]
  let chosen = $state('accounts')
  let strip: Tabs
  let body: AccountsTab

  /** Why the list couldn't load, until it next does. */
  const unloaded = $derived($ledger.failure && wordsFor($ledger.failure))
  /** An undo or redo refused here, until I put it away. */
  let refusal = $state<string | null>(null)
  /** The load failure I put away; a different one shows again. */
  let dismissed = $state<string | null>(null)
  const notice = $derived(refusal ?? (unloaded !== dismissed ? unloaded : null))

  /** Coming here from another place: the chosen tab, its own way on Accounts. */
  export function focus() {
    if (chosen === 'accounts') body.focus()
    else strip.focus()
  }

  /** After an undo or redo: the Accounts tab, the account that came back selected. */
  export async function show(id: string) {
    const switched = chosen !== 'accounts'
    chosen = 'accounts'
    await tick()
    await body.show(id)
    if (switched) body.focus()
  }

  /** An undo or redo refused while this place is showing. */
  export function refused(words: string) {
    refusal = words
  }

  function dismiss() {
    if (refusal !== null) refusal = null
    else dismissed = unloaded
  }

  /** An empty pane to add one in, on the Accounts tab: Name, Kind, Currency. */
  export async function startAdding() {
    chosen = 'accounts'
    await tick()
    await body.startAdding()
  }
</script>

<main class="accounts" {hidden}>
  <div class="top">
    <Tabs
      bind:this={strip}
      id="accounts"
      title={copy.app.places.accounts}
      tabs={TAB_LIST}
      selected={chosen}
      onselect={(id) => (chosen = id)}
    />
    {#if notice}<Notice words={notice} ondismiss={dismiss} />{/if}
  </div>

  <AccountsTab bind:this={body} hidden={chosen !== 'accounts'} {ledger} {forgetTyping} />

  <div
    class="currencies"
    role="tabpanel"
    id="accounts-panel-currencies"
    aria-labelledby="accounts-tab-currencies"
    tabindex="0"
    hidden={chosen !== 'currencies'}
  >
    <Empty>{copy.app.underConstruction}</Empty>
  </div>
</main>

<style>
  main {
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--space-4);
    padding: var(--space-4);
  }

  main[hidden] {
    display: none;
  }

  .top {
    display: grid;
    gap: var(--space-3);
  }

  .currencies[hidden] {
    display: none;
  }

  /* NARROW in narrow.ts. */
  @media (max-width: 44rem) {
    main {
      padding: var(--space-3);
    }
  }
</style>
