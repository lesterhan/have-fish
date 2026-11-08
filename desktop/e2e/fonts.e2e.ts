// The fonts ship inside the app and each does its job, in the built app.

import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { aHome, launch, openChip, openSelected, PANE, rows, WRITE, writeDown } from './app'

const LIST = 'ol[aria-label=Ledger]'

const SANS = 'IBM Plex Sans Variable'
const SERIF = 'Source Serif 4 Variable'
const FIGURES = 'Atkinson Hyperlegible Mono Variable'
const CODE = 'Fira Code Variable'

async function twoSpends(page: Page) {
  await writeDown(page, '12', 'Lunch -> Sam')
  await expect.poll(() => rows(page)).toHaveLength(1)
  await writeDown(page, '4.50', 'Coffee')
  await expect.poll(() => rows(page)).toHaveLength(2)
}

/** The first family `selector` asks for, unquoted. */
const familyOf = (page: Page, selector: string) =>
  page.$eval(selector, (el) => getComputedStyle(el).fontFamily.split(',')[0]?.replace(/"/g, ''))

describe('fonts', () => {
  test('all four load from inside the app, and the page fetches nothing from outside it', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)

    const loaded = await page.evaluate(
      async (families) => {
        await document.fonts.ready
        return Promise.all(
          families.map((f) =>
            document.fonts.load(`16px "${f}"`, '0').then(
              (faces) => faces.length,
              () => -1,
            ),
          ),
        )
      },
      [SANS, SERIF, FIGURES, CODE],
    )
    expect(
      loaded.every((n) => n > 0),
      String(loaded),
    ).toBe(true)

    // Load the page again, watching every request it makes.
    const requested: string[] = []
    page.on('request', (r) => requested.push(r.url()))
    await page.reload()
    await expect.poll(() => rows(page)).toHaveLength(2)
    await page.evaluate(() => document.fonts.ready)

    expect(requested.filter((url) => url.endsWith('.woff2')).length).toBeGreaterThan(0)
    expect(requested.filter((url) => !url.startsWith('app://'))).toEqual([])
  })

  test('each role is in its font', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)

    expect(await familyOf(page, `${WRITE} label`)).toBe(SANS)
    expect(await familyOf(page, `${WRITE} input[name=description]`)).toBe(SANS)
    expect(await familyOf(page, `${WRITE} input[name=amount]`)).toBe(FIGURES)
    expect(await familyOf(page, `${WRITE} input[name=date]`)).toBe(FIGURES)
    expect(await familyOf(page, `${LIST} >> text=/^\\w{3} \\d{1,2} \\w{3}$/`)).toBe(FIGURES)
    expect(await familyOf(page, `${LIST} >> text="4.50"`)).toBe(FIGURES)
    // A row reads in the interface's face; the serif is for titles (DESIGN.md, "Type").
    expect(await familyOf(page, `${LIST} >> text="Coffee"`)).toBe(SANS)
    await openSelected(page)
    await openChip(page, 'date')
    expect(await familyOf(page, `${PANE} input[name=date]`)).toBe(FIGURES)
    await openChip(page, 'amount')
    expect(await familyOf(page, `${PANE} input[name=amount]`)).toBe(FIGURES)
    expect(await familyOf(page, `${PANE} >> text="CAD"`)).toBe(FIGURES)
    await openChip(page, 'description')
    expect(await familyOf(page, `${PANE} input[name=description]`)).toBe(SANS)
  })

  test("the list's amounts line up on the decimal point", async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)
    // A row just written slides in: measure where it lands.
    await page.waitForFunction(() => document.getAnimations().length === 0)

    const points = await page.$$eval(`${LIST} >> text=/^\\d+\\.\\d{2}$/`, (amounts) =>
      amounts.map((el) => {
        const text = el.firstChild as Text
        const range = document.createRange()
        const at = text.data.indexOf('.')
        range.setStart(text, at)
        range.setEnd(text, at + 1)
        return range.getBoundingClientRect().left
      }),
    )
    expect(points).toHaveLength(2)
    expect(Math.abs((points[0] as number) - (points[1] as number))).toBeLessThan(0.5)
  })

  test('no ligatures where data is shown: a description with -> keeps both characters', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)

    const ligatures = (selector: string) =>
      page.$eval(selector, (el) => getComputedStyle(el).fontVariantLigatures)
    const lunch = `${LIST} >> text="Lunch -> Sam"`
    expect(await page.textContent(lunch)).toBe('Lunch -> Sam')
    expect(await ligatures(lunch)).toBe('none')
    await openSelected(page)
    await openChip(page, 'description')
    expect(await ligatures(`${PANE} input[name=description]`)).toBe('none')
  })
})
