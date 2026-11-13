<script lang="ts">
  // An amount, or several, as they read everywhere (DESIGN.md, "Money and days"): the figures face,
  // a true minus, the code small and quiet when it's said, and which way it went without colour
  // alone. The rules are `moneyParts` in `format.ts`.
  import type { Money } from '../../shared/currency'
  import { moneyParts, type Way } from '../format'

  type Props = {
    /** One amount, or each currency's of a transaction. */
    of: Money | readonly Money[]
    /** Says the code even of the home currency, as a transaction's details do. */
    code?: boolean
    way?: Way
  }
  let { of, code = false, way = 'out' }: Props = $props()

  const shown = $derived(
    (Array.isArray(of) ? of : [of as Money]).map((m) =>
      moneyParts(m.amount, m.currency, { code, way }),
    ),
  )
</script>

<span class="money" data-way={way}
  >{#each shown as { sign, figure, code: said }, i (said ?? i)}{#if i > 0}<span class="apart"
        >{' · '}</span
      >{/if}{#if sign === '⇄'}<span class="between">{'⇄ '}</span>{:else if sign}<span class="sign"
        >{sign}</span
      >{/if}<span class="figure">{figure}</span>{#if said}<span class="code">{` ${said}`}</span
      >{/if}{/each}</span
>

<style>
  .money {
    font-family: var(--font-figures);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .money[data-way='in'] {
    color: var(--color-in);
  }

  .code,
  .apart,
  .between {
    font-size: var(--text-small);
    color: var(--color-muted);
  }
</style>
