/**
 * OKLCH, and the two contrast measures the design system is specified in.
 *
 * The app's colours are described as positions on a perceptual ramp rather than as hex
 * literals, because that is the only form in which "the same rung in both themes" is a
 * statement you can check. See DESIGN.md §5.
 *
 * Three coordinates:
 *   l — lightness, 0 (black) to 1 (white). Perceptually uniform: a fixed step looks like
 *       the same step at either end of the ramp, which sRGB luminance emphatically does not.
 *   c — chroma, 0 (grey) upward. Not normalised: the maximum in-gamut chroma depends on
 *       both l and h, which is why `oklchToHex` has to gamut-map.
 *   h — hue angle in degrees.
 *
 * Ported from Björn Ottosson's reference implementation.
 */

export type Oklch = { l: number; c: number; h: number }

// --- sRGB transfer function ----------------------------------------------------------------

function toLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function fromLinear(value: number): number {
  const c =
    value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
  return c * 255
}

// --- conversion ------------------------------------------------------------------------------

function parseHex(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) throw new Error(`expected a 6-digit hex colour, got "${hex}"`)
  const n = Number.parseInt(match[1]!, 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = parseHex(hex).map(toLinear) as [number, number, number]

  const long = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const medium = Math.cbrt(
    0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
  )
  const short = Math.cbrt(
    0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b,
  )

  const l = 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short
  const a = 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short
  const bb = 0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short

  return {
    l,
    c: Math.hypot(a, bb),
    h: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360,
  }
}

/** Linear sRGB, which may fall outside [0, 1] when the colour is out of gamut. */
function toLinearRgb({ l, c, h }: Oklch): [number, number, number] {
  const radians = (h * Math.PI) / 180
  const a = c * Math.cos(radians)
  const b = c * Math.sin(radians)

  const long = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const medium = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const short = (l - 0.0894841775 * a - 1.291485548 * b) ** 3

  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ]
}

/**
 * Tolerance for float dust only. It has to be small: this is measured in *linear* light, where
 * a generous epsilon near black spans many sRGB steps — at 1/512 a request for pure black with
 * chroma on it came back as #01000b rather than #000000.
 */
const IN_GAMUT_EPSILON = 1e-6

function isInGamut(colour: Oklch): boolean {
  return toLinearRgb(colour).every(
    (channel) =>
      channel >= -IN_GAMUT_EPSILON && channel <= 1 + IN_GAMUT_EPSILON,
  )
}

/**
 * Gamut-maps by reducing chroma, holding lightness and hue exactly.
 *
 * The naive alternative is to clamp the three channels into range, which is one line and
 * quietly wrong: clamping moves the channels by different amounts, so it shifts the hue.
 * Every accent here is defined as "this hue at this rung", and a hue that drifts when the
 * requested chroma happens to be unreachable makes that definition a suggestion. Binary
 * search on chroma keeps the two coordinates the design actually specifies.
 */
export function oklchToHex(colour: Oklch): string {
  let inGamut = colour
  if (!isInGamut(colour)) {
    let low = 0
    let high = colour.c
    for (let i = 0; i < 24; i++) {
      const mid = (low + high) / 2
      if (isInGamut({ ...colour, c: mid })) low = mid
      else high = mid
    }
    inGamut = { ...colour, c: low }
  }

  const channels = toLinearRgb(inGamut).map((channel) => {
    const byte = Math.round(fromLinear(Math.min(1, Math.max(0, channel))))
    return Math.min(255, Math.max(0, byte)).toString(16).padStart(2, '0')
  })

  return `#${channels.join('')}`
}

// --- contrast ---------------------------------------------------------------------------------

/** WCAG relative luminance. Not perceptual — this is the input to a contrast *ratio*. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(toLinear) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio, 1 to 21. The unit ink is specified in. */
export function contrastRatio(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ]
  return (high + 0.05) / (low + 0.05)
}

/** How far apart two colours sit on the perceptual ramp. The unit surfaces are specified in. */
export function deltaL(a: string, b: string): number {
  return Math.abs(hexToOklch(a).l - hexToOklch(b).l)
}
