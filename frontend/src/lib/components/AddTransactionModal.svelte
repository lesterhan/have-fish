<script lang="ts">
  import { untrack } from "svelte";
  import Modal from "$lib/components/ui/Modal.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import AccountPathInput from "$lib/components/AccountPathInput.svelte";
  import { createTransaction, type Account, type Transaction } from "$lib/api";
  import { toISODate } from "$lib/date";

  interface Props {
    accounts: Account[];
    defaultOffsetAccountId?: string | null;
    open: boolean;
    onclose: () => void;
    oncreated?: (tx: Transaction) => void;
    onaccountcreated?: (account: Account) => void;
  }

  let {
    accounts,
    defaultOffsetAccountId,
    open = $bindable(),
    onclose,
    oncreated,
    onaccountcreated,
  }: Props = $props();

  // --- Form state ---
  // Two fixed postings — amounts are independent so the balance indicator is meaningful.
  let date = $state(toISODate(new Date()));
  let description = $state("");
  let postings = $state([
    { accountId: "", amount: "", currency: "CAD" },
    { accountId: untrack(() => defaultOffsetAccountId ?? ""), amount: "", currency: "CAD" },
  ]);
  let submitting = $state(false);
  let submitError = $state("");

  // Reset all fields whenever the modal opens.
  $effect(() => {
    if (open) {
      date = toISODate(new Date());
      description = "";
      postings = [
        { accountId: "", amount: "", currency: "CAD" },
        { accountId: defaultOffsetAccountId ?? "", amount: "", currency: "CAD" },
      ];
      submitting = false;
      submitError = "";
    }
  });

  // Per-currency balance — same logic as TransactionEditModal.
  // Skip unparseable amounts while the user is still typing.
  let balances = $derived.by(() => {
    const map = new Map<string, number>();
    for (const p of postings) {
      const n = parseFloat(p.amount);
      if (!isNaN(n)) map.set(p.currency, (map.get(p.currency) ?? 0) + n);
    }
    return map;
  });

  let balanced = $derived(
    balances.size > 0 && [...balances.values()].every((v) => Math.abs(v) < 0.005)
  );

  let canSubmit = $derived(
    balanced &&
    postings.every((p) => p.accountId !== "") &&
    !submitting
  );

  function addPosting() {
    postings.push({ accountId: "", amount: "", currency: postings[0]?.currency ?? "CAD" });
  }

  function removePosting(i: number) {
    postings.splice(i, 1);
  }

  function handleCurrencyInput(e: Event, i: number) {
    postings[i].currency = (e.currentTarget as HTMLInputElement).value.toUpperCase();
  }

  function handleAmountBlur(i: number) {
    const n = parseFloat(postings[i].amount);
    if (!isNaN(n) && postings[i].amount.trim() !== "") {
      postings[i].amount = n.toFixed(2);
    }
  }

  async function handleSubmit() {
    submitting = true;
    submitError = "";
    try {
      const result = await createTransaction({
        date,
        description: description.trim() || undefined,
        postings: postings.map((p) => ({
          accountId: p.accountId,
          amount: p.amount,
          currency: p.currency,
        })),
      });
      oncreated?.(result);
      onclose();
    } catch (e) {
      submitError = e instanceof Error ? e.message : "Failed to add transaction";
    } finally {
      submitting = false;
    }
  }
</script>

