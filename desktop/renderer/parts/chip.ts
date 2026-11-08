// A chip's keys: Enter saves what its editor holds, Escape puts it back and closes the editor.
// A key its editor already took (a picker's open list) isn't the chip's.

export type ChipKey = 'commit' | 'cancel' | null

export function chipKey(event: Pick<KeyboardEvent, 'key' | 'defaultPrevented'>): ChipKey {
  if (event.defaultPrevented) return null
  if (event.key === 'Enter') return 'commit'
  if (event.key === 'Escape') return 'cancel'
  return null
}
