import { CashPlaceholder } from '@/components/CashPlaceholder'

/**
 * Cash history tab — the feed of transactions touching the active wallet, with a
 * running balance to reconcile against the notes in your pocket. Built in story
 * 6; story 2 only stakes out the route.
 */
export default function CashHistoryScreen() {
  return (
    <CashPlaceholder
      title="Cash history"
      detail="Every transaction touching this wallet, with a running balance to check against what is in your pocket."
      story="Story 6"
    />
  )
}
