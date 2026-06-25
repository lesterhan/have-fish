# Epic: Transaction Modal — Flow Narration

Goal: Redesign the read-only transaction-detail modal so it **narrates how the money
moved**, not just what it was for. The current view (shipped in
[Single-Transaction View](archive/single-transaction-view.md) story 2) leads with the
subject leg but hides the things that matter on a real transaction: the *actual amount*
that left your account on a cross-currency spend, the *conversion rate + FX fee*, and the
*split relationship* (who owes whom). This epic surfaces all of it through a layered,
role-driven flow tree — clear for a trivial `savings → rent` and not overwhelming for a
5-leg multi-currency split.

## Design handoff

A high-fidelity design was produced externally. The assets live locally in `.design/`
(gitignored — not pushed):

- `.design/txn-modal.zip` → `design_handoff_transaction_modal/README.md` (the spec) +
  `Transaction Modal.html` (a vanilla-JS prototype demoing 4 archetypes — **reference, not
  code to copy**).
- Screenshots: `.design/txn-*.png` (`txn-modal-simple-spend`, `txn-split`,
  `txn-multi-currency`, `txn-refund`).

We recreate the design in the Svelte codebase using existing primitives. The handoff's
own pixel values (8px window radius, purple accent, raw hexes) are **overridden** where
they conflict with our design system — see *Overrides* below.

## Background — what's broken today

`narrate.ts` + `TransactionDetail.svelte` (from the prior epic) have two structural gaps,
both confirmed by tracing real transactions:

1. **Multi-currency spend loses the real cost + rate.** "You Are My Cup Of": coffee
   360 CZK paid from a USD account. The 17.29 USD that actually left, and the 20.88
   CZK/USD rate, live on the `transfer` + two `equity:conversions` bridge legs.
   `narrate` abs()'s the subject and *drops* conversion legs entirely; its flow detector
   only fires on ≥2 `transfer` legs in different currencies, so this shape (CZK subject +
   single USD transfer + equity bridge) shows no conversion at all. The user never sees
   what the coffee cost them in USD.
2. **Split shows no relationship.** "Nihao ikea": paid 500 CZK, own share 150, Household
   owes 350. Today renders three independent lines with an amount-less "how it moved"
   source. The 500-fronted / 150-mine / 350-owed math — the whole point — isn't expressed.

Both are narration-model problems, not styling. The fix is a richer derived model + a
flow-tree render.

## Core idea — three layers

Every posting carries a `role` (already on the read payload: `subject` / `transfer` /
`conversion` / `fee` / `share`). The design tells a story top-to-bottom:

1. **Hero** — *what the money was for.* The `subject` leg's friendly label + amount.
   Largest type, read first. Inflows (refund/income) render green with a leading `+`.
2. **Narration blurb** — one plain-language sentence summarizing the transaction.
   **Editable, templated** (see story 3).
3. **How it moved** — *the flow tree.* The real **source** asset as a dot at the top of a
   spine, branching down into each destination, every branch tagged with a **role chip**
   that says its *meaning* (`the spend`, `your share`, `owes you`, `you owe`, `FX fee`,
   `deposit`) instead of ledger jargon.
4. **On demand** — two collapsed-by-default expanders: **Currency conversion** (rate math
   derived from the bridge legs) and **All postings** (every raw leg incl. equity bridges,
   with a `balances ✓` per-currency check).

## Archetypes (one component, four data shapes)

| Archetype | Shape | Key surface |
|-----------|-------|-------------|
| **Simple spend** | 1 asset out → 1 expense in | source dot → one `the spend` branch; no conversion expander; 2 legs |
| **Split (Fish Pie)** | transfer + `share` (receivable) + subject | branches `your share` + `owes you` (accent); `Split · <group>` header tag; blurb spells out fronted/share/owed |
| **Multi-currency** | subject(native) + transfer(asset ccy) + 2× `equity:conversions` + fee | hero in native ccy; source = the asset that moved; `the spend` branch carries inline "converted @ rate" → opens conversion expander; `FX fee` branch (amber); conversion grid = PAID/CONVERTED/FX FEE/RATE; 5 legs |
| **Income / refund** | inflow — subject stored negative, asset positive | hero green `+`; source = the *destination* asset; `deposit` chip (green); blurb "Money came back in…"; `Refund` header tag |

