<script lang="ts">
  interface Props {
    width?: string;
    height?: string;
  }

  let { width = "100%", height = "1em" }: Props = $props();
</script>

<span class="shimmer" style="width: {width}; height: {height};"></span>

<style>
  .shimmer {
    display: block;
    border-radius: 0;
    background: linear-gradient(
      90deg,
      var(--color-window) 0%,
      var(--color-window-inset) 40%,
      var(--color-window) 60%,
      var(--color-window) 100%
    );
    background-size: 300% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% center;
    }
    100% {
      background-position: -100% center;
    }
  }
</style>
