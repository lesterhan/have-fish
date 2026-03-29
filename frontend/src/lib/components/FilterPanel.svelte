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

  function handleReset() {
    const today = new Date()
    const f = new Date(today)
    f.setDate(today.getDate() - 30)
    onApply(toISODate(f), toISODate(today))
  }
</script>

<Panel title="Filter">
  <div class="actions">
    <DateRangeSelector
      value={{ from, to }}
      onchange={(r) => onApply(r.from, r.to)}
    />
    <Button onclick={handleReset}>Reset</Button>
  </div>
</Panel>

<style>
  .actions {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-xs);
    padding: var(--sp-xs) var(--sp-sm);
  }
</style>
