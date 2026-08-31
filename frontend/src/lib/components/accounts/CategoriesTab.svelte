<script lang="ts">
  import { onMount } from 'svelte'
  import Chip from '$lib/components/ui/Chip.svelte'
  import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte'
  import ControlBar from '$lib/components/ui/ControlBar.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import SearchField from '$lib/components/ui/SearchField.svelte'
  import Select from '$lib/components/ui/Select.svelte'
  import Shimmer from '$lib/components/ui/Shimmer.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import AccountDrawer from './AccountDrawer.svelte'
  import AccountFlags from './AccountFlags.svelte'
  import SectionCard from './SectionCard.svelte'
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
  import { actionRequiredStore } from '$lib/actionRequired.svelte'
  import { attentionChip } from '$lib/components/transactions/attentionChip'
  import { rank } from '$lib/components/accounts/accountScorer'
  import { rootFor, rootsFrom } from '$lib/components/accounts/accountPaths'
  import {
    protectionFor,
    protectionMessage,
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
    foldAll,
    isDeletable,
    nodePaths,
    pathError,
    realRows,
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
  function matcher(
    nodes: CategoryNode[],
  ): ((node: CategoryNode) => boolean) | null {
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

  // ── Row expansion ─────────────────────────────────────────
  // Distinct from the tree's collapse state, and deliberately so: the chevron in the first
  // column opens a branch, this opens what is *inside* a row. One at a time, because the
  // drawer fetches when it opens.
  let openPath = $state<string | null>(null)

  function toggleRow(path: string) {
    openPath = openPath === path ? null : path
  }

  /** Unfinished entries on this row's own account. Virtual segments hold none. */
  function attentionFor(accountId: string | null): number | null {
    return accountId ? actionRequiredStore.getCount(accountId) : null
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
    // Flat view: the one thing the Settings list did that a tree does not — every real row,
    // full path, one line each, nothing to open.
    if (view === 'flat') {
      return realRows(visibleNodes(section)).map((node) => ({
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
    collapsed = foldAll(collapsed, branchPaths(section.nodes))
  }

  // ── Rename ────────────────────────────────────────────────
  let editingPath = $state<string | null>(null)
  let editValue = $state('')
  let busy = $state(false)

  /** A parent rename awaiting confirmation — it rewrites more than the row you clicked. */
  let pending = $state<{ from: string; to: string; affected: string[] } | null>(
    null,
  )

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
      toast.show(
        e instanceof Error ? e.message : 'Could not delete that category',
      )
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
  let canAdd = $derived(
    newPath.trim().length > 0 && addProblem === null && !adding,
  )

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
    return protectionFor(
      { id: node.accountId, path: node.path },
      settings,
      roots,
    )
  }

  function label(node: CategoryNode): string {
    return view === 'flat' ? node.path : node.segment
  }
</script>

<ControlBar>
  <SearchField bind:value={query} placeholder="Search categories" />

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
    class="quick-add trailing"
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
</ControlBar>

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
    <SectionCard
      label={section.label}
      count={rows.length}
      total={String(section.entries)}
      unit={section.entries === 1 ? 'entry' : 'entries'}
      collapsed={sectionCollapsed[section.key] ?? false}
      ontoggle={() =>
        (sectionCollapsed[section.key] = !sectionCollapsed[section.key])}
    >
      {#snippet trailing()}
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
      {/snippet}

      {#if rows.length === 0}
        <p class="message">
          {emptyOnly
            ? 'Nothing empty here.'
            : `Nothing matches “${query.trim()}”.`}
        </p>
      {:else}
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
              {@const needs = attentionFor(node.accountId) ?? 0}
              {@const open = openPath === node.path}
              <tr class:editing class:open>
                <td>
                  <div class="cell" style="padding-left: calc({depth} * 16px)">
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
                  <AccountFlags
                    accountId={node.accountId}
                    {settings}
                    protection={blocker}
                  >
                    {#snippet lead()}
                      {#if needs > 0}
                        <span title={attentionChip(needs).label}>
                          <Chip size="xs" icon="warning">{needs}</Chip>
                        </span>
                      {/if}
                      {#if node.accountId === null}
                        <span
                          title="No account was filed at this path — it exists because something beneath it does"
                        >
                          <Chip size="xs">category</Chip>
                        </span>
                      {/if}
                    {/snippet}
                    {#if empty}
                      <Chip size="xs">empty</Chip>
                    {/if}
                  </AccountFlags>
                </td>
                <td class="actions">
                  <GradientButton
                    quiet
                    square
                    aria-label={open
                      ? `Hide recent entries for ${node.path}`
                      : `Show recent entries for ${node.path}`}
                    aria-expanded={open}
                    tooltip={open
                      ? 'Close'
                      : 'Recent entries and what is unfinished'}
                    onclick={() => toggleRow(node.path)}
                  >
                    <Icon
                      name={open ? 'chevron-up-filled' : 'chevron-down-line'}
                      size={13}
                    />
                  </GradientButton>
                  <GradientButton
                    quiet
                    square
                    disabled={blocker?.kind === 'system' ||
                      editingPath !== null}
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
              {#if open}
                <!-- A category row stands for its whole subtree, so the drawer matches on
                     the path rather than the id — which is also the only thing a virtual
                     segment has to match on. -->
                <tr class="drawer-row">
                  <td colspan="5">
                    <AccountDrawer
                      match={{ kind: 'subtree', path: node.path }}
                      path={node.path}
                      accountId={node.accountId}
                      root={rootFor(section.key, roots)}
                      attention={attentionFor(node.accountId)}
                    />
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      {/if}
    </SectionCard>
  {/each}
{/if}

{#if pending}
  <ConfirmDialog
    title="Rename category"
    open={true}
    confirmLabel="Rename all"
    busyLabel="Renaming…"
    {busy}
    onconfirm={() => pending && applyRename(pending.from, pending.to)}
    oncancel={() => (pending = null)}
  >
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
  </ConfirmDialog>
{/if}

{#if deleting}
  <ConfirmDialog
    title="Delete category"
    open={true}
    confirmLabel="Delete"
    busyLabel="Deleting…"
    variant="warning"
    {busy}
    onconfirm={confirmDelete}
    oncancel={() => (deleting = null)}
  >
    <p>
      Delete <code>{deleting.path}</code>? It has no entries and nothing filed
      beneath it.
    </p>
  </ConfirmDialog>
{/if}

<style>
  .quick-add {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
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

  /* --- Row expansion --- *
     The drawer brings its own padding and left rule, so the cell gets out of the way. */
  tr.drawer-row td {
    padding: 0;
  }

  tr.open td {
    background: var(--color-window-raised);
  }

  /* --- Messages --- *
     Kept in step with the Accounts tab by hand: two rules is under the weight of another
     shared component, and they are the last thing the two tabs still say twice. */
  .message {
    margin: 0;
    padding: var(--sp-lg);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .message.error {
    color: var(--color-danger);
  }

  .loading-block {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    padding: var(--sp-sm);
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
</style>
