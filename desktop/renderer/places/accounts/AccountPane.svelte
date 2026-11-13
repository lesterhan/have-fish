<script lang="ts">
  // The account selected, or a form to add one: built from Pane, Field, Fold and Button, so it
  // styles nothing of its own.
  import { pathFor } from '@have-fish/core/account-path'
  import { ADDABLE_KINDS, type AddableKind } from '@have-fish/core/account-kind'
  import { CURRENCIES } from '@have-fish/core/currencies'
  import { tick } from 'svelte'
  import { copy } from '../copy'
  import type { ListedAccount } from '../shared/commands'
  import {
    type AccountField,
    ANY,
    type Adding,
    owes,
    startCurrency,
    startingCurrency,
  } from './accounts'
  import Button from './parts/Button.svelte'
  import Day from './parts/Day.svelte'
  import Empty from './parts/Empty.svelte'
  import Field from './parts/Field.svelte'
  import Fold from './parts/Fold.svelte'
  import Money from './parts/Money.svelte'
  import Pane from './parts/Pane.svelte'
  import Path from './parts/Path.svelte'

  type Props = {
    account: ListedAccount | undefined
    adding: boolean
    saving: boolean
    error: { field: AccountField; words: string } | null
    /** In a narrow window, whether the pane is over the list. */
    open: boolean
    onadd: (adding: Adding) => void
    /** A starting balance for the account showing, as typed. */
    onstart: (amount: string) => void
    oncancel: () => void
    onback: () => void
  }
  let { account, adding, saving, error, open, onadd, onstart, oncancel, onback }: Props = $props()

  const FIRST_KIND: AddableKind = 'bank'
  const words = copy.accounts.pane

  let name = $state('')
  let kind = $state<AddableKind>(FIRST_KIND)
  let currency = $state(startingCurrency(FIRST_KIND))
  /** Once I pick a currency, changing the kind leaves it alone. */
  let picked = false
  let nameInput: HTMLInputElement | undefined = $state()
  /** "How much is in it today?": folded away until I open it, here and on an account. */
  let startOpen = $state(false)
  let startText = $state('')
  let startInput: HTMLInputElement | undefined = $state()
  let fold: Fold | undefined = $state()

  /** Why it was refused, if it was about `field`; a refusal of the whole form shows on `whole`. */
  const refused = (field: AccountField, whole = false) =>
    error?.field === field || (whole && error?.field === 'form') ? error.words : null

  // Another account showing starts with the question folded and empty. By its id: a refresh
  // brings the same account back as a new object, and that mustn't clear what I'm typing.
  const shownId = $derived(account?.id)
  $effect(() => {
    void shownId
    startOpen = false
    startText = ''
  })

  /** An empty form, with the cursor in Name. */
  export async function start() {
    name = ''
    kind = FIRST_KIND
    currency = startingCurrency(FIRST_KIND)
    picked = false
    startOpen = false
    startText = ''
    await tick()
    nameInput?.focus()
  }

  export function focusName() {
    nameInput?.focus()
  }

  /** Opens the question, with the cursor in it: where a refused starting balance is fixed. */
  export async function focusStart() {
    startOpen = true
    await tick()
    startInput?.focus()
  }

  async function toggled(opened: boolean) {
    if (!opened) return
    await tick()
    startInput?.focus()
  }

  function kindChanged() {
    if (!picked) currency = startingCurrency(kind)
  }

  function onsubmit(event: SubmitEvent) {
    event.preventDefault()
    // Folded away, what's in the field isn't said: closing the question is skipping it.
    const asked = fold?.opened() ?? startOpen
    if (!saving) onadd({ name, kind, currency, start: asked ? startText : '' })
  }

  function onstartsubmit(event: SubmitEvent) {
    event.preventDefault()
    if (!saving) onstart(startText)
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    oncancel()
  }
</script>

