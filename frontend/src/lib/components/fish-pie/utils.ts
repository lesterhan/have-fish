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
