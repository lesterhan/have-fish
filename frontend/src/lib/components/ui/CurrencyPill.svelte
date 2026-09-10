<script lang="ts">
  /**
   * A currency tag. Neutral by design.
   *
   * This used to carry a 33-entry hand-picked colour map applied as an inline style, which
   * meant three things at once: the colours were authored for the light theme only, so in
   * dark mode every money row wore a pale pink or pale blue sticker; the inline style
   * overrode the class, so the token fallback underneath was dead code; and tokens.test.ts
   * could not see any of it, because none of it was a token.
   *
   * Whether currency should carry a *derived* identity hue is a real question and a separate
   * one — see planning/epics/visual-language.md. Until it is answered, a tag that is quiet in
   * both themes is the reading that is never wrong: the code is what identifies the currency,
   * and colour on every row of a ledger identifies nothing.
   */
  interface Props {
    code: string
    size?: 'xs' | 'sm'
  }

  let { code, size = 'sm' }: Props = $props()
</script>

<span class="pill" class:xs={size === 'xs'}>{code.toUpperCase()}</span>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    font-family: var(--font-mono);
    font-weight: var(--weight-bold);
    font-size: var(--text-label);
    line-height: var(--leading-none);
    padding: 2px 5px;
    background: var(--color-window-raised);
    color: var(--color-text-muted);
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .pill.xs {
    font-size: var(--text-micro);
    padding: 1px 4px;
  }
</style>
