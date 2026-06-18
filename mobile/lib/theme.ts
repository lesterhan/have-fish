import { type TextStyle, type ViewStyle } from 'react-native'

/**
 * have-fish Pocket Companion — design tokens.
 *
 * Single source of truth for every visual value in the mobile app. New UI must
 * read from `theme` — never hardcode a hex, spacing, radius, or font size. The
 * `bun run lint:tokens` guardrail fails the build if a color literal appears
 * outside this file.
 *
 * ## Source of truth
 *
 * The Pocket Companion redesign spec is `.design/handoff/README.md` (warm/rust
 * Aqua palette, layered-gradient "gloss" recipe, Source Serif 4 + JetBrains
 * Mono). This file is the RN materialization of that spec's **light theme**
 * with the locked variant `gloss: Subtle (level 1)`, `corners: Default`.
 *
 * ## Palette shape
 *
 * The Companion palette is the primary set (`appBg`, `chrome`, `surface`, `ink`,
 * `accent`, `accentSoft`, …). A block of **legacy aliases** maps the old
 * Graphite token names (`window`, `text`, `rule`, …) onto the nearest Companion
 * value so screens not yet migrated to the new shell keep compiling and render
 * in the new palette. Those aliases disappear when the old Groups-list/detail
 * screens are removed (Companion epic 4).
 *
 * ## Departures from the web design system
 *
 * - **Soft radii, not sharp corners.** The web rule is `radius: 0`; the
 *   Companion mobile design intentionally uses a `4·8·9·11·12·14·16·18` radius
 *   scale (rounded cards, chips, sheets). This is deliberate, not a regression.
 * - **Bundled fonts.** Source Serif 4 (headers) + JetBrains Mono (all numerals,
 *   labels, tags) are bundled (see `font`). `sans` stays the system face
 *   (Roboto on Android) for body copy, names, and button labels.
 *
 * Decisions baked in 2026-06-18.
 */

/**
 * Spacing scale. Semantic steps (`xs`…`3xl`) plus the exact in-between pixel
 * values the Companion layout is tuned to (`7·9·10·11·13`) so the Add screen
 * fits a 412×892 frame without scrolling. Numeric keys are read as `sp[9]`.
 */
const sp = {
  /* semantic steps */
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
  /* exact Companion layout values */
  4: 4,
  7: 7,
  9: 9,
  10: 10,
  11: 11,
  13: 13,
  16: 16,
} as const

/** Type scale (px). The Companion design specifies many exact sizes inline
 * (e.g. amount hero 40, group name 23, sheet title 19); those stay raw at the
 * call site. These named steps cover ordinary body / caption text. */
const text = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
} as const

/** RN fontWeight strings. */
const weight = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const satisfies Record<string, TextStyle['fontWeight']>

/**
 * Font families.
 * - `sans` is `undefined` → platform system font (Roboto on Android). Body
 *   copy, member names, button labels, settings rows.
 * - `serif` is bundled Source Serif 4 600 — headers and sheet titles.
 * - `mono*` are the bundled JetBrains Mono weights. Android does not synthesize
 *   weight from a single custom family, so pick the explicit family for the
 *   weight you need (do not combine `fontFamily: mono` with `fontWeight`).
 *   Defined in `lib/fonts.ts`; loaded in `app/_layout.tsx`.
 */
const font = {
  sans: undefined as string | undefined,
  serif: 'SourceSerif4-SemiBold',
  mono: 'JetBrainsMono-Regular', // 400
  monoMedium: 'JetBrainsMono-Medium', // 500
  monoSemibold: 'JetBrainsMono-SemiBold', // 600
  monoBold: 'JetBrainsMono-Bold', // 700
} as const

/**
 * Radius scale (Companion "Default" corners). Named by role so call sites read
 * intent, not a raw number.
 */
const radius = {
  sm: 4,
  md: 8,
  chip: 9,
  field: 11,
  btn: 12,
  cardSm: 14,
  card: 16,
  sheet: 18,
  /* legacy aliases (old screens) */
  lg: 4,
  xl: 8,
} as const

/**
 * Companion warm/rust light palette (from handoff "Design tokens"). The dark
 * tokens in the handoff are future parity — not shipped this epic.
 */
