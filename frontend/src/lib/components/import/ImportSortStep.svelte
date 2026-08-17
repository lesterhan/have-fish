<script lang="ts">
  import AccountPicker from '$lib/components/accounts/AccountPicker.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import GroupSelect from './GroupSelect.svelte'
  import Toggle from '$lib/components/ui/Toggle.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import type { Account, ExpenseGroup, ParsedTransaction } from '$lib/api'
  import type { RowState } from './row-state'
  import {
    clusterTarget,
    membersToWrite,
    userEditedCount,
    type ClusterState,
    type MerchantCluster,
  } from './clustering'
  import { groupName, categoryName } from './import-helpers'

  interface Props {
    clusters: MerchantCluster[]
    clusterStates: ClusterState[]
    transactions: ParsedTransaction[]
    rowStates: RowState[]
    accounts: Account[]
    groups: ExpenseGroup[]
    defaultCurrency: string
    applying: boolean
    onaccountcreated: (account: Account) => void
    onapply: (override: boolean) => void
    onskip: () => void
    onback: () => void
  }

  let {
    clusters,
    clusterStates = $bindable(),
    transactions,
    rowStates,
    accounts,
    groups,
    defaultCurrency,
    applying,
    onaccountcreated,
    onapply,
    onskip,
    onback,
  }: Props = $props()

  let expanded = $state<string | null>(null)
  let splitOpenFor = $state<string | null>(null)
  let splitAnchorEl = $state<HTMLElement | null>(null)

  const stateFor = (key: string) => clusterStates.find((c) => c.key === key)!

  // Clusters with a target chosen — the ones Apply would write.
  let targeted = $derived(clusters.filter((c) => clusterTarget(stateFor(c.key)) !== null))

  let writeCount = $derived(
    targeted.reduce(
      (sum, c) => sum + membersToWrite(c, stateFor(c.key), rowStates, false).length,
      0,
    ),
  )

  // Hand-edited members a plain Apply would leave alone, across every targeted cluster.
  let protectedCount = $derived(
    targeted.reduce((sum, c) => sum + userEditedCount(c, stateFor(c.key), rowStates), 0),
  )

  let rememberCount = $derived(targeted.filter((c) => stateFor(c.key).remember).length)

  function toggleExcluded(key: string, index: number) {
    const state = stateFor(key)
    const excluded = state.excluded.includes(index)
      ? state.excluded.filter((i) => i !== index)
      : [...state.excluded, index]
    clusterStates = clusterStates.map((c) => (c.key === key ? { ...c, excluded } : c))
  }

  function setSplit(key: string, groupId: string, categoryId: string | null) {
    clusterStates = clusterStates.map((c) =>
      c.key === key ? { ...c, groupId, categoryId, accountId: '' } : c,
    )
    splitOpenFor = null
  }

  function clearSplit(key: string) {
    clusterStates = clusterStates.map((c) =>
      c.key === key ? { ...c, groupId: null, categoryId: null } : c,
    )
  }

  function setRemember(key: string, remember: boolean) {
    clusterStates = clusterStates.map((c) => (c.key === key ? { ...c, remember } : c))
  }

  function rowAmount(tx: ParsedTransaction): string {
    if (tx.isTransfer === true) return `${tx.targetAmount} ${tx.targetCurrency}`
    if (tx.isTransfer === 'same-currency') return `${tx.amount} ${tx.currency}`
    return `${tx.amount} ${tx.currency ?? defaultCurrency}`
  }

  function shortDate(date: string): string {
    const d = new Date(date)
    return Number.isNaN(d.getTime())
      ? date.slice(0, 10)
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  }
</script>

