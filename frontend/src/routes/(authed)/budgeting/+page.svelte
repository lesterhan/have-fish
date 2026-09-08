<script lang="ts">
  import Icon from '$lib/components/ui/Icon.svelte'
</script>

<!-- The whole route is an absence, so V7 applies to the whole route: it takes the slot the
     page would occupy and states the reason at the size of the thing it replaces. A serif
     line with a traffic cone either side, floating at the top-left of an empty field, read
     as a page that had failed to load rather than one that has not been built. -->
<div class="page">
  <div class="empty">
    <Icon name="cone" size={16} />
    <h1>Budgeting isn't built yet.</h1>
    <p>
      Spending already answers where the money went. Budgeting will answer where
      it was supposed to go — until then this page has nothing to tell you.
    </p>
  </div>
</div>

<style>
  .page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100%;
    padding: var(--sp-2xl) var(--sp-lg);
    background: var(--color-window);
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-sm);
    max-width: 34rem;
    text-align: center;
    color: var(--color-text-muted);
  }

  h1 {
    font-family: var(--font-serif);
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
    margin: 0;
  }

  p {
    font-size: var(--text-sm);
    line-height: 1.5;
    margin: 0;
  }
</style>
