// ════════════════════════════════════════════════════════════
//  SEGMENT-AWARE FUZZY SCORER
//
//  Ported from the design handoff (pg/scorer.js). The fix for the
//  "hou pollutes with home:furniture" problem: flat substring matching
//  treats a path as one string, so `hou`'s characters scatter-match
//  `home`. We instead score a subsequence alignment with structure-aware
//  bonuses:
//    • big bonus when a query char lands at a SEGMENT START (after ':')
//    • bonus for CONSECUTIVE (contiguous) matches
//    • penalty for GAPS between matched chars
//    • bonus when the match reaches the LEAF (last) segment
//    • frequency as a gentle TIE-BREAK, never a match override
//
//  "hou" → housing:  h·o·u all land contiguously at the start of the
//           "housing" segment → big segment-start + contiguous bonus.
//  "hou" → home:furniture:  h·o match the start of "home", but "u" is
//           stranded over in "furniture" → large gap penalty sinks it.
//
//  Weights and behaviour are a faithful port — change them only with a
//  matching update to the verified-rankings tests.
// ════════════════════════════════════════════════════════════

const SEP = ':'

// Scoring weights. Each is documented in the handoff README's weights table.
const W = {
  base: 12, // each matched char
  segStart: 22, // matched char begins a segment (first char after a ':')
  pathStart: 16, // matched char is the very first char of the path
  consecutive: 14, // matched char directly follows the previous match
  gap: -2.4, // per skipped char between two matches
  leadGap: -0.4, // per char before the first match (mild)
  leaf: 16, // any match lands in the final segment
  fullSeg: 10, // an entire segment got covered start..end
} as const

const EXACT_LEAF_JACKPOT = 40 // query equals the leaf segment exactly
const FREQ_WEIGHT = 1.6 // multiplier on log2(freq + 1) tie-break
const DEPTH_PENALTY = 0.6 // per extra segment, mild shallow-path preference

/** The minimal shape the scorer needs from an account. */
export interface ScorableAccount {
  path: string
  freq?: number
}

/** An account augmented with its score and matched-character positions. */
export type RankedAccount<T extends ScorableAccount> = T & {
  score: number
  /** Indices (into the lowercased path) of every matched character. */
  pos: number[]
}

type CharClass = 'pathStart' | 'segStart' | 'normal'

function charClass(path: string, i: number): CharClass {
  if (i === 0) return 'pathStart'
  if (path[i - 1] === SEP) return 'segStart'
  return 'normal'
}

interface Alignment {
  score: number
  pos: number[]
}

// Best subsequence alignment of `q` within `path` (both already lowercased).
// Returns the highest-scoring alignment, or null if q is not a subsequence.
// Not memoized: the per-char bonus depends on the previous match index, and
// account paths are short, so the recursion stays cheap.
function align(q: string, path: string): Alignment | null {
  const ql = q.length
  const pl = path.length

  function rec(qi: number, pi: number, prev: number): Alignment {
    if (qi === ql) return { score: 0, pos: [] }
    let best: Alignment | null = null
    const maxStart = pl - (ql - qi)
    for (let p = pi; p <= maxStart; p++) {
      if (path[p] !== q[qi]) continue
      let s: number = W.base
      const cls = charClass(path, p)
      if (cls === 'segStart') s += W.segStart
      else if (cls === 'pathStart') s += W.pathStart
      if (prev >= 0) {
        if (p === prev + 1) s += W.consecutive
        else s += (p - prev - 1) * W.gap
      } else {
        s += p * W.leadGap
      }
      const sub = rec(qi + 1, p + 1, p)
      const total = s + sub.score
      if (!best || total > best.score) best = { score: total, pos: [p, ...sub.pos] }
    }
    return best ?? { score: -Infinity, pos: [] }
  }

  const r = rec(0, 0, -1)
  return r.score === -Infinity ? null : r
}

export interface ScoreResult {
  score: number
  pos: number[]
}

// Normalize a raw query: lowercase, strip ':' and whitespace. So `food:rest`,
// `foodrest`, and `food rest` all behave identically — the ':' is just a hint
// the user typed, and segment bonuses already reward boundaries.
function normalizeQuery(raw: string): string {
  return raw.toLowerCase().replace(/[:\s]+/g, '')
}

/**
 * Score a single account path against a raw query.
 * Returns the score + matched positions, or null if the query is not a
 * subsequence of the path. An empty query matches everything with score 0.
 */
export function scoreOne(rawQuery: string, path: string, freq = 0): ScoreResult | null {
  const q = normalizeQuery(rawQuery)
  const lp = path.toLowerCase()
  if (!q) return { score: 0, pos: [] }

  const a = align(q, lp)
  if (!a) return null

  let score = a.score

  // Leaf bonus — does the last matched char sit inside the final segment?
  const lastSep = lp.lastIndexOf(SEP)
  if (a.pos[a.pos.length - 1] > lastSep) score += W.leaf

  // Full-segment coverage bonus — did we cover an entire segment start..end?
  const segs = lp.split(SEP)
  const posSet = new Set(a.pos)
  let off = 0
  for (const seg of segs) {
    let whole = seg.length > 0
    for (let k = 0; k < seg.length; k++) {
      if (!posSet.has(off + k)) {
        whole = false
        break
      }
    }
    if (whole) score += W.fullSeg
    off += seg.length + 1
  }

  // Exact-leaf jackpot — query equals the leaf segment exactly.
  if (segs[segs.length - 1] === q) score += EXACT_LEAF_JACKPOT

  // Gentle frequency tie-break (log so heavy accounts can't bully match quality).
  score += Math.log2(freq + 1) * FREQ_WEIGHT

  // Mild shallow-path preference on ties.
  score -= (segs.length - 1) * DEPTH_PENALTY

  return { score, pos: a.pos }
}

/**
 * Rank an account list for a query, descending by score. Each returned item
 * carries `score` and `pos` (matched char indices, for highlight spans).
 * Ties break by frequency, then alphabetically by path — so with freq absent
 * (all zero) the order degrades to a stable alphabetical sort.
 */
export function rank<T extends ScorableAccount>(
  rawQuery: string,
  accounts: T[],
): RankedAccount<T>[] {
  const out: RankedAccount<T>[] = []
  for (const acc of accounts) {
    const r = scoreOne(rawQuery, acc.path, acc.freq ?? 0)
    if (r) out.push({ ...acc, score: r.score, pos: r.pos })
  }
  out.sort(
    (a, b) =>
      b.score - a.score ||
      (b.freq ?? 0) - (a.freq ?? 0) ||
      a.path.localeCompare(b.path),
  )
  return out
}
