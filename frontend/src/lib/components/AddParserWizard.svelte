<script lang="ts">
  import Modal from "./ui/Modal.svelte";
  import Button from "./ui/Button.svelte";
  import AccountPathInput from "./AccountPathInput.svelte";
  import type { Account, CsvParser } from "$lib/api";

  interface Props {
    open: boolean;
    accounts: Account[];
    onSuccess?: (parser: CsvParser) => void;
  }

  let { open = $bindable(), accounts, onSuccess }: Props = $props();

  const STEP = {
    ACCOUNT_PICK: "account-pick",
    PARSER_UPLOAD: "parser-upload",
    PARSER_COLUMNS: "parser-columns",
    PARSER_MULTICURRENCY: "parser-multicurrency",
    CONFIRM: "confirm",
  } as const;

  type WizardStep = (typeof STEP)[keyof typeof STEP];

  let step = $state<WizardStep>(STEP.ACCOUNT_PICK);
  let parserSkipped = $state(false);

  // --- Step 1 state ---
  // searchOnly mode gives us a path string; derive the account ID for submit.
  let selectedAccountPath = $state("");
  let selectedAccountId = $derived(
    accounts.find((a) => a.path === selectedAccountPath)?.id ?? "",
  );

  // --- Step 2+ state (parser setup) ---
  let isMultiCurrency = $state(false);

  // Transition tables
  const NEXT: Record<WizardStep, WizardStep | (() => WizardStep)> = {
    [STEP.ACCOUNT_PICK]: STEP.PARSER_UPLOAD,
    [STEP.PARSER_UPLOAD]: STEP.PARSER_COLUMNS,
    [STEP.PARSER_COLUMNS]: () =>
      isMultiCurrency ? STEP.PARSER_MULTICURRENCY : STEP.CONFIRM,
    [STEP.PARSER_MULTICURRENCY]: STEP.CONFIRM,
    [STEP.CONFIRM]: STEP.CONFIRM,
  };

  const BACK: Record<WizardStep, WizardStep | (() => WizardStep)> = {
    [STEP.ACCOUNT_PICK]: STEP.ACCOUNT_PICK,
    [STEP.PARSER_UPLOAD]: STEP.ACCOUNT_PICK,
    [STEP.PARSER_COLUMNS]: STEP.PARSER_UPLOAD,
    [STEP.PARSER_MULTICURRENCY]: STEP.PARSER_COLUMNS,
    [STEP.CONFIRM]: () =>
      parserSkipped
        ? STEP.PARSER_UPLOAD
        : isMultiCurrency
          ? STEP.PARSER_MULTICURRENCY
          : STEP.PARSER_COLUMNS,
  };

  function next() {
    const t = NEXT[step];
    step = typeof t === "function" ? t() : t;
  }

  function back() {
    const t = BACK[step];
    step = typeof t === "function" ? t() : t;
  }

  function skip() {
    // TODO (Story 3): call resetStep2() here
    isMultiCurrency = false;
    parserSkipped = true;
    step = STEP.CONFIRM;
  }

  function close() {
    open = false;
    setTimeout(() => {
      step = STEP.ACCOUNT_PICK;
      parserSkipped = false;
      selectedAccountPath = "";
      isMultiCurrency = false;
      // TODO (Story 3): call resetStep2() here
    }, 200);
  }

  // Validation
  let step1Valid = $derived(selectedAccountId.length > 0);

  // TODO (Story 3): derive parserUploadValid, parserColumnsValid, parserMultiCurrencyValid

  // Placeholder validity — always true until real state is wired up
  let parserUploadValid = $state(false);
  let parserColumnsValid = $state(false);
  let parserMultiCurrencyValid = $state(false);

  let submitting = $state(false);
  let submitError = $state("");

  async function handleConfirm() {
    // TODO (Story 4): POST to /api/parsers and call onSuccess
  }
</script>

<Modal title="Add Import Parser" bind:open onclose={close}>
  <div class="wizard-body">
    {#if step === STEP.ACCOUNT_PICK}
      <div class="form-grid">
        <label for="account-pick">Account</label>
        <AccountPathInput
          {accounts}
          bind:value={selectedAccountPath}
          placeholder="Select an account…"
          searchOnly
        />
      </div>
    {:else if step === STEP.PARSER_UPLOAD}
      <!-- TODO (Story 3): Parser name, CSV upload, detected header, multi-currency toggle -->
      <p class="placeholder">Step 2: Upload CSV + name parser</p>
    {:else if step === STEP.PARSER_COLUMNS}
      <!-- TODO (Story 3): Column mapping dropdowns -->
      <p class="placeholder">Step 3: Map columns</p>
    {:else if step === STEP.PARSER_MULTICURRENCY}
      <!-- TODO (Story 3): Multi-currency source/target/fee mapping -->
      <p class="placeholder">Step 4: Multi-currency mapping</p>
    {:else if step === STEP.CONFIRM}
      <!-- TODO (Story 4): Read-only summary + submit error -->
      <p class="placeholder">Step 5: Confirm</p>
      {#if submitError}
        <p class="summary-error">{submitError}</p>
      {/if}
    {/if}
  </div>

  <!-- Footer nav -->
  <div class="wizard-footer">
    <div class="footer-left">
      {#if step !== STEP.ACCOUNT_PICK}
        <Button onclick={back}>◀️ Back</Button>
      {/if}
    </div>

    <div class="footer-right">
      {#if step === STEP.ACCOUNT_PICK}
        <Button variant="primary" onclick={next} disabled={!step1Valid}>
          Next ▶️
        </Button>
      {:else if step === STEP.PARSER_UPLOAD}
        <Button onclick={skip}>Skip</Button>
        <Button variant="primary" onclick={next} disabled={!parserUploadValid}>
          Next ▶️
        </Button>
      {:else if step === STEP.PARSER_COLUMNS}
        <Button onclick={skip}>Skip</Button>
        <Button variant="primary" onclick={next} disabled={!parserColumnsValid}>
          Next ▶️
        </Button>
      {:else if step === STEP.PARSER_MULTICURRENCY}
        <Button onclick={skip}>Skip</Button>
        <Button
          variant="primary"
          onclick={next}
          disabled={!parserMultiCurrencyValid}
        >
          Next ▶️
        </Button>
      {:else if step === STEP.CONFIRM}
        <Button
          variant="primary"
          onclick={handleConfirm}
          disabled={submitting}
        >
          {submitting ? "Creating…" : "Confirm"}
        </Button>
      {/if}
    </div>
  </div>
</Modal>

<style>
  .wizard-body {
    min-width: 420px;
  }

  .form-grid {
    display: grid;
    grid-template-columns: 10rem 1fr;
    gap: var(--sp-xs) var(--sp-sm);
    align-items: center;
  }

  .form-grid label {
    font-size: var(--text-sm);
    text-align: right;
  }

  .placeholder {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    font-style: italic;
    padding: var(--sp-md) 0;
  }

  .summary-error {
    font-size: var(--text-sm);
    color: var(--color-amount-negative);
    background: var(--color-danger-light);
    padding: var(--sp-xs) var(--sp-sm);
    box-shadow: var(--shadow-sunken);
  }

  .wizard-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: var(--sp-md);
    border-top: 1px solid var(--color-bevel-mid);
    margin-top: var(--sp-md);
  }

  .footer-left,
  .footer-right {
    display: flex;
    gap: var(--sp-xs);
  }
</style>
