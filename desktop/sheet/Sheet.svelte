<script lang="ts">
  import { COLOURS, DURATIONS, RADII, SHADOWS, SPACE, TYPE } from './tokens'

  // Each part's states go here as it's built, under Parts.
  const value = (token: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(token).trim()
</script>

<main>
  <h1>Parts</h1>

  <section aria-label="Parts">
    <h2>Parts</h2>
    <p class="quiet">None yet: each arrives with the first screen that needs it.</p>
  </section>

  <section aria-label="Type">
    <h2>Type</h2>
    {#each TYPE as t (t)}
      <div class="row">
        <code>{t}</code>
        <span style:font-size="var({t})">Groceries 1,234.50</span>
      </div>
    {/each}
  </section>

  <section aria-label="Colours">
    <h2>Colours</h2>
    <div class="swatches">
      {#each COLOURS as c (c)}
        <figure>
          <div class="swatch" style:background="var({c})"></div>
          <figcaption><code>{c}</code></figcaption>
        </figure>
      {/each}
    </div>
  </section>

  <section aria-label="Space and radius">
    <h2>Space and radius</h2>
    {#each SPACE as s (s)}
      <div class="row">
        <code>{s}</code>
        <span class="bar" style:inline-size="var({s})"></span>
      </div>
    {/each}
    <div class="boxes">
      {#each RADII as r (r)}
        <figure>
          <div class="box" style:border-radius="var({r})"></div>
          <figcaption><code>{r}</code></figcaption>
        </figure>
      {/each}
    </div>
  </section>

  <section aria-label="Shadows">
    <h2>Shadows</h2>
    <div class="boxes">
      {#each SHADOWS as s (s)}
        <figure>
          <div class="box lifted" style:box-shadow="var({s})"></div>
          <figcaption><code>{s}</code></figcaption>
        </figure>
      {/each}
    </div>
  </section>

  <section aria-label="Motion">
    <h2>Motion</h2>
    {#each DURATIONS as d (d)}
      <div class="row"><code>{d}</code><span>{value(d)}</span></div>
    {/each}
  </section>
</main>

<style>
  main {
    display: grid;
    gap: var(--space-8);
    padding: var(--space-6);
  }

  h1 {
    margin: 0;
    font-family: var(--font-serif);
    font-size: var(--text-title);
    font-weight: var(--weight-strong);
  }

  h2 {
    margin: 0 0 var(--space-3);
    font-size: var(--text-quiet);
    font-weight: var(--weight-label);
    color: var(--color-muted);
  }

  .quiet {
    margin: 0;
    color: var(--color-muted);
  }

  .row {
    display: grid;
    grid-template-columns: 12rem 1fr;
    align-items: center;
    gap: var(--space-4);
    min-block-size: var(--row);
  }

  code {
    font-family: var(--font-code);
    font-size: var(--text-small);
    color: var(--color-muted);
  }

  .swatches,
  .boxes {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
  }

  figure {
    display: grid;
    gap: var(--space-1);
    margin: 0;
  }

  .swatch {
    inline-size: 7rem;
    block-size: var(--space-8);
    border: var(--border-width) solid var(--color-rule);
    border-radius: var(--radius-chip);
  }

  .bar {
    block-size: var(--space-2);
    background: var(--color-bar);
  }

  .box {
    inline-size: 7rem;
    block-size: 4rem;
    border: var(--border-width) solid var(--color-border);
    background: var(--color-background);
  }

  .lifted {
    margin: var(--space-2);
    border-radius: var(--radius-card);
  }
</style>
