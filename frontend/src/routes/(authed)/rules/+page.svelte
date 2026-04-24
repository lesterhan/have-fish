<script lang="ts">
  import { onMount } from 'svelte'
  import {
    fetchRules,
    fetchAccounts,
    createRule,
    updateRule,
    deleteRule,
    approveRule,
    denyRule,
    mineRules,
    type ImportRule,
    type Account,
  } from '$lib/api'
  import { toast } from '$lib/toast.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import Button from '$lib/components/ui/Button.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import TableShell from '$lib/components/ui/TableShell.svelte'

  let rules = $state<ImportRule[]>([])
  let accounts = $state<Account[]>([])
  let loading = $state(true)
  let mining = $state(false)

  let showAddForm = $state(false)
  let newPattern = $state('')
  let newAccountId = $state('')

  let editingId = $state<string | null>(null)
  let editPattern = $state('')
  let editAccountId = $state('')

  let activeRules = $derived(rules.filter((r) => r.status === 'active'))
  let suggestions = $derived(
    rules.filter((r) => r.status === 'suggested').sort((a, b) => b.matchCount - a.matchCount),
  )

  onMount(async () => {
    const [r, a] = await Promise.all([fetchRules(), fetchAccounts()])
    rules = r
    accounts = a
    loading = false
  })

  function startEdit(rule: ImportRule) {
    editingId = rule.id
    editPattern = rule.pattern
    editAccountId = rule.accountId
    showAddForm = false
  }

  function cancelEdit() {
    editingId = null
    editPattern = ''
    editAccountId = ''
  }

  async function handleAdd() {
    if (!newPattern.trim() || !newAccountId) return
    try {
      const created = await createRule({ pattern: newPattern.trim(), accountId: newAccountId })
      rules = [...rules, created]
      newPattern = ''
      newAccountId = ''
      showAddForm = false
    } catch (e) {
      toast.show((e as Error).message)
    }
  }

  async function handleSaveEdit() {
    if (!editingId || !editPattern.trim() || !editAccountId) return
    try {
      const updated = await updateRule(editingId, { pattern: editPattern.trim(), accountId: editAccountId })
      rules = rules.map((r) => (r.id === updated.id ? { ...updated } : r))
      cancelEdit()
    } catch (e) {
      toast.show((e as Error).message)
    }
  }

  async function handleDelete(id: string) {
    await deleteRule(id)
    rules = rules.filter((r) => r.id !== id)
  }

  async function handleApprove(id: string) {
    await approveRule(id)
    rules = rules.map((r) => (r.id === id ? { ...r, status: 'active' as const } : r))
  }

  async function handleDeny(id: string) {
    await denyRule(id)
    rules = rules.filter((r) => r.id !== id)
  }

  async function handleMine() {
    mining = true
    try {
      const { created } = await mineRules()
      const fresh = await fetchRules()
      rules = fresh
      if (created === 0) toast.show('No new suggestions found.')
      else toast.show(`${created} suggestion${created === 1 ? '' : 's'} added.`)
    } finally {
      mining = false
    }
  }
</script>

