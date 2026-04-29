<script lang="ts">
  import type { GroupMember, CurrencyBalance } from "$lib/api"
  import GradientButton from "$lib/components/ui/GradientButton.svelte"
  import { initials } from "./utils"

  interface Props {
    members: GroupMember[]
    balances: CurrencyBalance[]
    allSettled: boolean
    onSettleClick: (
      fromUserId: string,
      toUserId: string,
      amount: string,
      currency: string,
    ) => void
  }

  let { members, balances, allSettled, onSettleClick }: Props = $props()
</script>

<div class="section-bar">
  <span class="section-bar-title">Balance</span>
</div>

<div class="members-body">
  {#each members as member (member.id)}
    <div class="member-row">
      <div class="member-avatar">{initials(member.userName)}</div>
      <div class="member-info">
        <span class="member-name">{member.userName}</span>
        <span class="member-email">{member.userEmail}</span>
      </div>
      <div class="member-right">
        {#each balances as cb (cb.currency)}
          {#each cb.transfers as t}
            {#if t.fromUserId === member.userId}
              <span class="member-balance member-balance--owes">
                owes {t.currency}
                {parseFloat(t.amount).toFixed(2)}
              </span>
            {:else if t.toUserId === member.userId}
              <span class="member-balance member-balance--owed">
                gets back {t.currency}
                {parseFloat(t.amount).toFixed(2)}
              </span>
            {/if}
          {/each}
        {/each}
        {#if allSettled}
          <span class="member-balance member-balance--settled">settled</span>
        {/if}
      </div>
    </div>
  {/each}
</div>

{#if !allSettled}
  <div class="settle-actions">
    {#each balances as cb (cb.currency)}
      {#each cb.transfers as t}
        <div class="settle-btn-wrap">
          <GradientButton
            onclick={() =>
              onSettleClick(t.fromUserId, t.toUserId, t.amount, t.currency)}
          >
            Settle up
          </GradientButton>
        </div>
      {/each}
    {/each}
  </div>
{/if}

<style>
  .section-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 14px;
    background: var(--color-section-bar-bg);
    color: var(--color-section-bar-fg);
    border-top: 1px solid var(--color-section-bar-border-top);
    border-bottom: 1px solid var(--color-section-bar-border-bottom);
  }

  .section-bar-title {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
  }

  .members-body {
    background: var(--color-window);
  }

  .member-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: 8px 22px;
    border-bottom: 1px solid var(--color-rule-soft);
  }

  .member-row:last-child {
    border-bottom: none;
  }

  .member-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--color-accent-light);
    border: 1px solid var(--color-accent);
    color: var(--color-accent-chip-fg);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .member-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }

  .member-name {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
  }

  .member-email {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .member-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 1px;
    flex-shrink: 0;
  }

  .member-balance {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
  }

  .member-balance--owes {
    color: var(--color-amount-negative);
  }

  .member-balance--owed {
    color: var(--color-amount-positive);
  }

  .member-balance--settled {
    color: var(--color-text-muted);
    font-weight: 400;
    font-style: italic;
  }

  .settle-actions {
    background: var(--color-window);
    border-top: 1px solid var(--color-rule-soft);
    padding: var(--sp-xs) 22px;
  }

  .settle-btn-wrap :global(.btn) {
    width: 100%;
    height: 32px;
    font-size: var(--text-sm);
  }
</style>
