<script lang="ts">
  interface Props {
    code: string
    size?: 'xs' | 'sm'
  }

  let { code, size = 'sm' }: Props = $props()

  const COLORS: Record<string, { bg: string; fg: string }> = {
    CAD: { bg: '#f0d8d8', fg: '#6a1818' },
    EUR: { bg: '#d8e2f4', fg: '#1a3068' },
    GBP: { bg: '#dce0f4', fg: '#1c1e70' },
    USD: { bg: '#d8eaf4', fg: '#183860' },
    AUD: { bg: '#d4dff0', fg: '#182a60' },
    NZD: { bg: '#d8dcf4', fg: '#1a2268' },
    CHF: { bg: '#f4d8d8', fg: '#701818' },
    JPY: { bg: '#f4d4d4', fg: '#6a0808' },
    CNY: { bg: '#f0dcd0', fg: '#682810' },
    HKD: { bg: '#f4d8e4', fg: '#681830' },
    SGD: { bg: '#f0d8dc', fg: '#6a1828' },
    INR: { bg: '#f4e4d0', fg: '#6a380a' },
    KRW: { bg: '#dce8f4', fg: '#1a3060' },
    MXN: { bg: '#d8f0dc', fg: '#184820' },
    BRL: { bg: '#d8f0d8', fg: '#1a4818' },
    ZAR: { bg: '#e0f0d4', fg: '#2a4808' },
    NOK: { bg: '#dcddf0', fg: '#1c1e68' },
    SEK: { bg: '#d4e2f4', fg: '#183068' },
    DKK: { bg: '#f0d8de', fg: '#681828' },
    CZK: { bg: '#d8e4f0', fg: '#1a2a68' },
    PLN: { bg: '#f0d8e8', fg: '#68183a' },
    HUF: { bg: '#d8f0e4', fg: '#184830' },
    RON: { bg: '#f0e8d0', fg: '#684808' },
    BGN: { bg: '#d8f0e4', fg: '#184828' },
    ISK: { bg: '#d4e8f8', fg: '#183868' },
    TRY: { bg: '#f0d4d8', fg: '#680818' },
    MYR: { bg: '#e0f0d8', fg: '#284810' },
    IDR: { bg: '#f0d8d8', fg: '#6a1818' },
    THB: { bg: '#d8dff0', fg: '#1a2868' },
    PHP: { bg: '#d8e8f8', fg: '#182858' },
    ILS: { bg: '#d4dcf8', fg: '#182870' },
    NTD: { bg: '#dce0f4', fg: '#1a2268' },
    HRK: { bg: '#dde0f0', fg: '#1e2068' },
  }

  let colors = $derived(COLORS[code.toUpperCase()] ?? null)
  let style = $derived(
    colors
      ? `background:${colors.bg};color:${colors.fg};border-color:${colors.fg}4d`
      : undefined,
  )
</script>

<span class="pill" class:xs={size === 'xs'} {style}>{code.toUpperCase()}</span>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 10px;
    line-height: 1;
    padding: 2px 5px;
    background: var(--color-accent-chip-bg);
    color: var(--color-accent-chip-fg);
    border: 1px solid color-mix(in srgb, var(--color-accent-chip-fg) 30%, transparent);
    border-radius: 2px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .pill.xs {
    font-size: 9px;
    padding: 1px 4px;
  }
</style>
