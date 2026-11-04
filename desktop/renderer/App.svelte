<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { copy } from '../copy'
  import type { Typing } from '../shared/commands'
  import Accounts from './Accounts.svelte'
  import { runAction } from './actions'
  import { PLACES, type Place, SHOW, shownBy } from './places'
  import { wordsFor } from './refusals'
  import Reports from './Reports.svelte'
  import { ariaShortcut, MAC, shortcutText } from './shortcuts'
  import Spends from './Spends.svelte'
  import { type Field as TextField, FieldUndo, type Way, wayOf } from './undo'

  // Every place stays mounted, hidden while another shows, so its drafts and typing stay too.
  let place = $state<Place>('spends')
  let spends: Spends
  let accounts: Accounts
  let reports: Reports

  const view = (p: Place) => ({ spends, accounts, reports })[p]

  const fieldUndo = new FieldUndo()
  let told: Typing = { undo: false, redo: false }

  onMount(() =>
    window.haveFish.onAction((id) =>
      runAction(id, {
        newSpend,
        addAccount,
        // Each place's drafts are its own: Save all saves the ones where I am.
        saveAll: () => (place === 'reports' ? reports : spends).saveAll(),
        undo,
        redo,
        // Remove spend means nothing where spends aren't showing.
        remove: () => {
          if (place === 'spends') void spends.remove()
          else if (place === 'reports') void reports.remove()
        },
        showSpends: () => void go('spends'),
        showAccounts: () => void go('accounts'),
        showReports: () => void go('reports'),
      }),
    ),
  )

  /** Shows `to`, with the cursor in it. */
  async function go(to: Place) {
    place = to
    await tick()
    view(to).focus()
    tell()
  }

  /** Ctrl+N: the amount field, from anywhere. */
  async function newSpend() {
    place = 'spends'
    await tick()
    spends.newSpend()
  }

  async function addAccount() {
    place = 'accounts'
    await tick()
    await accounts.startAdding()
  }

  function forgetTyping() {
    fieldUndo.forget()
    tell()
  }

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

  /**
   * The ledger's undo or redo; then the list selects what came back. Focus stays put, unless
   * the change is in another place: that place shows, so you see what moved.
   */
  async function ledger(way: Way) {
    const moved = await window.haveFish.invoke(`ledger.${way}`, {})
    if (!moved.ok) {
      view(place).refused(wordsFor(moved))
      return
    }
    const shown = shownBy(moved.value, place)
    if (shown === null) return
    const elsewhere = shown.place !== place
    place = shown.place
    await view(shown.place).show(shown.id)
    if (elsewhere) {
      await tick()
      view(shown.place).focus()
    }
    tell()
  }
</script>

<svelte:head>
  <title>{copy.app.name}</title>
</svelte:head>

<div class="app">
  <nav aria-label={copy.app.places.label}>
    {#each PLACES as p (p)}
      <button
        type="button"
        aria-current={place === p ? 'page' : undefined}
        aria-keyshortcuts={ariaShortcut(SHOW[p], MAC)}
        onclick={() => void go(p)}
      >
        {copy.app.places[p]}
        <kbd aria-hidden="true">{shortcutText(SHOW[p], MAC)}</kbd>
      </button>
    {/each}
  </nav>

  <Spends bind:this={spends} hidden={place !== 'spends'} {forgetTyping} />
  <Accounts bind:this={accounts} hidden={place !== 'accounts'} {forgetTyping} />
  <Reports bind:this={reports} hidden={place !== 'reports'} {forgetTyping} />
</div>

<style>
  .app {
    box-sizing: border-box;
    height: 100vh;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }

  nav {
    display: grid;
    align-content: start;
    gap: var(--space-1);
    padding: var(--space-4) var(--space-2);
    border-inline-end: var(--border-width) solid var(--color-rule);
  }

  /* NARROW in narrow.ts: the places go across the top. */
  @media (max-width: 44rem) {
    .app {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr);
    }

    nav {
      grid-auto-flow: column;
      justify-content: start;
      padding: var(--space-2) var(--space-4) 0;
      border-inline-end: none;
    }
  }

  button {
    font: inherit;
    display: flex;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-3);
    border: none;
    border-radius: var(--radius);
    color: inherit;
    background: transparent;
    text-align: start;
    cursor: pointer;
  }

  button[aria-current='page'] {
    background: var(--color-selected);
  }

  kbd {
    font: inherit;
    font-size: var(--font-size-small);
    color: var(--color-muted);
  }
</style>
