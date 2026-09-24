import { log } from './logging'
import { createServer, hasFrontend } from './server'

// Where the built frontend lives. In the image it sits beside the backend source; a plain
// `bun run dev` usually has nothing there, and the server then serves the API alone while
// Vite serves the frontend.
const STATIC_ROOT = process.env.HAVEFISH_STATIC_ROOT ?? './public'

if (!(await hasFrontend(STATIC_ROOT))) {
  log.info({ staticRoot: STATIC_ROOT }, 'no frontend build found; serving the API only')
}

export default {
  port: process.env.PORT ?? 3001,
  fetch: (await createServer(STATIC_ROOT)).fetch,
}
