export const ACCENTS = {
  aqua:      { hex: '#2a78c0', hi: '#5aa8e8', chipBg: '#dde6f2', chipFg: '#1a3868', barTrack: '#dde6f2', titlebar: 'linear-gradient(180deg,#5aa8e8,#2a78c0)' },
  sage:      { hex: '#4a8a5a', hi: '#7ac08a', chipBg: '#dee8de', chipFg: '#1f4828', barTrack: '#dee8de', titlebar: 'linear-gradient(180deg,#7ac08a,#4a8a5a)' },
  persimmon: { hex: '#c46838', hi: '#e89868', chipBg: '#f0e0d4', chipFg: '#5a2a10', barTrack: '#f0e0d4', titlebar: 'linear-gradient(180deg,#e89868,#c46838)' },
  plum:      { hex: '#8a4a8a', hi: '#b878b8', chipBg: '#e8dee8', chipFg: '#3a103a', barTrack: '#e8dee8', titlebar: 'linear-gradient(180deg,#b878b8,#8a4a8a)' },
  ochre:     { hex: '#b89028', hi: '#e8c060', chipBg: '#efe6cc', chipFg: '#4a3408', barTrack: '#efe6cc', titlebar: 'linear-gradient(180deg,#e8c060,#b89028)' },
  slate:     { hex: '#5a6878', hi: '#8a98a8', chipBg: '#dde2e8', chipFg: '#1a2838', barTrack: '#dde2e8', titlebar: 'linear-gradient(180deg,#8a98a8,#5a6878)' },
} as const

export type AccentKey = keyof typeof ACCENTS

export function applyAccent(key: AccentKey) {
  const a = ACCENTS[key]
  const s = document.documentElement.style
  s.setProperty('--color-accent',           a.hex)
  s.setProperty('--color-accent-hi',        a.hi)
  s.setProperty('--color-accent-mid',       a.hi)
  s.setProperty('--color-accent-light',     a.chipBg)
  s.setProperty('--color-accent-chip-bg',   a.chipBg)
  s.setProperty('--color-accent-chip-fg',   a.chipFg)
  s.setProperty('--color-accent-bar-track', a.barTrack)
  s.setProperty('--color-titlebar-accent',  a.titlebar)
  s.setProperty('--color-dropdown-active',  a.hex)
}
