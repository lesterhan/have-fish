export interface Posting {
  id: string
  accountId: string
  amount: string
  currency: string
}

export interface Transaction {
  id: string
  date: string
  description: string | null
  postings: Posting[]
}

// Svelte action: focus and select input on mount
export function focusOnMount(node: HTMLInputElement) {
  node.focus()
  node.select()
}

// Parse YYYY-MM-DD as local midnight to avoid UTC timezone shift.
export function parseDateParts(isoDate: string) {
  const [y, m, d] = isoDate.substring(0, 10).split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return {
    dow: date.toLocaleDateString('en', { weekday: 'short' }),
    monthDay: date.toLocaleDateString('en', { month: 'short', day: 'numeric' }),
    year: String(y),
  }
}

// Sort postings by amount to identify the debit (from) and credit (to) sides.
export function summarize(postings: Posting[]) {
  const sorted = [...postings].sort(
    (a, b) => parseFloat(a.amount) - parseFloat(b.amount),
  )
  return {
    from: sorted[0],
    to: sorted[sorted.length - 1],
    rest: sorted.slice(1, -1),
  }
}

// For cross-currency transfers: identify source (largest outflow) and target
// (largest inflow in a different currency). Excludes conversion-account entries
// which can dwarf real amounts and skew the sort.
export function classifyTransfer(
  postings: Posting[],
  defaultConversionAccountId?: string | null,
) {
  const nonConversion = postings.filter(
    (p) => p.accountId !== defaultConversionAccountId,
  )
  const sorted = [...nonConversion].sort(
    (a, b) => parseFloat(a.amount) - parseFloat(b.amount),
  )
  const source = sorted[0]
  const target = source
    ? [...nonConversion]
        .filter((p) => p.currency !== source.currency)
        .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount))[0]
    : undefined
  const internalIds = new Set([source?.id, target?.id])
  const fees = nonConversion.filter(
    (p) => !internalIds.has(p.id) && parseFloat(p.amount) > 0,
  )
  return { source, target, fees }
}

// Format an amount string as an absolute value with 2 decimal places.
export function fmt(amount: string): string {
  return Math.abs(parseFloat(amount)).toFixed(2)
}

// Keyboard handler for elements acting as buttons via role="button".
export function handleEditableKeydown(e: KeyboardEvent, action: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    action()
  }
}
