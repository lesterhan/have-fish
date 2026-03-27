# Epic: Import CSV for Existing Asset Account ✓ Done

Goal: Clean up and polish the current import workflow for accounts that already exist. The form and preview table become proper Panel components, and a second panel below lists all configured parsers so the user can see what's set up without going to Settings.

## Background

The current import page is a raw form with no visual structure. It works but looks rough next to the new Panel-based assets page. This epic is about bringing it up to the same visual standard and surfacing parser management directly on the import page so the user never needs to leave.

This epic covers **asset accounts only** — accounts whose path starts with `defaultAssetsRootPath`. Liability imports have a separate epic because of the sign inversion problem.

---

## Stories

### 1. Wrap the upload form in a Panel

- Panel title: "Import CSV"
- The form fields (to account, default currency, file picker) become a vertically stacked layout inside the panel body
- Labels and inputs are full-width, stacked (label above input), with consistent spacing
- Error and "no parser found" messages live inside the panel
- The "Preview import" button sits at the bottom of the panel body

### 2. Wrap the preview table in a Panel

- Panel title: "Preview — {parser name}"
- The from-account selector (non-multi-currency), missing accounts banner, parse error list, transaction table, and summary/action row all live inside this panel
- The Cancel / Confirm buttons sit in a `.panel-actions` footer row at the bottom of the panel (matching the assets page toolbar pattern)

### 3. Add "Configured Parsers" panel below the import form

- Panel title: "Configured Parsers"
- Lists all non-deleted parsers in a table with columns:
  - **Name** — parser name
  - **Account** — path of the default account (or "—" if unset)
  - **Multi-currency** — yes/no
  - **Fee account** — path of the default fee account (or "—" if not set)
- Fetch parsers and accounts on mount alongside existing data loads
- Empty state: "No parsers configured yet."
- This panel is read-only for now — editing/deleting parsers is a later story

### 4. Hide the import form while preview is showing

- When `preview` is non-null, hide the upload form panel entirely
- When the user cancels, restore the upload form panel
- Prevents confusion about which panel is active

