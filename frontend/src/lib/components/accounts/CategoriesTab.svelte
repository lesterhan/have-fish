<script lang="ts">
  import { onMount } from 'svelte'
  import Card from '$lib/components/ui/Card.svelte'
  import Chip from '$lib/components/ui/Chip.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import Modal from '$lib/components/ui/Modal.svelte'
  import Select from '$lib/components/ui/Select.svelte'
  import Shimmer from '$lib/components/ui/Shimmer.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import {
    createAccount,
    deleteAccount,
    fetchAccountPostingCounts,
    fetchAccounts,
    renameAccount,
    type Account,
    type UserSettings,
  } from '$lib/api'
  import { toast } from '$lib/toast.svelte'
  import { bump as refreshSidebar } from '$lib/sidebarRefresh.svelte'
  import { rank } from '$lib/components/accounts/accountScorer'
  import { rootsFrom } from '$lib/components/accounts/accountPaths'
  import {
    ROLE_DESCRIPTION,
    ROLE_LABEL,
    protectionFor,
    protectionMessage,
    rolesOf,
    type Protection,
  } from '$lib/components/accounts/accountRoles'
  import {
    affectedPaths,
    branchPaths,
    categorySections,
    emptyRows,
    filterNodes,
    findCollision,
    flattenNodes,
    isDeletable,
    nodePaths,
    pathError,
    renameTarget,
    segmentError,
    type CategoryNode,
    type CategorySection,
    type CategoryStat,
  } from '$lib/components/accounts/categoryTree'

  /**
   * Categories — the expenses and income tree, and the last home of two things that were
   * scattered across `/accounts/manage` and the Settings account panel.
   *
   * The rename cascade comes from the manage page unchanged in behaviour: renaming a segment
   * rewrites every path beneath it in one request, and you are told how many rows that is
   * before it happens. Quick-add by raw path comes from Settings, which was the only surface
   * that let you type `expenses:travel:flights` and have the parents appear.
   *
   * What did *not* come across is the manage page's right-hand transaction preview. Story 6
   * gives every row on both tabs the same in-place expansion, and two ways to look at a
   * category's entries is one more than the page needs.
   */
  interface Props {
    /** Owned by the page: the tab reads roots and role pointers, and never writes them. */
    settings: UserSettings | null
  }

  let { settings }: Props = $props()

  let accounts = $state<Account[]>([])
  let statsById = $state<Map<string, CategoryStat>>(new Map())
  let loading = $state(true)
  let error = $state<string | null>(null)

  // Its own fetch rather than the page's: the tab only mounts when it is opened, so someone
  // who never leaves the Accounts tab never pays for this.
  onMount(load)

  async function load() {
    try {
      const [list, counts] = await Promise.all([
        fetchAccounts(),
        fetchAccountPostingCounts(),
      ])
      accounts = list
      statsById = new Map(
        counts.map((c) => [
          c.accountId,
          { count: c.count, lastActivity: c.lastActivity },
        ]),
      )
      error = null
    } catch {
      error = 'Could not load categories.'
    } finally {
      loading = false
    }
  }

  let roots = $derived(rootsFrom(settings))
  let allAccountPaths = $derived(accounts.map((a) => a.path))

  let sections = $derived(categorySections(accounts, statsById, roots))

  // ── Controls ──────────────────────────────────────────────
  let query = $state('')
  let view = $state<'tree' | 'flat'>('tree')
  let emptyOnly = $state(false)

  /** Rows with no entries and nothing beneath them, across every section — the chip's count. */
  let emptyPaths = $derived(
    new Set(sections.flatMap((s) => emptyRows(s.nodes)).map((n) => n.path)),
  )

  /**
   * Search matches over every node path including the virtual ones, so `food` finds the
   * branch even when no account was filed at `expenses:food` itself.
   */
  function matcher(nodes: CategoryNode[]): ((node: CategoryNode) => boolean) | null {
    const q = query.trim()
    if (!q) return null
    const matched = new Set(
      rank(
        q,
        nodePaths(nodes).map((path) => ({ path })),
      ).map((m) => m.path),
    )
    return (node) => matched.has(node.path)
  }

  function visibleNodes(section: CategorySection): CategoryNode[] {
    let nodes = section.nodes
    const match = matcher(nodes)
    if (match) nodes = filterNodes(nodes, match)
    // The empty filter keeps only the rows with nothing in them, plus their ancestors — the
    // point of the chip is to walk you to what you might want to clear out.
    if (emptyOnly) nodes = filterNodes(nodes, (n) => isDeletable(n))
    return nodes
  }

  // Flat view: the one thing the Settings list did that a tree does not — every real row,
  // full path, one line each, nothing to open.
  function flatRows(section: CategorySection): CategoryNode[] {
    const out: CategoryNode[] = []
    const walk = (list: readonly CategoryNode[]) => {
      for (const node of list) {
        if (node.accountId !== null) out.push(node)
        walk(node.children)
      }
    }
    walk(visibleNodes(section))
    return out.sort((a, b) => a.path.localeCompare(b.path))
  }

  // ── Collapse ──────────────────────────────────────────────
  let collapsed = $state<Set<string>>(new Set())
  let sectionCollapsed = $state<Record<string, boolean>>({})

  function toggleBranch(path: string) {
    const next = new Set(collapsed)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    collapsed = next
  }

  // A search result you still have to expand is not a search result, so a live query opens
  // everything; the collapse set is kept, so clearing the query restores what you folded.
  let searching = $derived(query.trim().length > 0 || emptyOnly)

  function rowsFor(section: CategorySection) {
    if (view === 'flat') {
      return flatRows(section).map((node) => ({
        node,
        depth: 0,
        hasChildren: false,
        collapsed: false,
      }))
    }
    return flattenNodes(visibleNodes(section), (path) =>
      searching ? false : collapsed.has(path),
    )
  }

  function collapseAll(section: CategorySection) {
    const branches = branchPaths(section.nodes)
    const anyOpen = branches.some((p) => !collapsed.has(p))
    const next = new Set(collapsed)
    for (const p of branches) {
      if (anyOpen) next.add(p)
      else next.delete(p)
    }
    collapsed = next
  }

  // ── Rename ────────────────────────────────────────────────
  let editingPath = $state<string | null>(null)
  let editValue = $state('')
  let busy = $state(false)

  /** A parent rename awaiting confirmation — it rewrites more than the row you clicked. */
  let pending = $state<{ from: string; to: string; affected: string[] } | null>(null)

  function startEdit(node: CategoryNode) {
    editingPath = node.path
    editValue = node.segment
  }

  function cancelEdit() {
    editingPath = null
    editValue = ''
  }

  function submitEdit(node: CategoryNode) {
    const segment = editValue.trim()
    if (!segment || segment === node.segment) return cancelEdit()

    const problem = segmentError(segment, node.segment)
    if (problem) {
      toast.show(problem)
      return
    }

    const to = renameTarget(node.path, segment)
    const collision = findCollision(allAccountPaths, node.path, to)
    if (collision) {
      toast.show(`“${collision}” already exists — merging isn't supported yet`)
      return
    }

    const affected = affectedPaths(allAccountPaths, node.path)
    // One row is the ordinary case and needs no ceremony. More than one means the rename
    // reaches rows you are not looking at, which is exactly what the confirm is for.
    if (affected.length > 1) {
      pending = { from: node.path, to, affected }
      return
    }
    void applyRename(node.path, to)
  }

  async function applyRename(from: string, to: string) {
    busy = true
    try {
      await renameAccount(from, to)
      await load()
      refreshSidebar()
      toast.show(`Renamed to ${to}`)
      cancelEdit()
      pending = null
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Rename failed')
    } finally {
      busy = false
    }
  }

  function onEditKeydown(e: KeyboardEvent, node: CategoryNode) {
    if (e.key === 'Enter') {
      e.preventDefault()
      submitEdit(node)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEdit()
    }
  }

  // ── Delete ────────────────────────────────────────────────
  // Offered only on a real row with no entries and nothing beneath it. The server enforces
  // the same rule, so a row that slips through the client guard is refused rather than lost.
  let deleting = $state<CategoryNode | null>(null)

  async function confirmDelete() {
    const node = deleting
    if (!node?.accountId) return
    busy = true
    try {
      await deleteAccount(node.accountId)
      await load()
      toast.show(`Deleted ${node.path}`)
      deleting = null
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not delete that category')
    } finally {
      busy = false
    }
  }

  // ── Quick-add ─────────────────────────────────────────────
  // Replaces the Settings form. Typing a full path is the fastest way to add a category, and
  // parents appear implicitly: `expenses:travel:flights` needs no `expenses:travel` first.
  let newPath = $state('')
  let adding = $state(false)

  let addProblem = $derived(pathError(newPath, allAccountPaths))
  let canAdd = $derived(newPath.trim().length > 0 && addProblem === null && !adding)

  async function add() {
    if (!canAdd) return
    const path = newPath.trim()
    adding = true
    try {
      await createAccount({ path })
      await load()
      refreshSidebar()
      newPath = ''
      toast.show(`Added ${path}`)
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not add that category')
    } finally {
      adding = false
    }
  }

  // ── Row helpers ───────────────────────────────────────────
  /**
   * Why this row is off limits, or null.
   *
   * The same guard the Accounts tab uses, and it earns its keep here: `expenses:uncategorized`
   * is empty by design and is where every import posts, so an unguarded surface offers to
   * delete it precisely because nothing has landed in it yet.
   */
  function guard(node: CategoryNode): Protection | null {
    if (node.accountId === null) return null
    return protectionFor({ id: node.accountId, path: node.path }, settings, roots)
  }

  function label(node: CategoryNode): string {
    return view === 'flat' ? node.path : node.segment
  }
