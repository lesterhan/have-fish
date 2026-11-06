<script lang="ts">
  import { ADDABLE_KINDS, type AddableKind } from '@have-fish/core/account-kind'
  import { CURRENCIES } from '@have-fish/core/currencies'
  import { tick } from 'svelte'
  import { copy } from '../copy'
  import Day from './parts/Day.svelte'
  import Money from './parts/Money.svelte'
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
  import Empty from './parts/Empty.svelte'

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
  let details: HTMLDetailsElement | undefined = $state()

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

  // The element's own state: `bind:open` may not have caught up when this runs.
  async function toggled(event: Event) {
    if (!(event.currentTarget as HTMLDetailsElement).open) return
    await tick()
    startInput?.focus()
  }

  function kindChanged() {
    if (!picked) currency = startingCurrency(kind)
  }

  function onsubmit(event: SubmitEvent) {
    event.preventDefault()
    // Folded away, what's in the field isn't said: closing the question is skipping it. Asked of
    // the element: `startOpen` follows its toggle event, which can come after this.
    const asked = details?.open ?? startOpen
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

<section class="pane" class:open aria-label={copy.accounts.pane.label}>
  <span class="back"><Button variant="quiet" onclick={onback}>{copy.accounts.pane.back}</Button></span>

  {#if adding}
    <!-- Escape bubbles up from the fields inside; the form itself never takes focus. -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <form aria-label={copy.accounts.pane.adding} {onsubmit} {onkeydown} novalidate>
      <p class="heading">{copy.accounts.pane.adding}</p>

      <label>
        <span>{copy.accounts.pane.name}</span>
        <input
          bind:this={nameInput}
          bind:value={name}
          name="name"
          autocomplete="off"
          maxlength="200"
          aria-invalid={error?.field === 'name'}
          aria-describedby={error?.field === 'name' ? 'account-name-error' : undefined}
        />
      </label>
      {#if error?.field === 'name'}
        <p class="error" id="account-name-error" role="alert">{error.words}</p>
      {/if}

      <label>
        <span>{copy.accounts.pane.kind}</span>
        <select name="kind" bind:value={kind} onchange={kindChanged} aria-describedby="kind-hint">
          {#each ADDABLE_KINDS as k (k)}
            <option value={k}>{copy.accounts.kinds[k]}</option>
          {/each}
        </select>
      </label>
      <p class="hint" id="kind-hint">{copy.accounts.pane.hints[kind]}</p>

      <label>
        <span>{copy.accounts.pane.currency}</span>
        <select
          name="currency"
          bind:value={currency}
          onchange={() => (picked = true)}
          aria-describedby="currency-hint"
        >
          <option value={ANY}>{copy.accounts.anyCurrency}</option>
          {#each CURRENCIES as c (c)}
            <option value={c}>{c}</option>
          {/each}
        </select>
      </label>
      <p class="hint" id="currency-hint">
        {currency === ANY ? copy.accounts.pane.holdsAny : copy.accounts.pane.holdsOnly(currency)}
      </p>

      {@render question(owes(kind), startCurrency(currency))}

      <span class="buttons">
        <!-- aria-disabled, not disabled: a disabled button would drop the focus it holds. -->
        <Button type="submit" aria-disabled={saving}>{copy.accounts.pane.save}</Button>
        <Button onclick={oncancel}>{copy.accounts.pane.cancel}</Button>
      </span>
      {#if error?.field === 'form'}
        <p class="error" role="alert">{error.words}</p>
      {/if}
    </form>
  {:else if account === undefined}
    <Empty>{copy.accounts.pane.nothing}</Empty>
    {#if error?.field === 'form'}
      <p class="error" role="alert">{error.words}</p>
    {/if}
  {:else}
    <p class="heading name">{account.name}</p>
    <dl>
      <dt>{copy.accounts.pane.kind}</dt>
      <dd class="kind">{copy.accounts.kinds[account.kind]}</dd>
      <dt>{copy.accounts.pane.currency}</dt>
      <dd class:code={account.currency !== null}>
        {account.currency ?? copy.accounts.anyCurrency}
      </dd>
      {#if account.start}
        <dt>
          {owes(account.kind) ? copy.accounts.pane.started.owe : copy.accounts.pane.started.have}
        </dt>
        <dd class="start">
          <span class="code"><Money of={account.start} code /></span>
          <span class="date"><Day date={account.start.date} /></span>
        </dd>
      {/if}
    </dl>
    <p class="hint">{copy.accounts.pane.hints[account.kind]}</p>
    {#if !account.start}
      <form class="give" onsubmit={onstartsubmit} novalidate>
        {@render question(owes(account.kind), startCurrency(account.currency))}
        {#if startOpen}
          <!-- aria-disabled, not disabled: a disabled button would drop the focus it holds. -->
          <Button type="submit" aria-disabled={saving}>{copy.accounts.pane.saveStart}</Button>
        {/if}
      </form>
    {/if}
    {#if error?.field === 'form'}
      <p class="error" role="alert">{error.words}</p>
    {/if}
  {/if}
</section>

<!-- The question, folded: what's in it today, or what I owe on a card or a loan. -->
{#snippet question(owed: boolean, currency: string)}
  {@const asked = owed ? copy.accounts.pane.start.owe : copy.accounts.pane.start.have}
  <details bind:this={details} bind:open={startOpen} ontoggle={toggled}>
    <summary>{asked}</summary>
    <span class="money">
      <input
        bind:this={startInput}
        bind:value={startText}
        name="start"
        aria-label={asked}
        inputmode="decimal"
        autocomplete="off"
        maxlength="64"
        aria-invalid={error?.field === 'start'}
        aria-describedby={error?.field === 'start' ? 'account-start-error' : undefined}
      />
      <span class="code">{currency}</span>
    </span>
  </details>
  {#if error?.field === 'start'}
    <p class="error" id="account-start-error" role="alert">{error.words}</p>
  {/if}
{/snippet}

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

  .name {
    font-family: var(--font-serif);
  }

  .hint {
    color: var(--color-muted);
  }

  .hint {
    font-size: var(--text-quiet);
  }

  dl {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-1) var(--space-3);
    margin: 0;
  }

  dt {
    font-size: var(--text-quiet);
    color: var(--color-muted);
  }

  dd {
    margin: 0;
  }

  /* A currency code is data; "Any currency" is words. */
  .code {
    font-family: var(--font-figures);
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
    font-size: var(--text-quiet);
    color: var(--color-muted);
  }

  input,
  select {
    font: inherit;
    padding: var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-control);
    color: inherit;
    background: transparent;
  }

  details {
    display: grid;
    gap: var(--space-2);
  }

  summary {
    cursor: pointer;
  }

  details[open] > summary {
    margin-block-end: var(--space-2);
  }

  .money {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .money input {
    flex: 1;
    min-width: 0;
    font-family: var(--font-figures);
    font-variant-numeric: tabular-nums;
  }

  .give {
    display: grid;
    gap: var(--space-2);
  }

  .start {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .date {
    color: var(--color-muted);
    font-family: var(--font-figures);
  }

  input[aria-invalid='true'] {
    border-color: var(--color-error);
  }

  .buttons {
    display: flex;
    gap: var(--space-2);
  }

  .error {
    font-size: var(--text-small);
    color: var(--color-error);
  }
</style>
