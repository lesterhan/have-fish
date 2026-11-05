<script lang="ts">
  import { copy } from '../copy'
  import Button from '../renderer/parts/Button.svelte'
  import Empty from '../renderer/parts/Empty.svelte'
  import Header from '../renderer/parts/Header.svelte'
  import Keys from '../renderer/parts/Keys.svelte'
  import Notice from '../renderer/parts/Notice.svelte'
  import Sidebar from '../renderer/parts/Sidebar.svelte'
  import type { Place } from '../renderer/places'
  import { COLOURS, DURATIONS, RADII, SHADOWS, SPACE, TYPE } from './tokens'

  // Each part in each of its states. Hover, focus and pressed can't be drawn at rest: the capture
  // script shoots the Button section with each.
  let place = $state<Place>('ledger')
  const VARIANTS = ['primary', 'plain', 'quiet'] as const
  const value = (token: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(token).trim()
</script>

<main>
  <h1>Parts</h1>

  <section aria-label="Keys">
    <h2>Keys</h2>
    <div class="line">
      <Keys action="newSpend" />
      <Keys action="saveAll" />
      <Keys action="addAccount" />
      <Keys action="remove" />
    </div>
  </section>

  <section aria-label="Button">
    <h2>Button: rest, then disabled; with and without keys</h2>
    {#each VARIANTS as variant (variant)}
      <div class="line">
        <Button {variant}>{copy.spends.write.submit}</Button>
        <Button {variant} action="addAccount">{copy.accounts.add}</Button>
        <Button {variant} disabled>{copy.spends.write.submit}</Button>
        <Button {variant} aria-disabled="true" action="saveAll">{copy.spends.pane.save}</Button>
      </div>
    {/each}
  </section>

  <section aria-label="Header">
    <h2>Header: title, a quiet line, one primary</h2>
    <div class="frame">
      <Header title={copy.app.places.accounts} line="4 accounts">
        <Button variant="primary" action="addAccount">{copy.accounts.add}</Button>
      </Header>
    </div>
  </section>

  <section aria-label="Notice">
    <h2>Notice</h2>
    <div class="frame">
      <Notice words={copy.errors.codes.UNEXPECTED} ondismiss={() => {}} />
    </div>
  </section>

  <section aria-label="Empty">
    <h2>Empty</h2>
    <div class="frame"><Empty>{copy.spends.pane.nothing}</Empty></div>
  </section>

  <section aria-label="Sidebar">
    <h2>Sidebar, a place current</h2>
    <div class="sidebar"><Sidebar current={place} ongo={(p) => (place = p)} /></div>
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

  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    margin-block-end: var(--space-2);
  }

  .frame {
    max-inline-size: 40rem;
    padding: var(--space-3);
    border: var(--border-width) dashed var(--color-rule);
  }

  .sidebar {
    display: flex;
    block-size: 9rem;
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
