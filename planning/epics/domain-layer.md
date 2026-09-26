# Domain layer

**Tracked as [#423](https://github.com/lesterhan/have-fish/issues/423)**, one sub-issue per
story below. The current state of the code is mapped in
[`backend/ARCHITECTURE.md`](../../backend/ARCHITECTURE.md) (story 1).

Move the backend's business rules out of the Hono route handlers into services and pure
domain modules. A rule then lives in one place, runs without a request, and can be read on
its own. Three things coming up need that:

- **Sync (P4).** A device has to validate a document it receives, because no server is the
  authority any more.
- **True local mobile (`L08` O2).** The same rules have to run inside React Native.
- **The repo split (#380).** It has to separate what the Fish Pie client keeps from what
  the service takes.

The epic is also a guided audit. Every story leaves the code better understood, not only
better arranged.

No UI changes, so there's no UX brief.

## Stories

1. [x] **Map where the backend's rules live** — #424. `backend/ARCHITECTURE.md`, the
   findings filed, and this file.
2. [ ] **One write path for transactions** — #425
3. [ ] **Every posting writer uses the ledger service** — #426
4. [ ] **Import commit plans in pure code** — #427
5. [ ] **Accounts and coverage into services** — #428
6. [ ] **Rules, parsers, settings, reports into services** — #429
7. [ ] **Fish Pie split and settlement maths into domain** — #430
8. [ ] **Lock the layers in with a check** — #431

Interleaved with P1 (agreed 2026-09-24): #279 and #281 wait for stories 2–3, and #282
waits for story 4. #277, #278 and #283 are independent. P1 goes ahead of stories 5–8,
because those stories are pure tidying and must not delay Probe 1.

## The layers

| Layer | Does | May import |
|---|---|---|
| **Route** | Parse the request, read `userId`, call one service, shape the answer | Services, `validation`, `errors` |
| **Service** | Load what a rule needs, run it, write, inside one database transaction | Domain modules, `db`, schema |
| **Domain** | Pure rules: does this balance, what legs does this row make, how does this split | Other domain modules, `currencies`, error *types* |

The test for whether something belongs in a domain module is simple: could a phone run it
against its own SQLite file, or a laptop run it on a document that just arrived from the
relay? If yes, it has no business importing `db` or `hono`.

## Design choices

All five were agreed in review of #435 (2026-09-25) and are built from story 2 onward.
Each is written as the proposal that was agreed.

### 1. How a service reports failure

Today there are three shapes of one idea:

| Where | Shape |
|---|---|
| `parseBody` | `{ ok: true, data } \| { ok: false, response }` |
| `heal-service` | `{ ok: true, postings } \| { ok: false, failure }` |
| `rules.ts` `resolveTarget` | `{ columns } \| { failure }` |

**Proposal.** Add one type to `errors.ts`:

```ts
export type Outcome<T> = { ok: true; value: T } | { ok: false; failure: ErrorBody }
```

- The service returns `Outcome<T>`, and the route does
  `if (!r.ok) return failWith(c, r.failure)`.
- `heal-service` and `resolveTarget` move to it as their stories touch them.
- `parseBody` keeps its shape. It is route-level by definition, and its failure is already
  a response.

**The alternative** is a thrown `DomainError(code, detail)` that `app.onError` turns into the
right status. It means less plumbing, and a throw inside `db.transaction` rolls back for
free. But it hides a failure path in the one place a reader most needs to see it, and
`onError` is deliberately a plain 500 today. So the rule under this proposal is:

- A rule the caller can break (unbalanced, not yours, wrong currency) is an `Outcome`,
  checked *before* the transaction opens.
- A throw is for an invariant only this code can break. `returnedRow` already works that
  way.

### 2. Who opens the database transaction

**Proposal.**
- The service that owns a unit of work opens it.
- A service that composes into someone else's unit of work takes an executor argument. The
  ledger write service is the main example: import calls it once per row.
- There is one exported `Executor` type in `db/index.ts`, replacing today's two local
  aliases (`Tx` in `fish-pie-accounts.ts`, `TxDb` in `fish-pie-expense-service.ts`).
- Routes never open a transaction. That's in the gate.

### 3. Where files go

**Proposal: by domain, not by layer.** The existing directories are already domains
(`import/`, `postings/`, `coverage/`). Each keeps its pure modules and gains a
`*-service.ts`. There is no top-level `services/` and no `domain/` folder.

**Naming rule:** a file ending `-service.ts` touches the database, and no other file does.

| New or moved | When |
|---|---|
| `ledger/` (new): `validate.ts` (pure: count, currencies, balance per currency) and `write-service.ts` | Story 2 |
| `fish-pie-balance-service.ts` → a pure `fish-pie/balances.ts` (it has no database access) | Story 7 |
| The four loaders at the bottom of `coverage/horizon.ts` → `coverage/config-service.ts` | Story 5 |

`errors.ts` imports Hono's `Context` for `fail` and `failWith`. The domain may import only
its types (`ErrorBody`, `errorBody`), so story 8 splits `fail` and `failWith` into a
route-side helper if that makes the check cleaner.

### 4. How far the Fish Pie story goes

`bodies.test.ts` already set the precedent: the eight `fish-pie-*` route files are exempt
from schema parsing, because they leave under #380 and would be ported twice otherwise.

**Proposal: story 7 follows the precedent.** It extracts only the maths the client keeps:
- splitting by weight, with the remainder going to the payer
- netting balances and the minimal set of transfers
- netting a settlement batch
- the legs each member's own ledger receives

It doesn't refactor the route orchestration, which moves to the Fish Pie service.

### 5. The single-posting endpoints

`POST`, `PATCH` and `DELETE /api/postings` edit one leg at a time and can't enforce the
balance, because a balanced edit usually changes two legs (#432). They also contradict the
sync unit in #281, where the whole transaction is the document.

**Proposal: #432 retires them before story 3.** Otherwise story 3 has to either route them
through the ledger service, which would reject every single-leg insert and break the
editor, or exempt them, which leaves the gate unmet.

## Rules for every story

1. **The move changes no behaviour.** Existing tests pass unmodified; tests may be added. A
   change to what the API does is its own issue.
2. **Findings are filed, not fixed along the way.** A bug found while moving code becomes
   its own issue, so a refactor PR stays reviewable as a refactor. The one exception is a
   fix the move can't avoid, and the PR says why.
3. **Every PR teaches.** Its body has a **How it works** section on the code that moved:
   what the rule is, why it exists, and what calls it. `backend/ARCHITECTURE.md` is updated
   in the same PR.
4. **Unfixed security findings never go in this file or the map.** They go to
   `have-fish-ops` per `CLAUDE.md`, and are described here only once fixed.

Any story can run in coach mode ("coach me") if you'd rather drive it yourself.

## Findings from the map (story 1)

| Issue | What |
|---|---|
| #432 | The raw ledger editor saves an edit as parallel requests that never check the balance, so a partial failure leaves an unbalanced transaction. **Fixed** by retiring `/api/postings`; the editor saves through the ledger service |
| #433 | Two active accounts can share one path, because create doesn't check and no index stops it |
| #434 | Import commit stores unknown currencies, and a row with no amount is a 500 |

One more finding was handled privately, per rule 4, and is now fixed: #436 holds
transaction delete, import commit and parser defaults to the caller's own rows, and
requires a real date on the FX-rate lookup.

Also recorded in the map, not filed:
- **Floats in money arithmetic** on over 90 lines. #279 covers it.
- **Two meanings of delete.** Covered by the `F2` correction in `00-direction.md` and by
  #281.
- **`GET /api/transactions` loads every transaction, then filters in memory.** Fine at
  household scale; it becomes a service in story 2's neighbourhood and can take its filters
  into SQL then.
- **Non-null `!` assertions** remain in `transactions.ts`, `accounts.ts` and `import.ts`,
  against the convention in `CLAUDE.md`. Each goes when its code moves.

## Gate

- `insert(postings)` appears only in the ledger write service, and a test fails if it
  shows up anywhere else.
- No route handler opens `db.transaction`.
- Domain modules import neither `db` nor `hono`, and a check enforces it.
- `backend/ARCHITECTURE.md` describes the code as it is.
- The full suite passes with no existing test modified.
