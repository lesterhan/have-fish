<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon from './Icon.svelte'

  /**
   * A designed absence.
   *
   * V7 says an empty slot states why it is empty, and until now that principle existed as
   * prose and as fourteen separate `.empty` rules. Eight of them were the same rule — serif,
   * italic, `--text-sm`, muted ink — written out eight times, and they had already drifted:
   * the spending breakdown's had lost the serif italic, so the one absence a user sees most
   * often was the one that looked like a different app. A principle with no component is a
   * principle that gets re-derived, slightly differently, by whoever is nearest.
   *
   * Serif italic because an absence is the app talking about itself rather than reporting
   * data, which is the same reason the section headers are serif (DESIGN.md §5). Muted ink
   * because nothing is wrong: an empty list is not an error, and painting it in error ink is
   * the mistake story 9 spent a whole story unpicking.
   *
   * Two shapes, because there are two absences:
   *
   *  - the default, a line where a list's rows would be. It takes the list's own gutter so
   *    the sentence starts where the rows start.
   *  - `page`, where the *whole route* is the absence. It takes the slot the page would
   *    occupy and answers at the size of the thing it replaces, because a quiet line floating
   *    at the top-left of an empty field reads as a page that failed to load.
   *
   * Not every muted line in the app is one of these. A one-line notice inside a dense panel —
   * the account drawer's "Nothing has been posted here yet", the rules page's suggestion
   * pane — is furniture at `--text-xs`, and dressing it as prose would make it the loudest
   * thing in a panel it is only annotating. Those stay as they are.
   */
  interface Props {
    /** The sentence. Say why it is empty, not that it is. */
    children: Snippet
    /**
     * Horizontal inset, so the sentence lines up with the rows it stands in for. Panels
     * differ, so the caller names its own; the default is the list gutter.
     */
    inset?: string
    /** The whole-route shape: centred, headed, and sized to the page. */
    page?: boolean
    /** `page` only — the heading above the explanation. */
    title?: string
    /** `page` only — an icon above the heading. */
    icon?: string
  }

  let { children, inset = '14px', page = false, title, icon }: Props = $props()
</script>

{#if page}
  <div class="page-slot">
    <div class="page-inner">
      {#if icon}<Icon name={icon} size={16} />{/if}
      {#if title}<h1>{title}</h1>{/if}
      <p class="page-body">{@render children()}</p>
    </div>
  </div>
{:else}
  <p class="line" style:--empty-inset={inset}>{@render children()}</p>
{/if}

<style>
  .line {
    margin: 0;
    padding: var(--sp-lg) var(--empty-inset);
    font-family: var(--font-serif);
    font-size: var(--text-sm);
    font-style: italic;
    color: var(--color-text-muted);
  }

  .page-slot {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100%;
    padding: var(--sp-2xl) var(--sp-lg);
    background: var(--color-window);
  }

  .page-inner {
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

  .page-body {
    font-size: var(--text-sm);
    line-height: 1.5;
    margin: 0;
  }
</style>
