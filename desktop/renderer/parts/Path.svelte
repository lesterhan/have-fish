<script lang="ts">
  // An account's path: its root as an initial in a square tinted by kind, so colour never says it
  // alone, then the rest in the code face with the colons quiet and the last part at 500. The
  // rules are in `path.ts`. A screen reader hears the root's word, which the tag stands for; the
  // tag's letter is drawn by CSS, so the path's text, copied or read, is `liabilities cibc:visa`.
  // A root alone is its tag and its word.
  import { pathOf } from './path'

  let { path, spelled = false }: { path: string; spelled?: boolean } = $props()

  const shown = $derived(pathOf(path))
</script>

<span class="path">
  {#if path.includes(':')}
    <span class="word" class:shown={spelled}>{`${shown.root} `}</span>
    <span class="tag" data-root={shown.root} data-tag={shown.tag} aria-hidden="true"></span>
    <span class="name"
      >{#each shown.parents as parent, i (i)}{parent}<span class="colon">:</span>{/each}<span
        class="leaf">{shown.leaf}</span
      ></span
    >
  {:else}
    <span class="tag" data-root={shown.root} data-tag={shown.tag} aria-hidden="true"></span>
    <span class="name word" class:shown={spelled}>
      {#if spelled}{shown.root}{:else}{shown.leaf}{/if}
    </span>
  {/if}
</span>

<style>
  .path {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-inline-size: 100%;
    vertical-align: middle;
  }

  .word {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* A picker's trail spells the root out. */
  .word.shown {
    position: static;
    inline-size: auto;
    block-size: auto;
    overflow: visible;
    clip-path: none;
    color: var(--color-muted);
    font-family: var(--font-code);
  }

  .tag::before {
    content: attr(data-tag);
  }

  .tag {
    flex: none;
    inline-size: 1.4em;
    border-radius: var(--radius-chip);
    font-family: var(--font-code);
    font-size: var(--text-key);
    line-height: 1.4em;
    text-align: center;
    color: var(--color-muted);
    background: var(--color-band);
  }

  .tag[data-root='assets'] {
    color: var(--color-assets);
    background: var(--color-assets-tint);
  }

  .tag[data-root='liabilities'] {
    color: var(--color-liabilities);
    background: var(--color-liabilities-tint);
  }

  .tag[data-root='expenses'] {
    color: var(--color-expenses);
    background: var(--color-expenses-tint);
  }

  .tag[data-root='income'] {
    color: var(--color-income);
    background: var(--color-income-tint);
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-code);
  }

  .colon {
    color: var(--color-muted);
  }

  .leaf {
    font-weight: var(--weight-label);
  }
</style>
