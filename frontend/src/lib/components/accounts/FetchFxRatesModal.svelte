<script lang="ts">
  import Modal from "../ui/Modal.svelte"
  import Button from "../ui/Button.svelte"

  interface RateRequest {
    date: string
    from: string
    to: string
  }

  interface Props {
    open: boolean
    rates: RateRequest[]
    onDone?: () => void
  }

  let { open = $bindable(), rates, onDone }: Props = $props()

  // Working copy — shrinks as rates are fetched successfully.
  let pending = $state<RateRequest[]>([])
  let fetchedCount = $state(0)
  let fetching = $state(false)
  let errors = $state<string[]>([])

  // Reset and auto-start whenever the modal opens.
  $effect(() => {
    if (open) {
      pending = [...rates]
      fetchedCount = 0
      errors = []
      // Auto-start fetching on the next tick.
      setTimeout(() => startFetching(), 0)
    }
  })

  async function startFetching() {
    if (fetching) return
    fetching = true
    errors = []

    // Work through a snapshot so the loop isn't confused by reactive mutations.
    const toFetch = [...pending]

    for (const rate of toFetch) {
      try {
        const qs = new URLSearchParams({ date: rate.date, from: rate.from, to: rate.to })
        const res = await fetch(`/api/fx-rates?${qs}`, { credentials: "include" })
        if (!res.ok && res.status !== 404) {
          // 404 = no data for that date (holiday/weekend) — still remove it
          errors = [...errors, `${rate.date} ${rate.from}→${rate.to}: server error`]
        }
        // Remove from pending regardless of 404 — nothing we can do about missing market data.
        pending = pending.filter((r) => !(r.date === rate.date && r.from === rate.from && r.to === rate.to))
        fetchedCount++
      } catch {
        errors = [...errors, `${rate.date} ${rate.from}→${rate.to}: network error`]
      }
    }

    fetching = false
  }

  let allDone = $derived(pending.length === 0 && !fetching)

  function close() {
    open = false
  }

  function handleDone() {
    close()
    onDone?.()
  }
</script>

<Modal title="Fetch Missing FX Rates" bind:open onclose={close}>
  <div class="body">
    <div class="tally">
      {#if allDone}
        <span class="tally-done">All done</span>
      {:else}
        <span class="tally-label">Fetching rates…</span>
      {/if}
      <span class="tally-count">{fetchedCount} / {fetchedCount + pending.length} fetched</span>
    </div>

    {#if pending.length > 0}
      <div class="rate-list">
        {#each pending as rate (rate.date + rate.from + rate.to)}
          <div class="rate-row">
            <span class="rate-date">{rate.date}</span>
            <span class="rate-pair">{rate.from} → {rate.to}</span>
          </div>
        {/each}
      </div>
    {/if}

    {#if errors.length > 0}
      <div class="errors">
        {#each errors as err}
          <p class="error-line">{err}</p>
        {/each}
      </div>
    {/if}
  </div>

  <div class="footer">
    {#if allDone}
      <Button variant="primary" onclick={handleDone}>Done</Button>
    {:else}
      <Button disabled>Fetching…</Button>
    {/if}
  </div>
</Modal>

<style>
  .body {
    min-width: 360px;
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
  }

  .tally {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: var(--text-sm);
  }

  .tally-label {
    color: var(--color-text-muted);
    font-style: italic;
  }

  .tally-done {
    color: var(--color-amount-positive);
    font-weight: var(--weight-semibold);
  }

  .tally-count {
    font-family: var(--font-mono);
    color: var(--color-text-muted);
  }

  .rate-list {
    background: var(--color-window-inset);
    box-shadow: var(--shadow-sunken);
    max-height: 280px;
    overflow-y: auto;
  }

  .rate-row {
    display: grid;
    grid-template-columns: 7.5rem 1fr;
    gap: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-sm);
    font-size: var(--text-sm);
    border-bottom: 1px solid var(--color-bevel-light);
  }

  .rate-row:last-child {
    border-bottom: none;
  }

  .rate-date {
    font-family: var(--font-mono);
    color: var(--color-text-muted);
  }

  .rate-pair {
    color: var(--color-text);
  }

  .errors {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
  }

  .error-line {
    font-size: var(--text-xs);
    color: var(--color-amount-negative);
    margin: 0;
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    padding-top: var(--sp-md);
    border-top: 1px solid var(--color-bevel-mid);
    margin-top: var(--sp-md);
  }
</style>
