<script lang="ts">
  import Shimmer from "$lib/components/ui/Shimmer.svelte";
</script>

<div class="row">
  <div class="date">
    <Shimmer width="3.2rem" height="0.75rem" />
    <Shimmer width="3rem" height="1rem" />
  </div>

  <div class="body">
    <Shimmer width="40%" height="0.875rem" />
    <Shimmer width="65%" height="0.875rem" />
  </div>

  <div class="money">
    <Shimmer width="4rem" height="0.75rem" />
    <Shimmer width="2.5rem" height="0.625rem" />
  </div>

  <div class="actions">
    <Shimmer width="1.5rem" height="1.5rem" />
  </div>
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: start;
    gap: var(--sp-xs);
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-divider);
  }

  .row:last-child {
    border-bottom: none;
  }

  .date {
    display: flex;
    flex-direction: column;
    margin-top: var(--sp-xs);
    gap: 3px;
  }

  .body {
    display: flex;
    flex-direction: column;
    margin-top: var(--sp-xs);
    gap: 8px;
    border-left: 1px solid var(--color-divider);
    padding-left: var(--sp-xs);
  }

  .money {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    margin-top: var(--sp-xs);
    gap: 3px;
  }

  .actions {
    display: flex;
    margin-top: var(--sp-xs);
    align-items: center;
  }
</style>
