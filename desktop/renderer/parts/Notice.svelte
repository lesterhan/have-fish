<script lang="ts">
  // What stopped something, under a place's header, where you were looking. It stays until you
  // act on it or put it away.
  import type { Snippet } from 'svelte'
  import { copy } from '../../copy'
  import Button from './Button.svelte'

  type Props = { words: string; ondismiss: () => void; action?: Snippet }
  let { words, ondismiss, action }: Props = $props()
</script>

<div class="notice" role="alert">
  <span class="words">{words}</span>
  {@render action?.()}
  <Button variant="quiet" aria-label={copy.app.notice.dismiss} onclick={ondismiss}>✕</Button>
</div>

<style>
  .notice {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    border-block-end: var(--border-width) solid var(--color-rule);
    font-size: var(--text-quiet);
    background: var(--color-notice);
    box-shadow: var(--edge-error);
  }

  .words {
    flex: 1;
  }
</style>
