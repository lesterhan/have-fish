type AccentVariant = {
  hex: string
  hi: string
  chipBg: string
  chipFg: string
  barTrack: string
  titlebar: string
  fg: string  // text color for use ON an accent-filled surface
}

type AccentDef = {
  light: AccentVariant
  dark: AccentVariant
}

export const ACCENTS: Record<string, AccentDef> = {
  aqua: {
    light: { hex: '#2a78c0', hi: '#5aa8e8', chipBg: '#dde6f2', chipFg: '#1a3868', barTrack: '#dde6f2', titlebar: 'linear-gradient(180deg,#5aa8e8,#2a78c0)', fg: '#ffffff' },
    dark:  { hex: '#68b8f0', hi: '#90ceff', chipBg: '#1a2a3a', chipFg: '#90ceff', barTrack: '#1a2a3a', titlebar: 'linear-gradient(180deg,#90ceff,#68b8f0)', fg: '#0e1620' },
  },
  sage: {
    light: { hex: '#4a8a5a', hi: '#7ac08a', chipBg: '#dee8de', chipFg: '#1f4828', barTrack: '#dee8de', titlebar: 'linear-gradient(180deg,#7ac08a,#4a8a5a)', fg: '#ffffff' },
    dark:  { hex: '#8dd09e', hi: '#a8e0b8', chipBg: '#1a2e22', chipFg: '#a8e0b8', barTrack: '#1a2e22', titlebar: 'linear-gradient(180deg,#a8e0b8,#8dd09e)', fg: '#0e1a12' },
  },
  persimmon: {
    light: { hex: '#c46838', hi: '#e89868', chipBg: '#f0e0d4', chipFg: '#5a2a10', barTrack: '#f0e0d4', titlebar: 'linear-gradient(180deg,#e89868,#c46838)', fg: '#ffffff' },
    dark:  { hex: '#f0a878', hi: '#f8c0a0', chipBg: '#2e1a0a', chipFg: '#f8c0a0', barTrack: '#2e1a0a', titlebar: 'linear-gradient(180deg,#f8c0a0,#f0a878)', fg: '#1e0e04' },
  },
  plum: {
    light: { hex: '#8a4a8a', hi: '#b878b8', chipBg: '#e8dee8', chipFg: '#3a103a', barTrack: '#e8dee8', titlebar: 'linear-gradient(180deg,#b878b8,#8a4a8a)', fg: '#ffffff' },
    dark:  { hex: '#cc90cc', hi: '#e0b0e0', chipBg: '#261026', chipFg: '#e0b0e0', barTrack: '#261026', titlebar: 'linear-gradient(180deg,#e0b0e0,#cc90cc)', fg: '#180a18' },
  },
  ochre: {
    light: { hex: '#b89028', hi: '#e8c060', chipBg: '#efe6cc', chipFg: '#4a3408', barTrack: '#efe6cc', titlebar: 'linear-gradient(180deg,#e8c060,#b89028)', fg: '#ffffff' },
    dark:  { hex: '#f0d070', hi: '#f8e090', chipBg: '#28200a', chipFg: '#f8e090', barTrack: '#28200a', titlebar: 'linear-gradient(180deg,#f8e090,#f0d070)', fg: '#1a1400' },
  },
  slate: {
    light: { hex: '#5a6878', hi: '#8a98a8', chipBg: '#dde2e8', chipFg: '#1a2838', barTrack: '#dde2e8', titlebar: 'linear-gradient(180deg,#8a98a8,#5a6878)', fg: '#ffffff' },
    dark:  { hex: '#a0b0c0', hi: '#c0d0e0', chipBg: '#1a2030', chipFg: '#c0d0e0', barTrack: '#1a2030', titlebar: 'linear-gradient(180deg,#c0d0e0,#a0b0c0)', fg: '#0e1420' },
  },
} as const

export type AccentKey = keyof typeof ACCENTS

export function applyAccent(key: AccentKey, dark = false) {
  const a = ACCENTS[key][dark ? 'dark' : 'light']
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
  s.setProperty('--color-accent-fg',        a.fg)
}
