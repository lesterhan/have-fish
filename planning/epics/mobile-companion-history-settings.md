# Epic: Pocket Companion — History & Settings (Companion 4 of 4)

**Goal:** Finish the Companion redesign with the History tab (scannable expenses +
settlements feed) and the Settings screen (read-only group config + the all-groups
entry point), plus the polished Groups sheet. Closes the design.

Builds on Epics 1–3 (theme, gloss primitives, bottom-sheet, shell, Add, settlement
state).

## Design reference

- **Screenshots:** `.design/history-tab.png`, `.design/settings-page.png`
- **Handoff:** `.design/handoff/README.md` — sections *Screen: History*,
  *Screen: Settings (group)*, *Components → Bottom sheet*.
- **Prototype:** `.design/handoff/companion/screens-more.jsx` (History, Settings).

## Backend reconciliation

- History data: `fetchExpenses` + `fetchSettlements`. Both newest-first.
- Settings is **mostly read-only** — category/account config lives on the web app by
  design, to keep the phone fast. Editable bits on the current mobile settings panel
  (rename group, weights, invites, delete) are **not** part of this design's Settings
  screen; keep them reachable if needed but the Companion Settings is a config
  *display* + an "All groups" button. Confirm with Lester whether to retain
  rename/delete/invite actions or move them fully to web.
- Quick currencies have no backend representation — render the static list
  (CAD · CZK · CNY · EUR) as active chips (display only).

---

## Stories

### Story 1 — History tab

Section label `EXPENSES {n}`, then rows. Each expense row = 3-col grid
`auto 1fr auto`, `gap 12`, padding `11 16`, `1px lineSoft` bottom border:
- 32px payer `Avatar`.
- Middle: description (system-ui 14.5/600, ellipsis) then a meta line (`gap 7`):
  `{Mon D} · {payer}` (mono 11, `ink3`) + a **category tag** (mono 9.5/700,
  uppercase, `ink2`, bg `#eee9df` / `surface2`, `1px lineSoft` border, radius 5,
  padding `2 6`). Omit the tag when uncategorized.
- Right: amount (mono 15/700, `ink`) over currency code (mono 10, `ink3`).

Then `SETTLEMENTS {n}` section: rows showing `{from} → {to}` + a status badge, date,
and the amount. Design shows a green `COMPLETED` badge; since mobile now has
**pending** settlements (Epic 3), render the real status — `COMPLETED` green, and a
`PENDING` badge (use `accentSoft`/`accentInk` or a neutral treatment) for unconfirmed
ones, with the receiver's Confirm action wired here (or surfaced from Epic 3).

- Use a single scrollable list (`FlatList`/`SectionList`) with the two sections;
  refresh on focus + after Add/settlement (shared state).
- Date label via the existing `Mon D` formatter.

**Tests:** expense rows render avatar/desc/meta/amount + category tag (and omit it
when uncategorized); settlement rows render direction + correct status badge;
sections show counts; pending vs completed badge correct; empty states for each
section.

### Story 2 — Settings screen

Reached via the header gear (Epic 1). `padding 16`, `gap 16`. Each card = `Label`
heading + soft-gloss `surface` container (radius 14), rows divided by `1px lineSoft`;
each row = label (`ink2` 14.5, left) + mono value (13/600, `ink`, right):
- **Group** — Name / Default currency / Members.
- **Split** — each member → `{pct}%` (from `shareWeight`).
- **Categories · posting accounts** — each active category → its ledger account
  (e.g. `Food → expenses:food`). Account path from the category's mapping
  (`myMapping.accountId` → resolve to the account `path` via `fetchAccounts`, the
  current user's view). Caption below: "Categories & accounts are configured on the
  web app to keep entry fast here."
- **Quick currencies** — the static quick-pick chips, shown active (display only).
- **All groups** — neutral `GlossButton` → opens the Groups sheet (Epic 1).

Decide (with Lester) whether to keep rename / member-weight / invite / delete actions
somewhere (they exist in the current `GroupSettingsPanel` + `lib/api.ts`). Default:
keep them out of the Companion Settings (web-managed), but don't delete the API
methods.

**Tests:** group/split/category-account/quick-currency rows render from real group
data; account paths resolve from mappings; "All groups" opens the sheet; graceful
render for a 1-member group.

### Story 3 — Groups sheet polish + cleanup

- Finalize the Groups sheet (started in Epic 1): list groups with `{n} members ·
  {ccy}`, switch + persist active group, return to Add. Keep create-group reachable
  (reuse existing flow).
- **Remove the old nav surfaces** now fully replaced: the standalone Groups-list home
  screen, the 4-tab `SegmentedTabs` group-detail layout, and any components only used
  by them (audit `ExpenseForm` old version, `BalanceCard`, `ExpenseList`,
  `SettlementList`, `GroupSettingsPanel`, `SegmentedTabs`, `AccountPicker`,
  `ScreenHeader` — migrate or delete). Keep `lib/api.ts` intact.
- Run `bun run lint:tokens`; ensure no dead raw-literal styles remain from deleted
  screens.

**Tests:** group switching from the sheet persists and reloads the shell; no orphaned
imports / dead screens; lint:tokens green; app builds + APK release succeeds.

---

## Out of scope

- Editing categories/accounts/weights on mobile (web-managed by design).
- Dark theme, per-user accent.

## Notes

- This epic ends the Companion redesign. After Story 3, wrap up: move all four
  Companion epics to `planning/epics/archive/` and mark them Done in
  `planning/ROADMAP.md` (the "wrapping up an epic" flow), and re-confirm the APK
  release pipeline (`build-android.yml`) still produces a signed build with the new
  fonts + `expo-linear-gradient` native dep.
</content>
