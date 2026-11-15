# The ledger's documents

This folder is the only code that writes a document's rows: the versions, the tombstones and the
outbox all depend on that. Each rule below names the test that fails when it breaks.

- A document goes in through `applyLocal` or `applyReceived`, and nothing else writes its rows.
  Only `main/context.ts` calls `applyLocal`, outside the tests' fixtures. Review holds this.
- Every item is read by its schema before anything is written: `apply.test.ts`, "a malformed
  document is refused with its place in the batch, and nothing moves".
- A batch and the clock commit in one transaction, so one refusal refuses the whole batch:
  `apply.test.ts`, "a batch of three with a bad third writes nothing, and the clock does not move".
- Versions decide, never bodies: `apply.received.test.ts`, "the same version again is counted
  same, and an older one stale".
- A delete is a tombstone, never a `DELETE`: `apply.test.ts`, "a delete stores a tombstone with
  no postings, and an undelete brings it back".
- Every local write goes on the outbox: `outbox.test.ts`, "a local write".
- A change here runs the property tests, which hold balance, tombstones and convergence:
  `apply.property.test.ts`, `outbox.property.test.ts` and `rows.property.test.ts`.
