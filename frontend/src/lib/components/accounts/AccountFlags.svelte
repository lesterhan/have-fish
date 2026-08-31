<script lang="ts">
  import type { Snippet } from 'svelte'
  import Chip from '$lib/components/ui/Chip.svelte'
  import {
    ROLE_DESCRIPTION,
    ROLE_LABEL,
    protectionMessage,
    rolesOf,
    type Protection,
  } from './accountRoles'
  import type { UserSettings } from '$lib/api'

  /**
   * The Flags cell: what the rest of the app is pointing at this account for, and whether
   * anything is holding it.
   *
   * Both Accounts tabs render this, and both had their own copy of the same three lines —
   * including the tooltip on each role chip, which is the part that explains why the row's
   * delete is greyed out and so the part most worth not losing in a copy.
   */
  interface Props {
    /** Null for a virtual path segment, which fills no role and holds no pointer. */
    accountId: string | null
    settings: UserSettings | null | undefined
    /** From `protectionFor` — only the system kind shows a chip; roles have their own. */
    protection?: Protection | null
    /** Chips before the roles, for what the row *is* rather than what points at it. */
    lead?: Snippet
    /** Chips after — the host's own state, e.g. pinned, hidden, empty. */
    children?: Snippet
  }

  let {
    accountId,
    settings,
    protection = null,
    lead,
    children,
  }: Props = $props()
</script>

<div class="flags">
  {@render lead?.()}
  {#if accountId}
    {#each rolesOf(accountId, settings) as role (role)}
      <span title={ROLE_DESCRIPTION[role]}>
        <Chip size="xs" tone="accent">{ROLE_LABEL[role]}</Chip>
      </span>
    {/each}
  {/if}
  {#if protection?.kind === 'system'}
    <span title={protectionMessage(protection)}>
      <Chip size="xs" icon="lock">managed</Chip>
    </span>
  {/if}
  {@render children?.()}
</div>

<style>
  /* A wrapper, not the cell itself: `display: flex` on a <td> drops it out of the table
     layout, so the column stops aligning and empty cells render as stray boxes. */
  .flags {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
</style>
