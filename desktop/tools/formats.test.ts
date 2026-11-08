import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, test } from 'vitest'
import { drawnHereIn, rawFormatsIn } from './formats'

describe('the detector itself', () => {
  it('catches a day or an amount shown as stored', () => {
    expect(rawFormatsIn('<span class="date">{t.date}</span>')).toEqual(['{t.date}'])
    expect(rawFormatsIn('<p>{account.start?.amount}</p>')).toEqual(['{account.start?.amount}'])
  })

  it("leaves a field's label alone", () => {
    expect(rawFormatsIn('<span>{copy.spends.pane.date}</span>')).toEqual([])
  })

  it('leaves a field given to an input alone', () => {
    expect(rawFormatsIn('<input value={values.date} />')).toEqual([])
    expect(rawFormatsIn('<input bind:value={values.amount} />')).toEqual([])
  })

  it('catches an amount written beside its code', () => {
    // The source the detector reads, not a template of ours.
    const built = 'const s = `$' + '{format(c)} $' + '{currency}`'
    expect(rawFormatsIn(built)).toEqual([built.slice(11, -1)])
    expect(rawFormatsIn('<span>{start.amount} {start.currency}</span>')).toContain(
      '{start.amount} {start.currency}',
    )
  })

  it('catches a formatter of its own', () => {
    expect(rawFormatsIn("new Intl.NumberFormat('en-US')")).toEqual(['Intl.NumberFormat'])
    expect(rawFormatsIn('d.toLocaleDateString()')).toEqual(['.toLocaleDateString('])
  })

  it('leaves money and day alone, and comments', () => {
    expect(rawFormatsIn('<span>{money(m.amount, m.currency)}</span>')).toEqual([])
    expect(rawFormatsIn('<span>{day(t.date, today)}</span>')).toEqual([])
    expect(rawFormatsIn('// it was {t.date}\n<!-- {t.amount} -->')).toEqual([])
  })
})

describe('the component detector', () => {
  it('catches a component formatting an amount or a day itself', () => {
    expect(drawnHereIn('<span>{money(m.amount, m.currency)}</span>')).toEqual(['money('])
    expect(drawnHereIn('<span>{day(t.date, today)}</span>')).toEqual(['day('])
    expect(drawnHereIn('{amountsText(t.amounts)}')).toEqual(['amountsText('])
  })

  it('leaves the parts that draw them alone, and other words with day in them', () => {
    expect(drawnHereIn('<Money of={t.amounts} /> <Day date={t.date} />')).toEqual([])
    expect(drawnHereIn('const d = today(); thisWeek(todayIn())')).toEqual([])
  })
})

describe('money and days go through here', () => {
  const RENDERER = join(import.meta.dirname, '../renderer')
  const files = readdirSync(RENDERER, { recursive: true, encoding: 'utf8' }).filter(
    (f) => /\.(svelte|ts)$/.test(f) && !/\.test\.ts$/.test(f) && f !== 'format.ts',
  )

  /** The ledger's own text form, copied to another tool: not an amount formatted for the screen. */
  const MACHINE_TEXT: Record<string, string> = {
    'postings.ts': 'the transaction as text, for copying',
    'parts/Postings.svelte': 'the same text, drawn',
  }

  test('it read the window', () => {
    expect(files).toContain('SpendList.svelte')
    expect(files.length).toBeGreaterThan(30)
  })

  test('every file that writes the ledger’s own text is still there', () => {
    expect(Object.keys(MACHINE_TEXT).filter((f) => !files.includes(f))).toEqual([])
  })

  test('no other file writes an amount or a day itself', () => {
    const raw = files
      .filter((f) => !(f in MACHINE_TEXT))
      .flatMap((f) =>
        rawFormatsIn(readFileSync(join(RENDERER, f), 'utf8')).map((found) => `${f}: ${found}`),
      )
    expect(raw, 'Use money() or day() from renderer/format.ts').toEqual([])
  })

  test('a component draws them only with Money and Day', () => {
    const PARTS = ['parts/Money.svelte', 'parts/Day.svelte']
    const drawn = files
      .filter((f) => f.endsWith('.svelte') && !PARTS.includes(f.replaceAll('\\', '/')))
      .flatMap((f) => drawnHereIn(readFileSync(join(RENDERER, f), 'utf8')).map((c) => `${f}: ${c}`))
    expect(drawn, 'Use <Money of=…> or <Day date=…>').toEqual([])
  })
})
