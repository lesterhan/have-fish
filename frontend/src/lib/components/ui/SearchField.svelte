<script lang="ts">
  import Icon from './Icon.svelte'
  import TextInput from './TextInput.svelte'

  /**
   * A search box with its magnifier — the icon and the input, bound together so the label
   * and the accessible name cannot drift apart.
   */
  interface Props {
    value: string
    /** Also the accessible name, so a search box is never an unlabelled input. */
    placeholder: string
  }

  let { value = $bindable(''), placeholder }: Props = $props()
</script>

<label class="search">
  <Icon name="search" size={12} />
  <TextInput bind:value {placeholder} aria-label={placeholder} />
</label>

<style>
  .search {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    color: var(--color-text-muted);
  }
</style>
