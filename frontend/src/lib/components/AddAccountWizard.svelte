<script lang="ts">
  import Modal from "./Modal.svelte";
  import Button from "./Button.svelte";

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

  function next() {
    step++;
  }
  function back() {
    step--;
  }
  function skip() {
    step = 3;
  }

  function close() {
    open = false;
    // Reset to step 1 after the modal closes so reopening starts fresh
    setTimeout(() => {
      step = 1;
    }, 200);
  }

  // TODO (task 7): step 1 form state — account path, starting balance, date
  // TODO (task 8): step 2 form state — parser name, header, columns, mappings
  // TODO (task 9): confirm submit logic

  // Step 1 is valid when account path is non-empty
  let step1Valid = $derived(false); // TODO (task 7): derive from account path value

  // Step 2 is valid when parser name, date column, and amount column are filled
  let step2Valid = $derived(false); // TODO (task 8): derive from parser form state
</script>

<Modal title={TITLES[type]} bind:open onclose={close}>
  <!-- Step content -->
  <div class="wizard-body">
    {#if step === 1}
      <!-- TODO (task 7): Step 1 — account path + starting balance -->
      <p class="placeholder">Step 1: Account path and starting balance</p>
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
    min-height: 180px;
    /* TODO: remove min-height once real content fills the steps */
  }

  .placeholder {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    font-style: italic;
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
