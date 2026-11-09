<script lang="ts">
  import { copy } from '../copy'
  import Button from '../renderer/parts/Button.svelte'
  import Chip from '../renderer/parts/Chip.svelte'
  import Composer from '../renderer/parts/Composer.svelte'
  import Empty from '../renderer/parts/Empty.svelte'
  import Field from '../renderer/parts/Field.svelte'
  import Fold from '../renderer/parts/Fold.svelte'
  import Header from '../renderer/parts/Header.svelte'
  import Keys from '../renderer/parts/Keys.svelte'
  import Notice from '../renderer/parts/Notice.svelte'
  import Band from '../renderer/parts/Band.svelte'
  import Day from '../renderer/parts/Day.svelte'
  import Money from '../renderer/parts/Money.svelte'
  import Path from '../renderer/parts/Path.svelte'
  import PathPicker from '../renderer/parts/PathPicker.svelte'
  import Postings from '../renderer/parts/Postings.svelte'
  import Sidebar from '../renderer/parts/Sidebar.svelte'
  import SpendCard from '../renderer/SpendCard.svelte'
  import SpendList from '../renderer/SpendList.svelte'
  import type { ListedPath, ListedTransaction } from '../shared/commands'
  import type { Place } from '../renderer/places'
  import { COLOURS, DURATIONS, RADII, SHADOWS, SPACE, TYPE } from './tokens'

  // Each part in each of its states. Hover, focus and pressed can't be drawn at rest: the capture
  // script shoots the Button section with each.
  let place = $state<Place>('ledger')
  const TODAY = '2026-11-05'
  const cad = (amount: string) => ({ amount, currency: 'CAD' })
  const row = (
    id: string,
    date: string,
    amount: string,
    fromPath: string,
    toPath: string,
    description: string,
  ): ListedTransaction => ({
    id,
    date,
    description,
    amounts: [cad(amount)],
    simple: cad(amount),
    from: fromPath.split(':').slice(1).join(':'),
    to: toPath.split(':').slice(1).join(':'),
    fromPath,
    toPath,
    legs: [],
    origin: { source: 'manual', at: Date.UTC(2026, 10, 5, 12, 40), here: true, file: null, line: null },
  })
  // Rest, selected, just written; money in and a move between my accounts.
  const ROWS = [
    row('a', TODAY, '16.76', 'liabilities:cibc:visa', 'expenses:health:pharmacy', 'Pharmacy'),
    row('b', TODAY, '15.93', 'liabilities:cibc:visa', 'expenses:food:restaurants', 'Lunch'),
    row('c', '2026-11-04', '200.00', 'assets:tangerine:chequing', 'assets:tangerine:savings', 'Put some away'),
    row('d', '2026-11-04', '26.32', 'liabilities:cibc:visa', 'expenses:home:supplies', 'Hardware store'),
    row('e', '2026-11-03', '40.00', 'income:sales', 'assets:wallet', 'Sold the old chair'),
  ]
  const POSTED: ListedTransaction = {
    ...row('p', TODAY, '35.00', 'liabilities:cibc:visa', 'expenses:food:restaurants', 'Cafe'),
    legs: [
      { amount: '35.00', currency: 'CAD', path: 'expenses:food:restaurants' },
      { amount: '-35.00', currency: 'CAD', path: 'liabilities:cibc:visa' },
    ],
  }
  const DAY = 86_400_000
  /** Paths for the picker's states: used today, yesterday, days ago, and never. */
  const PATHS: ListedPath[] = [
    { id: 'food', path: 'expenses:food', kind: 'category', lastUsed: Date.now() },
    { id: 'coffee', path: 'expenses:food:coffee', kind: 'category', lastUsed: Date.now() - DAY },
    {
      id: 'groceries',
      path: 'expenses:food:groceries',
      kind: 'category',
      lastUsed: Date.now() - 3 * DAY,
    },
    {
      id: 'market',
      path: 'expenses:food:groceries:market',
      kind: 'category',
      lastUsed: Date.now() - 5 * DAY,
    },
    {
      id: 'restaurants',
      path: 'expenses:food:restaurants',
      kind: 'category',
      lastUsed: Date.now() - 4 * DAY,
    },
    { id: 'books', path: 'expenses:fun:books', kind: 'category', lastUsed: Date.now() - 9 * DAY },
    { id: 'visa', path: 'liabilities:cibc:visa', kind: 'card', lastUsed: Date.now() },
    { id: 'chequing', path: 'assets:tangerine:chequing', kind: 'bank', lastUsed: Date.now() },
  ]
  const loadPaths = async () => PATHS
  let picked = $state('food:restaurants')
  const VARIANTS = ['primary', 'plain', 'quiet'] as const
  const value = (token: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(token).trim()
</script>

{#snippet card(t: ListedTransaction)}
  <SpendCard
    transaction={t}
    toOptions={[]}
    {loadPaths}
    onSaved={async () => {}}
    onclose={() => {}}
    onremove={() => {}}
    idPrefix="sheet-card"
  />
{/snippet}

<main>
  <h1>Parts</h1>

  <section aria-label="Keys">
    <h2>Keys</h2>
    <div class="line">
      <Keys action="newSpend" />
      <Keys action="showLedger" />
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
        <Button {variant} aria-disabled="true" action="remove">{copy.spends.card.remove}</Button>
      </div>
    {/each}
    <div class="line">
      <Button variant="quiet" key={copy.spends.card.esc}>{copy.spends.card.close}</Button>
      <Button variant="quiet" danger action="remove">{copy.spends.card.remove}</Button>
    </div>
  </section>

  <section aria-label="PathPicker">
    <h2>PathPicker: the trail, the parts under it, last used, and Create</h2>
    <div class="line">
      <PathPicker
        id="sheet-path"
        name="path"
        mode="to"
        {loadPaths}
        bind:text={picked}
        placeholder={copy.spends.write.unsorted}
        listLabel={copy.spends.write.toList}
        invalid={false}
        describedby={undefined}
        onchoose={() => {}}
        newOption={copy.spends.write.newCategory}
      />
    </div>
  </section>

  <section aria-label="Composer">
    <h2>Composer: first run, examples in the parts, then a line to fill</h2>
    <Composer
      open
      firstRun
      accounts={[]}
      assumedName={undefined}
      {loadPaths}
      onclose={() => {}}
      onsaved={async () => {}}
      forgetTyping={() => {}}
    />
  </section>

  <section aria-label="Postings">
    <h2>Postings: a balance check per currency and Copy, then the transaction as text</h2>
    <Postings transaction={POSTED} />
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
    <div class="frame"><Empty>{copy.reports.breakdown.nothing}</Empty></div>
  </section>

  <section aria-label="Money">
    <h2>Money: out, in, between, another currency, with its code, several</h2>
    <div class="line">
      <Money of={cad('1234.50')} />
      <Money of={cad('40.00')} way="in" />
      <Money of={cad('200.00')} way="between" />
      <Money of={{ amount: '35.00', currency: 'EUR' }} />
      <Money of={cad('-32.69')} code />
      <Money of={[cad('10.00'), { amount: '1100', currency: 'JPY' }]} />
    </div>
  </section>

  <section aria-label="Day">
    <h2>Day: this year, another, a band's today and yesterday, a run</h2>
    <div class="line">
      <Day date="2026-11-02" today={TODAY} />
      <Day date="2025-12-31" today={TODAY} />
      <Day date={TODAY} today={TODAY} band />
      <Day date="2026-11-04" today={TODAY} band />
      <Day date="2026-11-02" until="2026-11-08" today={TODAY} />
    </div>
  </section>

  <section aria-label="Chip">
    <h2>A chip: rest, locked, just saved, changing, refused</h2>
    <div class="line">
      <Chip label="Amount" figures><Money of={cad('15.93')} code /></Chip>
      <Chip label="From" locked><Path path="liabilities:cibc:visa" /></Chip>
      <Chip label="Date" figures saved><Day date={TODAY} today={TODAY} /></Chip>
      <Chip label="Amount" figures changing>
        {#snippet editor()}<input value="15.93" aria-label="Amount" />{/snippet}
        <Money of={cad('15.93')} code />
      </Chip>
      <Chip label="Amount" figures changing error={copy.errors.codes.AMOUNT_INVALID}>
        {#snippet editor()}<input value="15.9x" aria-label="Amount" aria-invalid="true" />{/snippet}
        <Money of={cad('15.93')} code />
      </Chip>
    </div>
  </section>

  <section aria-label="Path">
    <h2>Path: each root's tag</h2>
    <div class="line">
      <Path path="assets:tangerine:chequing" />
      <Path path="liabilities:cibc:visa" />
      <Path path="expenses:food:restaurants" />
      <Path path="income:salary" />
      <Path path="equity:opening" />
    </div>
  </section>

  <section aria-label="Band">
    <h2>Band: a day and its net; a root and what it comes to</h2>
    <div class="frame"><Band date={TODAY} today={TODAY} net={[cad('-32.69')]} /></div>
    <div class="frame"><Band net={[cad('12276.65')]}><Path path="assets" /></Band></div>
  </section>

  <section aria-label="Fold">
    <h2>Fold: a question folded, then opened on its field</h2>
    <div class="frame"><Fold summary="How much is in it today?">{@render amount('fold-closed')}</Fold></div>
    <div class="frame">
      <Fold summary="How much is in it today?" open>{@render amount('fold-open')}</Fold>
    </div>
  </section>

  <section aria-label="Rows">
    <h2>Rows: rest, selected, just written; in and between</h2>
    <div class="frame rows">
      <SpendList
        transactions={ROWS}
        selectedId="b"
        written="e"
        onselect={() => {}}
        opened={null}
        details={card}
        onopen={() => {}}
        onclose={() => {}}
        onremove={() => {}}
        onrefile={async () => {}}
        {loadPaths}
        label="Rows"
        idPrefix="sheet"
      />
    </div>
  </section>

  <section aria-label="Card">
    <h2>Card: a row open, its details lifted with it, its fields; the rest stepped back</h2>
    <div class="frame card">
      <SpendList
        transactions={ROWS}
        selectedId="d"
        onselect={() => {}}
        opened="d"
        details={card}
        onopen={() => {}}
        onclose={() => {}}
        onremove={() => {}}
        onrefile={async () => {}}
        {loadPaths}
        label="Open"
        idPrefix="sheet-open"
      />
    </div>
  </section>

  {#snippet amount(id: string)}
    <Field {id} label="Amount" figures>
      {#snippet children(describedby)}<input {id} value="1,234.56" aria-describedby={describedby} />{/snippet}
    </Field>
  {/snippet}

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

  .rows,
  .card {
    display: grid;
    max-inline-size: 60rem;
    block-size: 16rem;
  }

  .card {
    block-size: 30rem;
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
