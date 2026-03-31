<script module>
  function focusOnMount(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
</script>

<script lang="ts">
  import Button from "$lib/components/Button.svelte";
  import AccountPathInput from "$lib/components/AccountPathInput.svelte";
  import MoneyDisplay from "$lib/components/MoneyDisplay.svelte";
  import TransactionEditModal from "$lib/components/TransactionEditModal.svelte";
  import { toISODate } from "$lib/date";
  import { patchTransaction, patchPosting, type Account } from "$lib/api";

  interface Posting {
    id: string;
    accountId: string;
    amount: string;
    currency: string;
  }

  interface Transaction {
    id: string;
    date: string;
    description: string | null;
    postings: Posting[];
  }

  interface Props {
    tx: Transaction;
    accounts: Account[];
    defaultOffsetAccountId?: string | null;
    defaultConversionAccountId?: string | null;
    onaccountcreated?: (account: Account) => void;
  }

  let {
    tx,
    accounts,
    defaultOffsetAccountId,
    defaultConversionAccountId,
    onaccountcreated,
  }: Props = $props();

  let modalOpen = $state(false);

  // Local copies of mutable fields — updated after a successful save.
  let localDate = $state(tx.date);
  let localDescription = $state(tx.description ?? "");
  let localPostings = $state([...tx.postings]);

  let accountPaths = $derived(
    Object.fromEntries(accounts.map((a) => [a.id, a.path])),
  );

  // --- Description editing ---
  let descEditing = $state(false);
  let descValue = $state("");
  let descError = $state("");

  function startDescEdit() {
    descValue = localDescription;
    descEditing = true;
    descError = "";
  }

  async function commitDescEdit() {
    descEditing = false;
    const next = descValue.trim();
    if (next === localDescription) return;
    try {
      await patchTransaction(tx.id, { description: next || null });
      localDescription = next;
    } catch (e) {
      descError = e instanceof Error ? e.message : "Save failed";
    }
  }

  function cancelDescEdit() {
    descEditing = false;
    descError = "";
  }

  function handleDescKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitDescEdit();
    }
    if (e.key === "Escape") cancelDescEdit();
  }

  function handleEditableKeydown(e: KeyboardEvent, action: () => void) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      action();
    }
  }

  // --- Posting account editing ---
  let editingPostingId = $state<string | null>(null);
  let editAccountId = $state("");
  let postingError = $state("");

  function startPostingEdit(postingId: string, currentAccountId: string) {
    descEditing = false;
    editingPostingId = postingId;
    editAccountId = currentAccountId;
    postingError = "";
  }

  async function handlePostingCommit(accountId: string) {
    const id = editingPostingId;
    if (!id) return;
    editingPostingId = null;
    try {
      await patchPosting(id, { accountId });
      localPostings = localPostings.map((p) =>
        p.id === id ? { ...p, accountId } : p,
      );
    } catch (e) {
      postingError = e instanceof Error ? e.message : "Save failed";
    }
  }

  // Close posting edit when focus leaves the AccountPathInput wrapper.
  // The 200ms delay lets AccountPathInput's own 150ms blur handler run first.
  function handlePostingFocusout(e: FocusEvent) {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      const id = editingPostingId;
      setTimeout(() => {
        if (editingPostingId === id) editingPostingId = null;
      }, 200);
    }
  }

  // --- Date display ---
  // Parse YYYY-MM-DD as local midnight to avoid UTC timezone shift.
  function parseDateParts(isoDate: string) {
    // Slice to YYYY-MM-DD before splitting — avoids new Date(str) treating
    // a bare date string as UTC midnight and shifting it into the previous day
    // for UTC- timezones. new Date(y, m-1, d) always creates local midnight.
    const [y, m, d] = isoDate.substring(0, 10).split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return {
      dow: date.toLocaleDateString("en", { weekday: "short" }),
      monthDay: date.toLocaleDateString("en", {
        month: "short",
        day: "numeric",
      }),
      year: String(y),
    };
  }

  let dateParts = $derived(parseDateParts(localDate));

  // --- Display helpers ---

  // A cross-currency transfer has postings in more than one currency.
  // These transactions (typically 4–5 postings with a conversion account)
  // need a different layout from the standard from→to summary.
  let isCrossCurrency = $derived(
    new Set(localPostings.map((p) => p.currency)).size > 1,
  );

  // For cross-currency transfers: identify the source (largest outflow) and
  // target (largest inflow in a different currency). Everything else —
  // conversion account entries and fee postings — is treated as internals.
  function classifyTransfer(postings: Posting[]) {
    const sorted = [...postings].sort(
      (a, b) => parseFloat(a.amount) - parseFloat(b.amount),
    );
    // Source = most negative posting overall
    const source = sorted[0];
    // Target = most positive posting in a different currency from source
    const target = [...postings]
      .filter((p) => p.currency !== source.currency)
      .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount))[0];
    // Fees = remaining positive postings (excludes conversion account entries
    // which net to zero; only non-zero-sum positives remain)
    const internalIds = new Set([source.id, target?.id]);
    const fees = postings.filter(
      (p) =>
        !internalIds.has(p.id) &&
        parseFloat(p.amount) > 0 &&
        p.accountId !== defaultConversionAccountId,
    );
    return { source, target, fees };
  }

  let transfer = $derived(classifyTransfer(localPostings));

  function summarize(postings: Posting[]) {
    const sorted = [...postings].sort(
      (a, b) => parseFloat(a.amount) - parseFloat(b.amount),
    );
    return {
      from: sorted[0],
      to: sorted[sorted.length - 1],
      rest: sorted.slice(1, -1),
    };
  }

  let { from, to, rest } = $derived(summarize(localPostings));
