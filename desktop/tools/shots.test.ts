import { describe, expect, test } from 'vitest'
import { SCENES } from '../scenes/scenes'
import {
  type Change,
  changedShots,
  diffPage,
  fileOf,
  galleryPage,
  type Shot,
  SIZES,
  shotsOf,
  THEMES,
} from './shots'

const NAMES = SCENES.map((scene) => scene.name)

/** The sum of every shot's name, size and theme, in the order the shots came in. */
const described = (shots: readonly Shot[]) =>
  shots.map((shot) => `${shot.scene} ${shot.size} ${shot.theme}`)

describe('SIZES', () => {
  test('lists wide, the size the window opens and narrow, in that order', () => {
    expect(SIZES).toEqual([
      { name: 'wide', width: 1280, height: 800 },
      { name: 'opens', width: 960, height: 720 },
      { name: 'narrow', width: 640, height: 800 },
    ])
  })
})

describe('THEMES', () => {
  test('lists light then dark', () => {
    expect(THEMES).toEqual(['light', 'dark'])
  })
})

describe('fileOf', () => {
  test("puts a shot's scene, size and theme in one file name", () => {
    expect(fileOf('ledger/year', 'opens', 'dark')).toBe('ledger~year.opens.dark.png')
  })
})

describe('shotsOf', () => {
  test('makes every size and theme of a scene, wide light first', () => {
    expect(described(shotsOf(['ledger/year']))).toEqual([
      'ledger/year wide light',
      'ledger/year wide dark',
      'ledger/year opens light',
      'ledger/year opens dark',
      'ledger/year narrow light',
      'ledger/year narrow dark',
    ])
  })

  test('of nothing is nothing', () => {
    expect(shotsOf([])).toEqual([])
  })

  test('of the fourteen scenes makes eighty-four shots, each once', () => {
    const files = shotsOf(NAMES).map((shot) => shot.file)
    expect(NAMES).toHaveLength(14)
    expect(files).toHaveLength(84)
    expect(new Set(files).size).toBe(84)
  })
})

describe('changedShots', () => {
  test('of two unchanged shots finds nothing', () => {
    expect(
      changedShots(['a.png', 'b.png'], ['a.png', 'b.png'], { 'a.png': 0, 'b.png': 0 }),
    ).toEqual({ changed: [], added: [], gone: [] })
  })

  test('lists the shot whose pixels differ', () => {
    expect(
      changedShots(['a.png', 'b.png'], ['a.png', 'b.png'], { 'a.png': 0, 'b.png': 12 }).changed,
    ).toEqual(['b.png'])
  })

  test('lists a shot only the branch has as added', () => {
    expect(changedShots(['a.png'], ['a.png', 'c.png'], { 'a.png': 0 }).added).toEqual(['c.png'])
  })

  test('lists a shot only the base has as gone', () => {
    expect(changedShots(['a.png', 'g.png'], ['a.png'], { 'a.png': 0 }).gone).toEqual(['g.png'])
  })

  test('with no counts, every shot both sides have is changed', () => {
    expect(changedShots(['a.png', 'g.png'], ['a.png', 'c.png'])).toEqual({
      changed: ['a.png'],
      added: ['c.png'],
      gone: ['g.png'],
    })
  })

  test('sorts each list, so the page reads the same on every run', () => {
    expect(
      changedShots(['z.png', 'y.png'], ['y.png', 'z.png'], { 'z.png': 3, 'y.png': 1 }),
    ).toEqual({ changed: ['y.png', 'z.png'], added: [], gone: [] })
    expect(changedShots(['b.png'], ['b.png', 'z.png', 'm.png'], {}).added).toEqual([
      'm.png',
      'z.png',
    ])
    expect(changedShots(['z.png', 'b.png', 'm.png'], ['b.png'], {}).gone).toEqual([
      'm.png',
      'z.png',
    ])
  })
})

describe('galleryPage', () => {
  test('groups shots by place, each captioned and anchored', () => {
    const page = galleryPage(shotsOf(['ledger/year', 'accounts/year']))
    const headings = [...page.matchAll(/<h2>([^<]*)<\/h2>/g)].map((found) => found[1])
    expect(headings).toEqual(['ledger', 'accounts'])
    expect(page).toContain(
      '<figure id="ledger~year.opens.dark">\n        <img src="ledger~year.opens.dark.png" ' +
        'alt="ledger/year · opens · dark">\n        <figcaption>ledger/year · opens · dark</figcaption>',
    )
    expect(page).toContain('<figcaption>accounts/year · narrow · light</figcaption>')
  })

  test('holds no script and no address beyond its own files', () => {
    const page = galleryPage(shotsOf(NAMES))
    expect(page).not.toMatch(/<script\b/i)
    expect(page).not.toMatch(/https?:|\/\//)
    for (const [, src] of page.matchAll(/<img src="([^"]*)"/g))
      expect(shotsOf(NAMES).map((shot) => shot.file)).toContain(src)
  })

  test('escapes what it writes', () => {
    const page = galleryPage(shotsOf(['a<b/c"d']))
    expect(page).toContain('<h2>a&lt;b</h2>')
    expect(page).toContain('<figure id="a&lt;b~c&quot;d.wide.light">')
    expect(page).toContain('<figcaption>a&lt;b/c&quot;d · wide · light</figcaption>')
    expect(page).not.toContain('a<b')
  })
})

describe('diffPage', () => {
  const changed = (files: string[]): Change => ({ changed: files, added: [], gone: [] })

  test("shows a changed shot's before, after and difference", () => {
    const page = diffPage(changed(['ledger~year.opens.dark.png']))
    expect(page).toContain('<figcaption>ledger/year · opens · dark</figcaption>')
    const srcs = [...page.matchAll(/<img src="([^"]*)"/g)].map((found) => found[1])
    expect(srcs).toEqual([
      'base/ledger~year.opens.dark.png',
      'branch/ledger~year.opens.dark.png',
      'diff/ledger~year.opens.dark.png',
    ])
  })

  test('with nothing moved says so', () => {
    const page = diffPage(changed([]))
    expect(page).toContain('<p>No scene moved.</p>')
    expect(page).not.toContain('<img')
    expect(page).not.toContain('<section>')
  })

  test('lists added and gone shots under their own headings, with the one shot each has', () => {
    const page = diffPage({
      changed: [],
      added: ['ledger~refused.wide.light.png'],
      gone: ['reports~year.narrow.dark.png'],
    })
    const headings = [...page.matchAll(/<h2>([^<]*)<\/h2>/g)].map((found) => found[1])
    expect(headings).toEqual(['Added', 'Gone'])
    const srcs = [...page.matchAll(/<img src="([^"]*)"/g)].map((found) => found[1])
    expect(srcs).toEqual([
      'branch/ledger~refused.wide.light.png',
      'base/reports~year.narrow.dark.png',
    ])
  })

  test('with nothing compared shows before and after, with no difference', () => {
    const page = diffPage(changed(['ledger~year.opens.dark.png']), false)
    const srcs = [...page.matchAll(/<img src="([^"]*)"/g)].map((found) => found[1])
    expect(srcs).toEqual(['base/ledger~year.opens.dark.png', 'branch/ledger~year.opens.dark.png'])
    expect(page).toContain('No compare on this machine')
  })
})
