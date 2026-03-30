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
    onaccountcreated?: (account: Account) => void;
  }

  let { tx, accounts, onaccountcreated }: Props = $props();

  // Local copies of mutable fields — updated after a successful PATCH.
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
    const [y, m, d] = toISODate(new Date(isoDate)).split("-").map(Number);
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

  let dateParts = $derived(parseDateParts(tx.date));

  // --- Display helpers ---
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

    <!-- Summary line: from → to  amounts -->
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
          role="button"
          tabindex="0"
          onclick={() => startPostingEdit(from.id, from.accountId)}
          onkeydown={(e) => handleEditableKeydown(e, () => startPostingEdit(from.id, from.accountId))}
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
          role="button"
          tabindex="0"
          onclick={() => startPostingEdit(to.id, to.accountId)}
          onkeydown={(e) => handleEditableKeydown(e, () => startPostingEdit(to.id, to.accountId))}
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
            class="account editable"
            role="button"
            tabindex="0"
            onclick={() => startPostingEdit(posting.id, posting.accountId)}
            onkeydown={(e) => handleEditableKeydown(e, () => startPostingEdit(posting.id, posting.accountId))}
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

    {#if postingError}<span class="edit-error" role="alert">{postingError}</span>{/if}
  </div>

  <div class="money-col">
    {#if from.currency === to.currency}
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
    <Button disabled aria-label="Edit transaction (coming soon)">Edit</Button>
  </div>
</div>

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
    border-bottom: 1px dashed transparent;
    transition: border-color var(--duration-fast) var(--ease);
  }

  .editable:hover {
    border-bottom-color: var(--color-text-muted);
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
  }
</style>
