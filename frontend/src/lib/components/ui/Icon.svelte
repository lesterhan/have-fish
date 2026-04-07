<script lang="ts">
  interface Props {
    name: string
    size?: number
  }

  let { name, size = 14 }: Props = $props()
</script>

<span
  class="icon"
  style="width: {size}px; height: {size}px; mask-image: url('/icons/{name}.svg'); -webkit-mask-image: url('/icons/{name}.svg')"
  aria-hidden="true"
></span>

<style>
  .icon {
    display: inline-block;
    flex-shrink: 0;
    background-color: currentColor;
    mask-size: contain;
    mask-repeat: no-repeat;
    mask-position: center;
    -webkit-mask-size: contain;
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-position: center;
  }
</style>