## Overrides — reuse app flair, drop prototype specifics

Decisions made with the user (2026-06-25):

1. **Window chrome → reuse `Modal.svelte`.** The app already *is* a draggable XP/Aqua
   window with the same titlebar gradient + beveled close. The detail component becomes
   **Modal body content**, not its own window. **Corners stay sharp** — the handoff's 8px
   window radius violates the no-rounded-corners rule (`--radius` = 0). Drop the gloss-card
   wrapper added in the prior epic's PR #121; Modal is the surface.
2. **Accent → app tokens, not purple.** Map the handoff's `--accent*` to `--color-accent*`
   (Aqua blue, runtime-themed by `accent.ts`). The source dot, `owes you` chip, and
   expander hints use app accent.
3. **Semantic colors → app tokens.** Inflow-green / spend-red map to
   `--color-amount-positive` / `--color-amount-negative`, not the prototype hexes.
4. **Fonts → no change.** App already declares the exact three the handoff asks for:
   `--font-serif` (Source Serif 4), `--font-mono` (JetBrains Mono), `--font-sans`
   (Lucida Grande).
5. **Currency pill → reuse the existing `CurrencyPill` as-is.** The handoff specs a
   polychrome per-currency palette; we keep the current monochrome-accent pill for now.
   If at-a-glance currency ID proves weak in real use, touch up `CurrencyPill` as a
   separate, self-contained change — not in this epic.
6. **Friendly labels = `account.name ?? prettifyPath(path)`.** Asset/category accounts may
   have an optional `accounts.name` (nullable column, exists in schema). Prefer it; when
   null, **derive a prettified label from the path** (title-case the last 1–2 segments,
   joined with ` · ` — e.g. `expenses:housing:rent` → "Housing · Rent",
   `expenses:food` → "Food"). The **raw colon path is always shown as the secondary line**
   beneath the label (the app is ledger-forward; users expect to see paths).

## Derivation (compute from postings — store nothing but UI toggles)

- **source** = the asset/transfer leg that actually moved money. Outflow: the negative
  transfer asset. Inflow: the positive destination asset.
- **hero** = the `subject` leg. Sign-aware — keep direction; inflow renders `+`/green.
- **branches** = the non-source legs (excluding `equity:conversions`), each mapped to a
  role chip: `subject` → `the spend`; `share` on `…:receivable:…` → `owes you` (accent);
  `share` on `…:payable:…` → `you owe`; `expenses:fees:*` (or fee-role) → `FX fee` (amber);
  inflow destination asset → `deposit` (green).
- **conversion** = present iff two `equity:conversions` bridge legs in different
  currencies exist. Rate = bridge amounts (e.g. 360 CZK / 17.24 USD = 20.88 CZK/USD);
  PAID = source abs; FX FEE = fee leg. Triggers the conversion expander.
- **allPostings** = every raw leg (incl. bridges), signed, with ` · role` note.
- **balances ✓** = assert legs sum to zero per currency (across the conversion bridge).
- **archetype** = derived for blurb selection + header tag (simple / split / multiCcy /
  inflow).

`equity:conversions` legs are **never** rendered as branches — only in All postings and as
the conversion expander's source data.

---

## Stories

### 1. Plumb friendly account labels onto the read payload

Backend + a tiny frontend type change. The transactions payload sends `accountPath` but
not the account's `name`. The detail needs the friendly label.

- Add `accountName: accounts.name` to the posting select in `transactions.ts` (the GET
  list query) **and** the POST/replace enrichment path so the contract is consistent.
- Extend the frontend `Posting` type + `fetchTransactions` mapping with
  `accountName: string | null`.
- This is the only backend change in the epic; label *resolution* (`name ?? prettify`)
  lives frontend (story 2).

Tests: GET payload includes `accountName` (null when unset, the name when set); POST
returns it on enriched postings; existing `accountPath`/`role` assertions still pass.

---

### 2. Narration model rewrite + label resolver

Frontend, pure logic. Replace `narrate.ts`'s output with the layered model above.

- New `NarratedTransaction` shape: `{ archetype, hero, source, branches[], conversion?,
  allPostings[], balances }`. Sign-aware throughout (no blanket abs — direction is data).
