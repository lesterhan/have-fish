# An inbox for an app nothing arrives in

Notes from the design conversation that produced `DESIGN.md`'s inbox model and the Trust
Signals epic. Written down because the eventual inbox-count work depends on it and the
reasoning is not obvious from the code.

## The problem

`DESIGN.md` §1 commits the app to an inbox model: it knows what is unrecorded and says so;
zero is a designed, earned state. That model comes from email, where the inbox knows its
contents because mail arrives whether or not you look.

Nothing arrives here. Every row is imported or typed. So the inbox has to infer the existence
of work it cannot see, which is a different problem with a different failure mode.

## Three tiers of knowledge

**A — work sitting in the app, incomplete.** Imported rows not yet assigned, transactions
flagged for attention (the ⚠ badge), unsettled Fish Pie expenses, an abandoned import session,
unresolved duplicates, FX spends awaiting repair. Exactly countable. A true queue.

**B — absence inferable from a declared cadence.** The coverage model: an account with a
statement cycle whose coverage ended 40 days ago almost certainly has unrecorded activity.
Inferred, but well-founded, because the user declared the cadence.

**C — absence the app cannot know.** Cash spending. A transaction from this morning. An
account never mentioned. There is no basis for a number here.

**The count may only draw on A and B.** Any number that implies knowledge of C is a lie, and
one the user will catch immediately, at which point the whole readout is dead to them.

## The ambiguous zero

This is the failure mode that kills naive queue-depth counts in a manual app: **"I am caught
up" and "I have not imported anything in three weeks" look identical.** In email, zero is
unambiguous. Here the dangerous state is the one that renders as done.

What resolves it is already built and deserves more credit than it gets: coverage is
**asserted**, not inferred from absence. An account is current because the user said it is
covered through a date, with provenance (`import` / `reconcile` / `manual` / `empty`) — not
because no rows were found. That is the difference between silence and confirmation, and it
is the only reason an inbox model is honest in this app at all.

## What the existing model already gets right

Reading `backend/src/coverage/catch-up.ts`:

- **The horizon.** `state === 'current'` means covered to the *horizon*, not to today, and for
  a cycle account the horizon is the statement date plus release lag. The finish line moves
  with the cycle, so being caught up is reachable on a normal week. A count that cannot reach
  zero becomes wallpaper inside a fortnight; this is what prevents that, and nothing should
  undo it.
- **The leading edge.** Only the last coverage span counts. Older holes stay in the data and
  are never surfaced — "a 2019 gap sitting in a queue forever is the definition of the nagging
  this feature exists to avoid."
- **Accounts as the unit.** From the code's own comment: "Accounts, never days — '4 accounts
  to catch up' is actionable, '63 days behind' is only guilt." Right, and it is also the unit
  the work is actually done in: you deal with `bank:chequing`, not with 14 loose rows.
- **Momentum sorting.** Smallest gap first, dormant last, because "finishing the account that
  is two days behind makes the next one feel possible."
- **`expectedTxns`.** An estimate of how many transactions sit in the gap, from the account's
  own rate over *covered days only* — deliberately not dividing by uncovered days, which would
  read every neglected account as quiet.

## Two holes in `accountsToCatchUp`

Both are in `summarize()`, both would make a status-bar count misreport from day one.

**Dormant accounts inflate it permanently.** The count is `state === 'behind'` with no
dormancy filter, but `dormant` is orthogonal to `state`. A quiet account that is behind is
behind forever — nothing the user does clears it, because there is nothing to record. Several
of those park a permanent +2 or +3 on the number, which is exactly the badge fatigue that
kills these features. `sortAccounts` already ranks dormant last, so the intent exists; it just
never reached the count. Should be `behind && !dormant`.

**Unset accounts are invisible to it.** `merged.length === 0` → `state = 'unset'` → excluded.
So accounts never set up — the ones showing "never" on the accounts page, and the likeliest to
be quietly rotting — can never enter the count. The number systematically under-reports the
worst cases.

They cannot simply be added: they would then sit there permanently, reproducing the dormancy
problem. They are a one-time setup decision ("11 accounts aren't tracked — should they be?"),
dismissible per account, not a recurring queue item.

## Where this landed

The count is not the first thing to build. Trust Signals ships first
(`planning/epics/trust-signals.md`), because:

- The completeness date has no ambiguous zero. "Complete through Jun 21" degrades to
  "Complete through today" when caught up — the win condition stated as a fact.
- It answers the question actually being asked in front of a $20,119.73 balance, which is
  "can I believe this," not "how many chores remain."
- It establishes and tests the `behind && !dormant` predicate the count will need.

When the count is built on top, the shape it should take:

- Unit: accounts. An account is in the inbox if it is `behind && !dormant` **or** holds
  unresolved in-app work (tier A). Both resolve in the same place, so the union is coherent.
- Untracked accounts get a separate, dismissible setup prompt — never folded into the count.
- Cash cannot be inferred. Either exclude cash accounts or put them on a user-declared
  cadence; do not guess.
- `expectedTxns` belongs on the catch-up hub, where the user has already committed to doing
  the work, not in the status bar where it arrives uninvited and reads as guilt.
