import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, test } from 'vitest'
import { rawFormatsIn } from './formats'

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

describe('money and days go through here', () => {
  const RENDERER = join(import.meta.dirname, '../renderer')
  const files = readdirSync(RENDERER, { recursive: true, encoding: 'utf8' }).filter(
    (f) => /\.(svelte|ts)$/.test(f) && !/\.test\.ts$/.test(f) && f !== 'format.ts',
  )

  test('it read the window', () => {
    expect(files).toContain('SpendList.svelte')
    expect(files.length).toBeGreaterThan(30)
  })

  test('no other file writes an amount or a day itself', () => {
    const raw = files.flatMap((f) =>
      rawFormatsIn(readFileSync(join(RENDERER, f), 'utf8')).map((found) => `${f}: ${found}`),
    )
    expect(raw, 'Use money() or day() from renderer/format.ts').toEqual([])
  })
})
