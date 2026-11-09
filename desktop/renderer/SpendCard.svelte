<script lang="ts">
  // A spend's details, open under its row, as the sentence they read as: Paid [amount] at [what
  // for] from [account] on [day] into [where]. Each part is a chip; click it or Tab to it and
  // press Enter, and it becomes its editor in place. Enter saves it at once (undo takes it back),
  // and Esc puts it back. A spend that moves more than one amount is read only: its chips are
  // locked, and a second line says where each part came from.
  import { tick } from 'svelte'
  import { copy } from '../copy'
  import type { ListedTransaction, Wire } from '../shared/commands'
  import { dayOf, moment, understood } from './format'
  import { chipKey } from './parts/chip'
  import Button from './parts/Button.svelte'
  import Card from './parts/Card.svelte'
  import Chip from './parts/Chip.svelte'
  import Day from './parts/Day.svelte'
  import Money from './parts/Money.svelte'
  import Path from './parts/Path.svelte'
  import Picker from './Picker.svelte'
  import { type Option, toOf } from './picker'
  import Postings from './parts/Postings.svelte'
  import { provenanceOf } from './postings'
  import { spendWordsFor } from './refusals'
  import { type Changable, changeOf, savedValues } from './sentence'

  type Props = {
    transaction: ListedTransaction
    /** What its To offers: categories, then my accounts. */
    toOptions: (Option & { hint: string })[]
    /** After a chip saves: the places catch their lists up. */
    onSaved: () => Promise<void>
    /** Esc when no chip is open: the details close. */
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
    toOptions,
    onSaved,
    onclose,
    onremove,
    label = copy.spends.card.label,
    idPrefix = 'pane',
  }: Props = $props()

  const words = copy.spends.card
  const values = $derived(savedValues(transaction))
  /** The chip being changed, if one is; what its editor holds; and why its last save was refused. */
  let changing = $state<Changable | null>(null)
  let value = $state('')
  let error = $state<string | null>(null)
  /** The chip just saved, while its flash and tick show. */
  let justSaved = $state<Changable | null>(null)
  let saving = $state(false)
  /** Whether the postings show as text. */
  let postingsOpen = $state(false)

  /** The parts of a spend paid from more than one account, read only: each account it came from. */
  const payments = $derived(
    transaction.legs.flatMap((leg) =>
      leg.path !== null && leg.amount.startsWith('-')
        ? [{ path: leg.path, money: { amount: leg.amount.slice(1), currency: leg.currency } }]
        : [],
    ),
  )
  /** Where the money arrived, for a spend paid from more than one account. */
  const destination = $derived(
    transaction.legs.find((leg) => !leg.amount.startsWith('-') && leg.path !== null)?.path ?? null,
  )
  const meant = $derived(changing === 'date' ? understood(value) : null)
  /** Where it came from, when, and on which computer; its file set in the code face. */
  const originParts = $derived(provenanceOf(transaction.origin, moment))


  const fieldId = (part: string) => `${idPrefix}-${part}`
  const chipId = (part: string) => `${idPrefix}-chip-${part}`
  const refused = (part: Changable) => (changing === part ? error : null)

  export function focus() {
    document.getElementById(chipId('description'))?.focus()
  }

  function focusChip(part: Changable) {
    void tick().then(() => document.getElementById(chipId(part))?.focus())
  }

  /** Clicking a chip, or Enter on it: its editor in place, holding what's saved. */
  function open(part: Changable) {
    if (values === null) return
    error = null
    value = part === 'to' ? (transaction.to ?? '') : values[part]
    changing = part
    void tick().then(() => document.getElementById(fieldId(part))?.focus())
  }

  /** Whether the editor holds what's saved, so there's nothing to send. */
  function unchanged(part: Changable): boolean {
    if (values === null) return true
    if (part === 'to') return value.trim() === (transaction.to ?? '')
    if (part === 'date') return dayOf(value) === transaction.date
    return value === values[part]
  }

  /** Enter: saves the chip at once. A refusal keeps it open, underlined, with why. */
  async function commit() {
    const part = changing
    if (part === null || values === null || saving) return
    if (unchanged(part)) {
      changing = null
      error = null
      focusChip(part)
      return
    }
    saving = true
    const saved: Wire<unknown> = await window.haveFish.invoke(
      'spend.edit',
      changeOf(transaction, values, part, value, (typed) => toOf(toOptions, typed)),
    )
    saving = false
    if (!saved.ok) {
      error = spendWordsFor(saved)
      // The chip that was being changed stays open; focus stays in its editor to fix it.
      return
    }
    error = null
    changing = null
    justSaved = part
    setTimeout(() => {
      if (justSaved === part) justSaved = null
    }, 1400)
    await onSaved()
    focusChip(part)
  }

  /** Esc on an open chip: what was typed goes back and the chip closes. */
  function putBack() {
    const part = changing
    changing = null
    error = null
    if (part !== null) focusChip(part)
  }

  /** P shows the postings, unless a field is taking what's typed. */
  function postingsKey(event: KeyboardEvent): boolean {
    if (changing !== null || event.ctrlKey || event.metaKey || event.altKey) return false
    const target = event.target as HTMLElement | null
    if (target?.closest('input, textarea, [contenteditable="true"]') !== null) return false
    return event.key.toLowerCase() === 'p'
  }

  /** The card's keys, for a row that has the cursor while its details are open. */
  export function keydown(event: KeyboardEvent): boolean {
    onkeydown(event)
    return event.defaultPrevented
  }

  function onkeydown(event: KeyboardEvent) {
    const key = chipKey(event)
    if (key === 'commit') {
      if (changing !== null) {
        event.preventDefault()
        void commit()
      }
    } else if (key === 'cancel') {
      event.preventDefault()
      if (changing !== null) putBack()
      else if (postingsOpen) postingsOpen = false
      else onclose()
    } else if (postingsKey(event)) {
      event.preventDefault()
      postingsOpen = !postingsOpen
    }
  }
