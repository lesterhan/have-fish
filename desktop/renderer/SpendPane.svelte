<script lang="ts">
  import { copy } from '../copy'
  import type { ListedTransaction } from '../shared/commands'
  import { type Draft, savedValues, type Values } from './drafts'
  import { amountsText, understood } from './format'
  import Button from './parts/Button.svelte'
  import Empty from './parts/Empty.svelte'
  import Picker from './Picker.svelte'
  import type { Option } from './picker'
  import Unsaved from './Unsaved.svelte'

  type Props = {
    transaction: ListedTransaction | undefined
    draft: Draft | undefined
    /** What its To offers: categories, then my accounts. */
    toOptions: (Option & { hint: string })[]
    saving: boolean
    /** In a narrow window, whether the pane is over the list. */
    open: boolean
    onedit: (field: keyof Values, value: string) => void
    onrevert: () => void
    onsave: () => void
    onback: () => void
    /** No "are you sure?": Undo takes it back. */
    onremove: () => void
    /** What it's called, where there's more than one pane for a spend. */
    label?: string
    /** Starts its fields' ids, unique in the window. */
    idPrefix?: string
  }
  let {
    transaction,
    draft,
    toOptions,
    saving,
    open,
    onedit,
    onrevert,
    onsave,
    onback,
    onremove,
    label = copy.spends.pane.label,
    idPrefix = 'pane',
  }: Props = $props()

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

<section class="pane" class:open aria-label={label}>
  <span class="back"><Button variant="quiet" onclick={onback}>{copy.spends.pane.back}</Button></span>

  {#if transaction === undefined}
    <Empty>{copy.spends.pane.nothing}</Empty>
  {:else}
    <p class="heading">
      <!-- An editable spend shows its date in the field below. -->
      {#if !values}<span class="date">{transaction.date}</span>{/if}
      {#if draft}<Unsaved />{/if}
    </p>
    {#if transaction.from !== null}
      <p class="from">
        <span>{copy.spends.pane.from}</span>
        {transaction.from}
      </p>
    {/if}

    {#if values}
      <!-- Escape bubbles up from the fields inside; the form itself never takes focus. -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
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
            aria-describedby={error?.field === 'description' ? `${idPrefix}-description-error` : undefined}
          />
        </label>
        {#if error?.field === 'description'}
          <p class="error" id={`${idPrefix}-description-error`} role="alert">{error.words}</p>
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
              aria-describedby={error?.field === 'amount' ? `${idPrefix}-amount-error` : undefined}
            />
            <span class="currency">{transaction.simple?.currency}</span>
          </span>
        </label>
        {#if error?.field === 'amount'}
          <p class="error" id={`${idPrefix}-amount-error`} role="alert">{error.words}</p>
        {/if}

        {#if values.to !== null}
          <span class="field">
            <label for={`${idPrefix}-to`}>{copy.spends.pane.to}</label>
            <Picker
              id={`${idPrefix}-to`}
              name="to"
              options={toOptions}
              text={values.to}
              placeholder={copy.spends.write.unsorted}
              listLabel={copy.spends.write.toList}
              invalid={error?.field === 'to'}
              describedby={error?.field === 'to' ? `${idPrefix}-to-error` : undefined}
              onchoose={(text) => onedit('to', text)}
              newOption={copy.spends.write.newCategory}
            />
          </span>
          {#if error?.field === 'to'}
            <p class="error" id={`${idPrefix}-to-error`} role="alert">{error.words}</p>
          {/if}
        {/if}

        <label>
          <span>{copy.spends.pane.date}</span>
          <input
            name="date"
            value={values.date}
            oninput={(e) => onedit('date', e.currentTarget.value)}
            autocomplete="off"
            maxlength="10"
            aria-invalid={error?.field === 'date'}
            aria-describedby={error?.field === 'date'
              ? `${idPrefix}-date-error ${idPrefix}-date-understood`
              : `${idPrefix}-date-understood`}
          />
        </label>
        <p class="understood" id={`${idPrefix}-date-understood`}>{understood(values.date) ?? ''}</p>
        {#if error?.field === 'date'}
          <p class="error" id={`${idPrefix}-date-error`} role="alert">{error.words}</p>
        {/if}

        <!-- aria-disabled, not disabled: a disabled button would drop the focus it holds. -->
        <Button type="submit" action="saveAll" aria-disabled={draft === undefined || saving}>
          {copy.spends.pane.save}
        </Button>
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

    <Button onclick={onremove}>{copy.spends.pane.remove}</Button>
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
        transform var(--duration-slide) var(--ease-out),
        visibility 0s linear var(--duration-slide);
    }

    .pane.open {
      transform: none;
      visibility: visible;
      transition: transform var(--duration-slide) var(--ease-out);
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
  .currency,
  input[name='date'] {
    font-family: var(--font-figures);
    font-variant-numeric: tabular-nums;
  }

  .quiet {
    color: var(--color-muted);
  }

  .understood {
    min-height: 1lh;
    font-size: var(--text-quiet);
    color: var(--color-muted);
  }

  .from span {
    font-size: var(--text-quiet);
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

  label > span:first-child,
  .field > label {
    font-size: var(--text-quiet);
    color: var(--color-muted);
  }

  .field {
    display: grid;
    gap: var(--space-1);
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

  input {
    font: inherit;
    padding: var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-control);
    color: inherit;
    background: transparent;
  }

  input[aria-invalid='true'] {
    border-color: var(--color-error);
  }

  .error {
    font-size: var(--text-small);
    color: var(--color-error);
  }
</style>