const color = {
  /* Surfaces */
  appBg: '#e7e3da', // page background behind cards
  chrome: '#efece6', // header + tab bar
  surface: '#fcfbf8', // cards
  surface2: '#f3f0ea', // recessed / tags
  field: '#ffffff', // inputs
  line: '#dbd5ca', // borders
  lineSoft: '#e8e4db', // dividers

  /* Text */
  ink: '#2a2620', // primary
  ink2: '#746d61', // secondary / labels-on-fill
  ink3: '#a89f90', // faint / placeholders
  textOnAccent: '#ffffff',

  /* Accent (rust) */
  accent: '#c0651f',
  accentSoft: '#f5e6db', // selected chip / segment fill
  accentLine: '#e3ba9a', // selected border
  accentInk: '#b45f1d', // text on accentSoft fills
  accentGlossTop: '#c8793c', // accent gloss gradient top stop
  accentGlossBorder: '#a1551a', // accent gloss border

  /* Status */
  green: '#3f7d5a',
  greenBg: 'rgba(63,125,90,0.12)',
  red: '#b3492a',
  redBg: 'rgba(179,73,42,0.10)',

  /* Modal scrim — the dimmed backdrop behind sheets */
  scrim: 'rgba(0,0,0,0.32)',

  /* ── Legacy aliases (Graphite names → Companion values) ──────────────
   * Used only by screens awaiting migration; removed in Companion epic 4. */
  desktop: '#e7e3da', // → appBg
  window: '#fcfbf8', // → surface
  windowRaised: '#f3f0ea', // → surface2
  windowInset: '#ffffff', // → field
  rule: '#dbd5ca', // → line
  ruleSoft: '#e8e4db', // → lineSoft
  text: '#2a2620', // → ink
  textMuted: '#746d61', // → ink2
  textDisabled: '#a89f90', // → ink3
  accentHi: '#c8793c', // → accentGlossTop
  accentChipBg: '#f5e6db', // → accentSoft
  accentChipFg: '#b45f1d', // → accentInk
  success: '#3f7d5a', // → green
  successLight: 'rgba(63,125,90,0.12)', // → greenBg
  warning: '#b8801f', // amber (no Companion equivalent; kept for old screens)
  warningLight: 'rgba(184,128,31,0.12)',
  danger: '#b3492a', // → red
  dangerLight: 'rgba(179,73,42,0.10)', // → redBg
  amountPositive: '#3f7d5a', // → green
  amountNegative: '#b3492a', // → red
} as const

/** Transition durations (ms). */
const duration = {
  fast: 100,
  normal: 120,
} as const

/**
 * Neutral card surface — the flat RN approximation used by legacy screens
 * (the gloss primitives in Story 3 supersede this for new UI).
 */
const card = {
  bg: color.surface,
  borderColor: color.line,
  radius: radius.card,
  shadow: {
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  } satisfies ViewStyle,
} as const

/**
 * Gloss recipe constants (handoff "Gloss recipe", locked = Subtle / level 1).
 *
 * The per-base lighten/darken stops are computed at render time from `lib/color`
 * (RN has no `color-mix`); only the fixed white-sheen / shadow values live here.
 * Shadows are RN style props (iOS `shadow*` + Android `elevation`).
 */
const gloss = {
  /** White sheen overlay (top → transparent ~60%) on neutral surfaces. */
  neutralSheenTop: 'rgba(255,255,255,0.28)',
  /** 1px top inset highlight on neutral surfaces. */
  neutralInsetTop: 'rgba(255,255,255,0.7)',
  /** 1px top inset highlight on the accent gloss. */
  accentInsetTop: 'rgba(255,255,255,0.32)',
  /** Text shadow under white text on the accent gloss. */
  accentTextShadow: 'rgba(0,0,0,0.18)',

  /** Soft drop shadow for neutral cards / keys (elevation ~2). */
  shadowCard: {
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  } satisfies ViewStyle,
  /** Stronger shadow for accent buttons (elevation ~4). */
  shadowButton: {
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  } satisfies ViewStyle,
  /** Sheet shadow — large, upward (elevation ~12). */
  shadowSheet: {
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: -10 },
    elevation: 12,
  } satisfies ViewStyle,
} as const

export const theme = {
  sp,
  text,
  weight,
  font,
  radius,
  color,
  duration,
  card,
  gloss,
} as const

export type Theme = typeof theme

/**
 * Base card surface as a ready-to-spread style object (bg + border + radius +
 * soft elevation). Used by legacy screens; new UI uses `GlossSurface`.
 *
 *   <View style={[cardStyle, { padding: theme.sp.md }]} />
 */
export const cardStyle: ViewStyle = {
  backgroundColor: card.bg,
  borderWidth: 1,
  borderColor: card.borderColor,
  borderRadius: card.radius,
  ...card.shadow,
}