- `branches` carry a typed `chip` discriminant (`the-spend` / `your-share` / `owes-you` /
  `you-owe` / `fx-fee` / `deposit`) so the render is dumb.
- `conversion` rate math derived from the two `equity:conversions` bridge legs; `null`
  when absent.
- `balances` = per-currency sum-zero assertion.
- `prettifyPath(path)` + `accountLabel(posting)` = `name ?? prettifyPath` resolver.
- Exhaustive unit tests across all four archetypes **plus** the inflow-sign case and a
  malformed-import shape (must not throw). This is the load-bearing story.

Tests: archetype detection; source/hero/branches/chips per archetype; conversion rate from
bridge legs (20.88); balances ✓ true on canonical shapes, false on a deliberately
unbalanced one; `prettifyPath` cases; `accountLabel` prefers name, falls back to prettify.

---

### 3. Editable narration blurb templates

Frontend, isolated copy. The blurb sentence is **copy the user will tweak** — must not be
hardcoded in the component.

- A single `blurbTemplates` map: `archetype → (n: NarratedTransaction) => BlurbParts`,
  one easy-to-find file. Returns structured parts (text + emphasized numbers + an
  accent-colored span for `owes you`) so the render bolds/colors without parsing strings.
- Per-archetype wording from the mockups (simple / split / multi-currency / refund),
  treated as a starting point — expect the user to edit tone, wording, and which numbers
  are emphasized.

Tests: each archetype produces the expected interpolated parts (amounts, account names,
the `owes you` accent span); numbers come from the transaction, not literals.

---

### 4. Render — header, hero, blurb, flow tree

Frontend. Rewrite `TransactionDetail.svelte` for the first three layers; lives as Modal
body content (sharp corners, app accent, app fonts).

- Header row: payee (serif) + date (mono, dim) + optional kind/group **tag** pill
  (`Split · <group>` / `Refund`), accent-styled.
- Hero: friendly label + raw path secondary line; right-aligned amount w/ `CurrencyPill`.
  Inflow = green `+`.
- Blurb (story 3) between hero and tree.
- `HOW IT MOVED` flow tree: 3-col grid `spine | body | amount`, source dot + dropping
  spine, per-branch elbow/tick, role chips, inflow branches green. Inline "converted @
  rate" note on the multi-currency `the spend` branch (wired to the conversion expander in
  story 5).

Tests: each archetype renders the right hero direction, header tag, branch set + chips;
simple shape stays simple; inflow hero/branch are green. (Component logic exercised via the
pure model from story 2 — frontend has no render harness; assert the model + any render
helper functions.)

---

### 5. Render — progressive-disclosure expanders

Frontend. The two collapsed-by-default expanders + balances check.

- **Currency conversion**: caret row (rotates 90° open) with the rate as a right-aligned
  hint; body = PAID / CONVERTED / FX FEE / RATE grid. Only rendered when
  `conversion != null`. The hero branch's inline "converted @ rate" note opens this panel.
- **All postings**: caret row with "<n> legs" hint; body = 2-col ledger of every raw leg
  (path + ` · role`, signed amount + pill), footer `balances ✓` (green) from the model.
- Local UI state only: `convOpen`, `postingsOpen` — independent, both default closed.

Tests: conversion expander present only on multi-currency; rate hint matches the model;
all-postings lists every leg incl. bridges with correct signs; `balances ✓` reflects the
model's assertion; toggles are independent.

---

## Sequencing

1 first (unblocks the label) and standalone. 2 is load-bearing — the whole render keys off
the new model; land it with full tests before any pixels. 3 is small, isolated copy. 4 and
5 build the view top-down; 4 is the main visual, 5 the progressive disclosure. Each story
is its own PR against `main`.

## Resolved decisions (2026-06-25)

- **Own epic, after #121.** Not a ride-on the prior epic's final PR — this rewrites the
  narration model + render and touches the API. Branch off a merged main.
- **Friendly label** = `account.name ?? prettifyPath(path)`, raw path always secondary.
- **Currency pill** unchanged — reuse the monochrome `CurrencyPill`; revisit polychrome
  separately only if needed.
- **Chrome/accent/fonts/semantics** from the app, not the prototype (see *Overrides*).
- **Sharp corners** — override the handoff's 8px window radius.
- **Blurb is templated + editable**, never hardcoded inline.
