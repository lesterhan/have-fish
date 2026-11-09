// The composer's rules, without a DOM: the parts in the order you think of them, where Tab goes,
// and the days its date list offers for what's typed. `parts/Composer.svelte` draws them.

import { addDays } from '@have-fish/core/calendar-date'
import { dateFrom } from '@have-fish/core/typed-date'

/** The parts, in the order you think of them. */
export const PARTS = ['from', 'date', 'amount', 'description', 'to'] as const

export type Part = (typeof PARTS)[number]

/** The part Tab goes to next, wrapping round at the end. */
export const after = (part: Part): Part => PARTS[(PARTS.indexOf(part) + 1) % PARTS.length] as Part

/** The part Shift+Tab goes to, wrapping round at the start. */
export const before = (part: Part): Part =>
  PARTS[(PARTS.indexOf(part) + PARTS.length - 1) % PARTS.length] as Part

/** The part the line starts in: the first one with nothing in it, else the amount. */
export function startPart(values: Readonly<Record<Part, string>>): Part {
  return PARTS.find((part) => values[part].trim() === '') ?? 'amount'
}

/**
 * The part carrying the Tab key. An empty part being typed in says where Tab would bring you;
 * a filled one passes the mark to the next still-empty part after it. None once they're all full.
 */
export function tabMark(active: Part, values: Readonly<Record<Part, string>>): Part | null {
  if (values[active].trim() === '') return active
  for (let i = PARTS.indexOf(active) + 1; i < PARTS.length; i++) {
    const part = PARTS[i] as Part
    if (values[part].trim() === '') return part
  }
  return null
}

/** A day the date list offers: the shorthand, and the day it means. */
export type DayChoice = { typed: string; date: string }

/** What an empty date field offers first: today, yesterday, and the shorthand to learn. */
const COMMON = ['today', 'y', '-2', 'mon', '10-31'] as const

/** Each weekday's shortest shorthand, Monday first. */
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

/**
 * The days the date list offers for `typed`, nearest first. An empty field teaches the common
 * shorthand; typing narrows them by their first letters, so `-` lists the last few days and
 * `mon` the Monday it means. The day a full date names is offered too, to confirm it.
 */
export function dateSuggestions(typed: string, today: string): DayChoice[] {
  const text = typed.trim().toLowerCase()
  if (text === '') return choices(COMMON, today)

  const found = new Map<string, DayChoice>()
  const add = (shorthand: string) => {
    const date = dateFrom(shorthand, today)
    if (date !== null && !found.has(date)) found.set(date, { typed: shorthand, date })
  }

  // What was typed, when it's already a day: `today`, `-3`, `mon`, `10-31`, `2026-11-09`.
  const typedDate = dateFrom(text, today)
  const direct = typedDate === null ? undefined : { typed: text, date: typedDate }
  if (direct !== undefined) found.set(direct.date, direct)

  // Every shorthand that starts with what's typed, over the last year, nearest first.
  for (const shorthand of COMMON) if (shorthand.startsWith(text)) add(shorthand)
  for (let n = 1; n <= 7; n++) if (`-${n}`.startsWith(text)) add(`-${n}`)
  for (let back = 0; back < 7; back++) {
    const date = addDays(today, -back)
    const shorthand = WEEKDAYS[weekdayOf(date)] as string
    if (shorthand.startsWith(text)) add(shorthand)
  }
  for (let back = 0; back < 366; back++) {
    const date = addDays(today, -back)
    const shorthand = shortMonthDay(date)
    if (shorthand.startsWith(text)) add(shorthand)
  }

  return [...found.values()]
    .filter((choice) => choice.date <= today)
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))
    .sort((a, b) => (a === direct ? -1 : b === direct ? 1 : 0))
    .slice(0, 5)
}

/** Choices for these shorthands, dropping ones that aren't a day or repeat another's. */
function choices(shorthands: readonly string[], today: string): DayChoice[] {
  const seen = new Set<string>()
  const list: DayChoice[] = []
  for (const typed of shorthands) {
    const date = dateFrom(typed, today)
    if (date === null || seen.has(date)) continue
    seen.add(date)
    list.push({ typed, date })
  }
  return list
}

/** 0 for Monday, as `WEEKDAYS` counts. */
function weekdayOf(date: string): number {
  // UTC, so the weekday doesn't move with the machine's zone.
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
}

/** `11-9`, without the leading zeros a typed date doesn't need. */
function shortMonthDay(date: string): string {
  return `${Number(date.slice(5, 7))}-${Number(date.slice(8, 10))}`
}
