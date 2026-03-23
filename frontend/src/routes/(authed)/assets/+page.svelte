<script lang="ts">
  import { onMount } from 'svelte'
  import { fetchAccountBalances, type AccountBalance } from '$lib/api'

  let accounts = $state<AccountBalance[]>([])

  onMount(async () => {
    // TODO: fetch account balances and set accounts
  })

  // TODO: derive a helper or inline check — is every balance amount === '0.00'?
  // Used to dim zero-balance accounts in the template.
</script>

<h1>Assets</h1>

<!-- TODO: loading / empty state -->

<!-- TODO: table of accounts
  One row per account. Columns:
    - account path (left-aligned, monospace)
    - per-currency balances (right-aligned, one chip/span per currency)
      use --color-amount-positive for positive amounts, --color-amount-negative for negative
  Accounts where all balances are zero should render with reduced opacity (dimmed).
  Use a sunken table container matching the style in import/+page.svelte.
-->

<style>
  /* TODO: scoped styles
    - table layout matching the retro aesthetic (see import/+page.svelte for reference)
    - .cell-path — monospace, takes remaining width
    - .cell-balances — flex row, gap, right-aligned
    - .balance-chip — per-currency amount span with color classes
    - .dimmed — reduced opacity for zero-balance rows
  */
</style>
