// The capture script: screenshots for design work, not a test. `bun run capture` builds the app
// first. Kept out of the e2e suite, so CI never runs it.

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['e2e/capture.ts'],
    hookTimeout: 60_000,
  },
})
