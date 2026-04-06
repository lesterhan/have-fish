# Epic: Sidebar Redesign

Replace the top menubar navigation with a collapsible left sidebar. The sidebar
is the primary navigation surface and also surfaces account balances at a glance,
inspired by tools like YNAB and Photoshop's tool panel.

## Goals

- Remove the horizontal menubar nav links (keep the titlebar and statusbar)
- Add a collapsible left panel inside the window body area
- Collapsed state: a narrow strip with a single toggle icon button — Photoshop-style
- Expanded state: account groups (Assets, Liabilities, Equity) with balances, plus
  nav links to Transactions and Import
- Introduce `defaultEquityRootPath` to user settings (alongside the existing
  assets/liabilities/expenses root paths)

## Stories

### Story 1 — Add equity root path to user settings

**Backend**
- Add `defaultEquityRootPath text NOT NULL DEFAULT 'equity'` column to the
  `userSettings` table in `schema.ts`
- Generate and apply migration (dev + test databases)
- Expose the new field in the existing settings GET and PATCH routes

**Frontend**
- Add an "Equity root path" input to the settings page, matching the style of the
  existing root-path inputs

---

### Story 2 — Sidebar component (structure + collapse)

Create `frontend/src/lib/components/Sidebar.svelte`.

**Collapsed state** (≈ 36px wide)
- A single button centred vertically near the top — a `≡` or panel-toggle icon
- No text, no account list
- Clicking it expands the sidebar

**Expanded state** (≈ 200px wide)
- Toggle button at the top to collapse again
- Three account group sections: **Assets**, **Liabilities**, **Equity**
  - Each section header is a clickable link → `/assets` (same destination for all
    three for now; single-account routing is a future epic)
  - Under each header, a list of account rows (name + balance) — leave these as
    static placeholder items in this story; real data comes in Story 3
- Nav links at the bottom: **Transactions** → `/transactions`, **Import** → `/import`
- The collapse/expand state is driven by a local `$state` boolean; no persistence needed

**Visual treatment (retro theme)**
- The sidebar sits inside the window body, to the left of the content area
- Background: `--color-window` with `--shadow-sunken` on the right edge to separate
  it from the content pane
- Account rows: small text, `--color-text-muted` for balance, subtle hover using
  `--color-accent-light`
- Section headers: `--text-xs` uppercase, `--color-text-muted`, bolder weight
- The toggle button: `--shadow-raised` raised button, same chrome as the titlebar
  window buttons

---

### Story 3 — Wire up live account data

**Frontend**
- In `+layout.svelte` (or a layout load function), fetch all active accounts and
  the user's settings (to know the root paths for each group)
- Pass accounts + settings as props into `Sidebar`
- In `Sidebar`, group accounts by whether their path starts with
  `defaultAssetsRootPath`, `defaultLiabilitiesRootPath`, or `defaultEquityRootPath`
- Display each account's name and balance (use `MoneyDisplay`)
- Accounts with no balance yet should show `—` rather than `$0.00`

---

### Story 4 — Integrate sidebar into the main layout

- Restructure `+layout.svelte`: the `.window-body` becomes a flex row containing
  `<Sidebar>` on the left and a `<div class="content">` on the right
- The `.content` div takes `flex: 1`, `overflow-y: auto`, and keeps the existing
  scroll styling
- Remove the nav links from the menubar (keep the toast slot, theme toggle, and
  settings/email link)
- Move the theme toggle and user email/settings link into the sidebar footer or keep
  in a slimmed-down menubar — designer's call, but the menubar should feel lighter
- Ensure the layout still works in both maximized and windowed modes

---

## Responsive design

This epic marks the start of responsive design across the app. As we touch UI
surfaces, we should design for mobile screens alongside desktop.

**Sidebar on mobile (narrow viewport, e.g. ≤ 600px)**
- The sidebar does not appear as a left panel — it becomes a bottom sheet or a
  full-screen drawer triggered by a hamburger button in the titlebar/menubar area
- The collapsed "strip" metaphor does not translate to mobile; on small screens the
  default state is hidden and the toggle reveals it as an overlay
- Account rows and nav links should be finger-friendly (minimum 44px tap target height)
- The `.window` chrome (titlebar, statusbar) may need to adapt — e.g. hide the
  window-resize and quit buttons on mobile where they make no sense

Track responsive breakpoints as CSS custom properties or a shared constant so
future epics can reuse the same thresholds.

---

## Out of scope

- Clicking an account does not navigate anywhere yet — that is the Single Account
  View epic
- No drag-to-resize on the sidebar
- No persistence of collapsed/expanded state across sessions
