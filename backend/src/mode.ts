/**
 * Which edition this process is (D7): `server` is the hosted edition, `local` the app on one
 * person's machine. `index.ts` reads it once, from `HAVEFISH_MODE`; unset means `server`, so
 * the hosted deployment needs no new variable.
 *
 * A file of its own because `index.ts` reads it before anything touches the database: the
 * local launcher has to say where the database file is first.
 */
export type Mode = 'server' | 'local'

export function readMode(value: string | undefined): Mode {
  if (value === undefined || value === '' || value === 'server') return 'server'
  if (value === 'local') return 'local'
  throw new Error(`HAVEFISH_MODE is "${value}"; it is "local" or "server"`)
}
