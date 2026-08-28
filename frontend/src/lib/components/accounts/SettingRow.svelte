<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { SaveState } from './saveState'
  import Icon from '../ui/Icon.svelte'
  import GradientButton from '../ui/GradientButton.svelte'

  interface Props {
    /** The setting's name, in sentence case. */
    label: string
    /** One line under the label for anything the control cannot say itself. */
    hint?: string
    /**
     * The id of a labelable control inside the row — an input or a select. Given one, the
     * label becomes a real `<label for>`. Controls that label themselves (Toggle wraps its
     * own) leave this off and use the `labelId` the snippet is handed instead.
     */
    controlId?: string
    state?: SaveState
    /**
     * A neutral line where the save status goes, shown only while idle. For "this choice is
     * not finished yet" — which is not an error, and must not borrow the error's red, warning
     * icon and Retry button to say so.
     */
    note?: string
    /** Rendered as a Retry affordance beside an error. Omitted, the error is read-only. */
    onretry?: () => void
    /** The control. Receives the label element's id for `aria-labelledby`. */
    children: Snippet<[string]>
  }

  let {
    label,
    hint,
    controlId,
    state = { status: 'idle' },
    note,
    onretry,
    children,
  }: Props = $props()

  // `$props.id()` has to be its own top-level declaration.
  const uid = $props.id()
  const labelId = `${uid}-label`
</script>

<div class="row">
  <div class="label-cell">
    {#if controlId}
      <label class="label" id={labelId} for={controlId}>{label}</label>
    {:else}
      <span class="label" id={labelId}>{label}</span>
    {/if}
    {#if hint}<span class="hint">{hint}</span>{/if}
  </div>

  <div class="control-cell">
    {@render children(labelId)}
  </div>

  <!--
    The status never leaves the layout — the cell holds its width at idle — so a row does
    not resize as it settles, and a column of rows does not ripple when one of them saves.
  -->
  <div class="status-cell" role="status" aria-live="polite">
    {#if state.status === 'idle' && note}
      <span class="status muted" title={note}>
        <span class="message">{note}</span>
      </span>
    {:else if state.status === 'saving'}
      <span class="status muted">Saving…</span>
    {:else if state.status === 'saved'}
      <span class="status muted">
        <Icon name="check" size={11} />Saved
      </span>
    {:else if state.status === 'error'}
      <span class="status error" title={state.message}>
        <Icon name="warning" size={11} />
        <span class="message">{state.message}</span>
      </span>
      {#if onretry}
        <GradientButton size="sm" onclick={onretry}>Retry</GradientButton>
      {/if}
    {/if}
  </div>
</div>

<style>
  .row {
    display: grid;
    /* The control column is content-sized so a long message cannot squeeze it, but the
       status keeps a readable floor rather than collapsing to an ellipsis behind a wide
       select — a truncated error is worse than a slightly narrowed control. */
    grid-template-columns: minmax(9rem, 13rem) auto minmax(8rem, 1fr);
    align-items: center;
    gap: var(--sp-sm);
    min-height: 34px;
    padding: var(--sp-xs) 0;
  }

  .label-cell {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .label {
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--color-text);
  }

  .hint {
    font-size: 11px;
    line-height: 1.3;
    color: var(--color-text-muted);
  }

  .control-cell {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    min-width: 0;
  }

  .status-cell {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    /* The column is sized by the grid, not by its contents, so it holds its width while
       empty and the control never shifts as the status arrives and clears. */
    min-width: 0;
    overflow: hidden;
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    font-size: 11px;
    white-space: nowrap;
  }

  .status.muted {
    color: var(--color-text-muted);
  }

  .status.error {
    color: var(--color-danger);
  }

  /* Long server messages ellipsize rather than wrapping, which would change the row's
     height — the whole message stays available as the title. */
  .message {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (prefers-reduced-motion: no-preference) {
    .status {
      animation: fade-in var(--duration-normal) var(--ease);
    }
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* Narrow: the label takes its own line and the control keeps the status beside it. */
  @media (max-width: 520px) {
    .row {
      grid-template-columns: auto minmax(6rem, 1fr);
      row-gap: 2px;
    }

    .label-cell {
      grid-column: 1 / -1;
    }
  }
</style>
