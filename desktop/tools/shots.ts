// The shots: every scene at the sizes and themes design is argued about, the gallery page over
// them, and what a change moved between two sets. Pure, so a test holds every rule: the browser,
// git and ImageMagick are scenes-cli.ts's.

/** A size the window is judged at: a laptop screen, the size it opens, and half of one. */
export type Size = { name: 'wide' | 'opens' | 'narrow'; width: number; height: number }

/** Light and dark, as the browser's colour scheme: the scenes follow the system theme. */
export type Theme = 'light' | 'dark'

/** One picture of one scene at one size in one theme. */
export type Shot = { scene: string; size: Size['name']; theme: Theme; file: string }

/** What a change moved: shots in both whose pixels differ, and shots only one side has. */
export type Change = { changed: string[]; added: string[]; gone: string[] }

/** `capture.ts`'s wide, the size the window opens, and narrow: the same states side by side. */
export const SIZES: readonly Size[] = [
  { name: 'wide', width: 1280, height: 800 },
  { name: 'opens', width: 960, height: 720 },
  { name: 'narrow', width: 640, height: 800 },
]

export const THEMES: readonly Theme[] = ['light', 'dark']

/** A shot's file: the scene's slash becomes a tilde, so every shot is one file in one folder. */
export function fileOf(scene: string, size: Size['name'], theme: Theme): string {
  return `${scene.replaceAll('/', '~')}.${size}.${theme}.png`
}

/** Every scene at every size in every theme, in that order: wide light, wide dark, then over. */
export function shotsOf(scenes: readonly string[]): Shot[] {
  return scenes.flatMap((scene) =>
    SIZES.flatMap(({ name }) =>
      THEMES.map((theme) => ({ scene, size: name, theme, file: fileOf(scene, name, theme) })),
    ),
  )
}

/**
 * What moved between two sets of shot files, by file. `differing` is the pixels that differ for
 * each file both sides have. Each list is sorted, so the page reads the same on every run.
 */
export function changedShots(
  base: readonly string[],
  branch: readonly string[],
  differing: Record<string, number>,
): Change {
  const inBase = new Set(base)
  const inBranch = new Set(branch)
  return {
    changed: base.filter((file) => inBranch.has(file) && (differing[file] ?? 0) > 0).sort(),
    added: branch.filter((file) => !inBase.has(file)).sort(),
    gone: base.filter((file) => !inBranch.has(file)).sort(),
  }
}

