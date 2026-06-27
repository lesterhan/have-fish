<script lang="ts">
  import FishPieTag from '$lib/components/ui/FishPieTag.svelte'
  import type { ExpenseGroup } from '$lib/api'
  import { groupName, categoryName, myShareRatio } from './import-helpers'

  interface Props {
    groups: ExpenseGroup[]
    groupId: string
    categoryId: string | null
    // The row's amount + currency, used to compute the user's share of the split.
    amount: string
    currency: string
    currentUserId: string
  }

  let { groups, groupId, categoryId, amount, currency, currentUserId }: Props = $props()

  let category = $derived(
    categoryId ? categoryName(groups, groupId, categoryId) : groupName(groups, groupId),
  )

  // Show the group as a secondary chip only when it adds info beyond the category chip.
  let group = $derived(categoryId && groups.length > 1 ? groupName(groups, groupId) : null)

  let shareHint = $derived.by(() => {
    const grp = groups.find((g) => g.id === groupId)
    const ratio = myShareRatio(grp, currentUserId, categoryId)
    if (ratio === null) return null
    const raw = Math.abs(parseFloat(amount)) * ratio
    if (isNaN(raw)) return null
    return `${raw.toFixed(2)} ${currency}`
  })
</script>

<FishPieTag {category} {group} share={shareHint} />
