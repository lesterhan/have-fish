// What the sheet lays out before there are parts: each token, by kind, read from the page.

export const TYPE = ['key', 'small', 'quiet', 'base', 'sentence', 'title'].map((s) => `--text-${s}`)
export const SPACE = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `--space-${n}`)
export const RADII = ['chip', 'control', 'card', 'pill'].map((r) => `--radius-${r}`)
export const SHADOWS = ['pop', 'lift', 'compose', 'palette'].map((s) => `--shadow-${s}`)
export const DURATIONS = [
  'pop',
  'open',
  'slide',
  'slide-in',
  'fade',
  'drop',
  'confirm',
  'wash',
  'flash',
  'land',
].map((d) => `--duration-${d}`)
export const COLOURS = [
  'sidebar',
  'background',
  'band',
  'selected',
  'card',
  'rule',
  'border',
  'bar',
  'muted',
  'text',
  'accent',
  'on-accent',
  'in',
  'error',
  'assets',
  'liabilities',
  'expenses',
  'income',
].map((c) => `--color-${c}`)
