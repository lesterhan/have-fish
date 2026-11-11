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
 * each file both sides have; without it, as on a machine with no compare, every file both sides
 * have is in `changed`, since none could be compared. Each list is sorted.
 */
export function changedShots(
  base: readonly string[],
  branch: readonly string[],
  differing?: Record<string, number>,
): Change {
  const inBase = new Set(base)
  const inBranch = new Set(branch)
  return {
    changed: base
      .filter(
        (file) => inBranch.has(file) && (differing === undefined || (differing[file] ?? 0) > 0),
      )
      .sort(),
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

/** A shot's scene from its file: `ledger~year.wide.light.png` is `ledger/year`. */
export function sceneOf(file: string): string {
  const found = CAPTION.exec(file)
  return found === null ? file : (found[1] ?? file).replaceAll('~', '/')
}

/** A shot's caption from its file: `ledger/year · wide · light`. */
function captionOf(file: string): string {
  const found = CAPTION.exec(file)
  if (found === null) return file
  const [, , size = '', theme = ''] = found
  return `${sceneOf(file)} · ${size} · ${theme}`
}

/** Where a shot's caption sits: its file without the extension. */
const anchorOf = (file: string) => file.replace(/\.png$/, '')

/** What a picture of one side is, read out; its own file, for a gallery shot. */
const SIDES: Record<string, string> = { base: 'Before', branch: 'After', diff: 'The difference' }
const altOf = (src: string, caption: string) => SIDES[src.split('/')[0] ?? ''] ?? caption

/** One shot on a page: its anchor, its pictures and what it shows. */
function figureOf(file: string, sources: readonly string[], caption = captionOf(file)): string {
  const pictures = sources
    .map((src) => `        <img src="${escaped(src)}" alt="${escaped(altOf(src, caption))}">`)
    .join('\n')
  // Three pictures read as columns; one reads as itself.
  const sides = sources.length > 1 ? ' class="shots"' : ''
  return `      <figure id="${escaped(anchorOf(file))}"${sides}>
${pictures}
        <figcaption>${escaped(caption)}</figcaption>
      </figure>`
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
      h2 { font-size: 1.1rem; margin: 2rem 0 1rem; border-bottom: 1px solid #8884;
        padding-bottom: .3rem }
      figure { margin: 0 0 1.5rem }
      figure.shots { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem }
      figure.shots img { width: 100% }
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
    const figures = group.map((shot) =>
      figureOf(shot.file, [shot.file], `${shot.scene} · ${shot.size} · ${shot.theme}`),
    )
    return `    <section>
      <h2>${escaped(place)}</h2>
${figures.join('\n')}
    </section>`
  })
  return pageOf('Scenes', PAGE_STYLE, sections.join('\n'))
}

const DIFF_STYLE = `${PAGE_STYLE}
      .note { color: #666 }`

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
      '    <p class="note">No compare on this machine: before and after, ' +
        'with nothing marked as different.</p>',
    )
  }
  if (changed.length > 0) {
    const heading = lit ? 'Changed' : 'Before and after'
    const figures = changed.map((file) =>
      figureOf(file, [`base/${file}`, `branch/${file}`, ...(lit ? [`diff/${file}`] : [])]),
    )
    sections.push(`    <section>
      <h2>${heading}</h2>
${figures.join('\n')}
    </section>`)
  }
  if (added.length > 0) {
    const figures = added.map((file) => figureOf(file, [`branch/${file}`]))
    sections.push(`    <section>
      <h2>Added</h2>
${figures.join('\n')}
    </section>`)
  }
  if (gone.length > 0) {
    const figures = gone.map((file) => figureOf(file, [`base/${file}`]))
    sections.push(`    <section>
      <h2>Gone</h2>
${figures.join('\n')}
    </section>`)
  }
  return pageOf('Scenes that moved', DIFF_STYLE, sections.join('\n'))
}
