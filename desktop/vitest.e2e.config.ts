// The end-to-end suite: the built app, started by Playwright. `bun run e2e` builds it first.
// It needs an X display; on a Linux machine without one, run it under `xvfb-run -a`. The shortcut
// tests also need xdotool, since the menu never sees keys Playwright sends.

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.ts'],
    // The slowest test that passes takes about 5s, so a broken one fails in seconds, not a minute.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    fileParallelism: false,
  },
})
