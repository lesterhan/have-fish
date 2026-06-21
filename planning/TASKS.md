# Backlog Tasks

Small, self-contained tasks that don't belong to an epic.

---

## Extract tooltip icon into a shared component

**Context:** `EditParserPanel` has an inline `<button class="tooltip-icon">?</button>` pattern that also appears elsewhere in the app. It's a small circle with a `?` that shows a tooltip on hover via the `use:tooltip` action.

**Task:** Pull this out into a reusable `TooltipIcon.svelte` component in `frontend/src/lib/components/ui/`. It should accept a `label` prop (the tooltip text) and render the styled button internally. Replace usages in `EditParserPanel` and anywhere else the pattern appears.

---

## Currency input component

**Context:** The "Default currency" field across the app is currently a plain `<TextInput>`. It should behave more like `AccountPathInput`.

**Task:** Build a `CurrencyInput.svelte` component in `frontend/src/lib/components/ui/` with the following behaviour:

- **Suggestions:** Autocompletes from a list of supported currencies as the user types.
- **Display state (not focused):** Shows a `CurrencyPill` for the selected currency code instead of plain text. Should still look editable (not like a read-only badge) — probably pill inside a lightly-inset container, no full white input box.
- **Edit state (focused):** Switches to a text field with a dropdown of matching currencies, same interaction pattern as `AccountPathInput`.

Replace all `<TextInput>` currency fields with this component once built (at minimum the import page and any settings fields).

---

## Filter settled expenses out of the history list (web + companion)

**Do after the Companion epics are done.** Noticed while testing: the Fish Pie
history/expense list grows unbounded — every expense ever logged is dumped into one
list on both the web UI and the Companion History tab. Over time you have to scroll
past a wall of old, already-settled expenses to reach anything current or to find the
settlements.

**Task:**

- **Both platforms:** add a filter toggle on the expense list — a hide/show **settled**
  expenses button — so the default view shows only expenses still outstanding.
- **Companion History tab:** mirror the web UI's two-section layout — an `EXPENSES`
  section (with the new hide/show-settled filter) and a separate `SETTLEMENTS` section
  (including proposed/pending settlements). Today everything is one list, so you must
  scroll to the bottom to see any settlement. The two-section History layout is already
  specced in `planning/epics/mobile-companion-history-settings.md` (Story 1) — the new
  piece here is the settled-expense filter; fold it in if that epic hasn't shipped yet.

**Open question — what does "settled" mean per-expense?** Fish Pie has no per-expense
settled flag. Settlement nets *balances* between members, not individual expenses
(money is fungible — a settlement doesn't map to specific rows). So "hide settled
expenses" needs a definition before building. Candidates:
- Expenses dated before the most recent settlement that cleared the balance between the
  involved members (approximate, by date).
- A derived "fully covered by later settlements" notion (hard — requires attributing
  settlement amounts back to expenses, which the model deliberately avoids).
- Simplest: a per-expense `settledAt` set when a settlement covering its members lands,
  or a manual "archive expense" action.

Pin down the semantics with Lester before implementing. If it turns out to need a
schema change + backend work, promote this from a task to a small epic.

---

## Companion: full group settings page + relocate app settings

**Do after the Companion epics are done.** Noticed while testing: the gear icon sits
top-right next to the **group name**, so it reads as *group* settings — but the
Companion Settings screen (`mobile-companion-history-settings.md` Story 2) is
deliberately read-only and app-ish. Mismatch between what the placement implies and
what the screen does.

**This reverses a prior scope decision.** That epic's Story 2 and its *Out of scope*
section explicitly keep category/account/weight editing off mobile ("web-managed by
design, to keep the phone fast"). Lester now wants editable group settings on mobile
after the current planned work. Update that epic's notes (or supersede them) when this
is picked up.

**Task:**

- **Group settings page (under the gear icon):** mirror the web UI's group settings —
  editable, not just a display. At minimum: set up **categories** (and their posting
  accounts), rename group, member weights/split, invites, delete. The existing
  `GroupSettingsPanel` + `lib/api.ts` methods already cover most of this on mobile;
  this is largely re-surfacing them behind the gear rather than greenfield. Confirm the
  web group-settings surface to mirror exactly.
- **App settings — move elsewhere.** Separate app-level settings (server URL, account,
  sign out, theme, etc.) out of the group context. Placement TBD — candidate is a
  bottom-nav entry. **Decide with Lester** before building.

Decide the split between group vs app settings and the app-settings location with
Lester at pickup time.

---

## Companion: refined account selector / creator

**Prerequisite for the category-settings work above** — editing category posting
accounts on mobile needs a far better account picker than today's. Current
`mobile/components/AccountPicker.tsx` is a bottom sheet with a plain search box: fine
for picking from a short known list, weak for narrowing a large account tree fast or
creating a new account inline.

**Task:** build a refined account selector + creator for the Companion app that lets a
user land on the right account quickly and confidently, and create one when none fits.
Ideas to fold in:

- **Account-type presets** — quick filter chips for the root type
  (assets / liabilities / expenses / income / equity) to narrow the list before typing.
- **Autocomplete** over the account path as the user types, matching the web
  `AccountPathInput` behaviour where it makes sense for mobile.
- **Inline create** — when the desired account doesn't exist, create it from the picker
  (type → choose root → confirm) without leaving the flow.
- Confidence cues — show the full resolved path / type so the user knows what they're
  selecting.

Mirror the web `AccountPathInput` interaction model where it translates to touch.
Replaces / upgrades `AccountPicker.tsx` and should serve both expense entry and the new
category-settings page.

---

## Companion: better server-address entry on login

**Noticed while testing:** login / re-login on the Companion app is painful — you
re-type the full server URL (scheme, host, port) every time. Server base URL lives in
SecureStore (`mobile/lib/auth.ts`); the entry UI is the login screen under
`mobile/app/(auth)/`.

**Task:** make server-address entry fast and low-error:

- **Scheme toggle** — a preset `http://` / `https://` toggle instead of typing the
  scheme.
- **Remembered servers** — store previously-seen server addresses and let the user pick
  a prior one from a list/dropdown rather than retyping. (Persist alongside the base URL
  in SecureStore; consider not storing if the user explicitly clears it.)
- **Prefilled port** — default the port to `:8887` (the app's standard backend port),
  editable.

Net result: returning users tap a remembered server (or toggle scheme + accept the
prefilled port) instead of hand-typing the whole URL.
