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
