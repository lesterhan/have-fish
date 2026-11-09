<script lang="ts">
  // The line that writes a spend, in the ledger: From, Date, Amount, Description, To, in the order
  // you think of them. Every part shows its word until filled, the next one carries its Tab key,
  // and a part it can't read is underlined red with two words of why. Enter writes it and closes
  // the line; Esc closes it without writing. While it's open, the rest of the ledger steps back.
  import { tick, untrack } from 'svelte'
  import { copy } from '../../copy'
  import type { ListedAccount, ListedPath } from '../../shared/commands'
  import {
    after,
    before,
    type DayChoice,
    dateSuggestions,
    type Part,
    startPart,
    tabMark,
  } from '../composer'
  import { dayOf, todayIn } from '../format'
  import { fromOf, toOf } from '../picker'
  import { composerWordsFor, type Field as Where, fieldOf } from '../refusals'
  import Button from './Button.svelte'
  import Day from './Day.svelte'
  import Keys from './Keys.svelte'
  import Listbox from './Listbox.svelte'
  import PathPicker from './PathPicker.svelte'
  import Popover from './Popover.svelte'
  import { floating } from './floating'

  type Props = {
    /** Open: the line shows, and the ledger under it steps back. */
    open: boolean
    /** With no accounts and no spends: the parts show examples in the format to type. */
    firstRun: boolean
    accounts: readonly ListedAccount[]
    /** The account From holds while it's left alone. */
    assumedName: string | undefined
    /** Every path, with its last use; the ledger reads it once per change. */
    loadPaths: () => Promise<ListedPath[]>
    /** Esc, or reaching for the ledger: close it, keeping what's half-typed. */
    onclose: () => void
    /** Written: the ledger catches up, selects the new row, and closes the line. */
    onsaved: (id: string) => Promise<void> | void
    /** After a save: the fields' own undo has nothing left to take back. */
    forgetTyping: () => void
  }
  let {
    open,
    firstRun,
    accounts,
    assumedName,
    loadPaths,
    onclose,
    onsaved,
    forgetTyping,
  }: Props = $props()

  let fromText = $state('')
  let dateText = $state('')
  let amount = $state('')
  let description = $state('')
  let toText = $state('')
  /** The part the cursor is in, and the one Tab would mark. */
  let active = $state<Part>('amount')
  let error = $state<{ part: Where; words: string } | null>(null)
  let saving = $state(false)

  let dateOpen = $state(false)
  let dateActive = $state<string | null>(null)

  let form: HTMLFormElement | undefined = $state()
  let dateInput: HTMLInputElement | undefined = $state()
  let dateListbox: ReturnType<typeof Listbox<DayChoice>> | undefined = $state()

  const values = $derived<Record<Part, string>>({
    from: fromText,
    date: dateText,
    amount,
    description,
    to: toText,
  })
  const marked = $derived(tabMark(active, values))
  const suggestions = $derived(dateOpen ? dateSuggestions(dateText, todayIn()) : [])

  // The first suggestion is the one Enter takes, until the arrows move it.
  $effect(() => {
    const keys = suggestions.map((choice) => choice.typed)
    if (dateActive === null || !keys.includes(dateActive)) dateActive = keys[0] ?? null
  })

  // Opening the line: the parts From and Date carry over, and the cursor starts at the first
  // part still empty. With no accounts yet, every part stays empty to show its example. A line
  // already open when the part mounts (the sheet) doesn't take the cursor.
  let primed = false
  let wasOpen = untrack(() => open)
  /** Set when the line opens here: the form, once drawn, takes the cursor. */
  let takesCursor = false
  $effect(() => {
    if (open === wasOpen) return
    wasOpen = open
    if (!open) {
      primed = false
      return
    }
    if (primed) return
    primed = true
    takesCursor = true
    untrack(() => {
      if (!firstRun) {
        if (fromText.trim() === '') fromText = assumedName ?? ''
        if (dateText.trim() === '') dateText = 'today'
      }
      error = null
      dateOpen = false
      // Read the parts afresh: what carried over may not have reached `values` yet.
      active = startPart({ from: fromText, date: dateText, amount, description, to: toText })
    })
  })

  /** The form has just been drawn: it takes the cursor, once the parts carried over are in. */
  function takeCursor(node: HTMLElement) {
    const drawn = requestAnimationFrame(() => {
      if (!takesCursor) return
      takesCursor = false
      if (!node.contains(document.activeElement)) focus()
    })
    return { destroy: () => cancelAnimationFrame(drawn) }
  }

  export function focus() {
    if (!open) return
    focusPart(startPart(values))
  }

  function focusPart(part: Part) {
    active = part
    // A bound form from before the line closed is detached: find the one on the page.
    const line = form?.isConnected
      ? form
      : document.querySelector<HTMLFormElement>(`form[aria-label="${copy.spends.write.label}"]`)
    line?.querySelector<HTMLElement>(`[name="${part}"]`)?.focus()
  }

  /** The word a part shows until it's filled: its own, or the example the first time. */
  const word = (part: Part) => (firstRun ? copy.spends.composer.examples[part] : copy.spends.composer.parts[part])

  /** A part's width follows what's in it or, empty, the word it shows. */
  const width = (part: Part) =>
    Math.min(Math.max(values[part].length, word(part).length, 2), part === 'description' ? 40 : 24)

  function clearError(part: Where) {
    if (error?.part === part) error = null
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.defaultPrevented) return
    if (event.key === 'Tab') {
      event.preventDefault()
      dateOpen = false
      focusPart(event.shiftKey ? before(active) : after(active))
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      dateOpen = false
      onclose()
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault()
    if (saving) return
    saving = true
    const from = fromOf(accounts, fromText)
    const to = toOf(accounts, toText)
    const income = typeof from === 'object' && from !== null
    const written = await window.haveFish.invoke('spend.write', {
      amount,
      description,
      from,
      to,
      date: dateText.trim() === '' ? '' : dayOf(dateText),
    })
    saving = false
    if (!written.ok) {
      const part = fieldOf(written, to)
      error = { part, words: composerWordsFor(written) }
      await tick()
      if (part !== 'form') focusPart(part)
      return
    }
    amount = ''
    description = ''
    toText = ''
    error = null
    dateOpen = false
    // The next line starts on the account and day this one used; money coming in doesn't become
    // the account the next spend pays from.
    if (dateText.trim() === '') dateText = 'today'
    if (fromText.trim() === '' || income) fromText = assumedName ?? ''
    forgetTyping()
    await onsaved(written.value.id)
  }

  function pickDate(choice: DayChoice | undefined) {
    if (choice === undefined) return
    dateText = choice.typed
    dateOpen = false
    clearError('date')
    focusPart('amount')
  }

  function onDateKey(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' && !dateOpen) {
      event.preventDefault()
      dateOpen = true
      return
    }
    if (!dateOpen) return
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && dateListbox?.press(event)) return
    if (event.key === 'Enter') {
      const choice = suggestions.find((s) => s.typed === dateActive)
      const empty = dateText.trim() === ''
      if (choice !== undefined && !empty && choice.typed !== dateText.trim().toLowerCase()) {
        // Tab completes the shorthand; Enter on what's already a day sends the line.
        event.preventDefault()
        event.stopPropagation()
        pickDate(choice)
      } else {
        dateOpen = false
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      dateOpen = false
      onclose()
    } else if (event.key === 'Tab') {
      dateOpen = false
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions (Tab and Esc belong to the whole line) -->
  <form
    bind:this={form}
    class="composer"
    use:takeCursor
    class:example={firstRun}
    aria-label={copy.spends.write.label}
    onsubmit={save}
    {onkeydown}
    novalidate
  >
    <span class="new" aria-hidden="true">{copy.spends.composer.pill}</span>

    <span
      class="part"
      data-part="from"
      class:filled={fromText.trim() !== ''}
      class:active={active === 'from'}
      class:next={marked === 'from'}
      class:refused={error?.part === 'from'}
      onfocusin={() => (active = 'from')}
    >
      <span class="tab" class:shown={marked === 'from'}><Keys key={copy.spends.composer.tab} /></span>
      <PathPicker
        id="composer-from"
        name="from"
        mode="from"
        {loadPaths}
        bind:text={fromText}
        label={copy.spends.composer.parts.from}
        placeholder={word('from')}
        listLabel={copy.spends.write.fromList}
        invalid={error?.part === 'from'}
        describedby={undefined}
        onchoose={() => clearError('from')}
        newOption={copy.spends.write.newIncome}
        inline
        openOnFocus={false}
        below={form}
        onclose={onclose}
      />
    </span>
    {#if error?.part === 'from'}<span class="why" role="alert">{error.words}</span>{/if}

    <span
      class="part"
      data-part="date"
      class:filled={dateText.trim() !== ''}
      class:active={active === 'date'}
      class:next={marked === 'date'}
      class:refused={error?.part === 'date'}
      onfocusin={() => (active = 'date')}
    >
      <span class="tab" class:shown={marked === 'date'}><Keys key={copy.spends.composer.tab} /></span>
      <input
        bind:this={dateInput}
        id="composer-date"
        name="date"
        bind:value={dateText}
        aria-label={copy.spends.composer.parts.date}
        placeholder={word('date')}
        aria-invalid={error?.part === 'date'}
        aria-autocomplete="list"
        autocomplete="off"
        maxlength="10"
        size={width('date')}
        class="figures"
        onfocus={() => {
          dateOpen = true
          dateInput?.select()
        }}
        onblur={() => (dateOpen = false)}
        oninput={() => {
          dateOpen = true
          dateActive = null
          clearError('date')
        }}
        onkeydown={onDateKey}
      />
    </span>
    {#if error?.part === 'date'}<span class="why" role="alert">{error.words}</span>{/if}

    <span
      class="part"
      data-part="amount"
      class:filled={amount.trim() !== ''}
      class:active={active === 'amount'}
      class:next={marked === 'amount'}
      class:refused={error?.part === 'amount'}
      onfocusin={() => (active = 'amount')}
    >
      <span class="tab" class:shown={marked === 'amount'}><Keys key={copy.spends.composer.tab} /></span>
      <input
        id="composer-amount"
        bind:value={amount}
        name="amount"
        aria-label={copy.spends.composer.parts.amount}
        placeholder={word('amount')}
        aria-invalid={error?.part === 'amount'}
        inputmode="decimal"
        autocomplete="off"
        maxlength="64"
        size={width('amount')}
        class="figures"
        onfocus={(event) => event.currentTarget.select()}
        oninput={() => clearError('amount')}
      />
    </span>
    {#if error?.part === 'amount'}<span class="why" role="alert">{error.words}</span>{/if}

    <span
      class="part"
      data-part="description"
      class:filled={description.trim() !== ''}
      class:active={active === 'description'}
      class:next={marked === 'description'}
      class:refused={error?.part === 'description'}
      onfocusin={() => (active = 'description')}
    >
      <span class="tab" class:shown={marked === 'description'}><Keys key={copy.spends.composer.tab} /></span>
      <input
        id="composer-description"
        bind:value={description}
        name="description"
        aria-label={copy.spends.composer.parts.description}
        placeholder={word('description')}
        aria-invalid={error?.part === 'description'}
        autocomplete="off"
        maxlength="500"
        size={width('description')}
        onfocus={(event) => event.currentTarget.select()}
        oninput={() => clearError('description')}
      />
    </span>
    {#if error?.part === 'description'}<span class="why" role="alert">{error.words}</span>{/if}

    <span
      class="part"
      data-part="to"
      class:filled={toText.trim() !== ''}
      class:active={active === 'to'}
      class:next={marked === 'to'}
      class:refused={error?.part === 'to'}
      onfocusin={() => (active = 'to')}
    >
      <span class="tab" class:shown={marked === 'to'}><Keys key={copy.spends.composer.tab} /></span>
      <PathPicker
        id="composer-to"
        name="to"
        mode="to"
        {loadPaths}
        bind:text={toText}
        label={copy.spends.composer.parts.to}
        placeholder={word('to')}
        listLabel={copy.spends.write.toList}
        invalid={error?.part === 'to'}
        describedby={undefined}
        onchoose={() => clearError('to')}
        newOption={copy.spends.write.newCategory}
        inline
        openOnFocus={false}
        below={form}
        onclose={onclose}
      />
    </span>
    {#if error?.part === 'to'}<span class="why" role="alert">{error.words}</span>{/if}
    {#if error?.part === 'form'}<span class="why" role="alert">{error.words}</span>{/if}

    <Button type="submit" key={copy.spends.composer.esc} disabled={saving}
      >{copy.spends.composer.done}</Button
    >

    {#if dateOpen && suggestions.length > 0}
      <span
        class="dates"
        use:floating={form === undefined ? dateInput : { field: dateInput, below: form }}
      >
        <Popover>
          <Listbox
            bind:this={dateListbox}
            items={suggestions}
            idOf={(choice) => choice.typed}
            active={dateActive}
            label={copy.spends.composer.dateList}
            idPrefix="composer-date"
            columns="auto minmax(0, 1fr)"
            owner={dateInput}
            onactive={(key) => (dateActive = key)}
            onpick={(key) => pickDate(suggestions.find((choice) => choice.typed === key))}
          >
            {#snippet row(choice)}
              <span class="shorthand">{choice.typed}</span>
              <span class="means"><Day date={choice.date} full /></span>
            {/snippet}
          </Listbox>
        </Popover>
      </span>
    {/if}
  </form>
{/if}

<style>
  .composer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-3);
    padding: var(--space-1) var(--space-3);
    border: var(--border-width) solid var(--color-accent);
    border-radius: calc(var(--radius-control) + 2px);
    outline: 2px solid var(--color-accent);
    background: var(--color-background);
    box-shadow: var(--shadow-lift);
  }

  .new {
    padding: 0 var(--space-2);
    border-radius: var(--radius-chip);
    font-size: var(--text-small);
    font-weight: var(--weight-label);
    color: var(--color-on-accent);
    background: var(--color-accent);
  }

  .part {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-block-size: 26px;
    padding: 0 var(--space-1);
    border-bottom: 2px solid transparent;
    border-radius: var(--radius-chip);
    white-space: nowrap;
  }

  /* A filled part rests on the band, as a chip does; the one being typed in is underlined. */
  .part.filled:not(.active) {
    padding: 0 var(--space-2);
    border: var(--border-width) solid var(--color-rule);
    background: var(--color-band);
  }

  .part.active {
    border-bottom-color: var(--color-accent);
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }

  /* Hidden, never removed: a node added or taken away beside a field splits Chromium's undo of
     what was typed in it, so one Ctrl+Z would leave the first letter (see #628). */
  .tab {
    display: none;
  }

  .tab.shown {
    display: contents;
  }

  .part.next {
    border-bottom-color: var(--color-muted);
    border-bottom-style: dotted;
  }

  .part.refused {
    border-bottom-color: var(--color-error);
  }

  input {
    min-inline-size: 2ch;
    max-inline-size: min(32rem, 100%);
    field-sizing: content;
    padding: 0;
    border: 0;
    font: inherit;
    color: inherit;
    background: none;
  }

  input:focus-visible {
    outline: none;
  }

  input::placeholder {
    color: var(--color-muted);
    opacity: 1;
  }

  .example input::placeholder {
    font-style: italic;
  }

  .figures {
    font-family: var(--font-figures);
    font-variant-numeric: tabular-nums;
  }

  .why {
    padding: 0 var(--space-1);
    border: var(--border-width) solid var(--color-error);
    border-radius: var(--radius-chip);
    font-size: var(--text-small);
    color: var(--color-error);
    white-space: nowrap;
  }

  .composer > :global(button) {
    margin-inline-start: auto;
  }

  .dates {
    position: absolute;
    /* Above the band that stays over the list, which shares the picker's old z-index. */
    z-index: 2;
    display: grid;
    inline-size: max-content;
    min-inline-size: 100%;
    max-inline-size: min(24rem, 90vw);
    max-height: 14rem;
  }

  .shorthand {
    font-family: var(--font-figures);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .means {
    color: var(--color-text);
  }
</style>
