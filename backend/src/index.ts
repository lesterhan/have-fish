import { log } from './logging'
import { readMode } from './mode'

// Where the built frontend lives. In the image it sits beside the backend source; a plain
// `bun run dev` usually has nothing there, and the server then serves the API alone while
// Vite serves the frontend.
const STATIC_ROOT = process.env.HAVEFISH_STATIC_ROOT ?? './public'

// Read once, here (D7). The local build starts its own server on 127.0.0.1 and exports
// nothing; the server build hands Bun its fetch handler as it always has.
const mode = readMode(process.env.HAVEFISH_MODE)

async function serverEntry() {
  const { app } = await import('./app')
  const { createServer, hasFrontend } = await import('./server')
  if (!(await hasFrontend(STATIC_ROOT))) {
    log.info({ staticRoot: STATIC_ROOT }, 'no frontend build found; serving the API only')
  }
  return {
    port: process.env.PORT ?? 3001,
    fetch: (await createServer(app, STATIC_ROOT)).fetch,
  }
}

if (mode === 'local') {
  const { launchLocal } = await import('./local/launch')
  await launchLocal(STATIC_ROOT)
}

export default mode === 'server' ? await serverEntry() : undefined
