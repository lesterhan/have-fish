<script lang="ts">
  // A field for an account, category or income source, picked by its path: a trail to where you
  // are, the parts under it (the ones used last first), letters finding any path, and Create last
  // for a name none has. It replaces Picker everywhere; the rules are in `pathPicker.ts`.
  import { copy } from '../../copy'
  import type { ListedPath } from '../../shared/commands'
  import {
    childrenAt,
    createPath,
    levelOfTyped,
    needleOf,
    offered,
    parentsOf,
    relativeOf,
    searching,
    textOf,
    trailOf,
    type Mode,
    type Pick,
  } from '../pathPicker'
  import Listbox from './Listbox.svelte'
  import Path from './Path.svelte'
  import Popover from './Popover.svelte'
  import { floating } from './floating'

  type Props = {
    /** The field's id, for its label; the list's is built from it. */
    id: string
    name: string
    mode: Mode
    /** Every path, with its last use; the ledger reads it once per change. */
    loadPaths: () => Promise<ListedPath[]>
    /** What the field shows: a path without its root. */
    text: string
    placeholder: string
    /** What the list of paths is called, read out. */
    listLabel: string
    /** The input's accessible name, where no label names it. */
    label?: string | undefined
    invalid: boolean
    describedby: string | undefined
    /** I typed, or picked: the field holds my choice now. */
    onchoose: (text: string) => void
    /** A path was picked: from the list, not typed. A card saves it at once. */
    onpicked?: (() => void) | undefined
    /** Given, a name none has is offered as a new one, in these words. */
    newOption?: ((name: string) => string) | undefined
    /** Escape when the list is open: close the whole field, not only the list (refile). */
    onclose?: (() => void) | undefined
    /** In a list cell: the focus ring sits inside the field, where the row can't clip it. */
    inRow?: boolean
    /** A part of the composer: no field border or ring; the part it sits in draws those. */
    inline?: boolean
    /** Opens its list when focused. Off in the composer, where a list per part would cover the line. */
    openOnFocus?: boolean
    /** Where its list starts, when that isn't the field: the composer's whole line. */
    below?: HTMLElement | undefined
  }
  let {
    id,
    name,
    mode,
    loadPaths,
    text = $bindable(),
    placeholder,
    listLabel,
    label,
    invalid,
    describedby,
    onchoose,
    onpicked,
    newOption,
    onclose,
    inRow = false,
    inline = false,
    openOnFocus = true,
    below,
  }: Props = $props()

  const words = copy.spends.picker
  let input = $state<HTMLInputElement>()
  let listbox: ReturnType<typeof Listbox<Entry>>
  let open = $state(false)
  /** What the field held when it was entered: Escape puts it back, and typing is what differs. */
  let kept = $state('')
  /** The part of the path in view; null shows every path. */
  let level = $state<string | null>(null)
  let active = $state<string | null>(null)
  /** Every path, asked of main each time the field is entered: last use moves with each spend. */
  let paths = $state<ListedPath[]>([])
  let fetching = 0

  const available = $derived(offered(paths, mode))
  const current = $derived(
    text.trim() === ''
      ? undefined
      : available.find((p) => relativeOf(p.path) === text.trim() || p.path === text.trim()),
  )
  /** What was typed, once it differs from what the field held: then letters find paths. */
  const typed = $derived(text !== kept && text.trim() !== '')
  const at = $derived(typed ? levelOfTyped(level, text, mode) : level)
  const trail = $derived(trailOf(at))
  const picks = $derived(typed ? searching(available, text) : childrenAt(available, level))
  const made = $derived(typed && newOption !== undefined ? createPath(mode, at, text) : null)
  /** A name an account already has is not offered as a new one. */
  const created = $derived(
    made !== null &&
      !available.some((p) => relativeOf(p.path).toLowerCase() === made.name.toLowerCase())
      ? made
      : null,
  )

  type Entry = { key: string; pick: Pick | null; create: { name: string; path: string } | null }
  const entries = $derived<Entry[]>([
    ...picks.map((pick) => ({ key: pick.path, pick, create: null })),
    ...(created === null ? [] : [{ key: `new:${created.path}`, pick: null, create: created }]),
  ])
  const listId = $derived(`${id}-path-list`)

  $effect(() => {
    const keys = entries.map((e) => e.key)
    if (active === null || !keys.includes(active)) active = keys[0] ?? null
  })

  export function focus() {
    input?.focus()
  }

  function onfocus() {
    kept = text
    active = null
    // Typing starts a new path over the value, rather than after it.
    input?.select()
    if (openOnFocus) open = true
    void load()
  }

  /** The paths, fresh, and the level the field's value sits in. */
  async function load() {
    const mine = ++fetching
    const value = text
    const all = await loadPaths()
    if (mine !== fetching) return
    paths = all
    const found = valueIn(all, value)
    level = found === undefined ? null : parentsOf(found.path)
    // The current path is where the keys start; with none, the first.
    active = found?.path ?? null
  }

  /** The path a field's text names, without regard to case. */
  function valueIn(all: readonly ListedPath[], value = text): ListedPath | undefined {
    const typed = value.trim().toLowerCase()
    if (typed === '') return undefined
    return all.find(
      (p) => relativeOf(p.path).toLowerCase() === typed || p.path.toLowerCase() === typed,
    )
  }

  function oninput() {
    open = true
    active = null
    // Emptied, it opens again with every path, not the part of the tree it was in.
    if (text.trim() === '') level = null
    onchoose(text)
  }

  function pick(pick: Pick) {
    text = textOf(pick)
    kept = text
    open = false
    onchoose(text)
    onpicked?.()
  }

  function drill(pick: Pick) {
    level = pick.path
    active = null
    input?.focus()
  }

  function create(name: string) {
    text = name
    kept = text
    open = false
    onchoose(text)
    onpicked?.()
  }

  function go(part: string) {
    level = part
    active = null
    input?.focus()
  }

  function onkeydown(event: KeyboardEvent) {
    if (!open && event.key === 'ArrowDown') {
      event.preventDefault()
      open = true
      active = null
      void load()
      return
    }
    if (!open) return
    // Up and Down only: Home and End move the cursor in the field.
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && listbox.press(event)) return
    const entry = entries.find((e) => e.key === active)
    if (event.key === 'Enter' && entry !== undefined) {
      // Picks, and doesn't send the form.
      event.preventDefault()
      event.stopPropagation()
      if (entry.create !== null) create(entry.create.name)
      else if (entry.pick?.pickable) pick(entry.pick)
      else if (entry.pick !== null) drill(entry.pick)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      text = kept
      open = false
      onchoose(text)
      // A refile has no chip under it: one Escape puts the whole picker away.
      onclose?.()
    } else if (event.key === 'Tab') {
      open = false
    }
  }

  /** How long ago a path was used, in the picker's words. */
  function used(lastUsed: number | null): string {
    if (lastUsed === null) return ''
    const today = new Date()
    const then = new Date(lastUsed)
    const days = Math.floor(
      (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
        Date.UTC(then.getFullYear(), then.getMonth(), then.getDate())) /
        86_400_000,
    )
    if (days <= 0) return words.used.today
    if (days === 1) return words.used.yesterday
    return words.used.days(days)
  }
