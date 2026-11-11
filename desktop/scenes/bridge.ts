// The stand-in for `window.haveFish`, so the real window runs in a browser tab: reads are
// answered from a recorded fixture, and anything else is refused as a command the bridge
// doesn't know, which the window already has words for. Nothing here writes.

import type {
  Bridge,
  CommandName,
  DayNet,
  InputOf,
  ListedTransaction,
  Values,
  Wire,
  WireFailure,
} from '../shared/commands'
import type { Density } from '../shared/density'
import type { Fixture } from './fixture'

/** The bridge, plus what only a scene needs: `act` sends an action as the menu would. */
export type Replay = Bridge & { act(id: string): void }

type Reply<N extends CommandName> = (input: InputOf<N>) => Wire<Values[N]>

/** The commands a scene answers from the fixture; every other command is refused. */
const ANSWERED = [
  'transaction.page',
  'transaction.position',
  'transaction.days',
  'transaction.get',
  'account.list',
  'path.list',
  'report.spending',
  'spend.assumedFrom',
  'ledger.steps',
  'settings.density.get',
  'settings.density.set',
  'settings.theme.set',
  'clipboard.copy',
] as const satisfies readonly CommandName[]
type Answered = (typeof ANSWERED)[number]

/** The writes: refused as unknown, since the stand-in doesn't know how to save. */
const REFUSED = [
  'spend.write',
  'spend.edit',
  'spend.remove',
  'account.add',
  'account.start',
  'ledger.undo',
  'ledger.redo',
] as const satisfies readonly CommandName[]
type Refused = (typeof REFUSED)[number]

// Every command is answered or refused: one added to `inputs` is in neither list, and this
// stops compiling until it joins one. Exported so it is a used name.
export const handled: Record<Exclude<CommandName, Answered | Refused>, never> = {}

/** The bridge over `fixture`: the window can't tell it from main. */
export function replayBridge(
  fixture: Fixture,
  options?: { density?: Density | undefined },
): Replay {
  let density: Density = options?.density ?? 'regular'
  const actionListeners = new Set<(id: string) => void>()

  const answers: { [N in Answered]?: Reply<N> } = {
    'transaction.page': ({ from, limit }) => {
      const rows = fixture.rows.slice(from, from + limit)
      return {
        ok: true,
        value: { total: fixture.rows.length, from, rows, nets: netsOn(fixture, rows) },
      }
    },
    'transaction.position': ({ id }) => {
      const at = fixture.rows.findIndex((row) => row.id === id)
      return { ok: true, value: { at: at === -1 ? null : at } }
    },
    'transaction.get': ({ ids }) => ({
      ok: true,
      value: fixture.rows.filter((row) => ids.includes(row.id)),
    }),
    'transaction.days': () => ({ ok: true, value: fixture.days }),
    'account.list': () => ({ ok: true, value: fixture.accounts }),
    'path.list': () => ({ ok: true, value: fixture.paths }),
    'spend.assumedFrom': () => ({ ok: true, value: { id: fixture.assumedFrom } }),
    'report.spending': ({ start }) => ({
      ok: true,
      value: fixture.reports[start] ?? { currency: fixture.currency, spent: [], other: [] },
    }),
    'ledger.steps': () => ({ ok: true, value: { undo: null, redo: null } }),
    'settings.density.get': () => ({ ok: true, value: { density } }),
    'settings.density.set': ({ density: next }) => {
      density = next
      return { ok: true, value: { density: next } }
    },
    'settings.theme.set': ({ theme }) => ({ ok: true, value: { theme } }),
    'clipboard.copy': () => ({ ok: true, value: null }),
  }

  return {
    invoke(name, input) {
      // tsc can't tie `input` to `name`'s own reply; the two lists above did.
      const reply = (answers as Partial<{ [N in CommandName]: Reply<N> }>)[name]
      return Promise.resolve(reply === undefined ? unknown(name) : reply(input))
    },
    onChanged: () => () => {},
    onAction: (listener) => {
      actionListeners.add(listener)
      return () => actionListeners.delete(listener)
    },
    setTyping: () => {},
    act: (id) => {
      for (const listener of actionListeners) listener(id)
    },
  }
}

/** The nets of the days these rows fall on, in the fixture's order; no other day's. */
function netsOn(fixture: Fixture, rows: readonly ListedTransaction[]): DayNet[] {
  const dates = new Set(rows.map((row) => row.date))
  return fixture.nets.filter((net) => dates.has(net.date))
}

/** The refusal a write gets, in the shape the window already has words for. */
const unknown = (name: string): WireFailure => ({
  ok: false,
  error: 'COMMAND_UNKNOWN',
  detail: { name },
})
