<script lang="ts">
  import { confetti } from '$lib/confetti.svelte'
</script>

{#if confetti.particles.length > 0}
  <div class="overlay" aria-hidden="true">
    {#each confetti.particles as p (p.id)}
      <span
        class="particle"
        style="
          left: {p.x}vw;
          font-size: {p.size}rem;
          animation-delay: {p.delay}s;
          animation-duration: {p.duration}s;
          --rise: -{p.rise}vh;
          --sway: {p.sway}vw;
          --rot0: {p.rot0}deg;
          --rot1: {p.rot1}deg;
        ">{p.symbol}</span
      >
    {/each}
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 9999;
    overflow: hidden;
  }

  .particle {
    position: absolute;
    top: calc(100vh + 2rem);
    line-height: 1;
    will-change: transform, opacity;
    animation: cash-explode cubic-bezier(0.2, 0.8, 0.4, 1) forwards;
  }

  @keyframes cash-explode {
    0% {
      transform: translateY(0) translateX(0) rotate(var(--rot0));
      opacity: 1;
    }
    60% {
      opacity: 1;
    }
    100% {
      transform: translateY(var(--rise)) translateX(var(--sway))
        rotate(var(--rot1));
      opacity: 0;
    }
  }
</style>
