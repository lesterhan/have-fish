import { Platform, type TextStyle, type ViewStyle } from 'react-native'

/**
 * have-fish Pocket Companion — design tokens.
 *
 * Single source of truth for every visual value in the mobile app. The mobile
 * equivalent of the web's `frontend/src/styles/tokens.css`. New UI must read
 * from `theme` — never hardcode a hex, spacing, radius, or font size.
 *
 * ## Web-token → mobile-token mapping
 *
 * The web tokens are CSS custom properties in rem; mobile mirrors the **light**
 * `:root` block as a typed object in px (1rem = 16px). The web
 * `[data-theme='dark']` block is the future dark variant — this epic ships light
 * only, but the palette is structured so a dark `theme` can be swapped in later
 * at a single point.
 *
 *   web                          mobile
 *   ---------------------------  --------------------------------
 *   --sp-md: 1rem                sp.md: 16
 *   --text-sm: 0.875rem          text.sm: 14
 *   --color-window: #f4f5f7      color.window
 *   --color-accent: #2a78c0      color.accent       (fixed default Aqua)
 *   --radius-lg: 2px             radius.lg: 2
 *   --card-* surface             card.* (RN-approximated: bg + border + elevation)
 *   --duration-fast: 80ms        duration.fast: 80
 *
 * ## Design decisions baked in here (2026-06-18)
 *
 * - **Aqua-card subset, not XP bevels.** RN has no `--shadow-raised`/`--shadow-sunken`
 *   parity; we use the web `--card-*` model (flat bg + hairline border + soft
 *   elevation) instead.
 * - **System font.** Lucida Grande/Segoe UI don't exist on Android; `font.sans` is
 *   `undefined` (= system default). Named here so a bundled face is a one-line swap.
 * - **Fixed default accent.** Web's default Aqua `#2a78c0`. Per-user accent
 *   preference is not fetched this epic.
 * - **Sharp corners.** `radius.sm`/`radius.md` are 0, matching the web design system;
 *   `lg`/`xl` are tiny and used sparingly.
 */

/** Spacing scale — 4px base unit. Use for margin / padding / gap, never raw px. */
const sp = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
} as const

/** Type scale (px). Body text runs small, period-accurate for the Graphite shell. */
const text = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
} as const

/** RN fontWeight strings. Web maps semibold → 700. */
const weight = {
  normal: '400',
  medium: '500',
  semibold: '700',
} as const satisfies Record<string, TextStyle['fontWeight']>

/**
 * Font families. `sans` is `undefined` → the platform system font (Roboto on
 * Android), mirroring the web's Lucida Grande → Segoe UI → system fallback chain.
 * Swap in a bundled face here when one is added.
 */
const font = {
  sans: undefined as string | undefined,
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
} as const

/** Sharp corners by default; lg/xl are the only rounding, used sparingly. */
const radius = {
  sm: 0,
  md: 0,
  lg: 2,
  xl: 4,
} as const

/**
 * Graphite light palette — mirrors the web light `:root` color tokens.
 * (The web `[data-theme='dark']` Nord palette is the future dark variant.)
 */
const color = {
  /* The desktop — page background */
  desktop: '#b8bcc2',

  /* Window chrome (cool silver-grey) */
  window: '#f4f5f7', // panel / card surface
  windowRaised: '#eceef2', // alternate panel surface
  windowInset: '#ffffff', // text inputs, list boxes

  /* Rules and dividers */
  rule: '#c8ccd2',
  ruleSoft: '#e2e5ea',

  /* Text */
  text: '#1a1f28',
  textMuted: '#5a6068',
  textDisabled: '#8a909a',
  textOnAccent: '#ffffff',

  /* Accent — fixed default Aqua */
  accent: '#2a78c0',
  accentHi: '#5aa8e8',
  accentChipBg: '#dde6f2',
  accentChipFg: '#1a3868',

  /* Semantic */
  success: '#007700',
  successLight: '#e0ffe0',
  warning: '#b86800',
  warningLight: '#fff3e0',
  danger: '#cc0000',
  dangerLight: '#ffe0e0',

  /* Amounts — green income, red expense (matches web convention) */
  amountPositive: '#007700',
  amountNegative: '#cc0000',

  /* Transfers — neutral directional, no good/bad judgment */
  transferIn: '#006e8a', // teal — money arriving
  transferOut: '#4a5fa8', // slate blue — money leaving

  /* Modal scrim — the dimmed backdrop behind dialogs and bottom sheets */
  scrim: 'rgba(0, 0, 0, 0.5)',
} as const

/** Transition durations (ms). */
const duration = {
  fast: 80,
  normal: 120,
} as const

/**
 * Aqua card surface — the RN approximation of the web `--card-*` tokens.
 * A flat panel on a hairline border with a soft drop shadow. The shadow is
 * expressed as RN style props (iOS shadow* + Android elevation), not a CSS string.
 */
const card = {
  bg: color.window,
  borderColor: color.rule,
  radius: radius.lg,
  /** Spread into a card View's style. */
  shadow: {
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
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
} as const

export type Theme = typeof theme

/**
 * Base card surface as a ready-to-spread style object. Equivalent to the web
 * `--card-*` recipe (bg + border + radius + soft elevation).
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
