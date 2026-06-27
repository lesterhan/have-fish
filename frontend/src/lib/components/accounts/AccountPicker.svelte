<script lang="ts">
  import { tick } from 'svelte'
  import { createAccount, type Account } from '$lib/api'
  import { rank } from './accountScorer'
  import { buildTree, type TreeNode } from './accountTree'

  interface Props {
    accounts: Account[]
    /** Bound account ID (default) or path string (when searchOnly=true). */
    value: string
    placeholder?: string
    /** Path-string mode: value IS the path, partial paths are valid, no create. */
    searchOnly?: boolean
    /** When false, hides the create option (ID mode only). */
    allowCreate?: boolean
    oncreate?: (account: Account) => void
    /** Fires after any selection (existing path/id or a freshly created account). */
    oncommit?: (value: string) => void
  }

  let {
    accounts,
    value = $bindable(''),
    placeholder = 'Pick an account…',
    searchOnly = false,
    allowCreate = true,
    oncreate,
    oncommit,
  }: Props = $props()

  const listboxId = `account-picker-${Math.random().toString(36).slice(2, 7)}`
  const SEP = ':'

  // --- Derived data from the account list ------------------------------------
  const tree = $derived(buildTree(accounts))
  const pathToAccount = $derived(
    new Map(accounts.map((a) => [a.path, a] as const)),
  )

  // The committed path is the single source of truth at rest:
  // ID mode resolves the selected account's path; searchOnly uses value directly.
  const committedPath = $derived(
    searchOnly ? value : (accounts.find((a) => a.id === value)?.path ?? ''),
  )

  // --- Interaction state -----------------------------------------------------
  let open = $state(false) // is the dropdown showing?
  let searching = $state(false) // search mode vs. drill mode
  let creating = $state(false)

  // Drill state: a working copy of the path being walked + which depth's column
  // is open. Diverges from committedPath while the user is mid-drill; resyncs at
  // rest (see the effect below).
  let segs = $state<string[]>([])
  let level = $state(0)
  let colActive = $state(0)

  // Search state
  let query = $state('')
  let sActive = $state(0)

  let rootEl: HTMLDivElement | null = $state(null)
  let inputEl: HTMLInputElement | null = $state(null)
  let menuStyle = $state('')

  // Resync the working drill copy to the committed path whenever the control is
  // at rest (closed / not searching). While the menu is open the internal state
  // drives, so we don't clobber an in-progress drill or revert a search.
  $effect(() => {
    const path = committedPath
    if (!open && !searching) {
      // Use a local for the length read — reading `segs` back here after
      // writing it would make this effect depend on state it sets, looping.
      const next = path ? path.split(SEP) : []
      segs = next
      level = Math.max(0, next.length - 1)
    }
  })

  // --- Drill column ----------------------------------------------------------
  const drillPrefix = $derived(segs.slice(0, level).join(SEP))
  const colItems = $derived(
    open && !searching ? tree.childrenOf(drillPrefix) : [],
  )
  // Highlight the segment we currently hold at this level when the column opens.
  $effect(() => {
    const items = colItems
    const cur = segs[level]
    const idx = items.findIndex((n) => n.name === cur)
    colActive = idx >= 0 ? idx : 0
  })

  // Show a "go deeper" affordance only when the committed leaf has children.
  const canGoDeeper = $derived(
    open &&
      !searching &&
      segs.length > 0 &&
      tree.childrenOf(segs.join(SEP)).length > 0,
  )

  // --- Search results --------------------------------------------------------
  type SearchRow =
    | { kind: 'account'; account: Account; pos: number[] }
    | { kind: 'create'; path: string }

  const searchResults = $derived.by<SearchRow[]>(() => {
    if (!searching) return []
    const ranked = rank(query, accounts).slice(0, 8)
    const rows: SearchRow[] = ranked.map((r) => ({
      kind: 'account',
      account: r,
      pos: r.pos,
    }))
    // Create-new pseudo-row: demoted below a dashed divider, only when the query
    // is typed, non-empty, contains a letter, and matches no existing path.
    const norm = query.trim()
    const exact = accounts.some((a) => a.path === norm)
    const showCreate =
      !searchOnly && allowCreate && norm.length > 0 && !exact && /[a-z]/i.test(norm)
    if (showCreate) rows.push({ kind: 'create', path: norm })
    return rows
  })
  $effect(() => {
    // Keep the active row in range; the top *real* match is the default.
    if (sActive >= searchResults.length) sActive = 0
  })

  // --- Highlight rendering ---------------------------------------------------
  type Glyph = { ch: string; sep: boolean; leaf: boolean; hl: boolean }
  function glyphs(path: string, pos: number[]): Glyph[] {
    const set = new Set(pos)
    const lastSep = path.lastIndexOf(SEP)
    const out: Glyph[] = []
    for (let i = 0; i < path.length; i++) {
      const ch = path[i]
      if (ch === SEP) out.push({ ch, sep: true, leaf: false, hl: false })
      else out.push({ ch, sep: false, leaf: i > lastSep, hl: set.has(i) })
    }
    return out
  }

  // --- Positioning -----------------------------------------------------------
  function positionMenu() {
    if (!rootEl) return
    const rect = rootEl.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    if (spaceBelow < 240 && rect.top > spaceBelow) {
      menuStyle = `position: fixed; bottom: ${window.innerHeight - rect.top + 4}px; left: ${rect.left}px; width: ${rect.width}px;`
    } else {
      menuStyle = `position: fixed; top: ${rect.bottom + 4}px; left: ${rect.left}px; width: ${rect.width}px;`
    }
  }

  function openDrill() {
    if (open) return
    open = true
    positionMenu()
  }
  function closeMenu() {
    open = false
  }

  // --- Commit helpers --------------------------------------------------------
  function commitNode(node: TreeNode) {
    if (searchOnly) {
      value = node.path
      oncommit?.(value)
    } else if (node.isAccount) {
      const acc = pathToAccount.get(node.path)
      if (acc) {
        value = acc.id
        oncommit?.(value)
      }
    }
    // Pure-parent nodes in ID mode have no account — drilling handles them.
  }

  // Choose a column item: commit it (unless drillOnly), then drill into its
  // children if any, else close the menu.
  function chooseCol(node: TreeNode | undefined, drillOnly = false) {
    if (!node) return
    segs = segs.slice(0, level).concat(node.name)
    if (!drillOnly) commitNode(node)
    if (node.children.size > 0) {
      level = segs.length // advance to the child column
    } else {
      closeMenu()
    }
  }

  function colUp() {
    if (level > 0) {
      level--
      segs = segs.slice(0, level + 1)
    }
  }

  // --- Search mode -----------------------------------------------------------
  async function enterSearch(initial: string) {
    searching = true
    query = initial
    sActive = 0
    open = true
    positionMenu()
    await tick()
    inputEl?.focus()
    const len = inputEl?.value.length ?? 0
    inputEl?.setSelectionRange(len, len)
  }

  function exitSearch() {
    searching = false
    query = ''
    level = Math.max(0, segs.length - 1)
    rootEl?.focus()
  }

  async function acceptSearch(row: SearchRow | undefined) {
    if (!row) return
    if (row.kind === 'create') {
      if (creating) return
      creating = true
      try {
        const acc = await createAccount({ path: row.path })
        oncreate?.(acc)
        value = acc.id
        segs = acc.path.split(SEP)
        oncommit?.(value)
      } finally {
        creating = false
      }
    } else {
      value = searchOnly ? row.account.path : row.account.id
      segs = row.account.path.split(SEP)
      oncommit?.(value)
    }
    searching = false
    query = ''
    open = false
  }

  // --- Keyboard --------------------------------------------------------------
  function onRootKeydown(e: KeyboardEvent) {
    if (searching) return
    if (!open) {
      // First interaction: a printable key enters search, anything else opens drill.
      if (e.key.length === 1 && /\S/.test(e.key)) {
        e.preventDefault()
        enterSearch(e.key)
      } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault()
        openDrill()
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        colActive = Math.min(colActive + 1, colItems.length - 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        colActive = Math.max(colActive - 1, 0)
        break
      case 'ArrowRight':
        e.preventDefault()
        chooseCol(colItems[colActive], true)
        break
      case 'ArrowLeft':
      case 'Backspace':
        e.preventDefault()
        colUp()
        break
      case 'Enter':
        e.preventDefault()
        chooseCol(colItems[colActive], false)
        break
      case 'Escape':
        e.preventDefault()
        closeMenu()
        break
      default:
        if (e.key.length === 1 && /\S/.test(e.key)) {
          e.preventDefault()
          enterSearch(e.key)
        }
    }
  }

  function onSearchKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        sActive = Math.min(sActive + 1, searchResults.length - 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        sActive = Math.max(sActive - 1, 0)
        break
      case 'Enter':
        e.preventDefault()
        acceptSearch(searchResults[sActive])
        break
      case 'Escape':
        e.preventDefault()
        exitSearch()
        break
      case 'Backspace':
        if (query === '') {
          e.preventDefault()
          exitSearch()
        }
        break
    }
  }

  // --- Focus / pointer -------------------------------------------------------
  function onRootFocusIn() {
    if (!searching) openDrill()
  }
  function onRootFocusOut() {
    // Delay so a menu/crumb mousedown can run before we tear down.
    setTimeout(() => {
      if (rootEl?.contains(document.activeElement)) return
      if (searching) {
        searching = false
        query = ''
      }
      open = false
    }, 130)
  }

  function onCrumbClick(i: number) {
    level = i
    openDrill()
    rootEl?.focus()
  }
  function onDeeperClick() {
    level = segs.length
    openDrill()
    rootEl?.focus()
  }
  function toggleSearch() {
    if (searching) exitSearch()
    else enterSearch('')
  }

  function portal(node: HTMLElement) {
    document.body.appendChild(node)
    return { destroy: () => node.remove() }
  }
