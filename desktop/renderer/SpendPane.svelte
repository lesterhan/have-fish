<script lang="ts">
  import { copy } from '../copy'
  import type { ListedTransaction } from '../shared/commands'
  import { type Draft, savedValues, type Values } from './drafts'
  import { amountsText } from './format'
  import { ariaShortcut, MAC, shortcutText } from './shortcuts'
  import Unsaved from './Unsaved.svelte'

  type Props = {
    transaction: ListedTransaction | undefined
    draft: Draft | undefined
    saving: boolean
    /** In a narrow window, whether the pane is over the list. */
    open: boolean
    onedit: (field: keyof Values, value: string) => void
    onrevert: () => void
    onsave: () => void
    onback: () => void
    /** No "are you sure?": Undo takes it back. */
    onremove: () => void
  }
  let { transaction, draft, saving, open, onedit, onrevert, onsave, onback, onremove }: Props =
    $props()

  let first: HTMLInputElement | undefined = $state()

  export function focus() {
    first?.focus()
  }

  const saved = $derived(transaction && savedValues(transaction))
  // What the fields show: the draft while there is one, else what's saved.
  const values = $derived(draft ?? saved)
  const error = $derived(draft?.error ?? null)

  function onsubmit(event: SubmitEvent) {
    event.preventDefault()
    if (draft !== undefined && !saving) onsave()
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    onrevert()
  }
</script>

<section class="pane" class:open aria-label={copy.spends.pane.label}>
  <button type="button" class="back" onclick={onback}>{copy.spends.pane.back}</button>

  {#if transaction === undefined}
    <p class="quiet">{copy.spends.pane.nothing}</p>
  {:else}
    <p class="heading">
      <span class="date">{transaction.date}</span>
      {#if draft}<Unsaved />{/if}
    </p>
    {#if transaction.from !== null}
      <p class="from">
        <span>{copy.spends.pane.from}</span>
        {transaction.from}
      </p>
    {/if}

    {#if values}
      <form {onsubmit} {onkeydown} novalidate>
        <label>
          <span>{copy.spends.pane.description}</span>
          <input
            bind:this={first}
            name="description"
            value={values.description}
            oninput={(e) => onedit('description', e.currentTarget.value)}
            autocomplete="off"
            maxlength="500"
            aria-invalid={error?.field === 'description'}
            aria-describedby={error?.field === 'description' ? 'pane-description-error' : undefined}
          />
        </label>
        {#if error?.field === 'description'}
          <p class="error" id="pane-description-error" role="alert">{error.words}</p>
        {/if}

        <label>
          <span>{copy.spends.pane.amount}</span>
          <span class="money">
            <input
              name="amount"
              value={values.amount}
              oninput={(e) => onedit('amount', e.currentTarget.value)}
              inputmode="decimal"
              autocomplete="off"
              maxlength="64"
              aria-invalid={error?.field === 'amount'}
              aria-describedby={error?.field === 'amount' ? 'pane-amount-error' : undefined}
            />
            <span class="currency">{transaction.simple?.currency}</span>
          </span>
        </label>
        {#if error?.field === 'amount'}
          <p class="error" id="pane-amount-error" role="alert">{error.words}</p>
        {/if}

        <!-- aria-disabled, not disabled: a disabled button would drop the focus it holds. -->
        <button
          type="submit"
          aria-disabled={draft === undefined || saving}
          aria-keyshortcuts={ariaShortcut('saveAll', MAC)}
        >
          {copy.spends.pane.save}
          <kbd aria-hidden="true">{shortcutText('saveAll', MAC)}</kbd>
        </button>
        <!-- The pane has no From field yet, so a refusal about the account shows here too. -->
        {#if error?.field === 'form' || error?.field === 'from'}
          <p class="error" role="alert">{error.words}</p>
        {/if}
      </form>
    {:else}
      <p class="description">{transaction.description || copy.spends.noDescription}</p>
      <p class="amount">{amountsText(transaction.amounts)}</p>
      <p class="quiet">{copy.spends.pane.notSimple}</p>
    {/if}

    <button type="button" class="remove" onclick={onremove}>{copy.spends.pane.remove}</button>
  {/if}
</section>

<style>
  .pane {
    grid-area: pane;
    display: grid;
    align-content: start;
    gap: var(--space-2);
    padding-inline-start: var(--space-6);
    border-inline-start: var(--border-width) solid var(--color-rule);
    overflow-y: auto;
  }

  /* NARROW in narrow.ts: below it, the pane slides over the list. */
  @media (max-width: 44rem) {
    .pane {
      grid-area: auto;
      position: fixed;
      inset: 0;
      padding: var(--space-4);
      border: none;
      background: var(--color-background);
      transform: translateX(100%);
      visibility: hidden;
      transition:
        transform var(--duration-slide) ease-out,
        visibility 0s linear var(--duration-slide);
    }

    .pane.open {
      transform: none;
      visibility: visible;
      transition: transform var(--duration-slide) ease-out;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pane,
    .pane.open {
      transition: none;
    }
  }

  .back {
    display: none;
  }

  @media (max-width: 44rem) {
    .back {
      display: block;
      justify-self: start;
    }
  }

  p {
    margin: 0;
  }

  .heading {
    display: flex;
    gap: var(--space-2);
  }

  .date {
    font-family: var(--font-figures);
    color: var(--color-muted);
    font-variant-numeric: tabular-nums;
  }

  .description {
    font-family: var(--font-serif);
  }

  .amount,
  .money input,
  .currency {
    font-family: var(--font-figures);
    font-variant-numeric: tabular-nums;
  }

  .quiet {
    color: var(--color-muted);
  }

  .from span {
    font-size: var(--font-size-small);
    color: var(--color-muted);
  }

  form {
    display: grid;
    gap: var(--space-2);
  }

  label {
    display: grid;
    gap: var(--space-1);
  }

  label > span:first-child {
    font-size: var(--font-size-small);
    color: var(--color-muted);
  }

  .money {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .money input {
    flex: 1;
    min-width: 0;
    text-align: end;
  }

  input,
  button {
    font: inherit;
    padding: var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius);
    color: inherit;
    background: transparent;
  }

  input[aria-invalid='true'] {
    border-color: var(--color-error);
  }

  button {
    justify-self: start;
    cursor: pointer;
  }

  button[aria-disabled='true'] {
    color: var(--color-muted);
    cursor: default;
  }

  kbd {
    font: inherit;
    font-size: var(--font-size-small);
    color: var(--color-muted);
    margin-inline-start: var(--space-2);
  }

  .error {
    font-size: var(--font-size-small);
    color: var(--color-error);
  }
</style>
