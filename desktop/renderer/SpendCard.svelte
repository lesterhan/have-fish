<script lang="ts">
  // A spend's details, open under its row, as the sentence they read as: Paid [amount] at [what
  // for] from [account] on [day] into [where]. Each part is a chip; click it or Tab to it and
  // press Enter, and it becomes its editor in place. Enter saves it at once (undo takes it back),
  // and Esc puts it back. A spend that moves more than one amount is read only: its chips are
  // locked, and a second line says where each part came from.
  import { tick } from 'svelte'
  import { copy } from '../copy'
  import type { ListedPath, ListedTransaction } from '../shared/commands'
  import {
    closed,
    committing,
    flashed,
    opened,
    putBack as puttingBack,
    refused as refusing,
    saved as savedChip,
    sending,
  } from './chips'
  import { moment, understood } from './format'
  import { chipKey } from './parts/chip'
  import Button from './parts/Button.svelte'
  import Card from './parts/Card.svelte'
  import Chip from './parts/Chip.svelte'
  import Day from './parts/Day.svelte'
  import Money from './parts/Money.svelte'
  import Path from './parts/Path.svelte'
  import { type Option, toOf } from './picker'
  import PathPicker from './parts/PathPicker.svelte'
  import Postings from './parts/Postings.svelte'
  import { provenanceOf } from './postings'
  import { spendWordsFor } from './refusals'
  import { type Changable, destinationOf, paymentsOf, savedValues } from './sentence'

  type Props = {
    transaction: ListedTransaction
    /** What its To can name as an account: one of mine, by id. */
    toOptions: (Option & { hint: string })[]
    /** Every path, with its last use; the ledger reads it once per change. */
    loadPaths: () => Promise<ListedPath[]>
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
    loadPaths,
    onSaved,
    onclose,
    onremove,
    label = copy.spends.card.label,
    idPrefix = 'pane',
  }: Props = $props()

  const words = copy.spends.card
  const values = $derived(savedValues(transaction))
  /** The chip being changed, what its editor holds, and the one just saved: `chips.ts`'s rules. */
  let chip = $state(closed)
  /** Whether the postings show as text. */
  let postingsOpen = $state(false)

  /** A spend paid from more than one account, read only: each account it came from, and to. */
  const payments = $derived(paymentsOf(transaction.legs))
  const destination = $derived(destinationOf(transaction.legs))
  const meant = $derived(chip.part === 'date' ? understood(chip.value) : null)
  /** Where it came from, when, and on which computer; its file set in the code face. */
  const originParts = $derived(provenanceOf(transaction.origin, moment))


  const fieldId = (part: string) => `${idPrefix}-${part}`
  const chipId = (part: string) => `${idPrefix}-chip-${part}`
  const refused = (part: Changable) => (chip.part === part ? chip.error : null)

  export function focus() {
    document.getElementById(chipId('description'))?.focus()
  }

  function focusChip(part: Changable) {
    void tick().then(() => document.getElementById(chipId(part))?.focus())
  }

  /** Clicking a chip, or Enter on it: its editor in place, holding what's saved. */
  function open(part: Changable) {
    chip = opened(chip, transaction, part)
    if (chip.part === part) void tick().then(() => document.getElementById(fieldId(part))?.focus())
  }

  /** Enter: saves the chip at once. A refusal keeps it open, underlined, with why. */
  async function commit() {
    const next = committing(chip, transaction, (typed) => toOf(toOptions, typed))
    if (next === null) return
    if ('unchanged' in next) {
      chip = puttingBack(chip)
      focusChip(next.unchanged)
      return
    }
    const part = chip.part
    chip = sending(chip)
    const saved = await window.haveFish.invoke('spend.edit', next.send)
    if (!saved.ok) {
      // The chip that was being changed stays open; focus stays in its editor to fix it.
      chip = refusing(chip, spendWordsFor(saved))
      return
    }
    chip = savedChip(chip)
    await onSaved()
    if (part !== null) focusChip(part)
  }

  /** Esc on an open chip: what was typed goes back and the chip closes. */
  function putBack() {
    const part = chip.part
    chip = puttingBack(chip)
    if (part !== null) focusChip(part)
  }

  /** P shows the postings, unless a field is taking what's typed. */
  function postingsKey(event: KeyboardEvent): boolean {
    if (chip.part !== null || event.ctrlKey || event.metaKey || event.altKey) return false
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
      if (chip.part !== null) {
        event.preventDefault()
        void commit()
      }
    } else if (key === 'cancel') {
      event.preventDefault()
      if (chip.part !== null) putBack()
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
        changing={chip.part === 'amount'}
        saved={chip.justSaved === 'amount'}
        error={refused('amount')}
        onopen={() => open('amount')}
        onflashed={() => (chip = flashed(chip, 'amount'))}
      >
        {#snippet editor()}
          <span class="money">
            <input
              id={fieldId('amount')}
              name="amount"
              bind:value={chip.value}
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
        changing={chip.part === 'description'}
        saved={chip.justSaved === 'description'}
        error={refused('description')}
        onopen={() => open('description')}
        onflashed={() => (chip = flashed(chip, 'description'))}
      >
        {#snippet editor()}
          <input
            id={fieldId('description')}
            name="description"
            bind:value={chip.value}
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
        changing={chip.part === 'date'}
        saved={chip.justSaved === 'date'}
        error={refused('date')}
        onopen={() => open('date')}
        onflashed={() => (chip = flashed(chip, 'date'))}
      >
        {#snippet editor()}
          <span class="day">
            <input
              id={fieldId('date')}
              name="date"
              bind:value={chip.value}
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
          changing={chip.part === 'to'}
          saved={chip.justSaved === 'to'}
          error={refused('to')}
          onopen={() => open('to')}
          onflashed={() => (chip = flashed(chip, 'to'))}
        >
          {#snippet editor()}
            <PathPicker
              id={fieldId('to')}
              name="to"
              mode="to"
              {loadPaths}
              bind:text={chip.value}
              placeholder={copy.spends.write.unsorted}
              listLabel={copy.spends.write.toList}
              invalid={refused('to') !== null}
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