</script>

<div
  class="picker"
  class:elevated={open}
  bind:this={rootEl}
  role="combobox"
  tabindex="0"
  aria-expanded={open}
  aria-controls={listboxId}
  aria-haspopup="listbox"
  onkeydown={onRootKeydown}
  onfocusin={onRootFocusIn}
  onfocusout={onRootFocusOut}
>
  <div class="dbox">
    {#if searching}
      <input
        class="dsearch"
        bind:this={inputEl}
        bind:value={query}
        {placeholder}
        disabled={creating}
        spellcheck="false"
        autocomplete="off"
        aria-label="Search accounts"
        onkeydown={onSearchKeydown}
        oninput={() => (sActive = 0)}
      />
      <span class="rhint"><kbd>esc</kbd></span>
    {:else}
      <div class="crumbs">
        {#if segs.length === 0}
          <span class="placeholder">{placeholder}</span>
        {:else}
          {#each segs as seg, i (i)}
            {#if i > 0}<span class="csep">:</span>{/if}
            <button
              type="button"
              class="crumb"
              class:editing={i === level && open}
              onclick={() => onCrumbClick(i)}
              tabindex="-1"
            >
              {seg}
            </button>
          {/each}
        {/if}
        {#if canGoDeeper}
          <button
            type="button"
            class="crumb deeper"
            title="Go deeper"
            onclick={onDeeperClick}
            tabindex="-1"
          >
            ›
          </button>
        {/if}
      </div>
    {/if}
    <button
      type="button"
      class="searchbtn"
      class:on={searching}
      title="Search the whole tree — or just start typing"
      aria-label="Search accounts"
      onmousedown={(e) => {
        e.preventDefault()
        toggleSearch()
      }}
      tabindex="-1"
    >
      ⌕
    </button>
  </div>

  {#if open}
    <ul use:portal id={listboxId} class="menu" style={menuStyle} role="listbox">
      {#if searching}
        {#each searchResults as row, i (i)}
          {#if row.kind === 'create'}
            <li
              class="row create"
              class:on={i === sActive}
              role="option"
              aria-selected={i === sActive}
              onmousemove={() => (sActive = i)}
              onmousedown={(e) => {
                e.preventDefault()
                acceptSearch(row)
              }}
            >
              <span class="ci">＋</span>
              <span class="ct">Create new account <code>{row.path}</code></span>
            </li>
          {:else}
            <li
              class="row"
              class:on={i === sActive}
              role="option"
              aria-selected={i === sActive}
              onmousemove={() => (sActive = i)}
              onmousedown={(e) => {
                e.preventDefault()
                acceptSearch(row)
              }}
            >
              <span class="path">
                {#each glyphs(row.account.path, row.pos) as g}
                  {#if g.sep}<span class="sep">:</span>
                  {:else}<span
                      class:leaf={g.leaf}
                      class:anc={!g.leaf}
                      class:hl={g.hl}>{g.ch}</span
                    >{/if}
                {/each}
              </span>
              {#if i === 0}<span class="best">best</span>{/if}
            </li>
          {/if}
        {/each}
      {:else if colItems.length === 0}
        <li class="row empty">nothing deeper</li>
      {:else}
        {#each colItems as node, i (node.path)}
          <li
            class="row col"
            class:on={i === colActive}
            role="option"
            aria-selected={i === colActive}
            onmousemove={() => (colActive = i)}
            onmousedown={(e) => {
              e.preventDefault()
              rootEl?.focus()
              chooseCol(node, false)
            }}
          >
            <span class="path"><span class="leaf">{node.name}</span></span>
            {#if node.children.size > 0}
              <span class="chev">›</span>
            {:else}
              <span class="chev dot">•</span>
            {/if}
          </li>
        {/each}
      {/if}
    </ul>
  {/if}
</div>

<style>
  .picker {
    position: relative;
    width: 100%;
    outline: none;
  }
  .picker.elevated {
    z-index: 51;
  }
  .picker:focus-visible .dbox {
    border-color: var(--color-accent-mid);
    box-shadow: 0 0 0 2px var(--color-accent-light);
  }

  .dbox {
    display: flex;
    align-items: center;
    gap: 4px;
    box-sizing: border-box;
    min-height: 22px;
    padding: 1px 2px 1px 4px;
    background: var(--color-window-inset);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-inset);
    transition:
      border-color var(--duration-fast) var(--ease),
      box-shadow var(--duration-fast) var(--ease);
  }

  .crumbs {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    flex: 1 1 auto;
    gap: 1px;
    min-width: 0;
  }

  .placeholder {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-text-disabled);
    padding: 2px 4px;
  }

  .crumb {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-text-muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    padding: 2px 4px;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background var(--duration-fast) var(--ease),
      color var(--duration-fast) var(--ease),
      border-color var(--duration-fast) var(--ease);
  }
  .crumb:hover {
    background: var(--color-window-raised);
    color: var(--color-text);
  }
  .crumb.editing {
    color: var(--color-accent-chip-fg);
    background: var(--color-accent-chip-bg);
    border-color: var(--color-accent-mid);
    font-weight: 600;
  }
  .crumb.deeper {
    color: var(--color-text-disabled);
    font-size: 13px;
    padding: 0 3px;
  }

  .csep {
    color: var(--color-text-disabled);
    font-family: var(--font-mono);
    font-size: 11px;
    opacity: 0.55;
  }

  .dsearch {
    flex: 1 1 auto;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-text);
    background: transparent;
    border: none;
    outline: none;
    padding: 2px 4px;
  }
  .dsearch:disabled {
    cursor: wait;
  }

  .rhint {
    flex: 0 0 auto;
    color: var(--color-text-disabled);
  }
  .rhint kbd {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    padding: 0 3px;
  }

  .searchbtn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    font-size: 13px;
    line-height: 1;
    color: var(--color-text-muted);
    background: var(--color-window-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease),
      color var(--duration-fast) var(--ease),
      border-color var(--duration-fast) var(--ease);
  }
  .searchbtn:hover {
    color: var(--color-accent);
    border-color: var(--color-accent-mid);
    background: var(--color-window-inset);
  }
  .searchbtn.on {
    color: var(--color-accent-chip-fg);
    background: var(--color-accent-chip-bg);
    border-color: var(--color-accent-mid);
  }

  /* Dropdown */
  .menu {
    z-index: 100;
    list-style: none;
    margin: 0;
    padding: 3px;
    background: var(--color-window);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-window);
    max-height: 280px;
    overflow-y: auto;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 7px;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 11px;
    cursor: default;
    white-space: nowrap;
  }
  .row.on {
    background: var(--color-accent);
    color: var(--color-accent-text);
  }
  .row.empty {
    color: var(--color-text-disabled);
    font-style: italic;
    cursor: default;
  }

  .path {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .anc {
    color: var(--color-text-muted);
  }
  .leaf {
    color: var(--color-text);
  }
  .sep {
    color: var(--color-text-disabled);
    opacity: 0.6;
  }
  .hl {
    color: var(--color-accent);
    font-weight: 700;
  }
  /* On the active (accent-filled) row, flip highlights to stay legible. */
  .row.on .anc,
  .row.on .leaf,
  .row.on .sep,
  .row.on .hl {
    color: var(--color-accent-text);
  }

  .chev {
    flex: 0 0 auto;
    color: var(--color-text-disabled);
    font-size: 13px;
  }
  .chev.dot {
    color: var(--color-accent-mid);
  }
  .row.on .chev,
  .row.on .chev.dot {
    color: var(--color-accent-text);
  }

  .best {
    flex: 0 0 auto;
    font-size: 8.5px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--color-accent);
    background: var(--color-window-inset);
    border: 1px solid var(--color-accent-mid);
    border-radius: var(--radius-sm);
    padding: 0 3px;
  }
  .row.on .best {
    color: var(--color-accent-text);
    border-color: var(--color-accent-text);
    background: transparent;
  }

  /* Demoted create row */
  .row.create {
    margin-top: 4px;
    padding-top: 6px;
    border-top: 1px dashed var(--color-rule);
    color: var(--color-text-muted);
    gap: 5px;
    justify-content: flex-start;
  }
  .row.create.on {
    background: var(--color-accent);
    color: var(--color-accent-text);
  }
  .row.create .ci {
    color: var(--color-accent);
    font-weight: 700;
  }
  .row.create.on .ci {
    color: var(--color-accent-text);
  }
  .row.create code {
    font-family: var(--font-mono);
  }
</style>