/** A page's own file, path or name as text: a scene named `a<b` reads as words, not markup. */
const ESCAPED: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
const escaped = (text: string) => text.replace(/[&<>"']/g, (letter) => ESCAPED[letter] ?? letter)

const CAPTION = /^(.*)\.(wide|opens|narrow)\.(light|dark)\.png$/

/** A shot's caption from its file: `ledger/year · opens · dark`. */
function captionOf(file: string): string {
  const found = CAPTION.exec(file)
  if (found === null) return file
  const [, scene = '', size = '', theme = ''] = found
  return `${scene.replaceAll('~', '/')} · ${size} · ${theme}`
}

/** Where a shot's caption sits: its file without the extension. */
const anchorOf = (file: string) => file.replace(/\.png$/, '')

/** One shot on a page: its file, what it shows, and where it is anchored. */
function figureOf(file: string, src: string, alt: string, inner: string): string {
  return `      <figure id="${escaped(anchorOf(file))}">
        <img src="${escaped(src)}" alt="${escaped(alt)}">
${inner}      </figure>`
}

/** The shots grouped by place, in the order the places first appear. */
function byPlace(shots: readonly Shot[]): Map<string, Shot[]> {
  const places = new Map<string, Shot[]>()
  for (const shot of shots) {
    const place = shot.scene.split('/')[0] ?? shot.scene
    const group = places.get(place)
    if (group === undefined) places.set(place, [shot])
    else group.push(shot)
  }
  return places
}

const PAGE_STYLE = `      :root { color-scheme: light dark }
      body { margin: 0; padding: 2rem; font: 15px/1.4 system-ui, sans-serif }
      h1 { font-size: 1.4rem; margin: 0 0 1.5rem }
      h2 { font-size: 1.1rem; margin: 2rem 0 1rem; border-bottom: 1px solid #8884; padding-bottom: .3rem }
      figure { margin: 0 0 1.5rem }
      figcaption { margin-top: .4rem; color: #666 }
      img { display: block; max-width: 100%; height: auto; border: 1px solid #8884 }`

const pageOf = (title: string, style: string, body: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>
${style}
    </style>
  </head>
  <body>
    <h1>${title}</h1>
${body}
  </body>
</html>
`

/**
 * The gallery: one folder of static files, every shot grouped by place, each captioned with its
 * scene, size and theme and anchored by them. No script and nothing fetched: it opens from disk
 * with the network off.
 */
export function galleryPage(shots: readonly Shot[]): string {
  const sections = [...byPlace(shots)].map(([place, group]) => {
    const figures = group.map((shot) => {
      const caption = captionOf(shot.file)
      return figureOf(
        shot.file,
        shot.file,
        caption,
        `        <figcaption>${escaped(caption)}</figcaption>\n`,
      )
    })
    return `    <section>
      <h2>${escaped(place)}</h2>
${figures.join('\n')}
    </section>`
  })
  return pageOf('Scenes', PAGE_STYLE, sections.join('\n'))
}

const DIFF_STYLE = `${PAGE_STYLE}
      .shots { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem }
      .shots img { width: 100% }
      .note { color: #666 }`

/** One shot of each side a shot has, in columns, its file naming the picture. */
function diffFigureOf(file: string, lit: boolean): string {
  const caption = captionOf(file)
  const pictures = [`base/${file}`, `branch/${file}`]
  if (lit) pictures.push(`diff/${file}`)
  const alts = lit ? ['Before', 'After', 'The difference'] : ['Before', 'After']
  const cells = pictures
    .map((src, i) => `          <img src="${escaped(src)}" alt="${alts[i] ?? ''}">`)
    .join('\n')
  return `      <figure id="${escaped(anchorOf(file))}">
        <figcaption>${escaped(caption)}</figcaption>
        <div class="shots">
${cells}
        </div>
      </figure>`
}

/** One shot a side alone has: no before or after to lay beside it. */
function oneSideFigureOf(file: string, side: 'base' | 'branch'): string {
  const caption = captionOf(file)
  return figureOf(
    file,
    `${side}/${file}`,
    caption,
    `        <figcaption>${escaped(caption)}</figcaption>\n`,
  )
}

/**
 * The page of only what moved: each changed shot's before, after and difference; then the shots
 * one side alone has. `lit` is false on a machine without ImageMagick's compare, where nothing
 * is marked as different and each shot shows before and after only.
 */
export function diffPage(result: Change, lit = true): string {
  const { changed, added, gone } = result
  if (changed.length === 0 && added.length === 0 && gone.length === 0) {
    return pageOf('Scenes that moved', DIFF_STYLE, '    <p>No scene moved.</p>')
  }
  const sections: string[] = []
  if (!lit) {
    sections.push(
      '    <p class="note">No compare on this machine: before and after, with nothing marked as different.</p>',
    )
  }
  if (changed.length > 0) {
    const heading = lit ? 'Changed' : 'Before and after'
    sections.push(`    <section>
      <h2>${heading}</h2>
${changed.map((file) => diffFigureOf(file, lit)).join('\n')}
    </section>`)
  }
  if (added.length > 0) {
    sections.push(`    <section>
      <h2>Added</h2>
${added.map((file) => oneSideFigureOf(file, 'branch')).join('\n')}
    </section>`)
  }
  if (gone.length > 0) {
    sections.push(`    <section>
      <h2>Gone</h2>
${gone.map((file) => oneSideFigureOf(file, 'base')).join('\n')}
    </section>`)
  }
  return pageOf('Scenes that moved', DIFF_STYLE, sections.join('\n'))
}
