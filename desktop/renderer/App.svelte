<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { copy } from '../copy'
  import type { Typing } from '../shared/commands'
  import type { WindowActionId } from '../shared/actions'
  import type { Density } from '../shared/density'
  import type { ThemeChoice } from '../shared/theme/theme'
  import Accounts from './places/accounts/Accounts.svelte'
  import { runAction } from './actions'
  import { showDensity } from './density'
  import { ledgerStore } from './ledger/ledger'
  import Palette from './Palette.svelte'
  import { type PaletteItem, paletteItems } from './palette'
  import Sidebar from './parts/Sidebar.svelte'
  import { type Place, type PlaceView, type SpendView, shownBy } from './places'
  import { wordsFor } from './ledger/refusals'
  import Reports from './Reports.svelte'
  import { MAC } from './shortcuts'
  import { spendActions } from './ledger/spendActions'
  import Spends from './places/spends/Spends.svelte'
  import { type Field as TextField, FieldUndo, type Way, wayOf } from './undo'

  // Every place stays mounted, hidden while another shows, so its selection and typing stay too.
  let place = $state<Place>('ledger')
  let spends: Spends
  let accounts: Accounts
  let reports: Reports

  // Typed, so a place that stops doing what App asks of it fails the check.
  const view = (p: Place): PlaceView => ({ ledger: spends, accounts, reports })[p]
  const spendPlace = (p: Exclude<Place, 'accounts'>): SpendView => ({ ledger: spends, reports })[p]

  // One copy of the ledger's lists for every place, loaded once per change.
  const lists = ledgerStore(window.haveFish)
  const spendsDo = spendActions(window.haveFish)
  onMount(() => lists.start())

  const fieldUndo = new FieldUndo()
  let told: Typing = { undo: false, redo: false }

  /** An action on spends, which means nothing where spends aren't showing. */
  const whereSpendsShow = (act: (p: SpendView) => unknown) => () => {
    if (place !== 'accounts') void act(spendPlace(place))
  }

  /** Every action the window carries out: the menu's, and the palette's. */
  const handlers = {
    palette: () => void togglePalette(),
    newSpend,
    addAccount,
    undo,
    redo,
    remove: whereSpendsShow((p) => p.remove()),
    postings: whereSpendsShow((p) => p.postings()),
    refile: whereSpendsShow((p) => p.refile()),
    showLedger: () => void go('ledger'),
    showAccounts: () => void go('accounts'),
    showReports: () => void go('reports'),
    // Main remembers the density and the window sets it on the page; the stylesheet does the rest.
    densityCompact: () => void setDensity('compact'),
    densityRegular: () => void setDensity('regular'),
    densityComfortable: () => void setDensity('comfortable'),
    densityLarge: () => void setDensity('large'),
    // Main remembers it and repaints; the stylesheet already holds both schemes.
    themeGraphiteLight: () => void setTheme('graphite-light'),
    themeGraphiteDark: () => void setTheme('graphite-dark'),
    themeSystem: () => void setTheme('system'),
  }

  onMount(() => window.haveFish.onAction((id) => runAction(id, handlers)))

  /** The palette's actions while it's open, and where the cursor was before it. */
  let palette = $state<readonly PaletteItem[] | null>(null)
  let before: HTMLElement | null = null

  /** Ctrl+K: the palette, with Undo and Redo named as the menu names them. Again, it closes. */
  async function togglePalette() {
    if (palette !== null) {
      closePalette()
      return
    }
    before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const typing = fieldUndo.typing(textField(before))
    const next = await window.haveFish.invoke('ledger.steps', {})
    const named = (way: Way) =>
      typing[way]
        ? copy.actions.typing[way]
        : next.ok && next.value[way] !== null
          ? copy.steps.said(way, next.value[way])
          : null
    palette = paletteItems({ undo: named('undo'), redo: named('redo') })
  }

  /** Esc: the cursor goes back where it was. */
  function closePalette() {
    palette = null
    before?.focus()
    before = null
  }

  /** Runs `id` from where the cursor was, as the menu would have. */
  async function runFromPalette(id: WindowActionId) {
    closePalette()
    await tick()
    handlers[id]()
  }

  const setTheme = (theme: ThemeChoice) => window.haveFish.invoke('settings.theme.set', { theme })

  /** Main keeps the density; the window shows what it kept, and each list measures again. */
  async function setDensity(density: Density) {
    const kept = await window.haveFish.invoke('settings.density.set', { density })
    if (kept.ok) showDensity(kept.value.density)
  }

  /** Shows `to`, with the cursor in it. */
  async function go(to: Place) {
    place = to
    await tick()
    view(to).focus()
    tell()
  }

  /** Ctrl+N: the amount field, from anywhere. */
  async function newSpend() {
    place = 'ledger'
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
    const moved = await (way === 'undo'
      ? window.haveFish.invoke('ledger.undo', {})
      : window.haveFish.invoke('ledger.redo', {}))
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
  <Sidebar current={place} ongo={(p) => void go(p)} />
  <Spends
    bind:this={spends}
    hidden={place !== 'ledger'}
    ledger={lists}
    actions={spendsDo}
    {forgetTyping}
  />
  <Accounts bind:this={accounts} hidden={place !== 'accounts'} ledger={lists} {forgetTyping} />
  <Reports
    bind:this={reports}
    hidden={place !== 'reports'}
    ledger={lists}
    actions={spendsDo}
  />
</div>
{#if palette !== null}
  <Palette items={palette} onrun={(id) => void runFromPalette(id)} onclose={closePalette} />
{/if}

<style>
  .app {
    box-sizing: border-box;
    height: 100vh;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }

  /* NARROW in narrow.ts: the places go across the top. */
  @media (max-width: 44rem) {
    .app {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr);
    }
  }
</style>
