/**
 * Rendering an account path with the matched characters marked.
 *
 * `accountScorer` returns the indices it matched; this turns a path plus those indices into
 * per-character glyphs a template can style. Three distinctions matter, and all three come
 * from the path's structure rather than from the query:
 *
 *  - separators are punctuation, dimmed so the segments read as the words they are;
 *  - the leaf segment is the account's actual name, so it carries the weight;
 *  - matched characters are what the query earned, so they are marked.
 */

const SEP = ':'

export interface Glyph {
  ch: string
  /** The `:` between segments — punctuation, not content. */
  sep: boolean
  /** In the final segment, i.e. the account's own name rather than its ancestry. */
  leaf: boolean
  /** Matched by the query. */
  hl: boolean
}

export function glyphs(path: string, pos: readonly number[]): Glyph[] {
  const set = new Set(pos)
  const lastSep = path.lastIndexOf(SEP)
  const out: Glyph[] = []
  for (let i = 0; i < path.length; i++) {
    const ch = path[i]!
    if (ch === SEP) out.push({ ch, sep: true, leaf: false, hl: false })
    else out.push({ ch, sep: false, leaf: i > lastSep, hl: set.has(i) })
  }
  return out
}
