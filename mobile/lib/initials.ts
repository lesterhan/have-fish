/**
 * Member initials for `Avatar`. One letter for a single name, two for multi-word
 * names (first + last). Falls back to `?` for an empty/whitespace name so an
 * avatar never renders blank.
 */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase()
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase()
}
