<script lang="ts">
  // Ctrl+K: every action the window carries out, under its heading, each with its keys, found by
  // the letters typed in order. Opaque over the window, which it blurs and dims. Enter runs the
  // one highlighted; Esc, or a click outside, closes it. The rules are in `palette.ts`.
  import { onMount } from 'svelte'
  import { copy } from '../copy'
  import type { KeyedActionId, WindowActionId } from '../shared/actions'
  import { type PaletteItem, type Shown, shownFor } from './palette'
  import Band from './parts/Band.svelte'
  import Empty from './parts/Empty.svelte'
  import Keys from './parts/Keys.svelte'
  import Listbox from './parts/Listbox.svelte'

  type Props = {
    items: readonly PaletteItem[]
    onrun: (id: WindowActionId) => void
    onclose: () => void
  }
  let { items, onrun, onclose }: Props = $props()

  const words = copy.palette
  let input = $state<HTMLInputElement>()
  let listbox: ReturnType<typeof Listbox<Shown>> | undefined = $state()
  let typed = $state('')
  let active = $state<string | null>(null)

  const shown = $derived(shownFor(items, typed))
  /** The headings over what shows, in order, and how many actions each has. */
  const headings = $derived(
    shown.reduce<{ heading: PaletteItem['heading']; count: number }[]>((all, { item }) => {
      const last = all.at(-1)
      if (last?.heading === item.heading) last.count++
      else all.push({ heading: item.heading, count: 1 })
      return all
    }, []),
  )

  // The first action is highlighted until the arrows move: Enter runs it.
  $effect(() => {
    const ids = shown.map((s) => s.item.id as string)
    if (active === null || !ids.includes(active)) active = ids[0] ?? null
  })

  onMount(() => input?.focus())

  function run() {
    const chosen = shown.find((s) => s.item.id === active)
    if (chosen !== undefined) onrun(chosen.item.id)
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      listbox?.press(event)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onclose()
    }
  }

  /** Its letters, each typed one marked. */
  const lettersOf = (label: string, marked: readonly number[]) =>
    [...label].map((letter, i) => ({ letter, marked: marked.includes(i) }))
</script>

<!-- A click outside the panel closes it; the keys are the input's. -->
<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="scrim" onmousedown={(e) => e.target === e.currentTarget && onclose()}>
  <div class="panel" role="dialog" aria-modal="true" aria-label={words.label}>
    <div class="field">
      <span class="prompt" aria-hidden="true">›</span>
      <input
        bind:this={input}
        bind:value={typed}
        name="palette"
        role="combobox"
        aria-label={words.label}
        aria-autocomplete="list"
        aria-expanded={shown.length > 0}
        aria-controls="palette-option-list"
        autocomplete="off"
        spellcheck="false"
        maxlength="100"
        {onkeydown}
        onblur={(e) => {
          // Clicked away to something else in the window: it closes, as a menu does.
          if (!(e.relatedTarget instanceof Node && e.currentTarget.closest('.panel')?.contains(e.relatedTarget)))
            onclose()
        }}
      />
      <span class="esc"><Keys key={words.esc} /> {words.close}</span>
    </div>
    <div class="options" hidden={shown.length === 0}>
      <Listbox
        bind:this={listbox}
        items={shown}
        idOf={(s) => s.item.id}
        {active}
        label={words.list}
        idPrefix="palette-option"
        columns="minmax(0, 1fr) auto"
        groups={headings.map((h) => h.count)}
        owner={input}
        wrap
        onactive={(id) => (active = id)}
        onpick={(id) => {
          active = id
          run()
        }}
      >
        {#snippet band(g)}
          {@const group = headings[g]}
          {#if group}<Band>{words.headings[group.heading]}</Band>{/if}
        {/snippet}
        {#snippet row(s)}
          <span
            >{#each lettersOf(s.item.label, s.marked) as { letter, marked }, i (i)}{#if marked}<mark
                  >{letter}</mark
                >{:else}{letter}{/if}{/each}</span
          >
          <span>{#if s.item.keyed}<Keys action={s.item.id as KeyedActionId} />{/if}</span>
        {/snippet}
      </Listbox>
    </div>
    {#if shown.length === 0}<div class="none"><Empty>{words.none}</Empty></div>{/if}
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: grid;
    justify-items: center;
    align-items: start;
    padding-block-start: 12vh;
    padding-inline: var(--space-4);
    background: var(--scrim);
    backdrop-filter: blur(6px);
  }

  @media (prefers-reduced-transparency: reduce) {
    .scrim {
      backdrop-filter: none;
    }
  }

  .panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    inline-size: min(100%, 35rem);
    max-block-size: 70vh;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-card);
    background: var(--color-background);
    box-shadow: var(--shadow-palette);
    overflow: hidden;
    animation: open var(--duration-open) var(--ease-out);
  }

  @keyframes open {
    from {
      opacity: 0;
      scale: 0.98;
    }
  }

  .field {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-block-end: var(--border-width) solid var(--color-rule);
    font-size: var(--text-sentence);
  }

  .prompt,
  .esc {
    color: var(--color-muted);
  }

  .esc {
    font-size: var(--text-small);
    white-space: nowrap;
  }

  input {
    flex: 1;
    min-width: 0;
    font: inherit;
    border: none;
    outline: none;
    color: inherit;
    background: transparent;
  }

  .options {
    display: grid;
    min-height: 0;
  }

  .options[hidden] {
    display: none;
  }

  .none {
    padding-inline: var(--space-4);
  }

  mark {
    font-weight: var(--weight-label);
    color: var(--color-accent);
    background: none;
  }
</style>
