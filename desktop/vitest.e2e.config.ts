// The end-to-end suite: the built app, started by Playwright. `bun run e2e` builds it first.
// It needs a display; on a Linux machine without one, run it under `xvfb-run -a`.

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
