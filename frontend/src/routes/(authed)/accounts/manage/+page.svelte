<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import {
    fetchAccounts,
    fetchAccountPostingCounts,
    fetchTransactions,
    fetchUserSettings,
    renameAccount,
    type Account,
    type Transaction,
  } from '$lib/api'
  import { toast } from '$lib/toast.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import Modal from '$lib/components/ui/Modal.svelte'
  import SpendingTxnRow from '$lib/components/spending/SpendingTxnRow.svelte'
  import { scrollShadow } from '$lib/scrollShadow'

  type TreeNode = {
    segment: string
    path: string
    accountId: string | null
    children: TreeNode[]
  }

  let accounts = $state<Account[]>([])
  let loading = $state(true)

  // Per-leaf posting counts (same source as the settings account panel). A category's
  // count is the sum of its descendant leaves — see countByPath.
  let postingCountMap = $state<Map<string, number>>(new Map())
  let baseCurrency = $state('CAD')

  // Right panel: the account whose transactions are shown. Path-prefix match means
  // selecting a category lists every transaction beneath it.
  let selectedPath = $state<string | null>(null)
  let selectedTxns = $state<Transaction[]>([])
  let txnsLoading = $state(false)

  let editingPath = $state<string | null>(null)
  let editValue = $state('')
  let saving = $state(false)

  // Pending parent rename awaiting confirmation (affects more than one account).
  let pending = $state<{ from: string; to: string; affected: string[] } | null>(null)

  // Collapsed category paths. This page is expenses-first: `expenses` sits on top and stays
  // expanded; every other top-level category starts collapsed.
  let collapsed = $state(new Set<string>())

  let tree = $derived(buildTree(accounts))

  // Transaction count per tree path. Leaf = its own posting count; category (virtual)
  // node = sum of every descendant leaf. Rebuilt whenever accounts or counts change.
  let countByPath = $derived.by<Map<string, number>>(() => {
    const map = new Map<string, number>()
    const visit = (node: TreeNode): number => {
      const own = node.accountId ? (postingCountMap.get(node.accountId) ?? 0) : 0
      const total = node.children.reduce((sum, c) => sum + visit(c), own)
      map.set(node.path, total)
      return total
    }
    tree.forEach(visit)
    return map
  })

  onMount(async () => {
    const [accts, counts, settings] = await Promise.all([
      fetchAccounts(),
      fetchAccountPostingCounts(),
      fetchUserSettings(),
    ])
    accounts = accts
    postingCountMap = new Map(counts.map((c) => [c.accountId, c.count]))
    baseCurrency = settings.preferredCurrency ?? 'CAD'
    // Collapse every top-level category except `expenses` by default.
    collapsed = new Set(tree.filter((n) => n.segment !== 'expenses').map((n) => n.path))
    loading = false
  })

  async function select(path: string) {
    selectedPath = path
    txnsLoading = true
    try {
      selectedTxns = await fetchTransactions({ accountPath: path })
    } catch {
      selectedTxns = []
    } finally {
      txnsLoading = false
    }
  }

  function toggle(path: string) {
    const next = new Set(collapsed)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    collapsed = next
  }

  // Receivable accounts (`assets:receivable:*`) are system-managed — re-spawned at import —
  // so they are excluded from rename.
  function isReceivable(path: string): boolean {
    return path === 'assets:receivable' || path.startsWith('assets:receivable:')
  }

  // Build a nested tree from the flat materialized paths. Intermediate segments with no
  // account row of their own become virtual nodes (accountId null) but are still renamable.
  function buildTree(list: Account[]): TreeNode[] {
    const roots: TreeNode[] = []
    const byPath = new Map<string, TreeNode>()
    const ensure = (path: string): TreeNode => {
      const existing = byPath.get(path)
      if (existing) return existing
      const idx = path.lastIndexOf(':')
      const node: TreeNode = {
        segment: idx === -1 ? path : path.slice(idx + 1),
        path,
        accountId: null,
        children: [],
      }
      byPath.set(path, node)
      if (idx === -1) roots.push(node)
      else ensure(path.slice(0, idx)).children.push(node)
      return node
    }
    for (const a of list) ensure(a.path).accountId = a.id
    const sortRec = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => a.segment.localeCompare(b.segment))
      nodes.forEach((n) => sortRec(n.children))
    }
    sortRec(roots)
    // Expenses-first: this page is primarily for reorganizing expense categories.
    roots.sort((a, b) =>
      a.segment === 'expenses' ? -1 : b.segment === 'expenses' ? 1 : 0,
    )
    return roots
  }

  // Real account rows rewritten by renaming `path` — the node itself (if a real row) and
  // every descendant row. Used for the cascade-confirm count.
  function affectedPaths(path: string): string[] {
    return accounts
      .map((a) => a.path)
      .filter((p) => p === path || p.startsWith(`${path}:`))
      .sort()
  }

  function startEdit(node: TreeNode) {
    editingPath = node.path
    editValue = node.segment
  }

  function cancelEdit() {
    editingPath = null
    editValue = ''
  }

  function parentPrefix(path: string): string {
    const idx = path.lastIndexOf(':')
    return idx === -1 ? '' : path.slice(0, idx)
  }

  function submitEdit(node: TreeNode) {
    const segment = editValue.trim()
    if (!segment || segment === node.segment) return cancelEdit()
    if (segment.includes(':')) {
      toast.show('A name cannot contain a colon')
      return
    }
    const prefix = parentPrefix(node.path)
    const to = prefix ? `${prefix}:${segment}` : segment

    // Client-side collision pre-check against rows outside the moved subtree.
    const affected = affectedPaths(node.path)
    const affectedSet = new Set(affected)
    const rewritten = affected.map((p) => `${to}${p.slice(node.path.length)}`)
    const others = new Set(accounts.map((a) => a.path).filter((p) => !affectedSet.has(p)))
    const collision = rewritten.find((p) => others.has(p))
    if (collision) {
      toast.show(`"${collision}" already exists — merge isn't supported yet`)
      return
    }

    if (affected.length > 1) {
      pending = { from: node.path, to, affected }
      return
    }
    void applyRename(node.path, to)
  }

  async function applyRename(from: string, to: string) {
    saving = true
    try {
      await renameAccount(from, to)
      accounts = await fetchAccounts()
      // The selected path may have moved under the rename — clear rather than show stale rows.
      selectedPath = null
      selectedTxns = []
      toast.show(`Renamed to ${to}`)
      cancelEdit()
      pending = null
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Rename failed')
    } finally {
      saving = false
    }
  }

  function handleKeydown(e: KeyboardEvent, node: TreeNode) {
    if (e.key === 'Enter') {
      e.preventDefault()
      submitEdit(node)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEdit()
    }
  }