<Modal title="New Transaction" {open} {onclose}>
  <div class="modal-body">

    <!-- Date + description — always-visible inputs (creation form, not edit-in-place) -->
    <div class="header-row">
      <input
        type="date"
        class="date-input"
        aria-label="Date"
        bind:value={date}
        disabled={submitting}
      />
      <input
        class="desc-input"
        bind:value={description}
        placeholder="Description (optional)"
        aria-label="Description"
        disabled={submitting}
      />
    </div>

    <!-- Posting rows — same grid as TransactionEditModal (account | amount | currency) -->
    <div class="postings">
      {#each postings as posting, i}
        <div class="posting-row">
          <div class="posting-account-cell">
            <AccountPathInput
              {accounts}
              bind:value={posting.accountId}
              oncreate={(a) => { onaccountcreated?.(a); }}
            />
          </div>
          <input
            type="text"
            inputmode="decimal"
            class="amount-input"
            aria-label="Amount"
            bind:value={posting.amount}
            placeholder="0.00"
            onblur={() => handleAmountBlur(i)}
            disabled={submitting}
          />
          <input
            type="text"
            class="currency-input"
            aria-label="Currency"
            value={posting.currency}
            oninput={(e) => handleCurrencyInput(e, i)}
            maxlength={4}
            disabled={submitting}
          />
          <button
            class="delete-btn"
            title="Remove posting"
            aria-label="Remove posting"
            disabled={postings.length <= 2}
            onclick={() => removePosting(i)}
          >×</button>
        </div>
      {/each}
    </div>

    <button class="add-posting-btn" onclick={addPosting}>+ Add posting</button>

    <hr class="divider" />

    <!-- Balance indicator — same as TransactionEditModal -->
    <div class="balance-row">
      <span class="balance-label">Balance</span>
      {#if balanced}
        <span class="balance-ok">✓ 0.00</span>
      {:else}
        <div class="balance-errors">
          {#each [...balances.entries()] as [cur, total]}
            {#if Math.abs(total) >= 0.005}
              <span class="balance-bad" title="Balance must be zero">
                {total > 0 ? "+" : ""}{total.toFixed(2)} {cur}
              </span>
            {/if}
          {/each}
        </div>
      {/if}
    </div>

    {#if submitError}
      <p class="save-error" role="alert">{submitError}</p>
    {/if}

    <div class="footer">
      <div class="footer-actions">
        <Button disabled={submitting} onclick={onclose}>Cancel</Button>
        <Button variant="primary" disabled={!canSubmit} onclick={handleSubmit}>
          {submitting ? "Adding…" : "Add"}
        </Button>
      </div>
    </div>

  </div>
</Modal>

<style>
  /* Matches TransactionEditModal's .modal-body exactly */
  .modal-body {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    min-width: 460px;
  }

  /* ---- Header row: date + description ---- */
  .header-row {
    display: flex;
    align-items: baseline;
    gap: var(--sp-md);
  }

  .date-input {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    background: var(--color-window-inset);
    border: none;
    box-shadow: var(--shadow-sunken);
    padding: 1px var(--sp-xs);
    height: 20px;
    outline: none;
    flex-shrink: 0;
  }

  .date-input:focus {
    outline: 1px solid var(--color-accent-mid);
    outline-offset: -1px;
  }

  .desc-input {
    flex: 1;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--color-accent-mid);
    background: var(--color-window-inset);
    border: none;
    box-shadow: var(--shadow-sunken);
    padding: 1px var(--sp-xs);
    height: 20px;
    outline: none;
    min-width: 0;
  }

  .desc-input:focus {
    outline: 1px solid var(--color-accent-mid);
    outline-offset: -1px;
  }

  .desc-input::placeholder {
    font-weight: var(--weight-normal);
    color: var(--color-text-muted);
  }

  /* ---- Postings list — identical grid to TransactionEditModal ---- */
  .postings {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .posting-row {
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    align-items: center;
    gap: var(--sp-xs);
    padding: 2px 0;
  }

  .posting-account-cell {
    min-width: 0;
  }

  .amount-input {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-window-inset);
    border: none;
    box-shadow: var(--shadow-sunken);
    padding: 1px var(--sp-xs);
    height: 20px;
    outline: none;
    width: 10ch;
    text-align: right;
    transition: outline var(--duration-fast) var(--ease);
  }

  .currency-input {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    background: var(--color-window-inset);
    border: none;
    box-shadow: var(--shadow-sunken);
    padding: 1px var(--sp-xs);
    height: 20px;
    outline: none;
    width: 5.5ch;
    text-transform: uppercase;
    transition: outline var(--duration-fast) var(--ease);
  }

  .amount-input:focus,
  .currency-input:focus {
    outline: 1px solid var(--color-accent-mid);
    outline-offset: -1px;
  }

  /* ---- Delete + add posting buttons — same as TransactionEditModal ---- */
  .delete-btn {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0 var(--sp-xs);
    line-height: 1;
    height: 20px;
    outline: none;
    transition: color var(--duration-fast) var(--ease);
  }

  .delete-btn:hover:not(:disabled) {
    color: var(--color-danger);
  }

  .delete-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .delete-btn:focus-visible {
    outline: 1px dotted var(--color-text);
    outline-offset: 1px;
  }

  .add-posting-btn {
    align-self: flex-start;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
    outline: none;
    transition: color var(--duration-fast) var(--ease);
  }

  .add-posting-btn:hover {
    color: var(--color-text);
  }

  .add-posting-btn:focus-visible {
    outline: 1px dotted var(--color-text);
    outline-offset: 2px;
  }

  /* ---- Divider + balance — copied verbatim from TransactionEditModal ---- */
  .divider {
    border: none;
    border-top: 1px solid var(--color-divider);
    margin: 0;
  }

  .balance-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .balance-label {
    color: var(--color-text-muted);
  }

  .balance-ok {
    color: var(--color-success);
  }

  .balance-errors {
    display: flex;
    gap: var(--sp-sm);
  }

  .balance-bad {
    color: var(--color-danger);
  }

  /* ---- Footer ---- */
  .save-error {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-danger);
    margin: 0;
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    padding-top: var(--sp-xs);
    border-top: 1px solid var(--color-divider);
  }

  .footer-actions {
    display: flex;
    gap: var(--sp-sm);
  }
</style>
