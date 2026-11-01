<script lang="ts">
  import { copy } from '../copy'
</script>

<!-- The ● for a draft, with words for screen readers so the dot isn't the only sign. -->
<span class="unsaved"
  ><span aria-hidden="true">●</span><span class="visually-hidden">{copy.spends.unsaved}</span></span
>

<style>
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
