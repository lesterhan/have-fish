<script lang="ts">
  import { goto } from '$app/navigation'
  import { rank } from './accountScorer'
  import { glyphs } from './accountHighlight'
  import type { SidebarAccount, SidebarRow } from './sidebarAccounts'

  /**
   * Ctrl+K: type a few characters, hit Enter, land on the account.
   *
   * This is what lets the sidebar stop being an index. `accountScorer` already ranks
   * segment-aware — `wis` puts `assets:wise:*` on top rather than scattering into
   * `assets:savings` — so the palette is a search box over work that already existed.
   *
   * Scoped to jumping. A palette that also runs actions and opens pages is the obvious next
   * step and the obvious way to blow the epic open; the shell makes adding verbs cheap later.
   */
  interface Props {
    /** Every account, categories included: this answers "where is X", and X may be a category. */
    accounts: SidebarAccount[]
    /** Shown before anything is typed — the sidebar passes its pinned and recent rows. */
    initial?: SidebarRow[]
    /** Bound so the host can open it from its own shortcut or a button. */
    open: boolean
  }

  let { accounts, initial = [], open = $bindable(false) }: Props = $props()

  const MAX_RESULTS = 8

  let query = $state('')
  let active = $state(0)
  let inputEl = $state<HTMLInputElement | undefined>(undefined)

  type Result = { id: string; path: string; label: string; pos: number[] }

  let results = $derived.by<Result[]>(() => {
    const q = query.trim()
    if (!q) {
      // No query yet: the sidebar's own two lists, which are the answer often enough that
      // Ctrl+K then Enter is a shortcut to the account you were just in.
      return initial
        .slice(0, MAX_RESULTS)
        .map((r) => ({ id: r.id, path: r.path, label: r.label, pos: [] }))
    }
    return rank(q, accounts)
      .slice(0, MAX_RESULTS)
      .map((r) => ({ id: r.id, path: r.path, label: r.path, pos: r.pos }))
  })

  // A shrinking result set must not leave the highlight past the end of the list.
  $effect(() => {
    if (active >= results.length) active = 0
  })

  export function show() {
    query = ''
    active = 0
    open = true
  }

  function close() {
    open = false
  }

  function jump(result: Result | undefined) {
    if (!result) return
    close()
    void goto(`/account/${result.id}`)
  }

  // Ctrl+K, and Cmd+K for anyone arriving from a Mac. Not captured while typing in another
  // field: the browser's own Ctrl+K is a search shortcut, so taking it everywhere would be
  // rude, but taking it over the app chrome is the point.
  function onWindowKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      if (open) close()
      else show()
    }
  }

  function onPaletteKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        close()
        break
      case 'ArrowDown':
        e.preventDefault()
        active = results.length === 0 ? 0 : (active + 1) % results.length
        break
      case 'ArrowUp':
        e.preventDefault()
        active =
          results.length === 0 ? 0 : (active - 1 + results.length) % results.length
        break
      case 'Enter':
        e.preventDefault()
        jump(results[active])
        break
    }
  }

  $effect(() => {
    if (open) inputEl?.focus()
  })
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if open}
  <!-- Click-through backdrop: dismissing by clicking away is expected of a palette, and the
       keyboard path (Escape) is handled on the panel itself. -->
  <div
    class="backdrop"
    role="presentation"
    onclick={close}
    onkeydown={onPaletteKeydown}
  ></div>

  <div class="palette" role="dialog" aria-label="Jump to account" aria-modal="true">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="field" onkeydown={onPaletteKeydown} role="presentation">
      <input
        bind:this={inputEl}
        bind:value={query}
        class="input"
        type="text"
        placeholder="Jump to account…"
        aria-label="Jump to account"
        aria-controls="jump-results"
        autocomplete="off"
        spellcheck="false"
      />
      <span class="hint">Ctrl K</span>
    </div>

    <ul class="results" id="jump-results">
      {#if results.length === 0}
        <li class="empty">
          {query.trim() ? `Nothing matches “${query.trim()}”.` : 'No accounts yet.'}
        </li>
      {:else}
        {#each results as result, i (result.id)}
          <li>
            <button
              type="button"
              class="result"
              class:active={i === active}
              onmouseenter={() => (active = i)}
              onclick={() => jump(result)}
            >
              {#if result.pos.length > 0}
                <span class="path">
                  {#each glyphs(result.path, result.pos) as g, gi (gi)}
                    <span
                      class="glyph"
                      class:sep={g.sep}
                      class:leaf={g.leaf}
                      class:hl={g.hl}>{g.ch}</span
                    >
                  {/each}
                </span>
              {:else}
                <span class="path"><span class="glyph leaf">{result.label}</span></span>
              {/if}
            </button>
          </li>
        {/each}
      {/if}
    </ul>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.28);
    z-index: 300;
  }

  .palette {
    position: fixed;
    top: 18vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(520px, calc(100vw - 2 * var(--sp-lg)));
    z-index: 301;
    background: var(--color-window);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-window);
    overflow: hidden;
  }

  .field {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-sm) var(--sp-md);
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-window-inset);
  }

  .input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: none;
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: var(--text-base);
  }

  .hint {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--color-text-muted);
    padding: 1px 4px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    white-space: nowrap;
  }

  .results {
    list-style: none;
    margin: 0;
    padding: var(--sp-xs);
    max-height: 46vh;
    overflow-y: auto;
  }

  .result {
    display: block;
    width: 100%;
    text-align: left;
    padding: var(--sp-xs) var(--sp-sm);
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .result.active {
    background: var(--color-accent);
    color: var(--color-accent-fg);
  }

  .glyph.sep {
    opacity: 0.45;
  }

  .glyph.leaf {
    font-weight: var(--weight-semibold);
  }

  .glyph.hl {
    color: var(--color-accent-chip-fg);
    background: var(--color-accent-light);
    border-radius: 2px;
  }

  .result.active .glyph.hl {
    color: inherit;
    background: rgba(255, 255, 255, 0.28);
  }

  .empty {
    padding: var(--sp-sm);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }
</style>