</script>

<div class="page">
  <div class="left-col">
    <div class="section-bar">
      <GradientButton onclick={() => goto('/settings')} tooltip="Back to Settings">
        <Icon name="back" />
        Back
      </GradientButton>
      <span class="section-bar-title">MANAGE ACCOUNTS</span>
    </div>

    <p class="hint">
      Click an account to see its transactions. Rename any account or category — renaming a
      category renames every account beneath it. Postings stay attached, only the name changes.
    </p>

    <div class="tree" use:scrollShadow>
      {#if loading}
        <p class="empty">Loading…</p>
      {:else if tree.length === 0}
        <p class="empty">No accounts yet.</p>
      {:else}
        {#each tree as node (node.path)}
          {@render treeRow(node, 0)}
        {/each}
      {/if}
    </div>
  </div>

  <div class="right-col">
    <div class="txn-panel">
      <div class="txn-header">
        <span class="txn-header-title">Transactions</span>
        {#if selectedPath}
          <span class="txn-header-path">{selectedPath}</span>
          <span class="txn-header-spacer"></span>
          <span class="txn-header-count">{selectedTxns.length} entries</span>
        {/if}
      </div>
      <div class="txn-col-header">
        <span>DATE</span>
        <span>PAYEE / ACCOUNT</span>
        <span class="col-header-right">AMOUNT</span>
      </div>
      <div class="txn-body" use:scrollShadow>
        {#if !selectedPath}
          <p class="status">Select an account to view its transactions.</p>
        {:else if txnsLoading && selectedTxns.length === 0}
          <p class="status">Loading…</p>
        {:else if selectedTxns.length === 0}
          <p class="status">No transactions under this account.</p>
        {:else}
          <div class="txn-list">
            {#each selectedTxns as tx, i (tx.id)}
              <SpendingTxnRow
                {tx}
                idx={i}
                converted={false}
                fxRates={{}}
                {baseCurrency}
                {accounts}
              />
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

{#snippet treeRow(node: TreeNode, depth: number)}
  {@const receivable = isReceivable(node.path)}
  {@const editing = editingPath === node.path}
  {@const hasChildren = node.children.length > 0}
  {@const isCollapsed = collapsed.has(node.path)}
  {@const count = countByPath.get(node.path) ?? 0}
  {@const selected = selectedPath === node.path}
  <div class="row" class:editing class:selected>
    <div class="row-main" style="padding-left: calc(14px + {depth} * 18px)">
      {#if hasChildren}
        <button
          type="button"
          class="disclosure"
          onclick={() => toggle(node.path)}
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? 'Expand' : 'Collapse'}
        >
          <Icon name={isCollapsed ? 'chevron-right-filled' : 'chevron-down-line'} size={12} />
        </button>
      {:else}
        <span class="leaf-dot"></span>
      {/if}

      {#if editing}
        <TextInput
          bind:value={editValue}
          spellcheck={false}
          disabled={saving}
          onkeydown={(e: KeyboardEvent) => handleKeydown(e, node)}
          style="width: 14rem"
        />
        <GradientButton square onclick={() => submitEdit(node)} disabled={saving} tooltip="Save">
          <Icon name="floppy" size={12} />
        </GradientButton>
        <GradientButton square onclick={cancelEdit} disabled={saving} tooltip="Cancel">
          <Icon name="close" size={12} />
        </GradientButton>
      {:else}
        <button type="button" class="segment" class:active={selected} onclick={() => select(node.path)}>
          <span class="segment-name">{node.segment}</span>
          {#if count > 0}
            <span class="count">({count})</span>
          {/if}
        </button>
        {#if node.accountId === null}
          <span class="virtual-tag">category</span>
        {/if}
        {#if receivable}
          <span class="virtual-tag">system</span>
        {:else}
          <GradientButton
            square
            onclick={() => startEdit(node)}
            disabled={editingPath !== null}
            tooltip="Rename"
          >
            <Icon name="edit-txn" size={12} />
          </GradientButton>
        {/if}
      {/if}
    </div>
  </div>

  {#if hasChildren && !isCollapsed}
    {#each node.children as child (child.path)}
      {@render treeRow(child, depth + 1)}
    {/each}
  {/if}
{/snippet}

<Modal title="Rename category" bind:open={() => pending !== null, (v) => { if (!v) pending = null }}>
  {#if pending}
    <div class="confirm">
      <p>
        This renames <strong>{pending.affected.length}</strong> account{pending.affected.length === 1
          ? ''
          : 's'} under
        <code>{pending.from}</code> → <code>{pending.to}</code>:
      </p>
      <ul class="affected" use:scrollShadow>
        {#each pending.affected as p (p)}
          <li><code>{p}</code> → <code>{pending.to}{p.slice(pending.from.length)}</code></li>
        {/each}
      </ul>
      <div class="confirm-actions">
        <GradientButton onclick={() => (pending = null)} disabled={saving}>Cancel</GradientButton>
        <GradientButton
          active
          onclick={() => pending && applyRename(pending.from, pending.to)}
          disabled={saving}
        >
          {saving ? 'Renaming…' : 'Rename all'}
        </GradientButton>
      </div>
    </div>
  {/if}
</Modal>

<style>
  .page {
    display: grid;
    grid-template-columns: 1fr 360px;
    height: 100%;
    overflow: hidden;
  }

  @media (max-width: 600px) {
    .page {
      grid-template-columns: 1fr;
    }
  }

  .left-col {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-right: 1px solid var(--color-rule);
  }

  .section-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: 5px 14px;
    background: var(--color-section-bar-bg);
    color: var(--color-section-bar-fg);
    border-top: 1px solid var(--color-section-bar-border-top);
    border-bottom: 1px solid var(--color-section-bar-border-bottom);
    flex-shrink: 0;
  }

  .section-bar-title {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: var(--weight-semibold);
    letter-spacing: 0.6px;
    flex: 1;
  }

  .hint {
    margin: 0;
    padding: var(--sp-sm) 14px;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    background: var(--color-window-raised);
    border-bottom: 1px solid var(--color-rule);
    flex-shrink: 0;
  }

  .tree {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .row {
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-window-inset);
    transition: background var(--duration-fast) var(--ease);
  }

  .row:hover {
    background: var(--color-window-raised);
  }

  .row.editing {
    background: var(--color-window-raised);
  }

  .row.selected {
    background: var(--color-accent-chip-bg);
  }

  .row-main {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: 4px 14px 4px 0;
    min-height: 26px;
  }

  .disclosure {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
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
    margin: 0 4px;
  }

  .segment {
    flex: 1;
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    padding: 2px 4px;
    border: none;
    background: none;
    text-align: left;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text);
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease);
  }

  .segment:hover {
    color: var(--color-accent);
  }

  .segment.active {
    color: var(--color-accent);
    font-weight: var(--weight-semibold);
  }

  .segment:focus-visible {
    outline: 2px solid var(--color-accent-mid);
  }

  .segment-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--color-text-muted);
  }

  .virtual-tag {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--color-text-muted);
    border: 1px solid var(--color-rule);
    padding: 0 4px;
    flex-shrink: 0;
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
    box-shadow: var(--shadow-sunken);
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

  .empty {
    padding: var(--sp-lg) 14px;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  /* Right panel — transactions for the selected account */
  .right-col {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  @media (max-width: 600px) {
    .right-col {
      border-top: 1px solid var(--color-rule);
    }
  }

  .txn-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--color-window-raised);
  }

  .txn-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    background: var(--color-section-bar-bg);
    color: var(--color-section-bar-fg);
    border-top: 1px solid var(--color-section-bar-border-top);
    border-bottom: 1px solid var(--color-section-bar-border-bottom);
    flex-shrink: 0;
  }

  .txn-header-title {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .txn-header-path {
    font-family: var(--font-mono);
    font-size: 10px;
    opacity: 0.75;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .txn-header-spacer {
    flex: 1;
  }

  .txn-header-count {
    font-family: var(--font-mono);
    font-size: 11px;
    opacity: 0.75;
    flex-shrink: 0;
  }

  .txn-col-header {
    display: grid;
    grid-template-columns: 52px 1fr auto;
    gap: 10px;
    padding: 4px 14px;
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-window);
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.8px;
    color: var(--color-text-muted);
    text-transform: uppercase;
  }

  .col-header-right {
    text-align: right;
  }

  .txn-body {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .txn-list {
    display: flex;
    flex-direction: column;
  }

  .status {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    padding: var(--sp-md) 14px;
  }
</style>
