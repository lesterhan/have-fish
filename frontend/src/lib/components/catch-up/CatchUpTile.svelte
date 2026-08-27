<script lang="ts">
  import Icon from '$lib/components/ui/Icon.svelte'
  import { tileState } from './tile'
  import { fetchCatchUp, snoozeCatchUp, type CatchUpPayload } from '$lib/api'
  import { onMount } from 'svelte'

  let payload = $state<CatchUpPayload | null>(null)
  let snoozing = $state(false)

  // Named `tile` rather than `state`: a variable called `state` shadows the $state rune.
  let tile = $derived(tileState(payload, payload?.today ?? ''))

  async function load() {
    try {
      payload = await fetchCatchUp()
    } catch {
      // The tile is context on someone else's page. Failing to load it should leave the
      // dashboard alone, not put an error where a quiet line was going to be.
      payload = null
    }
  }

  async function snooze() {
    if (snoozing) return
    snoozing = true
    try {
      const { snoozedUntil } = await snoozeCatchUp(7)
      if (payload) payload = { ...payload, snoozedUntil }
    } catch {
      // Same reasoning — a failed snooze leaves the line where it was.
    } finally {
      snoozing = false
    }
  }

  onMount(load)
</script>

{#if tile.kind !== 'hidden'}
  <div class="tile" class:current={tile.kind === 'current'}>
    {#if tile.kind === 'current'}
      <span class="check"><Icon name="check" size={11} /></span>
      <span class="label">{tile.label}</span>
    {:else}
      <a class="label link" href="/catch-up">{tile.label}</a>
      <span class="spacer"></span>
      <button class="snooze" onclick={snooze} disabled={snoozing}>
        {snoozing ? 'Snoozing…' : 'Not now'}
      </button>
    {/if}
  </div>
{/if}

<style>
  /* One line, no panel. A Card here would give being-behind the same weight as the month's
     spending, which is the opposite of the intent — and deliberately none of the vocabulary
     Action Required owns: no red, no badge, no dot. */
  .tile {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    margin-bottom: var(--sp-md);
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-window-raised);
    border: 1px solid var(--color-rule-soft);
    border-radius: var(--radius-lg);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .spacer {
    flex: 1;
  }

  .link {
    color: var(--color-text);
    text-decoration: none;
    border-bottom: 1px solid var(--color-rule);
    transition: border-color var(--duration-fast) var(--ease);
  }

  .link:hover {
    border-bottom-color: var(--color-accent);
  }

  .link:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: 2px;
  }

  /* The whole reward this epic ships: a small Aqua-gloss check. No confetti, no streak. */
  .check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-amount-positive) 55%, white),
      var(--color-amount-positive)
    );
    box-shadow: var(--shadow-control);
    color: var(--color-window-inset);
  }

  .tile.current {
    color: var(--color-text-muted);
  }

  /* Deliberately the quietest thing on the line: dismissing should feel available, not
     encouraged. */
  .snooze {
    padding: 1px 6px;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease);
  }

  .snooze:hover:not(:disabled) {
    color: var(--color-text);
  }

  .snooze:focus-visible {
    outline: 2px solid var(--color-accent-mid);
  }

  .snooze:disabled {
    cursor: default;
    opacity: 0.6;
  }
</style>
