<script lang="ts">
  import Panel from '$lib/components/Panel.svelte'
  import Button from '$lib/components/Button.svelte'
  import DateRangeSelector, { type DateRange } from '$lib/components/DateRangeSelector.svelte'
  import { toISODate } from '$lib/date'

  interface Props {
    from: string
    to: string
    onApply: (from: string, to: string) => void
  }

  let { from, to, onApply }: Props = $props()

  // Pending selection — held here until Apply is clicked.
  // Initialised from props (which reflect the current URL state).
  let pending = $state<DateRange>({ from, to })

  function handleApply() {
    onApply(pending.from, pending.to)
  }

  function handleReset() {
    const today = new Date()
    const f = new Date(today)
    f.setDate(today.getDate() - 30)
    const reset = { from: toISODate(f), to: toISODate(today) }
    pending = reset
    onApply(reset.from, reset.to)
  }
</script>

<Panel title="Filter">
  <div class="actions">
    <DateRangeSelector value={pending} onchange={(r) => (pending = r)} />
    <Button onclick={handleApply}>Apply</Button>
    <Button onclick={handleReset}>Reset</Button>
  </div>
</Panel>

<style>
  .actions {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    padding: var(--sp-xs) var(--sp-sm);
  }
</style>
