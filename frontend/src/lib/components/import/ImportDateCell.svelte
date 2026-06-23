<script lang="ts">
  import Icon from '$lib/components/ui/Icon.svelte'
  import { tooltip } from '$lib/tooltip'
  import type { PossibleDuplicate } from '$lib/api'
  import { shortDate } from './import-helpers'

  interface Props {
    date: string
    possibleDuplicate?: PossibleDuplicate | null
  }

  let { date, possibleDuplicate }: Props = $props()
</script>

<td class="cell-mono">
  {shortDate(date)}
  {#if possibleDuplicate}
    <span
      class="indicator-icon"
      use:tooltip={{
        label: `Possible duplicate: ${possibleDuplicate.date} ${possibleDuplicate.amount} ${possibleDuplicate.currency}`,
        always: true,
      }}
    >
      <Icon name="warning-filled" size={16} />
    </span>
  {/if}
</td>
