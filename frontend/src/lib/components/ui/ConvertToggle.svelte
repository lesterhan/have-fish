<script lang="ts">
  import CurrencyPill from '$lib/components/ui/CurrencyPill.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'

  /**
   * The control that folds a surface's foreign amounts into one currency.
   *
   * The conversions themselves have nothing in common — Spending converts a flow at each
   * transaction's own historical rate, the Accounts page converts a stock at today's — so this
   * shares only the affordance, which is the part that should not drift: the button reflects
   * state with `active`, refuses input while a fetch is in flight, and its label and tooltip
   * always announce *what the click will do* rather than what is currently showing.
   */
  interface Props {
    /** True while the surface is showing converted figures. */
    converted: boolean
    /** A conversion is in flight; the control is inert until it settles. */
    busy?: boolean
    /** The currency being converted into. */
    currency: string
    /**
     * What turning conversion off gets you back, e.g. "Show raw totals" where the off state
     * lists each currency separately, or "Show CAD only" where it shows one currency's
     * balances. Required because that differs by surface and is the whole point of the click.
     */
    offLabel: string
    /** Render as the currency pill alone, for a dense toolbar with no room for a phrase. */
    compact?: boolean
    onclick: () => void
  }

  let {
    converted,
    busy = false,
    currency,
    offLabel,
    compact = false,
    onclick,
  }: Props = $props()

  let action = $derived(converted ? offLabel : `Convert to ${currency}`)
</script>

<GradientButton
  active={converted}
  disabled={busy}
  aria-label={action}
  tooltip={action}
  {onclick}
>
  {#if compact}
    <CurrencyPill code={currency} size="xs" />
  {:else if busy}
    Converting…
  {:else}
    {action}
  {/if}
</GradientButton>
