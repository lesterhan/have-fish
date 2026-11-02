<script lang="ts">
  import { ADDABLE_KINDS, type AddableKind } from '@have-fish/core/account-kind'
  import { CURRENCIES } from '@have-fish/core/currencies'
  import { tick } from 'svelte'
  import { copy } from '../copy'
  import type { ListedAccount } from '../shared/commands'
  import { type AccountField, ANY, type Adding, startingCurrency } from './accounts'

  type Props = {
    account: ListedAccount | undefined
    adding: boolean
    saving: boolean
    error: { field: AccountField; words: string } | null
    /** In a narrow window, whether the pane is over the list. */
    open: boolean
    onadd: (adding: Adding) => void
    oncancel: () => void
    onback: () => void
  }
  let { account, adding, saving, error, open, onadd, oncancel, onback }: Props = $props()

  const FIRST_KIND: AddableKind = 'bank'

  let name = $state('')
  let kind = $state<AddableKind>(FIRST_KIND)
  let currency = $state(startingCurrency(FIRST_KIND))
  /** Once I pick a currency, changing the kind leaves it alone. */
  let picked = false
  let nameInput: HTMLInputElement | undefined = $state()

  /** An empty form, with the cursor in Name. */
  export async function start() {
    name = ''
    kind = FIRST_KIND
    currency = startingCurrency(FIRST_KIND)
    picked = false
    await tick()
    nameInput?.focus()
  }

  export function focusName() {
    nameInput?.focus()
  }

  function kindChanged() {
    if (!picked) currency = startingCurrency(kind)
  }

  function onsubmit(event: SubmitEvent) {
    event.preventDefault()
    if (!saving) onadd({ name, kind, currency })
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    oncancel()
  }
</script>

<section class="pane" class:open aria-label={copy.accounts.pane.label}>
  <button type="button" class="back" onclick={onback}>{copy.accounts.pane.back}</button>

  {#if adding}
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

      <span class="buttons">
        <!-- aria-disabled, not disabled: a disabled button would drop the focus it holds. -->
        <button type="submit" aria-disabled={saving}>{copy.accounts.pane.save}</button>
        <button type="button" onclick={oncancel}>{copy.accounts.pane.cancel}</button>
      </span>
      {#if error?.field === 'form'}
        <p class="error" role="alert">{error.words}</p>
      {/if}
    </form>
  {:else if account === undefined}
    <p class="quiet">{copy.accounts.pane.nothing}</p>
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
    </dl>
    <p class="hint">{copy.accounts.pane.hints[account.kind]}</p>
    {#if error?.field === 'form'}
      <p class="error" role="alert">{error.words}</p>
    {/if}
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

  .name {
    font-family: var(--font-serif);
  }

  .quiet,
  .hint {
    color: var(--color-muted);
  }

  .hint {
    font-size: var(--font-size-small);
  }

  dl {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-1) var(--space-3);
    margin: 0;
  }

  dt {
    font-size: var(--font-size-small);
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
    font-size: var(--font-size-small);
    color: var(--color-muted);
  }

  input,
  select,
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

  .buttons {
    display: flex;
    gap: var(--space-2);
  }

  button {
    justify-self: start;
    cursor: pointer;
  }

  button[aria-disabled='true'] {
    color: var(--color-muted);
    cursor: default;
  }

  .error {
    font-size: var(--font-size-small);
    color: var(--color-error);
  }
</style>