</script>

<span class="path-picker">
  <input
    bind:this={input}
    {id}
    {name}
    aria-label={label}
    bind:value={text}
    {placeholder}
    role="combobox"
    aria-autocomplete="list"
    aria-expanded={open}
    aria-controls={listId}
    aria-invalid={invalid}
    aria-describedby={describedby}
    autocomplete="off"
    maxlength="200"
    size={Math.max(text.length, placeholder.length, 4)}
    class:in-row={inRow}
    class:in-line={inline}
    class:filled={text.trim() !== ''}
    {onfocus}
    onblur={() => (open = false)}
    {oninput}
    {onkeydown}
  />
  <span
    class="options"
    class:empty={!open || entries.length === 0}
    use:floating={below === undefined ? input : { field: input, below }}
  >
    <Popover>
      {#if trail.length > 0}
        <div class="trail">
          {#each trail as part, i (part.path)}
            <button
              type="button"
              class:current={i === trail.length - 1}
              onmousedown={(event) => event.preventDefault()}
              onclick={() => go(part.path)}
            >
              {#if part.root}<Path path={part.path} spelled />{:else}{part.name}{/if}
            </button>
            <span class="colon">:</span>
          {/each}
        </div>
      {/if}
      <Listbox
        bind:this={listbox}
        items={entries}
        idOf={(entry) => entry.key}
        {active}
        label={listLabel}
        idPrefix={`${id}-path`}
        columns="minmax(0, 1fr) auto auto"
        owner={input}
        wrap
        hidden={entries.length === 0}
        onactive={(key) => (active = key)}
        onpick={(key) => {
          const entry = entries.find((e) => e.key === key)
          if (entry?.create) create(entry.create.name)
          else if (entry?.pick?.pickable) pick(entry.pick)
          else if (entry?.pick !== null && entry !== undefined) drill(entry.pick)
        }}
      >
        {#snippet row(entry)}
          {#if entry.create}
            <span class="new" data-create={entry.create.path}>{newOption?.(entry.create.name)}</span>
          {:else if entry.pick}
            <span class="name" data-path={entry.pick.path}>
              {#if typed}<Path path={entry.pick.path} />{:else}{entry.pick.name}{/if}
            </span>
            <span class:now={entry.pick.path === current?.path} class="hint">
              {entry.pick.path === current?.path ? words.used.now : used(entry.pick.lastUsed)}
            </span>
            {#if entry.pick.hasChildren}
              <button
                type="button"
                class="more"
                aria-label={words.open(entry.pick.name)}
                onmousedown={(event) => event.preventDefault()}
                onclick={(event) => {
                  event.stopPropagation()
                  if (entry.pick) drill(entry.pick)
                }}
              >
                ›
              </button>
            {/if}
          {/if}
        {/snippet}
      </Listbox>
    </Popover>
  </span>
</span>

<style>
  .path-picker {
    position: relative;
    display: grid;
  }

  input {
    font: inherit;
    padding: var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-control);
    color: inherit;
    background: transparent;
  }

  input[aria-invalid='true'] {
    border-color: var(--color-error);
  }

  input:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  /* In a list cell the row clips an outside ring: keep it inside the field. */
  input.in-row:focus-visible {
    outline-offset: -2px;
  }

  /* A composer part: the part around it draws the chip, the underline or the refusal. */
  input.in-line {
    padding: 0;
    border: 0;
    border-radius: 0;
    font-family: var(--font-code);
    background: none;
  }

  input.in-line:focus-visible {
    outline: none;
  }

  .options {
    position: absolute;
    inset-inline-start: 0;
    top: calc(100% + var(--space-1));
    /* Above the band that stays over the list, which shares a z-index with the picker. */
    z-index: 2;
    display: grid;
    /* Wider than a chip's field, so a whole path reads; never wider than the window. */
    inline-size: max-content;
    min-inline-size: 100%;
    max-inline-size: min(24rem, 90vw);
    max-height: 14rem;
    /* A row clips and keeps its text on one line; the list reads normally inside it. */
    white-space: normal;
  }

  .options.empty {
    display: none;
  }

  .trail {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border-block-end: var(--border-width) solid var(--color-border);
    background: var(--color-band);
    font-family: var(--font-code);
    font-size: var(--text-quiet);
  }

  .trail button {
    display: inline-flex;
    align-items: center;
    margin: 0;
    padding: 0;
    border: 0;
    font: inherit;
    color: inherit;
    background: none;
    cursor: pointer;
  }

  .trail button:hover {
    color: var(--color-text);
  }

  .trail .current {
    font-weight: var(--weight-label);
    color: var(--color-accent);
  }

  .colon {
    color: var(--color-muted);
  }

  .name {
    font-family: var(--font-code);
  }

  .hint {
    font-size: var(--text-quiet);
    color: var(--color-muted);
    white-space: nowrap;
  }

  .hint.now {
    color: var(--color-accent);
  }

  .new {
    font-style: italic;
  }

  .more {
    margin: 0;
    padding: 0 var(--space-1);
    border: 0;
    font: inherit;
    color: var(--color-muted);
    background: none;
    cursor: pointer;
  }

  .more:hover {
    color: var(--color-accent);
  }
</style>
