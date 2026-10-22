// Writes drizzle/ into `main/db/migrations.ts`, because a packaged app has no folder to read.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Migration } from '../main/db/migrate'

/** drizzle-kit's output folder. */
export const DRIZZLE = fileURLToPath(new URL('../drizzle', import.meta.url))
const BUNDLE = fileURLToPath(new URL('../main/db/migrations.ts', import.meta.url))

/** The migrations in `folder`, in the order drizzle-kit's journal lists them. */
export function readMigrations(folder: string): Migration[] {
  const journal: { entries: { tag: string }[] } = JSON.parse(
    readFileSync(join(folder, 'meta/_journal.json'), 'utf8'),
  )
  return journal.entries.map(({ tag }) => ({
    tag,
    statements: readFileSync(join(folder, `${tag}.sql`), 'utf8')
      .split('--> statement-breakpoint')
      .map((sql) => sql.trim())
      .filter((sql) => sql !== ''),
  }))
}

function render(migrations: readonly Migration[]): string {
  return `// Generated from drizzle/ by \`bun run db:bundle\`. Don't edit it: change schema.ts, then run
// \`bun run db:generate --name <change>\` and \`bun run db:bundle\`.
import type { Migration } from './migrate'

export const MIGRATIONS: readonly Migration[] = ${JSON.stringify(migrations, null, 2)}
`
}

if (import.meta.main) writeFileSync(BUNDLE, render(readMigrations(DRIZZLE)))
