# Roadmap

| Epic | Status |
|------|--------|
| Assets Summary | Done |
| Currency Transfers | Done |
| [Modal Component](epics/archive/modal-component.md) | Done |
| [Add Account Wizard](epics/archive/add-account-wizard.md) | Done |
| [Starting Balances](epics/starting-balances.md) | Backlog |
| [Manual Transaction Entry](epics/archive/manual-transaction-entry.md) | Done |
| [Quick Entry](epics/quick-entry.md) | Backlog |
| [Import Description Backfill](epics/import-description-backfill.md) | Backlog |
| [Split Transactions](epics/split-transactions.md) | Backlog |
| [Reconciliation](epics/archive/reconciliation.md) | Done |
| [Transactions Edit UX](epics/archive/transactions-edit-ux.md) | Done |
| [Transaction Edit Modal](epics/archive/transaction-edit-modal.md) | Done |
| [Transaction Filtering by Date](epics/archive/transaction-filtering-by-date.md) | Done |
| [Import CSV for Existing Asset Account](epics/archive/import-csv-existing-account.md) | Done |
| [Import CSV for Liability Accounts](epics/archive/import-csv-liability-accounts.md) | Done |
| [Support Transfer Direction](epics/archive/support-transfer-direction.md) | Done |
| [Resolve Duplicate Transactions](epics/archive/resolve-duplicate-transactions.md) | Done |
| [Dashboard](epics/archive/dashboard.md) | Done |
| [User Sign-up](epics/archive/user-signup.md) | Done |
| [Sidebar Redesign](epics/archive/sidebar-redesign.md) | Done |
| [Single Account View](epics/archive/single-account-view.md) | Done |
| [Add Import Parser](epics/archive/add-import-parser.md) | Done |
| [Spending Page](epics/archive/spending-page.md) | Done |
| [Illiquid Account Flags](epics/illiquid-account-flags.md) | Backlog |
| [Account Reorganization](epics/account-reorganization.md) | Backlog |
| [Single-Transaction View](epics/single-transaction-view.md) | Backlog |
| [Cross-Currency Spend Import + Heal](epics/archive/cross-currency-spend-import.md) | Done |
| [Import Rules](epics/archive/import-rules.md) | Done |
| [Import Rules — Fish Pie Splits & Inline Capture](epics/import-rules-fish-pie.md) | Backlog |
| [Spending Account Filter](epics/spending-account-filter.md) | Backlog |
| [FX Rates & Preferred Currency](epics/archive/fx-rates.md) | Done |
| [Action Required](epics/archive/action-required.md) | Done |
| [Fish Pie: Groups & Membership](epics/archive/fish-pie-groups.md) | Done |
| [Fish Pie: Invites](epics/archive/fish-pie-invites.md) | Done |
| [Fish Pie: Group Expenses](epics/archive/fish-pie-expenses.md) | Done |
| [Fish Pie: Balances & Settlement](epics/archive/fish-pie-balances.md) | Done |
| [Graphite Design System](epics/archive/graphite-design-system.md) | Done |
| [Accent Color Preference](epics/archive/accent-color-preference.md) | Done |
| [Currency Pill Component](epics/archive/currency-pill.md) | Done |
| [Spending Page Redesign](epics/archive/spending-page-redesign.md) | Done |
| [Transactions Panel Redesign](epics/archive/transactions-panel-redesign.md) | Done |
| [Fish Pie: Account Integration](epics/archive/fish-pie-account-integration.md) | Done |
| [Fish Pie: Settlement Confirmation](epics/archive/fish-pie-settlement-confirmation.md) | Done |
| [Fish Pie: CSV Import Integration](epics/archive/fish-pie-csv-import.md) | Done |
| [Fish Pie: Expense Management](epics/fish-pie-expense-management.md) | Backlog |
| [Fish Pie: Ledger Signs](epics/archive/fish-pie-ledger-signs.md) | Done |
| [Fish Pie: Categories](epics/archive/fish-pie-categories.md) | Done |
| [Fish Pie: Expense Proposals](epics/fish-pie-expense-proposals.md) | Backlog |
| [Mobile Local APK CI](epics/archive/mobile-local-apk-ci.md) | Done |
| [Mobile Revival → MVP](epics/archive/mobile-revival.md) | Done |
| [Pocket Companion: Mobile Design](epics/archive/mobile-pocket-companion-design.md) | Done |
| [Companion 1: Shell, Theme & Nav](epics/archive/mobile-companion-shell.md) | Done |
| [Companion 2: Add / Speed Entry](epics/archive/mobile-companion-add.md) | Done |
| [Companion 3: Balances & Settlement](epics/archive/mobile-companion-balances.md) | Done |
| [Companion 4: History & Settings](epics/archive/mobile-companion-history-settings.md) | Done |
| [Companion Payment Row](epics/companion-payment-row.md) | Backlog |
| [Companion Theming (Light/Dark + Accents)](epics/companion-theming.md) | Backlog |
| [Fish Pie: Cross-Currency Settlement](epics/archive/fish-pie-cross-currency-settlement.md) | Done |

## Fish Pie sequence

Agreed order for the Fish Pie overhaul (background and findings in
[`planning/exploration/fish-pie-experience.md`](exploration/fish-pie-experience.md)).
Pick up the first non-Done item:

1. ~~**[Ledger Signs](epics/archive/fish-pie-ledger-signs.md)**~~ — **Done.** Fixed
   BUG-005 (debtor posting signs) + data migration. Closed BUG-004a.
2. ~~**[Categories](epics/archive/fish-pie-categories.md)**~~ — **Done.** Single group
   per household, category per expense, per-category weights, merge migration. Renamed
   clearing accounts `group:<slug>` → `assets:receivable:<slug>` (decided 2026-06-11).
3. **[Expense Proposals](epics/fish-pie-expense-proposals.md)** — amended: settlement
   *warns* instead of hard-blocking on pending proposals; rebase onto categories.
   Also resolves BUG-006 properly.
4. ~~**[Mobile Revival → MVP](epics/archive/mobile-revival.md)**~~ — **Done.** SDK 56
   bump, API resync, account picker, category-aware entry, view-only balances. Mobile
   settlement/design/offline deferred (stories 6–8).
5. **Import Rules v2** (no epic yet, see exploration F16) — then the fish-pie
   auto-split rule action.
6. **Fish Pie attention/notifications** (no epic yet, see exploration F17).
7. **Settlement FX consolidation** (no epic yet) — settle all currencies as one
   amount using stored FX rates.
8. **hledger export** — after 1–2 stabilize ledger semantics.
