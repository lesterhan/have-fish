export function initials(name: string | null | undefined): string {
  return (
    (name ?? '')
      .split(' ')
      .map((w) => w[0] ?? '')
      .join('')
      .toUpperCase()
      .slice(0, 2) || '?'
  )
}

/**
 * The two members of a two-person group, or null when the group is any other size.
 *
 * Four screens make the split slider conditional on a group having exactly two members,
 * and each one wrote that as `members.length === 2` followed by `members[0]` — the same
 * question asked twice, the second time silently. This is the one place that answers it,
 * and what it hands back is the pair itself rather than a boolean the caller then has to
 * take on trust.
 */
export function memberPair<M>(members: readonly M[]): { first: M; second: M } | null {
  const [first, second] = members
  if (members.length !== 2 || first === undefined || second === undefined) return null
  return { first, second }
}