</script>

<div class="row">
  <div class="date">
    <span class="date-meta">{dateParts.year} {dateParts.dow}</span>
    <span class="date-main">{dateParts.monthDay}</span>
  </div>

  <div class="body">
    <!-- Description -->
    {#if descEditing}
      <!-- Auto-sizes to text width via the CSS grid sizer trick -->
      <div class="desc-sizer" data-value={descValue}>
        <input
          class="edit-input"
          bind:value={descValue}
          onblur={commitDescEdit}
          onkeydown={handleDescKeydown}
          aria-label="Description"
          use:focusOnMount
        />
      </div>
    {:else}
      <span
        class="description editable"
        role="button"
        tabindex="0"
        onclick={startDescEdit}
        onkeydown={(e) => handleEditableKeydown(e, startDescEdit)}
        title="Click to edit"
      >
        {localDescription || "—"}
      </span>
    {/if}
    {#if descError}<span class="edit-error" role="alert">{descError}</span>{/if}

    {#if isCrossCurrency}
      <!-- Cross-currency transfer: show source → target, suppress internals -->
      <div class="summary-line">
        <span class="account account-from">
          {accountPaths[transfer.source.accountId] ?? transfer.source.accountId}
        </span>
        <span class="arrow" aria-hidden="true">➜</span>
        <span class="account account-to">
          {accountPaths[transfer.target?.accountId ?? ""] ??
            transfer.target?.accountId ??
            "—"}
        </span>
      </div>
      {#if transfer.fees.length > 0}
        <div class="transfer-fees">
          {#each transfer.fees as fee}
            <span class="fee-label">
              fee {Math.abs(parseFloat(fee.amount)).toFixed(2)}
              {fee.currency}
            </span>
          {/each}
        </div>
      {/if}
    {:else}
      <!-- Standard summary line: from → to -->
      <div class="summary-line">
        {#if editingPostingId === from.id}
          <div class="account-edit-wrapper" onfocusout={handlePostingFocusout}>
            <AccountPathInput
              {accounts}
              bind:value={editAccountId}
              oncommit={handlePostingCommit}
              oncreate={onaccountcreated}
            />
          </div>
        {:else}
          <span
            class="account account-from editable"
            class:account-uncategorized={from.accountId ===
              defaultOffsetAccountId}
            role="button"
            tabindex="0"
            onclick={() => startPostingEdit(from.id, from.accountId)}
            onkeydown={(e) =>
              handleEditableKeydown(e, () =>
                startPostingEdit(from.id, from.accountId),
              )}
            title="Click to edit"
          >
            {accountPaths[from.accountId] ?? from.accountId}
          </span>
        {/if}

        <span class="arrow" aria-hidden="true">➜</span>

        {#if editingPostingId === to.id}
          <div class="account-edit-wrapper" onfocusout={handlePostingFocusout}>
            <AccountPathInput
              {accounts}
              bind:value={editAccountId}
              oncommit={handlePostingCommit}
              oncreate={onaccountcreated}
            />
          </div>
        {:else}
          <span
            class="account account-to editable"
            class:account-uncategorized={to.accountId ===
              defaultOffsetAccountId}
            role="button"
            tabindex="0"
            onclick={() => startPostingEdit(to.id, to.accountId)}
            onkeydown={(e) =>
              handleEditableKeydown(e, () =>
                startPostingEdit(to.id, to.accountId),
              )}
            title="Click to edit"
          >
            {accountPaths[to.accountId] ?? to.accountId}
          </span>
        {/if}
      </div>

      <!-- Extra postings (fees etc.) -->
      {#each rest as posting}
        <div class="extra-posting">
          {#if editingPostingId === posting.id}
            <div
              class="account-edit-wrapper"
              onfocusout={handlePostingFocusout}
            >
              <AccountPathInput
                {accounts}
                bind:value={editAccountId}
                oncommit={handlePostingCommit}
                oncreate={onaccountcreated}
              />
            </div>
          {:else}
            <span
              class="account editable"
              class:account-uncategorized={posting.accountId ===
                defaultOffsetAccountId}
              role="button"
              tabindex="0"
              onclick={() => startPostingEdit(posting.id, posting.accountId)}
              onkeydown={(e) =>
                handleEditableKeydown(e, () =>
                  startPostingEdit(posting.id, posting.accountId),
                )}
              title="Click to edit"
            >
              {accountPaths[posting.accountId] ?? posting.accountId}
            </span>
          {/if}
          <MoneyDisplay
            amount={Math.abs(parseFloat(posting.amount)).toFixed(2)}
            currency={posting.currency}
          />
        </div>
      {/each}
    {/if}

    {#if postingError}<span class="edit-error" role="alert">{postingError}</span
      >{/if}
  </div>

  <div class="money-col">
    {#if isCrossCurrency}
      <MoneyDisplay
        amount={Math.abs(parseFloat(transfer.source.amount)).toFixed(2)}
        currency={transfer.source.currency}
      />
      <span class="cross-arrow" aria-hidden="true">➜</span>
      <MoneyDisplay
        amount={parseFloat(transfer.target?.amount ?? "0").toFixed(2)}
        currency={transfer.target?.currency ?? ""}
      />
    {:else if from.currency === to.currency}
      <MoneyDisplay
        amount={Math.abs(parseFloat(from.amount)).toFixed(2)}
        currency={to.currency}
      />
    {:else}
      <MoneyDisplay
        amount={Math.abs(parseFloat(from.amount)).toFixed(2)}
        currency={from.currency}
      />
      <span class="cross-arrow" aria-hidden="true">→</span>
      <MoneyDisplay
        amount={parseFloat(to.amount).toFixed(2)}
        currency={to.currency}
      />
    {/if}
  </div>

  <div class="actions">
    <Button
      title="Edit transaction"
      variant="ghost"
      square
      onclick={() => (modalOpen = true)}>🧮</Button
    >
  </div>
</div>

<TransactionEditModal
  tx={{
    ...tx,
    date: localDate,
    description: localDescription || null,
    postings: localPostings,
  }}
  {accounts}
  {defaultOffsetAccountId}
  bind:open={modalOpen}
  onclose={() => (modalOpen = false)}
  {onaccountcreated}
  onsaved={(updates) => {
    localDate = updates.date;
    localDescription = updates.description ?? "";
    localPostings = updates.postings;
  }}
/>

<style>
  .row {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: start;
    gap: var(--sp-xs);
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-divider);
    transition: background var(--duration-fast) var(--ease);
  }

  .row:hover {
    background: var(--color-accent-light);
  }

  .row:last-child {
    border-bottom: none;
  }

  .date {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    font-family: var(--font-sans);
  }

  .date-meta {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .date-main {
    font-size: var(--text-base);
    color: var(--color-text);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-left: 1px solid var(--color-divider);
    padding-left: var(--sp-xs);
  }

  .description {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-accent-mid);
  }

  /* Auto-sizing description input.
     The ::after pseudo-element mirrors the input value and sets the width;
     the input overlays it in the same grid cell. */
  .desc-sizer {
    display: inline-grid;
    align-self: flex-start;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
  }

  .desc-sizer::after {
    content: attr(data-value) " ";
    grid-area: 1 / 1;
    visibility: hidden;
    white-space: pre;
    min-width: 8ch;
  }

  .desc-sizer .edit-input {
    grid-area: 1 / 1;
    width: 100%;
    min-width: 0;
  }

  .summary-line {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
  }

  .extra-posting {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    display: flex;
    gap: var(--sp-xs);
    padding-left: var(--sp-md);
  }

  .transfer-fees {
    display: flex;
    gap: var(--sp-sm);
  }

  .fee-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .arrow {
    color: var(--color-text-muted);
    flex-shrink: 0;
    padding: 0 var(--sp-xs);
  }

  .account {
    color: var(--color-text);
  }

  .account-from {
    color: var(--color-text-muted);
  }

  .account-to {
    color: var(--color-text);
  }

  .account-uncategorized {
    color: var(--color-warning);
  }

  .money-col {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    align-self: center;
  }

  .cross-arrow {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .editable {
    cursor: text;
    outline: 1px dashed transparent;
    outline-offset: 1px;
    transition: outline-color var(--duration-fast) var(--ease);
  }

  .editable:hover {
    outline-color: var(--color-text-muted);
  }

  .edit-input {
    font-family: inherit;
    font-size: inherit;
    color: var(--color-text);
    background: var(--color-window-inset);
    border: none;
    box-shadow: var(--shadow-sunken);
    padding: 1px var(--sp-xs);
    height: 20px;
    outline: none;
  }

  .edit-input:focus {
    outline: 1px solid var(--color-accent-mid);
    outline-offset: -1px;
  }

  .account-edit-wrapper {
    flex: 1;
    min-width: 0;
    max-width: 260px;
  }

  .edit-error {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-danger);
  }

  .actions {
    display: flex;
    align-items: center;
    align-self: center;
  }
</style>
