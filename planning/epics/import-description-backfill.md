# Epic: Import Description Backfill

Goal: When importing a monthly CSV statement, automatically fill in blank descriptions on existing transactions that match a duplicate row — so you can enter transactions quickly without descriptions and let the import clean them up later.

## Background

The Quick Entry flow lets you enter transactions fast, often leaving descriptions blank. When the monthly statement arrives and you import it, the duplicate detection already skips rows that match existing transactions (same account, date ±1 day, amount ±0.01). This epic extends that behavior: if the matched existing transaction has a blank description, the import will patch it with the CSV description instead of silently skipping.

The preview table already shows a "dup" badge for matched rows. This epic adds a "patch" state — visually distinct — so you can see at a glance which rows will update an existing description vs. which are fully skipped.

---

## Stories

### 1. Backend — patch description on import commit

In `POST /api/import/commit`:

- For each row in the commit payload, check if it has a `possibleDuplicate`
- If yes, fetch the existing transaction
- If the existing transaction's `description` is null or empty string, update it with the incoming row's description
- If the existing transaction already has a description, skip as before (no overwrite)
- Return a summary in the response: `{ created: N, skipped: N, patched: N }`

Update `ParsedTransaction` (in `types.ts` and frontend `api.ts`) to carry a `willPatch` boolean in the preview result so the frontend can display the correct state.

Write a minimal smoke test: import a row that matches an existing transaction with blank description — confirm the description is updated and no duplicate transaction is created.

### 2. Frontend — patch state in import preview

In `ImportPreviewPanel.svelte`:

- Rows with `willPatch: true` show a "patch" badge instead of the "dup" badge
- Default row state for `willPatch` rows: not skipped (since they are doing useful work)
- "Patch" badge should be visually distinct from "dup" — different color or label (e.g. "patch desc" vs "duplicate")
- After commit, the success message should include the patched count: "3 imported, 2 patched, 1 skipped"
