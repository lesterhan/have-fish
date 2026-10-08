// A valid account path is colon-segmented with no empty segments and no surrounding
// whitespace: it refuses '', ':x', 'x:' and 'x::y'.
export function isValidPath(path: string): boolean {
  if (path !== path.trim() || path.length === 0) return false
  return path.split(':').every((seg) => seg.length > 0 && seg === seg.trim())
}