<div class="page">

  <!-- Left: active rules -->
  <div class="left-col">
    <div class="section-bar">
      <span class="section-bar-title">ACTIVE RULES</span>
      <GradientButton
        onclick={() => { showAddForm = true; cancelEdit() }}
        disabled={showAddForm}
      >
        Add rule
      </GradientButton>
    </div>

    <div class="rules-table">
      <TableShell
        columns={[
          { label: 'Pattern' },
          { label: 'Account' },
          { label: '', class: 'col-actions' },
        ]}
        {loading}
        empty={activeRules.length === 0 && !showAddForm}
        emptyText="No active rules. Add one or approve a suggestion."
      >
        {#if showAddForm}
          <tr class="form-row">
            <td class="cell-form">
              <TextInput
                bind:value={newPattern}
                placeholder="e.g. LOBLAWS"
                spellcheck={false}
                style="width: 100%; box-sizing: border-box"
                onkeydown={(e) => {
                  if (e.key === 'Enter') handleAdd()
                  if (e.key === 'Escape') { showAddForm = false; newPattern = ''; newAccountId = '' }
                }}
              />
            </td>
            <td class="cell-form">
              <AccountPathInput
                {accounts}
                bind:value={newAccountId}
                placeholder="Select account…"
                oncreate={(a) => { accounts = [...accounts, a] }}
              />
            </td>
            <td class="cell-actions">
              <div class="action-row">
                <GradientButton onclick={handleAdd} disabled={!newPattern.trim() || !newAccountId} active>
                  Save
                </GradientButton>
                <Button variant="ghost" square onclick={() => { showAddForm = false; newPattern = ''; newAccountId = '' }}>
                  <Icon name="close" size={12} />
                </Button>
              </div>
            </td>
          </tr>
        {/if}
        {#each activeRules as rule (rule.id)}
          {#if editingId === rule.id}
            <tr class="form-row">
              <td class="cell-form">
                <TextInput
                  bind:value={editPattern}
                  spellcheck={false}
                  style="width: 100%; box-sizing: border-box"
                  onkeydown={(e) => {
                    if (e.key === 'Enter') handleSaveEdit()
                    if (e.key === 'Escape') cancelEdit()
                  }}
                />
              </td>
              <td class="cell-form">
                <AccountPathInput
                  {accounts}
                  bind:value={editAccountId}
                  oncreate={(a) => { accounts = [...accounts, a] }}
                />
              </td>
              <td class="cell-actions">
                <div class="action-row">
                  <GradientButton onclick={handleSaveEdit} active>Save</GradientButton>
                  <Button variant="ghost" square onclick={cancelEdit}>
                    <Icon name="close" size={12} />
                  </Button>
                </div>
              </td>
            </tr>
          {:else}
            <tr>
              <td class="cell-pattern">{rule.pattern}</td>
              <td class="cell-mono">{rule.accountPath}</td>
              <td class="cell-actions">
                <div class="action-row">
                  <Button variant="ghost" square onclick={() => startEdit(rule)} tooltip="Edit">
                    <Icon name="edit-txn" size={12} />
                  </Button>
                  <Button variant="ghost" square onclick={() => handleDelete(rule.id)} tooltip="Delete">
                    <Icon name="trash" size={12} />
                  </Button>
                </div>
              </td>
            </tr>
          {/if}
        {/each}
      </TableShell>
    </div>
  </div>

  <!-- Right: suggestions sidebar -->
  <div class="right-col">
    <div class="section-bar">
      <span class="section-bar-title">SUGGESTIONS</span>
    </div>

    <div class="mine-strip">
      <span class="mine-hint">Analyze transaction history to find patterns.</span>
      <GradientButton onclick={handleMine} disabled={mining}>
        {mining ? 'Mining…' : 'Mine'}
      </GradientButton>
    </div>

    <div class="suggestions-list">
      {#if loading}
        <div class="empty-state">Loading…</div>
      {:else if suggestions.length === 0}
        <div class="empty-state">No suggestions. Click Mine to analyze your transaction history.</div>
      {:else}
        {#each suggestions as rule (rule.id)}
          <div class="suggestion-card">
            <div class="suggestion-info">
              <span class="suggestion-pattern">{rule.pattern}</span>
              <span class="suggestion-account">{rule.accountPath}</span>
              <span class="suggestion-count">{rule.matchCount} matches</span>
            </div>
            <div class="suggestion-actions">
              <GradientButton onclick={() => handleApprove(rule.id)} active>Approve</GradientButton>
              <Button variant="ghost" onclick={() => handleDeny(rule.id)}>Deny</Button>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>

</div>

<style>
  .page {
    display: grid;
    grid-template-columns: 1fr 300px;
    height: 100%;
    overflow: hidden;
  }

  @media (max-width: 600px) {
    .page {
      grid-template-columns: 1fr;
    }
  }

  /* ── Left column ── */

  .left-col {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    border-right: 1px solid var(--color-rule);
  }

  .section-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    padding: 4px 12px;
    background: var(--color-section-bar-bg);
    border-top: 1px solid var(--color-section-bar-border-top);
    border-bottom: 1px solid var(--color-section-bar-border-bottom);
    flex-shrink: 0;
  }

  .section-bar-title {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.6px;
    color: var(--color-section-bar-fg);
    flex: 1;
  }

  .rules-table :global(th) {
    background: var(--color-window);
    box-shadow: none;
    border-bottom: 1px solid var(--color-rule);
    padding: 4px 12px;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.8px;
    color: var(--color-text-muted);
    text-transform: uppercase;
  }

  .rules-table :global(td) {
    padding: 5px 12px;
    border-bottom: 1px solid var(--color-rule-soft);
    background: var(--color-window-inset);
    font-size: var(--text-xs);
  }

  .rules-table :global(tbody tr:last-child td) {
    border-bottom: none;
  }

  .rules-table :global(tbody tr:not(.form-row):hover td) {
    background: var(--color-accent-light);
  }

  .rules-table :global(.col-actions) {
    width: 1px;
  }

  .cell-pattern {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
  }

  .cell-mono {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .cell-actions {
    white-space: nowrap;
    padding: 2px var(--sp-xs) !important;
  }

  .cell-form {
    padding: 4px 8px !important;
  }

  .action-row {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .form-row :global(td) {
    background: var(--color-window-raised);
  }

  /* ── Right column ── */

  .right-col {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--color-window-raised);
  }

  .mine-strip {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: 6px 12px;
    border-bottom: 1px solid var(--color-rule-soft);
    flex-shrink: 0;
  }

  .mine-hint {
    flex: 1;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .suggestions-list {
    flex: 1;
    overflow-y: auto;
  }

  .empty-state {
    padding: var(--sp-md) 12px;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .suggestion-card {
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-rule-soft);
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--color-window);
  }

  .suggestion-card:hover {
    background: var(--color-accent-light);
  }

  .suggestion-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .suggestion-pattern {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .suggestion-account {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .suggestion-count {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-disabled);
  }

  .suggestion-actions {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
  }
</style>
