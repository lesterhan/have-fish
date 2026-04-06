<script lang="ts">
  import { onMount } from "svelte";
  import Modal from "./ui/Modal.svelte";
  import Button from "./ui/Button.svelte";
  import Toggle from "./ui/Toggle.svelte";
  import { tooltip } from "$lib/tooltip";
  import { settingsStore } from "$lib/settings.svelte";

  interface Props {
    type: "asset" | "liability";
    open: boolean;
    onSuccess?: () => void;
  }

  let { type, open = $bindable(), onSuccess }: Props = $props();

  const TITLES = {
    asset: "Add New Asset Account",
    liability: "Add New Liability Account",
  };

  const STEP = {
    ACCOUNT: "account",
    PARSER_UPLOAD: "parser-upload",
    PARSER_COLUMNS: "parser-columns",
    PARSER_MULTICURRENCY: "parser-multicurrency",
    CONFIRM: "confirm",
  } as const;

  type WizardStep = (typeof STEP)[keyof typeof STEP];
  let step = $state<WizardStep>(STEP.ACCOUNT);
  let parserSkipped = $state(false);

  // Transition tables — use a function where the target depends on runtime state.
  const NEXT: Record<WizardStep, WizardStep | (() => WizardStep)> = {
    [STEP.ACCOUNT]: STEP.PARSER_UPLOAD,
    [STEP.PARSER_UPLOAD]: STEP.PARSER_COLUMNS,
    [STEP.PARSER_COLUMNS]: () =>
      isMultiCurrency ? STEP.PARSER_MULTICURRENCY : STEP.CONFIRM,
    [STEP.PARSER_MULTICURRENCY]: STEP.CONFIRM,
    [STEP.CONFIRM]: STEP.CONFIRM,
  };

  const BACK: Record<WizardStep, WizardStep | (() => WizardStep)> = {
    [STEP.ACCOUNT]: STEP.ACCOUNT,
    [STEP.PARSER_UPLOAD]: STEP.ACCOUNT,
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
    resetStep2();
    parserSkipped = true;
    step = STEP.CONFIRM;
  }

  function close() {
    open = false;
    setTimeout(() => {
      step = STEP.ACCOUNT;
      parserSkipped = false;
      resetStep1();
      resetStep2();
    }, 200);
  }

  onMount(async () => {
    await settingsStore.load();
  });

  // The prefix to pre-fill when the wizard opens, based on type + user settings.
  let rootPrefix = $derived.by(() => {
    const s = settingsStore.value;
    if (!s) return "";
    return type === "asset"
      ? s.defaultAssetsRootPath + ":"
      : s.defaultLiabilitiesRootPath + ":";
  });

  // --- Step 1 state ---
  let accountPath = $state("");
  let startingBalance = $state("");
  let startingCurrency = $state("CAD");
  let startingDate = $state(todayIso());

  function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  // Pre-fill the account path when the wizard opens or the root prefix resolves.
  $effect(() => {
    if (open && rootPrefix && accountPath === "") {
      accountPath = rootPrefix;
    }
  });

  function resetStep1() {
    accountPath = "";
    startingBalance = "";
    startingCurrency = "CAD";
    startingDate = todayIso();
  }

  let step1Valid = $derived(
    accountPath.trim().length > 0 && accountPath.trim() !== rootPrefix.trim(),
  );

  // --- Step 2 state ---
  let parserName = $state("");
  let columns = $state<string[]>([]);
  let mappingDate = $state("");
  let mappingAmount = $state("");
  let mappingDescription = $state("");
  let mappingCurrency = $state("");
  let isMultiCurrency = $state(false);
  let mappingSourceAmount = $state("");
  let mappingSourceCurrency = $state("");
  let mappingTargetAmount = $state("");
  let mappingTargetCurrency = $state("");
  let mappingFeeAmount = $state("");
  let mappingFeeCurrency = $state("");
  let mappingSignColumn = $state("");
  let mappingSignNegativeValue = $state("");
  // The raw header line shown to the user after file upload
  let detectedHeader = $state("");

  // Mirrors the backend's parseCsv transformHeader logic exactly.
  function normalizeColumn(col: string): string {
    return col
      .toLowerCase()
      .replace(/"/g, "")
      .replace(/\s/g, "")
      .replace(/\(.*\)/g, "");
  }

  // Sorted pipe-joined fingerprint — must match what the backend stores.
  function buildNormalizedHeader(cols: string[]): string {
    return [...cols].sort().join("|");
  }

  function handleFileUpload(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const firstLine =
        text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
      detectedHeader = firstLine;
      const parsed = firstLine
        .split(",")
        .map((c) => normalizeColumn(c.trim()))
        .filter(Boolean);
      columns = [...new Set(parsed)];
      // Reset mappings when a new file is loaded
      mappingDate = "";
      mappingAmount = "";
      mappingDescription = "";
      mappingCurrency = "";
      mappingSourceAmount = "";
      mappingSourceCurrency = "";
      mappingTargetAmount = "";
      mappingTargetCurrency = "";
      mappingFeeAmount = "";
      mappingFeeCurrency = "";
      mappingSignColumn = "";
      mappingSignNegativeValue = "";
    };
    reader.readAsText(file);
  }

  function resetStep2() {
    parserName = "";
    columns = [];
    detectedHeader = "";
    mappingDate = "";
    mappingAmount = "";
    mappingDescription = "";
    mappingCurrency = "";
    isMultiCurrency = false;
    mappingSourceAmount = "";
    mappingSourceCurrency = "";
    mappingTargetAmount = "";
    mappingTargetCurrency = "";
    mappingFeeAmount = "";
    mappingFeeCurrency = "";
    mappingSignColumn = "";
    mappingSignNegativeValue = "";
  }

  let parserUploadValid = $derived(
    parserName.trim().length > 0 && columns.length > 0,
  );
  let parserColumnsValid = $derived(
    mappingDate.length > 0 && mappingAmount.length > 0,
  );
  let parserMultiCurrencyValid = $derived(
    mappingSourceAmount.length > 0 &&
      mappingSourceCurrency.length > 0 &&
      mappingTargetAmount.length > 0 &&
      mappingTargetCurrency.length > 0,
  );

  // --- Confirm / submit ---
  let submitting = $state(false);
  let submitError = $state("");

  async function handleConfirm() {
    submitting = true;
    submitError = "";
    try {
      // 1. Create the account
      const accountRes = await fetch(`${BASE}/api/accounts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: accountPath.trim() }),
      });
      if (!accountRes.ok) {
        const err = await accountRes.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to create account.");
      }
      const account = await accountRes.json();

      // 2. Post starting balance transaction if a balance was entered
      const balanceAmount = startingBalance.trim();
      if (balanceAmount && settingsStore.value?.defaultOffsetAccountId) {
        const offsetId = settingsStore.value.defaultOffsetAccountId;
        const txRes = await fetch(`${BASE}/api/transactions`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: startingDate,
            description: "Opening balance",
            postings: [
              {
                accountId: account.id,
                amount: balanceAmount,
                currency: startingCurrency,
              },
              {
                accountId: offsetId,
                amount: String(-parseFloat(balanceAmount)),
                currency: startingCurrency,
              },
            ],
          }),
        });
        if (!txRes.ok) {
          const err = await txRes.json().catch(() => ({}));
          throw new Error(
            err.error ?? "Account created but failed to post starting balance.",
          );
        }
      }

      // 3. Create parser if step 2 was completed
      if (!parserSkipped) {
        const columnMapping = {
          date: mappingDate,
          amount: mappingAmount,
          description: mappingDescription || null,
          currency: mappingCurrency || null,
          signColumn: mappingSignColumn || null,
          signNegativeValue: mappingSignColumn ? (mappingSignNegativeValue || null) : null,
          ...(isMultiCurrency && {
            sourceAmount: mappingSourceAmount || null,
            sourceCurrency: mappingSourceCurrency || null,
            targetAmount: mappingTargetAmount || null,
            targetCurrency: mappingTargetCurrency || null,
            feeAmount: mappingFeeAmount || null,
            feeCurrency: mappingFeeCurrency || null,
          }),
        };
        const parserRes = await fetch(`${BASE}/api/parsers`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: parserName.trim(),
            normalizedHeader: buildNormalizedHeader(columns),
            columnMapping,
            isMultiCurrency,
            defaultAccountId: account.id,
          }),
        });
        if (!parserRes.ok) {
          const err = await parserRes.json().catch(() => ({}));
          throw new Error(
            err.error ?? "Account created but failed to save parser.",
          );
        }
      }

      onSuccess?.();
      close();
    } catch (e) {
      submitError = e instanceof Error ? e.message : "Something went wrong.";
    } finally {
      submitting = false;
    }
  }

  const BASE = '';
</script>

<Modal title={TITLES[type]} bind:open onclose={close}>
  <!-- Step content -->
  <div class="wizard-body">
    {#if step === STEP.ACCOUNT}
      <div class="form-grid">
        <label for="account-path">Account path</label>
        <input
          id="account-path"
          type="text"
          bind:value={accountPath}
          placeholder={rootPrefix || "assets:"}
          spellcheck={false}
          autocomplete="off"
        />

        <label for="starting-balance"
          >Starting balance <span class="optional">(optional)</span></label
        >
        <div class="balance-row">
          <input
            id="starting-balance"
            type="text"
            inputmode="decimal"
            bind:value={startingBalance}
            placeholder="0.00"
            class="balance-amount"
          />
          <input
            type="text"
            bind:value={startingCurrency}
            placeholder="CAD"
            class="balance-currency"
            maxlength={5}
            spellcheck={false}
          />
        </div>

        {#if startingBalance.trim()}
          <label for="starting-date">Balance date</label>
          <input id="starting-date" type="date" bind:value={startingDate} />
        {/if}
      </div>
    {:else if step === STEP.PARSER_UPLOAD}
      <div class="form-grid">
        <label for="parser-name">Parser name</label>
        <input
          id="parser-name"
          type="text"
          bind:value={parserName}
          placeholder="e.g. Imre Trust Visa"
          autocomplete="off"
        />

        <label for="wizard-csv-file">CSV file</label>
        <input
          id="wizard-csv-file"
          type="file"
          accept=".csv,text/csv"
          onchange={handleFileUpload}
          class="file-input"
        />

        {#if detectedHeader}
          <span class="field-label">Detected header</span>
          <code class="detected-header">{detectedHeader}</code>
        {/if}

        {#if columns.length > 0}
          <span class="field-label toggle-label">
            Multi-currency
            <button type="button" class="tooltip-icon" use:tooltip={"Enable for banks that encode transfers inline (e.g. Wise). Source, target, and fee columns will be mapped separately."} aria-label="Enable for banks that encode transfers inline (e.g. Wise). Source, target, and fee columns will be mapped separately.">?</button>
          </span>
          <Toggle bind:checked={isMultiCurrency} />
        {/if}
      </div>
    {:else if step === STEP.PARSER_COLUMNS}
      <div class="form-grid">
        <label for="map-date">Date <span class="required">*</span></label>
        <select id="map-date" bind:value={mappingDate}>
          <option value="">— select —</option>
          {#each columns as col}<option value={col}>{col}</option>{/each}
        </select>

        <label for="map-amount">Amount <span class="required">*</span></label>
        <select id="map-amount" bind:value={mappingAmount}>
          <option value="">— select —</option>
          {#each columns as col}<option value={col}>{col}</option>{/each}
        </select>

        <label for="map-description">Description</label>
        <select id="map-description" bind:value={mappingDescription}>
          <option value="">— not mapped —</option>
          {#each columns as col}<option value={col}>{col}</option>{/each}
        </select>

        <label for="map-currency">Currency</label>
        <select id="map-currency" bind:value={mappingCurrency}>
          <option value="">— not mapped —</option>
          {#each columns as col}<option value={col}>{col}</option>{/each}
        </select>

        <label for="map-sign-column" class="toggle-label">
          Direction column
          <button type="button" class="tooltip-icon" use:tooltip={"For banks that put IN/OUT in a separate column (e.g. Wise). Select the column and enter the value that means debit/OUT."} aria-label="For banks that put IN/OUT in a separate column (e.g. Wise). Select the column and enter the value that means debit/OUT.">?</button>
        </label>
        <select id="map-sign-column" bind:value={mappingSignColumn}>
          <option value="">— not mapped —</option>
          {#each columns as col}<option value={col}>{col}</option>{/each}
        </select>

        {#if mappingSignColumn}
          <label for="map-sign-negative">Negative value</label>
          <input
            id="map-sign-negative"
            type="text"
            bind:value={mappingSignNegativeValue}
            placeholder="e.g. OUT"
            spellcheck={false}
            autocomplete="off"
          />
        {/if}
      </div>
    {:else if step === STEP.PARSER_MULTICURRENCY}
      <div class="form-grid">
        <label for="map-src-amount"
          >Source amount <span class="required">*</span></label
        >
        <select id="map-src-amount" bind:value={mappingSourceAmount}>
          <option value="">— select —</option>
          {#each columns as col}<option value={col}>{col}</option>{/each}
        </select>

        <label for="map-src-currency"
          >Source currency <span class="required">*</span></label
        >
        <select id="map-src-currency" bind:value={mappingSourceCurrency}>
          <option value="">— select —</option>
          {#each columns as col}<option value={col}>{col}</option>{/each}
        </select>

        <label for="map-tgt-amount"
          >Target amount <span class="required">*</span></label
        >
        <select id="map-tgt-amount" bind:value={mappingTargetAmount}>
          <option value="">— select —</option>
          {#each columns as col}<option value={col}>{col}</option>{/each}
        </select>

        <label for="map-tgt-currency"
          >Target currency <span class="required">*</span></label
        >
        <select id="map-tgt-currency" bind:value={mappingTargetCurrency}>
          <option value="">— select —</option>
          {#each columns as col}<option value={col}>{col}</option>{/each}
        </select>

        <label for="map-fee-amount">Fee amount</label>
        <select id="map-fee-amount" bind:value={mappingFeeAmount}>
          <option value="">— not mapped —</option>
          {#each columns as col}<option value={col}>{col}</option>{/each}
        </select>

        <label for="map-fee-currency">Fee currency</label>
        <select id="map-fee-currency" bind:value={mappingFeeCurrency}>
          <option value="">— not mapped —</option>
          {#each columns as col}<option value={col}>{col}</option>{/each}
        </select>
      </div>
    {:else if step === STEP.CONFIRM}
      <div class="summary">
        <div class="summary-section">
          <h3 class="summary-heading">Account</h3>
          <div class="summary-row">
            <span class="summary-label">Path</span>
            <code class="summary-value">{accountPath.trim()}</code>
          </div>
          {#if startingBalance.trim()}
            <div class="summary-row">
              <span class="summary-label">Starting balance</span>
              <span class="summary-value"
                >{startingBalance.trim()} {startingCurrency}</span
              >
            </div>
            <div class="summary-row">
              <span class="summary-label">Balance date</span>
              <span class="summary-value">{startingDate}</span>
            </div>
            {#if !settingsStore.value?.defaultOffsetAccountId}
              <p class="summary-warn">
                No offset account set — starting balance will be skipped. Set
                one in Settings.
              </p>
            {/if}
          {/if}
        </div>

        <div class="summary-section">
          <h3 class="summary-heading">CSV Parser</h3>
          {#if parserSkipped}
            <p class="summary-muted">No parser configured.</p>
          {:else}
            <div class="summary-row">
              <span class="summary-label">Name</span>
              <span class="summary-value">{parserName.trim()}</span>
            </div>
            <div class="summary-row">
              <span class="summary-label">Date column</span>
              <code class="summary-value">{mappingDate}</code>
            </div>
            <div class="summary-row">
              <span class="summary-label">Amount column</span>
              <code class="summary-value">{mappingAmount}</code>
            </div>
            {#if mappingDescription}
              <div class="summary-row">
                <span class="summary-label">Description column</span>
                <code class="summary-value">{mappingDescription}</code>
              </div>
            {/if}
            {#if mappingSignColumn}
              <div class="summary-row">
                <span class="summary-label">Direction column</span>
                <code class="summary-value">{mappingSignColumn}</code>
              </div>
              {#if mappingSignNegativeValue}
                <div class="summary-row">
                  <span class="summary-label">Negative value</span>
                  <code class="summary-value">{mappingSignNegativeValue}</code>
                </div>
              {/if}
            {/if}
            {#if isMultiCurrency}
              <div class="summary-row">
                <span class="summary-label">Multi-currency</span>
                <span class="summary-value">Yes</span>
              </div>
            {/if}
          {/if}
        </div>

        {#if submitError}
          <p class="summary-error">{submitError}</p>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Footer nav -->
  <div class="wizard-footer">
    <div class="footer-left">
      {#if step !== STEP.ACCOUNT}
        <Button onclick={back}>◀️ Back</Button>
      {/if}
    </div>

    <div class="footer-right">
      {#if step === STEP.ACCOUNT}
        <Button variant="primary" onclick={next} disabled={!step1Valid}
          >Next ▶️</Button
        >
      {:else if step === STEP.PARSER_UPLOAD}
        <Button onclick={skip}>Skip</Button>
        <Button variant="primary" onclick={next} disabled={!parserUploadValid}
          >Next ▶️</Button
        >
      {:else if step === STEP.PARSER_COLUMNS}
        <Button onclick={skip}>Skip</Button>
        <Button variant="primary" onclick={next} disabled={!parserColumnsValid}
          >Next ▶️</Button
        >
      {:else if step === STEP.PARSER_MULTICURRENCY}
        <Button onclick={skip}>Skip</Button>
        <Button
          variant="primary"
          onclick={next}
          disabled={!parserMultiCurrencyValid}>Next ▶️</Button
        >
      {:else if step === STEP.CONFIRM}
        <Button variant="primary" onclick={handleConfirm} disabled={submitting}>
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

  .form-grid label,
  .form-grid .field-label {
    font-size: var(--text-sm);
    text-align: right;
  }

  .form-grid input {
    font-size: var(--text-sm);
    font-family: var(--font-sans);
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-window-inset);
    box-shadow: var(--shadow-sunken);
    border: none;
    color: var(--color-text);
    width: 100%;
    box-sizing: border-box;
  }

  .form-grid input:focus {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
  }

  .optional {
    color: var(--color-text-muted);
    font-weight: var(--weight-normal);
  }

  .balance-row {
    display: flex;
    gap: var(--sp-xs);
  }

  /* Override the .form-grid input { width: 100% } rule for inputs inside the balance row */
  .balance-row input {
    width: auto;
  }

  .balance-amount {
    flex: 1;
    min-width: 0;
  }

  .balance-currency {
    width: 3.5rem;
    flex-shrink: 0;
    text-transform: uppercase;
  }

  .form-grid select {
    font-size: var(--text-sm);
    font-family: var(--font-sans);
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-window-inset);
    box-shadow: var(--shadow-sunken);
    border: none;
    color: var(--color-text);
    width: 100%;
    box-sizing: border-box;
  }

  .form-grid select:focus {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
  }

  .file-input {
    font-size: var(--text-sm);
    font-family: var(--font-sans);
    background: none !important;
    box-shadow: none !important;
    padding: 0 !important;
    cursor: pointer;
  }

  .detected-header {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    word-break: break-all;
  }

  .required {
    color: var(--color-amount-negative);
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    justify-content: flex-end;
  }

  .tooltip-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-text-muted);
    color: var(--color-window);
    font-size: 10px;
    font-weight: bold;
    cursor: help;
    flex-shrink: 0;
  }

  .summary {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
  }

  .summary-section {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
  }

  .summary-heading {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    padding-bottom: var(--sp-xs);
    border-bottom: 1px solid var(--color-bevel-mid);
    margin-bottom: var(--sp-xs);
  }

  .summary-row {
    display: flex;
    gap: var(--sp-sm);
    font-size: var(--text-sm);
    align-items: baseline;
  }

  .summary-label {
    color: var(--color-text-muted);
    min-width: 9rem;
    text-align: right;
    flex-shrink: 0;
  }

  .summary-value {
    color: var(--color-text);
  }

  .summary-muted {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    font-style: italic;
  }

  .summary-warn {
    font-size: var(--text-sm);
    color: var(--color-amount-negative);
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
