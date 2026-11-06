<script lang="ts">
  // A spend's details, open under its row: the fields that change it, saved with Enter; Esc puts
  // back what was typed and closes. The drafts are the editor's (`editor.ts`), shared by every
  // place that lists spends.
  import { copy } from '../copy'
  import type { ListedTransaction } from '../shared/commands'
  import { type Draft, savedValues, type Values } from './drafts'
  import { understood } from './format'
  import Button from './parts/Button.svelte'
  import Card from './parts/Card.svelte'
  import Day from './parts/Day.svelte'
  import Field from './parts/Field.svelte'
  import Money from './parts/Money.svelte'
  import Path from './parts/Path.svelte'
  import Picker from './Picker.svelte'
  import type { Option } from './picker'
  import Unsaved from './Unsaved.svelte'

  type Props = {
    transaction: ListedTransaction
    draft: Draft | undefined
    /** What its To offers: categories, then my accounts. */
    toOptions: (Option & { hint: string })[]
    saving: boolean
    onedit: (field: keyof Values, value: string) => void
    onsave: () => void
    /** Esc or Close: what was typed goes, and the card with it. */
    onclose: () => void
    /** No "are you sure?": Undo takes it back. */
    onremove: () => void
    /** What it's called, where there's more than one list of spends. */
    label?: string
    /** Starts its fields' ids, unique in the window. */
    idPrefix?: string
  }
  let {
    transaction,
    draft,
    toOptions,
    saving,
    onedit,
    onsave,
    onclose,
    onremove,
    label = copy.spends.card.label,
    idPrefix = 'pane',
  }: Props = $props()

  let first: HTMLInputElement | undefined = $state()

  export function focus() {
    first?.focus()
  }

  const saved = $derived(savedValues(transaction))
  // What the fields show: the draft while there is one, else what's saved.
  const values = $derived(draft ?? saved)
  /** The day the date field means, said under it. */
  const meant = $derived(values && understood(values.date))
  const error = $derived(draft?.error ?? null)
  const refused = (field: string) => (error?.field === field ? error.words : null)
  const fieldId = (name: string) => `${idPrefix}-${name}`
  const words = copy.spends.card

  function save() {
    if (draft !== undefined && !saving) onsave()
  }

  function onkeydown(event: KeyboardEvent) {
    // A picker's open list takes its own Enter and Escape first.
    if (event.defaultPrevented) return
    if (event.key === 'Escape') {
      event.preventDefault()
      onclose()
    } else if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault()
      save()
    }
  }
</script>

<Card {label} {onkeydown}>
  {#if values}
    <div class="fields">
      <!-- The card has no From field yet, so a refusal about the account, or the whole spend, shows here. -->
      <Field id={fieldId('from')} label={words.from} error={refused('from') ?? refused('form')}>
        <output id={fieldId('from')}>{#if transaction.fromPath}<Path path={transaction.fromPath} />{/if}</output>
      </Field>

      <Field id={fieldId('description')} label={words.description} error={refused('description')}>
        {#snippet children(describedby)}
          <input
            bind:this={first}
            id={fieldId('description')}
            name="description"
            value={values.description}
            oninput={(e) => onedit('description', e.currentTarget.value)}
            autocomplete="off"
            maxlength="500"
            aria-invalid={error?.field === 'description'}
            aria-describedby={describedby}
          />
        {/snippet}
      </Field>

      <Field id={fieldId('amount')} label={words.amount} error={refused('amount')} figures>
        {#snippet children(describedby)}
          <span class="money">
            <input
              id={fieldId('amount')}
              name="amount"
              value={values.amount}
              oninput={(e) => onedit('amount', e.currentTarget.value)}
              inputmode="decimal"
              autocomplete="off"
              maxlength="64"
              aria-invalid={error?.field === 'amount'}
              aria-describedby={describedby}
            />
            <span>{transaction.simple?.currency}</span>
          </span>
        {/snippet}
      </Field>

      {#if values.to !== null}
        <Field id={fieldId('to')} label={words.to} error={refused('to')}>
          {#snippet children(describedby)}
            <Picker
              id={fieldId('to')}
              name="to"
              options={toOptions}
              text={values.to ?? ''}
              placeholder={copy.spends.write.unsorted}
              listLabel={copy.spends.write.toList}
              invalid={error?.field === 'to'}
              {describedby}
              onchoose={(text) => onedit('to', text)}
              newOption={copy.spends.write.newCategory}
            />
          {/snippet}
        </Field>
      {/if}

      <Field id={fieldId('date')} label={words.date} error={refused('date')} figures>
        {#snippet note()}{#if meant}<Day date={meant} />{/if}{/snippet}
        {#snippet children(describedby)}
          <input
            id={fieldId('date')}
            name="date"
            value={values.date}
            oninput={(e) => onedit('date', e.currentTarget.value)}
            autocomplete="off"
            maxlength="10"
            aria-invalid={error?.field === 'date'}
            aria-describedby={describedby}
          />
        {/snippet}
      </Field>

    </div>
  {:else}
    <div class="whole">
      <p>{transaction.description || copy.spends.noDescription}</p>
      <p><Money of={transaction.amounts} code /></p>
      <p>{words.notSimple}</p>
    </div>
  {/if}

  {#snippet foot()}
    {#if draft}<Unsaved />{/if}
    {#if values}
      <!-- aria-disabled, not disabled: a disabled button would drop the focus it holds. -->
      <Button variant="quiet" action="saveAll" aria-disabled={draft === undefined || saving} onclick={save}>
        {words.save}
      </Button>
    {/if}
    <Button variant="quiet" key={words.esc} onclick={onclose}>{words.close}</Button>
    <Button variant="quiet" danger action="remove" onclick={onremove}>{words.remove}</Button>
  {/snippet}
</Card>

<style>
  /* Wide, the fields go across; narrow, one under another. */
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 14rem), 1fr));
    gap: var(--space-2) var(--space-4);
    align-items: start;
  }

  .money {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .money > :global(input) {
    flex: 1;
  }

  .whole {
    display: grid;
    gap: var(--space-2);
  }

  .whole p {
    margin: 0;
  }
</style>