</script>

<Card {label} {onkeydown}>
  {#if values}
    <p class="sentence">
      <span class="lead">{words.sentence.paid}</span>
      <Chip
        id={chipId('amount')}
        label={words.chip.amount}
        figures
        changing={changing === 'amount'}
        saved={justSaved === 'amount'}
        error={refused('amount')}
        onopen={() => open('amount')}
      >
        {#snippet editor()}
          <span class="money">
            <input
              id={fieldId('amount')}
              name="amount"
              bind:value
              inputmode="decimal"
              autocomplete="off"
              maxlength="64"
              aria-invalid={refused('amount') !== null}
            />
            <span>{transaction.simple?.currency}</span>
          </span>
        {/snippet}
        <Money of={{ amount: values.amount, currency: transaction.simple?.currency ?? '' }} code />
      </Chip>

      <span class="lead">{words.sentence.at}</span>
      <Chip
        id={chipId('description')}
        label={words.chip.description}
        changing={changing === 'description'}
        saved={justSaved === 'description'}
        error={refused('description')}
        onopen={() => open('description')}
      >
        {#snippet editor()}
          <input
            id={fieldId('description')}
            name="description"
            bind:value
            autocomplete="off"
            maxlength="500"
            aria-invalid={refused('description') !== null}
          />
        {/snippet}
        {values.description || copy.spends.noDescription}
      </Chip>

      {#if transaction.fromPath}
        <span class="lead">{words.sentence.from}</span>
        <Chip id={chipId('from')} label={words.chip.from} locked>
          <Path path={transaction.fromPath} />
        </Chip>
      {/if}

      <span class="lead">{words.sentence.on}</span>
      <Chip
        id={chipId('date')}
        label={words.chip.date}
        figures
        changing={changing === 'date'}
        saved={justSaved === 'date'}
        error={refused('date')}
        onopen={() => open('date')}
      >
        {#snippet editor()}
          <span class="day">
            <input
              id={fieldId('date')}
              name="date"
              bind:value
              autocomplete="off"
              maxlength="10"
              aria-invalid={refused('date') !== null}
              aria-describedby={`${fieldId('date')}-note`}
            />
            <span id={`${fieldId('date')}-note`}>{#if meant}<Day date={meant} />{/if}</span>
          </span>
        {/snippet}
        <Day date={values.date} />
      </Chip>

      {#if transaction.to !== null}
        <span class="lead">{words.sentence.into}</span>
        <Chip
          id={chipId('to')}
          label={words.chip.to}
          changing={changing === 'to'}
          saved={justSaved === 'to'}
          error={refused('to')}
          onopen={() => open('to')}
        >
          {#snippet editor()}
            <Picker
              id={fieldId('to')}
              name="to"
              options={toOptions}
              bind:text={value}
              placeholder={copy.spends.write.unsorted}
              listLabel={copy.spends.write.toList}
              invalid={refused('to') !== null}
              describedby={undefined}
              onchoose={() => {}}
              onpicked={() => void commit()}
              newOption={copy.spends.write.newCategory}
            />
          {/snippet}
          {#if transaction.toPath}
            <Path path={transaction.toPath} />
          {:else}
            <span>{copy.spends.write.unsorted}</span>
          {/if}
        </Chip>
      {/if}
    </p>
  {:else}
    <p class="sentence">
      <span class="lead">{words.sentence.paid}</span>
      <Chip label={words.chip.amount} figures locked>
        <Money of={transaction.amounts} code />
      </Chip>
      <span class="lead">{words.sentence.at}</span>
      <Chip label={words.chip.description} locked>
        {transaction.description || copy.spends.noDescription}
      </Chip>
      <span class="lead">{words.sentence.on}</span>
      <Chip label={words.chip.date} figures locked>
        <Day date={transaction.date} />
      </Chip>
      {#if destination}
        <span class="lead">{words.sentence.into}</span>
        <Chip label={words.chip.to} locked>
          <Path path={destination} />
        </Chip>
      {/if}
    </p>
    {#if payments.length > 0}
      <p class="sentence sub">
        <span class="lead">{words.sentence.with}</span>
        {#each payments as payment, i (payment.path + payment.money.currency)}
          {#if i > 0}<span class="lead">{words.sentence.and}</span>{/if}
          <Chip label={words.chip.amount} figures locked>
            <Money of={payment.money} code />
          </Chip>
          <span class="lead">{words.sentence.from}</span>
          <Chip label={words.chip.from} locked>
            <Path path={payment.path} />
          </Chip>
        {/each}
      </p>
    {/if}
    <p class="note">{words.notSimple}</p>
  {/if}

  {#if postingsOpen}
    <Postings {transaction} />
  {/if}

  {#snippet where()}
    <span>
      {#each originParts as part, i (i)}
        {#if part.code}<code>{part.text}</code>{:else}{part.text}{/if}
      {/each}
    </span>
  {/snippet}

  {#snippet foot()}
    <Button
      variant="quiet"
      key={words.postingsKey}
      aria-expanded={postingsOpen}
      onclick={() => (postingsOpen = !postingsOpen)}
    >
      {words.postings}
    </Button>
    <Button variant="quiet" key={words.esc} onclick={onclose}>{words.close}</Button>
    <Button variant="quiet" danger action="remove" onclick={onremove}>{words.remove}</Button>
  {/snippet}
</Card>

<style>
  /* The sentence wraps; the plain words between chips are the leads. */
  .sentence {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: var(--space-2);
    row-gap: var(--space-2);
    margin: 0;
  }

  .sub {
    margin-block-start: var(--space-2);
  }

  .money,
  .day {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-1);
  }

  .money > :global(input) {
    inline-size: 8ch;
  }

  .day > :global(input) {
    inline-size: 10ch;
  }

  .note {
    margin: var(--space-2) 0 0;
  }
</style>