<Pane label={words.label} {open} back={words.back} {onback}>
  {#snippet title()}
    {#if adding}{words.adding}{:else if account}<Path
        path={pathFor(account.kind, account.name)}
      />{/if}
  {/snippet}

  {#if adding}
    <!-- Escape bubbles up from the fields inside; the form itself never takes focus. -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <form class="fields" aria-label={words.adding} {onsubmit} {onkeydown} novalidate>
      <Field id="account-name" label={words.name} error={refused('name', true)}>
        {#snippet children(describedby)}
          <input
            bind:this={nameInput}
            bind:value={name}
            id="account-name"
            name="name"
            autocomplete="off"
            maxlength="200"
            aria-invalid={error?.field === 'name'}
            aria-describedby={describedby}
          />
        {/snippet}
      </Field>

      <Field id="account-kind" label={words.kind}>
        {#snippet note()}{words.hints[kind]}{/snippet}
        {#snippet children(describedby)}
          <select
            id="account-kind"
            name="kind"
            bind:value={kind}
            onchange={kindChanged}
            aria-describedby={describedby}
          >
            {#each ADDABLE_KINDS as k (k)}
              <option value={k}>{copy.accounts.kinds[k]}</option>
            {/each}
          </select>
        {/snippet}
      </Field>

      <Field id="account-currency" label={words.currency}>
        {#snippet note()}{currency === ANY ? words.holdsAny : words.holdsOnly(currency)}{/snippet}
        {#snippet children(describedby)}
          <select
            id="account-currency"
            name="currency"
            bind:value={currency}
            onchange={() => (picked = true)}
            aria-describedby={describedby}
          >
            <option value={ANY}>{copy.accounts.anyCurrency}</option>
            {#each CURRENCIES as c (c)}
              <option value={c}>{c}</option>
            {/each}
          </select>
        {/snippet}
      </Field>

      {@render question(owes(kind), startCurrency(currency))}

      <span class="buttons">
        <!-- aria-disabled, not disabled: a disabled button would drop the focus it holds. -->
        <Button type="submit" aria-disabled={saving}>{words.save}</Button>
        <Button onclick={oncancel}>{words.cancel}</Button>
      </span>
    </form>
  {:else if account === undefined}
    <Empty>{words.nothing}</Empty>
  {:else}
    <div class="fields">
      <Field id="account-kind" label={words.kind}>
        {#snippet note()}{words.hints[account.kind]}{/snippet}
        {#snippet children()}<output id="account-kind">{copy.accounts.kinds[account.kind]}</output
          >{/snippet}
      </Field>
      <Field id="account-currency" label={words.currency} figures={account.currency !== null}>
        {#snippet children()}<output id="account-currency"
            >{account.currency ?? copy.accounts.anyCurrency}</output
          >{/snippet}
      </Field>
      {#if account.start}
        {@const start = account.start}
        <Field
          id="account-started"
          label={owes(account.kind) ? words.started.owe : words.started.have}
          figures
        >
          {#snippet children()}<output id="account-started"
              ><Money of={start} code /> <Day date={start.date} /></output
            >{/snippet}
        </Field>
      {:else}
        <form class="fields" onsubmit={onstartsubmit} novalidate>
          {@render question(owes(account.kind), startCurrency(account.currency))}
          {#if startOpen}
            <!-- aria-disabled, not disabled: a disabled button would drop the focus it holds. -->
            <span class="buttons">
              <Button type="submit" aria-disabled={saving}>{words.saveStart}</Button>
            </span>
          {/if}
        </form>
      {/if}
    </div>
  {/if}
</Pane>

<!-- The question, folded: what's in it today, or what I owe on a card or a loan. -->
{#snippet question(owed: boolean, currency: string)}
  <Fold
    bind:this={fold}
    bind:open={startOpen}
    summary={owed ? words.start.owe : words.start.have}
    ontoggle={toggled}
  >
    <Field id="account-start" label={words.amount} error={refused('start', !adding)} figures>
      {#snippet children(describedby)}
        <span class="money">
          <input
            bind:this={startInput}
            bind:value={startText}
            id="account-start"
            name="start"
            inputmode="decimal"
            autocomplete="off"
            maxlength="64"
            aria-invalid={error?.field === 'start'}
            aria-describedby={describedby}
          />
          <span>{currency}</span>
        </span>
      {/snippet}
    </Field>
  </Fold>
{/snippet}

<style>
  .fields {
    display: grid;
    gap: var(--space-3);
  }

  .money {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .money > :global(input) {
    flex: 1;
  }

  .buttons {
    display: flex;
    gap: var(--space-2);
  }
</style>
