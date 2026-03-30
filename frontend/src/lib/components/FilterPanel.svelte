<script lang="ts">
  import Panel from "$lib/components/Panel.svelte";
  import Button from "$lib/components/Button.svelte";
  import DateRangeSelector from "$lib/components/DateRangeSelector.svelte";
  import { toISODate } from "$lib/date";

  interface Props {
    from: string;
    to: string;
    sortDir: "asc" | "desc";
    onApply: (from: string, to: string) => void;
    onSortChange: (dir: "asc" | "desc") => void;
  }

  let { from, to, sortDir, onApply, onSortChange }: Props = $props();

  function handleReset() {
    const today = new Date();
    const f = new Date(today);
    f.setDate(today.getDate() - 30);
    onApply(toISODate(f), toISODate(today));
  }
</script>

<Panel title="Filter">
  <div class="bar">
    <div class="sort-controls">
      <Button
        onclick={() => onSortChange(sortDir === "desc" ? "asc" : "desc")}
        title="Sort by date"
      >
        Date {sortDir === "desc" ? "↘️" : "↗️"}
      </Button>
    </div>
    <div class="date-controls">
      <DateRangeSelector
        value={{ from, to }}
        onchange={(r) => onApply(r.from, r.to)}
      />
      <Button square title="Reset to last 30 days" onclick={handleReset}
        >🔄</Button
      >
    </div>
  </div>
</Panel>

<style>
  .bar {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-sm);
  }

  .sort-controls {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
  }

  .date-controls {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-xs);
    margin-left: auto;
  }
</style>
