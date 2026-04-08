<script lang="ts">
  import Shimmer from '$lib/components/ui/Shimmer.svelte'
</script>

<div class="row">
  <div class="date">
    <Shimmer width="3rem" height="0.625rem" />
    <Shimmer width="2.75rem" height="0.875rem" />
  </div>
  <div class="desc">
    <Shimmer width="55%" height="0.875rem" />
  </div>
  <div class="account">
    <Shimmer width="70%" height="0.875rem" />
  </div>
  <div class="amount">
    <Shimmer width="4.5rem" height="0.875rem" />
  </div>
  <div class="actions">
    <Shimmer width="1.5rem" height="1.5rem" />
  </div>
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: var(--tx-cols) auto;
    align-items: center;
    gap: var(--sp-xs);
    padding: 0 var(--sp-sm);
    min-height: 2.75rem;
    border-bottom: 1px solid var(--color-divider);
  }

  .row:last-child {
    border-bottom: none;
  }

  .amount {
    display: flex;
    justify-content: flex-end;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
  }

  @media (max-width: 520px) {
    .row {
      grid-template-columns: auto 1fr auto auto;
      grid-template-rows: auto auto;
      grid-template-areas:
        'date . amount actions'
        'desc desc desc desc';
      min-height: unset;
      padding: var(--sp-xs) var(--sp-sm);
    }

    .date    { grid-area: date; }
    .desc    { grid-area: desc; padding-top: var(--sp-xs); border-top: 1px solid var(--color-divider); }
    .account { display: none; }
    .amount  { grid-area: amount; }
    .actions { grid-area: actions; }
  }
</style>
