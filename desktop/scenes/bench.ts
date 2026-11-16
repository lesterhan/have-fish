// The design bench: a bar of controls over the scene they name, framed once per theme shown,
// and the theme lab's and the tokens' panels under it. The rules are in controls.ts, lab.ts and
// tokens.ts; this draws them.

import tokensCss from '../renderer/tokens.css?raw'
import { SCHEMES } from '../shared/theme/contract'
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
import {
  BUILT_IN_LAB,
  exportsOf,
  failuresOf,
  type Lab,
  linesOf,
  moved,
  SCHEME_LABELS,
  SLIDERS,
} from './lab'
import { exportOf, GRID_STYLE, groupsOf, styleOf, type Typed } from './tokens'

const bar = byId('controls')
const shelf = byId('frames')
const labBody = byId('lab-body')
const spacingBody = byId('spacing-body')

let bench = benchOf(location.search)
let lab: Lab = BUILT_IN_LAB
let typed: Typed = {}
let grid = false
history.replaceState(null, '', searchOf(bench))

/** The space and type tokens tokens.css declares, by fieldset, and all of them in its order. */
const groups = groupsOf(tokensCss)
const fields = groups.flatMap((group) => group.tokens)

const GRID_ID = 'bench-grid'

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

for (const scheme of SCHEMES) {
  const fieldset = document.createElement('fieldset')
  const legend = document.createElement('legend')
  legend.textContent = SCHEME_LABELS[scheme]
  fieldset.append(legend)
  for (const slider of SLIDERS) {
    const label = document.createElement('label')
    label.textContent = slider.label
    const input = document.createElement('input')
    input.type = 'range'
    // Bounds and step first: a range input clamps a value to those it has when the value is set.
    input.min = String(slider.min)
    input.max = String(slider.max)
    input.step = String(slider.step)
    input.value = String(lab[scheme][slider.key])
    const output = document.createElement('output')
    output.textContent = input.value
    input.addEventListener('input', () => {
      lab = moved(lab, scheme, slider.key, input.value)
      output.textContent = String(lab[scheme][slider.key])
      show()
      showLab()
      showExport()
    })
    label.append(input, output)
    fieldset.append(label)
  }
  labBody.append(fieldset)
}

const contract = document.createElement('ul')
contract.id = 'contract'
labBody.append(contract)

/** The export's text boxes, in exportsOf's order. */
const textareas = exportsOf(lab).map(({ file }) => {
  const figure = document.createElement('figure')
  const caption = document.createElement('figcaption')
  caption.textContent = file
  const textarea = document.createElement('textarea')
  textarea.readOnly = true
  textarea.rows = 7
  textarea.cols = 40
  figure.append(caption, textarea)
  labBody.append(figure)
  return textarea
})

const gridLabel = document.createElement('label')
const gridBox = document.createElement('input')
gridBox.type = 'checkbox'
gridBox.addEventListener('change', () => {
  grid = gridBox.checked
  show()
})
gridLabel.append(gridBox, 'Grid, a line every --space-1')
spacingBody.append(gridLabel)

for (const group of groups) {
  const fieldset = document.createElement('fieldset')
  const legend = document.createElement('legend')
  legend.textContent = group.title
  fieldset.append(legend)
  for (const token of group.tokens) {
    const label = document.createElement('label')
    label.textContent = token.name
    const input = document.createElement('input')
    input.type = 'text'
    input.value = token.value
    input.spellcheck = false
    input.size = token.value.length
    input.addEventListener('input', () => {
      typed = { ...typed, [token.name]: input.value }
      show()
      showExport()
    })
    label.append(input)
    fieldset.append(label)
  }
  spacingBody.append(fieldset)
}

const exportFigure = document.createElement('figure')
const exportCaption = document.createElement('figcaption')
exportCaption.textContent = 'Changed in the lab or here, to paste'
const exported = document.createElement('textarea')
exported.readOnly = true
exported.rows = 8
exported.cols = 48
exportFigure.append(exportCaption, exported)
spacingBody.append(exportFigure)

showLab()
showExport()
show()

function byId(id: string): HTMLElement {
  const found = document.getElementById(id)
  if (found === null) throw new Error(`bench.html has no #${id}`)
  return found
}

/** Frames the bench's scene, reloading a frame only when its page changes. */
function show() {
  for (const [key, select] of selects) select.value = bench[key]
  const frames = framesOf(bench, lab)
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

/** Sets the frame's theme and the panel's tokens on the frame's root, and the grid over it. */
function paint(iframe: HTMLIFrameElement) {
  const page = iframe.contentDocument
  const theme = themes.get(iframe)
  if (page === null || theme === undefined) return
  const root = page.documentElement
  const style = { ...rootStyleOf(theme), ...styleOf(fields, typed) }
  for (const [name, value] of Object.entries(style)) root.style.setProperty(name, value)
  const drawn = page.getElementById(GRID_ID)
  if (!grid) drawn?.remove()
  else if (drawn === null) {
    const lines = page.createElement('div')
    lines.id = GRID_ID
    for (const [name, value] of Object.entries(GRID_STYLE)) lines.style.setProperty(name, value)
    root.append(lines)
  }
}

/** Says what the contract finds in the lab, and the JSON it exports as. */
function showLab() {
  contract.replaceChildren(
    ...linesOf(failuresOf(lab)).map((line) => {
      const item = document.createElement('li')
      item.textContent = line
      return item
    }),
  )
  exportsOf(lab).forEach(({ text }, i) => {
    const textarea = textareas[i]
    if (textarea !== undefined) textarea.value = text
  })
}

/** Says every token changed in the panel or the lab, as one block to paste. */
function showExport() {
  exported.value = exportOf(fields, typed, lab)
}