<div class="sort-step">
  <div class="intro">
    <h2>Repeat merchants</h2>
    <p>
      {clusters.length} merchant{clusters.length === 1 ? '' : 's'} appear{clusters.length === 1
        ? 's'
        : ''} more than once. Assign each one here and its rows drop out of the review list.
      Anything you skip is still waiting in Review.
    </p>
  </div>

  <div class="clusters">
    {#each clusters as cluster (cluster.key)}
      {@const state = stateFor(cluster.key)}
      {@const matched = !!cluster.matchedRulePattern}
      <div class="cluster" class:matched class:expanded={expanded === cluster.key}>
        <div class="cluster-row">
          <button
            type="button"
            class="stem"
            aria-expanded={expanded === cluster.key}
            onclick={() => (expanded = expanded === cluster.key ? null : cluster.key)}
          >
            <span class="disclosure" class:open={expanded === cluster.key}>
              <Icon name="arrow-right" size={10} />
            </span>
            <span class="stem-name">{cluster.key}</span>
            <span class="stem-count">×{cluster.indices.length}</span>
          </button>

          <span class="dates">{shortDate(cluster.firstDate)} – {shortDate(cluster.lastDate)}</span>

          <span class="total">
            {#if cluster.total !== null}
              −{cluster.total.toFixed(2)}
              <span class="total-currency">{cluster.currency}</span>
            {:else}
              <span class="mixed">mixed currencies</span>
            {/if}
          </span>

          <div class="target">
            {#if state.groupId}
              <span class="split-chip">
                <Icon name="pie" size={11} />
                {groupName(groups, state.groupId)}
                {#if state.categoryId}
                  · {categoryName(groups, state.groupId, state.categoryId)}
                {/if}
                <button
                  type="button"
                  class="chip-remove"
                  aria-label="Remove split"
                  onclick={() => clearSplit(cluster.key)}>×</button
                >
              </span>
            {:else if splitOpenFor === cluster.key}
              <div class="split-anchor" bind:this={splitAnchorEl}>
                <GroupSelect
                  {groups}
                  anchorEl={splitAnchorEl}
                  onselect={(id, catId) => setSplit(cluster.key, id, catId)}
                  onclose={() => (splitOpenFor = null)}
                />
              </div>
            {:else}
              <AccountPicker
                {accounts}
                bind:value={clusterStates[clusterStates.findIndex((c) => c.key === cluster.key)].accountId}
                placeholder={matched ? 'Override…' : 'expenses:groceries…'}
                oncreate={onaccountcreated}
              />
            {/if}
          </div>

          {#if groups.length > 0 && !state.groupId && splitOpenFor !== cluster.key}
            <GradientButton
              square
              aria-label="Split with group"
              tooltip="Split with a Fish Pie group"
              onclick={() => (splitOpenFor = cluster.key)}
            >
              <Icon name="pie" size={14} />
            </GradientButton>
          {/if}

          <span class="remember">
            <Toggle
              checked={state.remember}
              label="remember"
              onchange={(v) => setRemember(cluster.key, v)}
            />
          </span>
        </div>

        {#if matched}
          <!-- Shown, never hidden: a rule assigning the wrong account is exactly what the
               user needs to see. Expanding it allows an override. -->
          <div class="matched-note">
            matched by rule «{cluster.matchedRulePattern}»
          </div>
        {/if}

        {#if expanded === cluster.key}
          <ul class="members">
            {#each cluster.indices as i (i)}
              {@const excluded = state.excluded.includes(i)}
              <li class="member" class:excluded>
                <label class="member-label">
                  <input
                    type="checkbox"
                    checked={!excluded}
                    onchange={() => toggleExcluded(cluster.key, i)}
                  />
                  <span class="member-date">{shortDate(transactions[i].date)}</span>
                  <span class="member-desc">{transactions[i].description ?? '—'}</span>
                  <span class="member-amount">{rowAmount(transactions[i])}</span>
                </label>
                {#if rowStates[i]?.source === 'user'}
                  <span class="member-flag">edited by hand</span>
                {:else if rowStates[i]?.skipped}
                  <span class="member-flag">skipped</span>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/each}
  </div>

  <div class="actions">
    <GradientButton onclick={onback}>Back</GradientButton>
    <span class="spacer"></span>
    {#if protectedCount > 0}
      <GradientButton onclick={() => onapply(true)} disabled={applying}>
        Override all {protectedCount}
      </GradientButton>
    {/if}
    <GradientButton onclick={onskip} disabled={applying}>Skip</GradientButton>
    <GradientButton size="lg" active disabled={applying || writeCount === 0} onclick={() => onapply(false)}>
      {#if applying}
        Applying…
      {:else if writeCount === 0}
        Nothing to apply
      {:else}
        Apply to {writeCount} row{writeCount === 1 ? '' : 's'}{rememberCount > 0
          ? ` · ${rememberCount} rule${rememberCount === 1 ? '' : 's'}`
          : ''}
      {/if}
    </GradientButton>
  </div>
</div>

<style>
  .sort-step {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
    padding: var(--sp-md);
  }

  .intro h2 {
    margin: 0 0 var(--sp-xs);
    font-family: var(--font-serif);
    font-size: var(--text-lg);
    font-weight: 600;
  }

  .intro p {
    margin: 0;
    max-width: 48rem;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .clusters {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-lg);
    background: var(--color-window-raised);
    box-shadow: var(--shadow-inset);
    overflow: hidden;
  }

  .cluster {
    border-bottom: 1px solid var(--color-rule);
  }

  .cluster:last-child {
    border-bottom: none;
  }

  /* A cluster a rule already covers is de-emphasised, not hidden. */
  .cluster.matched .cluster-row {
    opacity: 0.6;
  }

  .cluster.matched.expanded .cluster-row,
  .cluster.matched .cluster-row:hover {
    opacity: 1;
  }

  .cluster-row {
    display: grid;
    grid-template-columns: minmax(9rem, 1fr) auto auto minmax(12rem, 26rem) auto auto;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-sm) var(--sp-md);
    transition: opacity var(--duration-fast) var(--ease);
  }

  .stem {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-xs);
    padding: 2px 0;
    border: none;
    background: transparent;
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }

  .stem:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: 2px;
  }

  .disclosure {
    display: inline-flex;
    color: var(--color-text-muted);
    transition: rotate var(--duration-fast) var(--ease);
  }

  .disclosure.open {
    rotate: 90deg;
  }

  .stem-name {
    font-weight: 700;
  }

  .stem-count {
    color: var(--color-text-muted);
  }

  .dates,
  .total {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    white-space: nowrap;
    color: var(--color-text-muted);
  }

  .total {
    text-align: right;
    color: var(--color-amount-negative);
  }

  .total-currency {
    color: var(--color-text-muted);
  }

  .mixed {
    font-style: italic;
  }

  .split-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px var(--sp-sm);
    border-radius: var(--radius-pill);
    background: var(--color-accent-chip-bg);
    color: var(--color-accent-chip-fg);
    font-size: var(--text-xs);
  }

  .chip-remove {
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: var(--text-sm);
    line-height: 1;
  }

  .matched-note {
    padding: 0 var(--sp-md) var(--sp-sm) calc(var(--sp-md) + 18px);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .members {
    margin: 0;
    padding: 0 var(--sp-md) var(--sp-sm) calc(var(--sp-md) + 18px);
    list-style: none;
  }

  .member {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: 2px 0;
    font-size: var(--text-xs);
  }

  .member-label {
    display: grid;
    grid-template-columns: auto 4rem minmax(10rem, 1fr) auto;
    align-items: center;
    gap: var(--sp-sm);
    flex: 1;
    cursor: pointer;
  }

  .member.excluded .member-label {
    opacity: 0.45;
    text-decoration: line-through;
  }

  .member-date,
  .member-amount {
    font-family: var(--font-mono);
    color: var(--color-text-muted);
  }

  .member-amount {
    text-align: right;
  }

  .member-flag {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
  }

  .spacer {
    flex: 1;
  }
</style>
