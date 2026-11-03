<script lang="ts">
  import { named, type Offer, type Option, offered, stepped } from './picker'

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

  let input: HTMLInputElement
  let open = $state(false)
  /** What the list is filtered by: what I typed, or nothing when the arrows opened it. */
  let filter = $state('')
  let active = $state(0)
  /** What Escape puts back: the text when the field was entered, or last picked. */
  let kept = ''

  const listId = $derived(`${id}-options`)
  const shown = $derived(open ? offered(options, filter, newOption !== undefined) : [])
  const nameOf = (offer: Offer<Option>) => (offer.kind === 'mine' ? offer.option.name : offer.name)
  const keyOf = (offer: Offer<Option>) =>
    offer.kind === 'mine' ? offer.option.id : `new:${offer.name}`
  const optionId = (i: number) => `${id}-option-${i}`

  export function focus() {
    input.focus()
  }

  function oninput() {
    filter = text
    active = 0
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
      active = Math.max(
        0,
        options.findIndex((o) => o === named(options, text)),
      )
      open = true
      return
    }
    if (!open) return
    const to = stepped(active, event.key, shown.length)
    const option = shown[active]
    if (to !== undefined) {
      event.preventDefault()
      active = to
    } else if (event.key === 'Enter' && option !== undefined) {
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

  // Keeps the active option in view as the arrows move it.
  $effect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' })
  })
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
    aria-activedescendant={shown[active] === undefined ? undefined : optionId(active)}
    aria-invalid={invalid}
    aria-describedby={describedby}
    autocomplete="off"
    maxlength="200"
    onfocus={() => (kept = text)}
    onblur={() => (open = false)}
    {oninput}
    {onkeydown}
  />
  <ul id={listId} role="listbox" aria-label={listLabel} hidden={shown.length === 0}>
    {#each shown as offer, i (keyOf(offer))}
      <!-- Picked on mousedown, before the field loses the cursor and closes the list. -->
      <li
        id={optionId(i)}
        role="option"
        aria-selected={i === active}
        class:new={offer.kind === 'new'}
        onmousedown={(e) => {
          e.preventDefault()
          pick(offer)
        }}
      >
        {#if offer.kind === 'mine'}
          <span>{offer.option.name}</span>
          <span class="hint">{(offer.option as Option & { hint?: string }).hint ?? ''}</span>
        {:else}
          <span>{newOption?.(offer.name)}</span>
        {/if}
      </li>
    {/each}
  </ul>
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
    border-radius: var(--radius);
    color: inherit;
    background: transparent;
  }

  input[aria-invalid='true'] {
    border-color: var(--color-error);
  }

  ul {
    position: absolute;
    inset-inline: 0;
    top: calc(100% + var(--space-1));
    z-index: 1;
    max-height: 12rem;
    overflow-y: auto;
    margin: 0;
    padding: var(--space-1) 0;
    list-style: none;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-background);
  }

  ul[hidden] {
    display: none;
  }

  li {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-1) var(--space-2);
    cursor: default;
  }

  li[aria-selected='true'] {
    background: var(--color-selected);
  }

  .hint {
    font-size: var(--font-size-small);
    color: var(--color-muted);
  }

  .new {
    font-style: italic;
  }
</style>
