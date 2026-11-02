<script lang="ts">
  import { copy } from '../copy'
  import type { ListedAccount } from '../shared/commands'
  import { movedBy } from './selection'

  type Props = {
    accounts: ListedAccount[]
    selectedId: string | null
    onselect: (id: string) => void
    /** Show the pane, in a narrow window. */
    onopen: () => void
  }
  let { accounts, selectedId, onselect, onopen }: Props = $props()

  let list: HTMLOListElement

  export function focus() {
    list.focus()
  }

  const optionId = (id: string) => `account-${id}`

  // Keeps the selected row in view as the keys move it.
  $effect(() => {
    if (selectedId !== null) {
      document.getElementById(optionId(selectedId))?.scrollIntoView({ block: 'nearest' })
    }
  })

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      onopen()
      return
    }
    const to = movedBy(accounts, selectedId, event.key)
    if (to === undefined) return
    event.preventDefault()
    if (to !== null) onselect(to)
  }

  function onclick(event: MouseEvent) {
    const id = (event.target as Element).closest<HTMLElement>('[role=option]')?.dataset.id
    if (id === undefined) return
    onselect(id)
    onopen()
  }
</script>

<ol
  bind:this={list}
  role="listbox"
  aria-label={copy.accounts.list.label}
  tabindex="0"
  aria-activedescendant={selectedId === null ? undefined : optionId(selectedId)}
  {onkeydown}
  {onclick}
>
  {#each accounts as a (a.id)}
    <li id={optionId(a.id)} role="option" aria-selected={a.id === selectedId} data-id={a.id}>
      <span class="name">{a.name}</span>
      <span class="kind">{copy.accounts.kinds[a.kind]}</span>
      <span class="currency" class:code={a.currency !== null}>
        {a.currency ?? copy.accounts.anyCurrency}
      </span>
    </li>
  {/each}
</ol>

<style>
  ol {
    grid-area: list;
    overflow-y: auto;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: var(--space-3);
    padding: var(--space-2);
    border-bottom: var(--border-width) solid var(--color-rule);
    cursor: default;
  }

  li[aria-selected='true'] {
    background: var(--color-selected);
  }

  .name {
    font-family: var(--font-serif);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kind {
    color: var(--color-muted);
  }

  .currency {
    text-align: end;
  }

  /* A currency code is data; "Any currency" is words. */
  .code {
    font-family: var(--font-figures);
  }
</style>
