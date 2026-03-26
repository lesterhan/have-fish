<script lang="ts">
  import { onMount } from "svelte";
  import Modal from "./Modal.svelte";
  import Button from "./Button.svelte";
  import { fetchUserSettings, type UserSettings } from "$lib/api";

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

  // Step 1, 2, or 3
  let step = $state(1);

  function next() { step++ }
  function back() { step-- }
  function skip() { step = 3 }

  function close() {
    open = false;
    setTimeout(() => { step = 1; resetStep1() }, 200);
  }

  // --- User settings (needed for root path prefixes) ---
  let userSettings = $state<UserSettings | null>(null);

  onMount(async () => {
    userSettings = await fetchUserSettings();
  });

  // The prefix to pre-fill when the wizard opens, based on type + user settings.
  let rootPrefix = $derived.by(() => {
    if (!userSettings) return "";
    return type === "asset"
      ? userSettings.defaultAssetsRootPath + ":"
      : userSettings.defaultLiabilitiesRootPath + ":";
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
    accountPath.trim().length > 0 && accountPath.trim() !== rootPrefix.trim()
  );

  // TODO (task 8): step 2 form state — parser name, header, columns, mappings
  // TODO (task 9): confirm submit logic

  // Step 2 is valid when parser name, date column, and amount column are filled
  let step2Valid = $derived(false); // TODO (task 8): derive from parser form state
</script>

<Modal title={TITLES[type]} bind:open onclose={close}>
  <!-- Step content -->
  <div class="wizard-body">
    {#if step === 1}
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

        <label for="starting-balance">Starting balance <span class="optional">(optional)</span></label>
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
          <input
            id="starting-date"
            type="date"
            bind:value={startingDate}
          />
        {/if}
      </div>
    {:else if step === 2}
      <!-- TODO (task 8): Step 2 — parser setup -->
      <p class="placeholder">Step 2: Set up a CSV parser</p>
    {:else if step === 3}
      <!-- TODO (task 9): Step 3 — confirmation summary -->
      <p class="placeholder">Step 3: Confirm and create</p>
    {/if}
  </div>

  <!-- Footer nav -->
  <div class="wizard-footer">
    <div class="footer-left">
      {#if step > 1}
        <Button onclick={back}>◀️ Back</Button>
      {/if}
    </div>

    <div class="footer-right">
      {#if step === 1}
        <Button variant="primary" onclick={next} disabled={!step1Valid}
          >Next ▶️</Button
        >
      {:else if step === 2}
        <Button onclick={skip}>Skip</Button>
        <Button variant="primary" onclick={next} disabled={!step2Valid}
          >Next ▶️</Button
        >
      {:else if step === 3}
        <!-- TODO (task 9): disabled until submit logic is ready -->
        <Button variant="primary" onclick={close}>Confirm</Button>
      {/if}
    </div>
  </div>
</Modal>

<style>
  .wizard-body {
    min-width: 420px;
  }

  .placeholder {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    font-style: italic;
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

  .balance-amount {
    flex: 1;
  }

  .balance-currency {
    width: 4rem;
    flex-shrink: 0;
    text-transform: uppercase;
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
