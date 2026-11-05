<script lang="ts">
  import Listbox from './parts/Listbox.svelte'
  import { named, type Offer, type Option, offered } from './picker'

  type Props = {
    /** The field's id, for its label; the list's is built from it. */
    id: string
    name: string
    options: (Option & { hint?: string })[]
    /** What the field shows. */
    text: string
    placeholder: string
    /** What the list of options is called, read out. */
    listLabel: string
    invalid: boolean
    describedby: string | undefined
    /** I typed, or picked: the field holds my choice now, which is `text`. */
    onchoose: (text: string) => void
    /** Given, a name none of mine has is offered as a new one, in these words. */
    newOption?: ((name: string) => string) | undefined
  }
  let {
    id,
    name,
    options,
    text = $bindable(),
    placeholder,
    listLabel,
    invalid,
    describedby,
    onchoose,
    newOption,
  }: Props = $props()

  let input = $state<HTMLInputElement>()
  let listbox: ReturnType<typeof Listbox<Offer<Option>>>
  let open = $state(false)
  /** What the list is filtered by: what I typed, or nothing when the arrows opened it. */
  let filter = $state('')
  /** The highlighted offer's key. */
  let active = $state<string | null>(null)
  /** What Escape puts back: the text when the field was entered, or last picked. */
  let kept = ''

  const listId = $derived(`${id}-option-list`)
  const shown = $derived(open ? offered(options, filter, newOption !== undefined) : [])
  const nameOf = (offer: Offer<Option>) => (offer.kind === 'mine' ? offer.option.name : offer.name)
  // An element id can't hold a space, and a new name may.
  const keyOf = (offer: Offer<Option>) =>
    offer.kind === 'mine' ? offer.option.id : `new-${encodeURIComponent(offer.name)}`

  // The first offer is highlighted until the arrows move: Enter picks it.
  $effect(() => {
    const keys = shown.map(keyOf)
    if (active === null || !keys.includes(active)) active = keys[0] ?? null
  })

  export function focus() {
    input?.focus()
  }

  function oninput() {
    filter = text
    active = null
    // Emptied, Enter sends the form: nothing typed is nothing to pick from. Down still lists all.
    open = text.trim() !== ''
    onchoose(text)
  }

  function pick(offer: Offer<Option>) {
    text = nameOf(offer)
    kept = text
    open = false
    onchoose(text)
  }

  function onkeydown(event: KeyboardEvent) {
    if (!open && event.key === 'ArrowDown') {
      event.preventDefault()
      filter = ''
      const current = named(options, text)
      active = current === undefined ? null : current.id
      open = true
      return
    }
    if (!open) return
    // Up and Down only: Home and End move the cursor in the field.
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && listbox.press(event)) return
    const option = shown.find((o) => keyOf(o) === active)
    if (event.key === 'Enter' && option !== undefined) {
      // Picks, and doesn't send the form.
      event.preventDefault()
      pick(option)
    } else if (event.key === 'Escape') {
      // Only the list: the form's own Escape waits for the next press.
      event.preventDefault()
      event.stopPropagation()
      text = kept
      open = false
      onchoose(text)
    }
  }

</script>

<span class="picker">
  <input
    bind:this={input}
    {id}
    {name}
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
    onfocus={() => (kept = text)}
    onblur={() => (open = false)}
    {oninput}
    {onkeydown}
  />
  <span class="options" class:empty={shown.length === 0}>
    <Listbox
      bind:this={listbox}
      items={shown}
      idOf={keyOf}
      {active}
      label={listLabel}
      idPrefix={`${id}-option`}
      columns="minmax(0, 1fr) auto"
      owner={input}
      wrap
      hidden={shown.length === 0}
      onactive={(key) => (active = key)}
      onpick={(key) => {
        const offer = shown.find((o) => keyOf(o) === key)
        if (offer !== undefined) pick(offer)
      }}
    >
      {#snippet row(offer)}
        {#if offer.kind === 'mine'}
          <span>{offer.option.name}</span>
          <span class="hint">{(offer.option as Option & { hint?: string }).hint ?? ''}</span>
        {:else}
          <span class="new">{newOption?.(offer.name)}</span>
        {/if}
      {/snippet}
    </Listbox>
  </span>
</span>

<style>
  .picker {
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

  .options {
    position: absolute;
    inset-inline: 0;
    top: calc(100% + var(--space-1));
    z-index: 1;
    display: grid;
    max-height: 12rem;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-control);
    background: var(--color-background);
    box-shadow: var(--shadow-pop);
    overflow: hidden;
  }

  .options.empty {
    display: none;
  }

  .hint {
    font-size: var(--text-quiet);
    color: var(--color-muted);
  }

  .new {
    font-style: italic;
  }
</style>
