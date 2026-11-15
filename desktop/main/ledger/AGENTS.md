# The ledger's documents

This folder is the only code that writes a document's rows: the versions, the tombstones and the
outbox all depend on that. Each rule below names the test that fails when it breaks.

- A document goes in through `applyLocal` or `applyReceived`, and nothing outside this folder and
  `main/db/` writes its rows. In the app only `main/context.ts` calls `applyLocal`; the seed tool
  and the tests call it too. No test pins this yet, so review holds it.
- Every item is read by its schema before anything is written: `apply.test.ts`, "a malformed
  document is refused with its place in the batch, and nothing moves".
- A batch and the clock commit in one transaction, so one refusal refuses the whole batch:
  `apply.test.ts`, "a batch of three with a bad third writes nothing, and the clock does not move".
- Versions decide, never bodies: `apply.received.test.ts`, "the same version again is counted
  same, and an older one stale".
- A delete is a tombstone, never a `DELETE`: `apply.test.ts`, "a delete stores a tombstone with
  no postings, and an undelete brings it back".
- Every local write goes on the outbox: `outbox.test.ts`, "a local write".
- A transaction's postings sum to zero in each currency: `store.file.test.ts`, "SQL sums a
  transaction's postings to zero in each currency".
- A change here runs the property tests: convergence in `apply.property.test.ts`, the outbox in
  `outbox.property.test.ts`, and a document's round trip through its rows in
  `rows.property.test.ts`.
