// The design bench: a bar of controls over the scene they name, framed once per theme shown.
// The rules are in controls.ts; this only draws them.

import type { Theme } from '../shared/theme/theme'
import {
  type Bench,
  benchOf,
  CONTROLS,
  chosen,
  framesOf,
  noteOf,
  rootStyleOf,
  searchOf,
} from './controls'

const bar = byId('controls')
const shelf = byId('frames')

let bench = benchOf(location.search)
history.replaceState(null, '', searchOf(bench))

/** The theme each frame holds now, read on every load so a reload keeps it. */
const themes = new WeakMap<HTMLIFrameElement, Theme>()

/** Each control's select, so a choice that moves another control shows it there too. */
const selects = new Map<keyof Bench, HTMLSelectElement>()

for (const control of CONTROLS) {
  const label = document.createElement('label')
  label.textContent = control.label
  const select = document.createElement('select')
  for (const choice of control.choices) {
    const option = document.createElement('option')
    option.value = choice.value
    option.textContent = choice.label
    option.selected = choice.value === bench[control.key]
    select.append(option)
  }
  select.addEventListener('change', () => {
    bench = chosen(bench, control.key, select.value)
    history.replaceState(null, '', searchOf(bench))
    show()
  })
  selects.set(control.key, select)
  label.append(select)
  bar.append(label)
}

const note = document.createElement('p')
note.id = 'note'
bar.append(note)

show()

function byId(id: string): HTMLElement {
  const found = document.getElementById(id)
  if (found === null) throw new Error(`bench.html has no #${id}`)
  return found
}

/** Frames the bench's scene, reloading a frame only when its page changes. */
function show() {
  for (const [key, select] of selects) select.value = bench[key]
  const frames = framesOf(bench)
  frames.forEach((frame, i) => {
    const iframe = frameAt(i)
    if (iframe.getAttribute('src') !== frame.src) iframe.setAttribute('src', frame.src)
    if (frame.width === null) {
      iframe.style.width = ''
      iframe.style.flex = '1 1 0'
      iframe.style.minWidth = '0'
    } else {
      iframe.style.width = `${frame.width}px`
      iframe.style.flex = 'none'
      iframe.style.minWidth = ''
    }
    iframe.title = `${bench.scene} · ${frame.theme.scheme}`
    themes.set(iframe, frame.theme)
    paint(iframe)
  })
  while (shelf.children.length > frames.length) shelf.lastElementChild?.remove()
  const said = noteOf(bench)
  note.textContent = said
  note.hidden = said === null
}

/** The shelf's frame at `i`, made if it isn't there yet, and painted on every load. */
function frameAt(i: number): HTMLIFrameElement {
  const found = shelf.children[i]
  if (found instanceof HTMLIFrameElement) return found
  const made = document.createElement('iframe')
  made.addEventListener('load', () => paint(made))
  shelf.append(made)
  return made
}

/** Sets every colour of the frame's theme, and its scheme, on the frame's root. */
function paint(iframe: HTMLIFrameElement) {
  const root = iframe.contentDocument?.documentElement
  const theme = themes.get(iframe)
  if (root === undefined || theme === undefined) return
  for (const [name, value] of Object.entries(rootStyleOf(theme)))
    root.style.setProperty(name, value)
}
