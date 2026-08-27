/**
 * The account page's one amber signal: transactions that need a decision.
 *
 * Two rules make it work. It disappears entirely at zero — a disabled control that exists
 * to say "nothing to report" is still a control, and the page's amber budget is one region
 * above the ledger. And it stays absent while the count is still unknown, so the band does
 * not flash a chip in and out on load.
 */
export type AttentionChip = { show: boolean; label: string }

export function attentionChip(count: number | null | undefined): AttentionChip {
  if (count === null || count === undefined || count <= 0) {
    return { show: false, label: '' }
  }
  return {
    show: true,
    label: `${count} ${count === 1 ? 'needs' : 'need'} attention`,
  }
}
