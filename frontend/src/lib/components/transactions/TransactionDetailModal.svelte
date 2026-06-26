<script lang="ts">
  // The single transaction surface as a modal (Flow Narration story 6b). One entry point for
  // every host: a click opens the narrated TransactionDetail, and — when `accounts` is passed —
  // the same surface edits in place (recategorize / header), with the raw LedgerEditModal as the
  // escape hatch for power edits and shapes the narration can't classify.
  //
  // The wrapper owns the displayed transaction so an in-place save re-narrates without a
  // round-trip: `live` follows the host's `tx` by reference, and a save swaps it for the freshly
  // enriched result. Omit `accounts` for a pure read-only detail (no Edit affordance).
  import { untrack } from 'svelte'
  import Modal from '$lib/components/ui/Modal.svelte'
  import TransactionDetail from './TransactionDetail.svelte'
  import LedgerEditModal from './LedgerEditModal.svelte'
  import type { Account, Transaction } from '$lib/api'
  import type { Posting as RawPosting } from './transactionUtils'

  interface Props {
    tx: Transaction | null
    open: boolean
    onclose: () => void
    // When provided, the detail offers in-place edit + the ledger escape. Omit for read-only.
    accounts?: Account[]
    defaultOffsetAccountId?: string | null
    onaccountcreated?: (account: Account) => void
    // Fired with the saved transaction (enriched postings + applied header) after any edit.
    onsaved?: (updated: Transaction) => void
    ondeleted?: () => void
    onremovedFromGroup?: () => void
  }

  let {
    tx,
    open,
    onclose,
    accounts,
    defaultOffsetAccountId,
    onaccountcreated,
    onsaved,
    ondeleted,
    onremovedFromGroup,
  }: Props = $props()

  // `live` is the transaction actually rendered. It follows the host's selection by reference
  // (a new `tx` reseeds it), but an in-place save updates it directly so the view re-narrates
  // without waiting for the host to feed the saved copy back down.
  let live = $state<Transaction | null>(untrack(() => tx))
  $effect(() => {
    const next = tx
    untrack(() => (live = next))
  })

  // The raw-ledger escape stacks on top of the detail modal when invoked.
  let ledgerOpen = $state(false)

  function close() {
    ledgerOpen = false
    onclose()
  }

  // A raw ledger save returns bare postings; re-enrich them (role + path) from the prior copy so
  // the in-place narration stays meaningful until the host feeds a fully classified copy back.
  function enrichLedgerSave(
    date: string,
    description: string | null,
    postings: RawPosting[],
  ): Transaction {
    const base = live ?? tx!
    const byId = new Map(base.postings.map((p) => [p.id, p]))
    const paths = Object.fromEntries(
      (accounts ?? []).map((a) => [a.id, a.path]),
    )
    return {
      ...base,
      date,
      description,
      postings: postings.map((lp) => {
        const orig = byId.get(lp.id)
        return {
          id: lp.id,
          accountId: lp.accountId,
          amount: lp.amount,
          currency: lp.currency,
          accountPath: paths[lp.accountId] ?? orig?.accountPath ?? lp.accountId,
          accountName: orig?.accountName ?? null,
          role: orig?.role ?? 'subject',
        }
      }),
    }
  }
</script>

<Modal title="Transaction" {open} onclose={close}>
  {#if live}
    <TransactionDetail
      tx={live}
      {accounts}
      {onaccountcreated}
      onsaved={(updated) => {
        live = updated
        onsaved?.(updated)
      }}
      ondeleted={() => {
        ondeleted?.()
        close()
      }}
      onremovedFromGroup={() => {
        onremovedFromGroup?.()
        close()
      }}
      oneditledger={accounts ? () => (ledgerOpen = true) : undefined}
    />
  {/if}
</Modal>

{#if accounts && live}
  <LedgerEditModal
    tx={live}
    {accounts}
    {defaultOffsetAccountId}
    bind:open={ledgerOpen}
    onclose={() => (ledgerOpen = false)}
    {onaccountcreated}
    onsaved={(u) => {
      const merged = enrichLedgerSave(u.date, u.description, u.postings)
      live = merged
      onsaved?.(merged)
    }}
    ondeleted={() => {
      ondeleted?.()
      close()
    }}
    onremovedFromGroup={() => {
      onremovedFromGroup?.()
      close()
    }}
  />
{/if}