</script>

<div class="toolbar">
  <label class="search">
    <Icon name="search" size={12} />
    <TextInput
      bind:value={query}
      placeholder="Search categories"
      aria-label="Search categories"
    />
  </label>

  <label class="control">
    <span>View</span>
    <Select bind:value={view} aria-label="Category view">
      <option value="tree">Tree</option>
      <option value="flat">Flat</option>
    </Select>
  </label>

  {#if emptyPaths.size > 0}
    <GradientButton
      active={emptyOnly}
      tooltip={emptyOnly
        ? 'Show every category again'
        : 'Show only categories with no entries — the ones that can be deleted'}
      onclick={() => (emptyOnly = !emptyOnly)}
    >
      {emptyPaths.size} empty
    </GradientButton>
  {/if}

  <form
    class="quick-add"
    onsubmit={(e) => {
      e.preventDefault()
      void add()
    }}
  >
    <TextInput
      bind:value={newPath}
      placeholder="expenses:travel:flights"
      aria-label="New category path"
      aria-invalid={addProblem !== null}
      spellcheck={false}
      style="width: 16rem"
    />
    <GradientButton type="submit" variant="primary" disabled={!canAdd}>
      {adding ? 'Adding…' : 'Add'}
    </GradientButton>
  </form>
</div>

{#if addProblem}
  <p class="message error">{addProblem}</p>
{/if}

{#if error}
  <p class="message error">{error}</p>
{:else if loading}
  <div class="loading-block">
    {#each { length: 5 } as _}
      <Shimmer height="1.5rem" />
    {/each}
  </div>
{:else if sections.length === 0}
  <p class="message">No categories yet — add one above.</p>
{:else}
  {#each sections as section (section.key)}
    {@const rows = rowsFor(section)}
    <Card class="group-card">
      <div class="group-header">
        <button
          type="button"
          class="group-toggle"
          aria-expanded={!sectionCollapsed[section.key]}
          onclick={() =>
            (sectionCollapsed[section.key] = !sectionCollapsed[section.key])}
        >
          <img
            src="/icons/chevron-right-filled.svg"
            alt=""
            aria-hidden="true"
            width="12"
            height="12"
            class="chevron"
            class:open={!sectionCollapsed[section.key]}
          />
          <span class="group-label">{section.label}</span>
          <span class="group-count">{rows.length}</span>
          <span class="group-total">
            {section.entries}
            <span class="unit">{section.entries === 1 ? 'entry' : 'entries'}</span>
          </span>
        </button>
        {#if view === 'tree'}
          <GradientButton
            quiet
            disabled={searching}
            onclick={() => collapseAll(section)}
            tooltip={searching
              ? 'A filtered tree stays open — clear the filter to fold it'
              : 'Fold or unfold every branch in this section'}
          >
            Fold all
          </GradientButton>
        {/if}
      </div>

      {#if !sectionCollapsed[section.key]}
        {#if rows.length === 0}
          <p class="message">
            {emptyOnly
              ? 'Nothing empty here.'
              : `Nothing matches “${query.trim()}”.`}
          </p>
        {:else}
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th class="num">Entries</th>
                  <th>Last used</th>
                  <th>Flags</th>
                  <th class="actions"><span class="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {#each rows as { node, depth, hasChildren, collapsed: folded } (node.path)}
                  {@const editing = editingPath === node.path}
                  {@const blocker = guard(node)}
                  {@const empty = isDeletable(node)}
                  {@const deletable = empty && blocker === null}
                  <tr class:editing>
                    <td>
                      <div
                        class="cell"
                        style="padding-left: calc({depth} * 16px)"
                      >
                        {#if hasChildren}
                          <button
                            type="button"
                            class="disclosure"
                            aria-expanded={!folded}
                            aria-label={folded
                              ? `Expand ${node.path}`
                              : `Collapse ${node.path}`}
                            onclick={() => toggleBranch(node.path)}
                          >
                            <Icon
                              name={folded
                                ? 'chevron-right-filled'
                                : 'chevron-down-line'}
                              size={13}
                            />
                          </button>
                        {:else}
                          <span class="leaf-dot"></span>
                        {/if}

                        {#if editing}
                          <TextInput
                            bind:value={editValue}
                            spellcheck={false}
                            disabled={busy}
                            aria-label={`Rename ${node.path}`}
                            onkeydown={(e: KeyboardEvent) => onEditKeydown(e, node)}
                            style="width: 12rem"
                          />
                          <GradientButton
                            square
                            disabled={busy}
                            aria-label="Save name"
                            tooltip="Save"
                            onclick={() => submitEdit(node)}
                          >
                            <Icon name="floppy" size={12} />
                          </GradientButton>
                          <GradientButton
                            square
                            disabled={busy}
                            aria-label="Cancel rename"
                            tooltip="Cancel"
                            onclick={cancelEdit}
                          >
                            <Icon name="close" size={12} />
                          </GradientButton>
                        {:else}
                          <span class="segment">{label(node)}</span>
                        {/if}
                      </div>
                    </td>
                    <td class="num">
                      {#if node.entries === 0}
                        <span class="muted">—</span>
                      {:else}
                        {node.entries}
                      {/if}
                    </td>
                    <td>
                      {#if node.lastUsed}
                        {node.lastUsed}
                      {:else}
                        <span class="muted">never</span>
                      {/if}
                    </td>
                    <td>
                      <div class="flags">
                        {#if node.accountId === null}
                          <span
                            title="No account was filed at this path — it exists because something beneath it does"
                          >
                            <Chip size="xs">category</Chip>
                          </span>
                        {/if}
                        {#if node.accountId}
                          {#each rolesOf(node.accountId, settings) as role (role)}
                            <span title={ROLE_DESCRIPTION[role]}>
                              <Chip size="xs" tone="accent">{ROLE_LABEL[role]}</Chip>
                            </span>
                          {/each}
                        {/if}
                        {#if blocker?.kind === 'system'}
                          <span title={protectionMessage(blocker)}>
                            <Chip size="xs" icon="lock">managed</Chip>
                          </span>
                        {/if}
                        {#if empty}
                          <Chip size="xs">empty</Chip>
                        {/if}
                      </div>
                    </td>
                    <td class="actions">
                      <GradientButton
                        quiet
                        square
                        disabled={blocker?.kind === 'system' || editingPath !== null}
                        aria-label={`Rename ${node.path}`}
                        tooltip={blocker?.kind === 'system'
                          ? protectionMessage(blocker)
                          : hasChildren
                            ? 'Rename — this renames everything beneath it too'
                            : 'Rename'}
                        onclick={() => startEdit(node)}
                      >
                        <Icon name="edit-txn" size={13} />
                      </GradientButton>
                      <GradientButton
                        quiet
                        square
                        disabled={!deletable}
                        aria-label={`Delete ${node.path}`}
                        tooltip={blocker
                          ? protectionMessage(blocker)
                          : node.accountId === null
                            ? 'Nothing was filed here, so there is nothing to delete'
                            : deletable
                              ? 'Delete this category'
                              : 'Only a category with no entries and nothing beneath it can be deleted'}
                        onclick={() => (deleting = node)}
                      >
                        <Icon name="trash" size={13} />
                      </GradientButton>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      {/if}
    </Card>
  {/each}
{/if}

<Modal
  title="Rename category"
  bind:open={
    () => pending !== null, (v) => { if (!v) pending = null }
  }
>
  {#if pending}
    <div class="confirm">
      <p>
        This renames <strong>{pending.affected.length}</strong>
        account{pending.affected.length === 1 ? '' : 's'} under
        <code>{pending.from}</code> → <code>{pending.to}</code>. Entries stay
        attached — only the name changes.
      </p>
      <ul class="affected">
        {#each pending.affected as p (p)}
          <li>
            <code>{p}</code> →
            <code>{pending.to}{p.slice(pending.from.length)}</code>
          </li>
        {/each}
      </ul>
      <div class="confirm-actions">
        <GradientButton disabled={busy} onclick={() => (pending = null)}>
          Cancel
        </GradientButton>
        <GradientButton
          variant="primary"
          disabled={busy}
          onclick={() => pending && applyRename(pending.from, pending.to)}
        >
          {busy ? 'Renaming…' : 'Rename all'}
        </GradientButton>
      </div>
    </div>
  {/if}
</Modal>

<Modal
  title="Delete category"
  bind:open={
    () => deleting !== null, (v) => { if (!v) deleting = null }
  }
>
  {#if deleting}
    <div class="confirm">
      <p>
        Delete <code>{deleting.path}</code>? It has no entries and nothing filed
        beneath it.
      </p>
      <div class="confirm-actions">
        <GradientButton disabled={busy} onclick={() => (deleting = null)}>
          Cancel
        </GradientButton>
        <GradientButton
          variant="warning"
          disabled={busy}
          onclick={confirmDelete}
        >
          {busy ? 'Deleting…' : 'Delete'}
        </GradientButton>
      </div>
    </div>
  {/if}
</Modal>

<style>
  /* --- Toolbar --- */
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    flex-wrap: wrap;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--color-text-muted);
  }

  .control {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .quick-add {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    margin-left: auto;
  }

  /* --- Section card --- */
  .group-header {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: 4px var(--sp-sm);
    background: var(--color-section-bar-bg);
    color: var(--color-section-bar-fg);
    border-top: 1px solid var(--color-section-bar-border-top);
    border-bottom: 1px solid var(--color-section-bar-border-bottom);
  }

  .group-toggle {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    min-width: 0;
    padding: 2px 0;
    border: none;
    background: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .group-toggle:focus-visible {
    outline: 2px solid var(--color-accent-mid);
  }

  .chevron {
    flex-shrink: 0;
    transition: rotate var(--duration-fast) var(--ease);
    filter: invert(1);
  }

  .chevron.open {
    rotate: 90deg;
  }

  .group-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: 0.4px;
    text-transform: uppercase;
  }

  .group-count {
    font-family: var(--font-mono);
    font-size: 10px;
    opacity: 0.7;
  }

  .group-total {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .unit {
    opacity: 0.7;
    font-size: 10px;
  }

  /* --- Table --- */
  .table-wrap {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-xs);
  }

  th {
    text-align: left;
    padding: 4px var(--sp-sm);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: var(--weight-semibold);
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-rule);
    white-space: nowrap;
  }

  td {
    padding: 3px var(--sp-sm);
    border-bottom: 1px solid var(--color-rule);
    vertical-align: middle;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  tbody tr:hover {
    background: var(--color-window-raised);
  }

  tr.editing {
    background: var(--color-window-raised);
  }

  th.num,
  td.num {
    text-align: right;
    font-family: var(--font-mono);
    white-space: nowrap;
  }

  th.actions,
  td.actions {
    text-align: right;
    white-space: nowrap;
  }

  .cell {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 22px;
  }

  .disclosure {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 15px;
    height: 15px;
    padding: 0;
    border: none;
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    flex-shrink: 0;
    transition: color var(--duration-fast) var(--ease);
  }

  .disclosure:hover {
    color: var(--color-text);
  }

  .disclosure:focus-visible {
    outline: 2px solid var(--color-accent-mid);
  }

  .leaf-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--color-text-muted);
    flex-shrink: 0;
    margin: 0 5px;
  }

  .segment {
    font-family: var(--font-mono);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .flags {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }

  .muted {
    color: var(--color-text-muted);
  }

  /* --- Messages and dialogs --- */
  .message {
    margin: 0;
    padding: var(--sp-md) var(--sp-sm);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .message.error {
    color: var(--color-amount-negative);
  }

  .loading-block {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
  }

  .confirm {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
    max-width: 32rem;
  }

  .confirm p {
    margin: 0;
    font-size: var(--text-sm);
  }

  .confirm code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .affected {
    margin: 0;
    padding: var(--sp-sm);
    list-style: none;
    max-height: 12rem;
    overflow-y: auto;
    background: var(--color-window-inset);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-inset);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .affected li {
    font-size: var(--text-xs);
  }

  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-sm);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
