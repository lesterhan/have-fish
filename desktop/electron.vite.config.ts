// How `electron-vite` builds the app's three parts into out/: main (Node), the preload (a
// sandboxed script) and the renderer (the page, with Svelte).

import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      // Bundled, so the packaged app ships only what can't be: better-sqlite3's native binary.
      externalizeDeps: { exclude: ['@have-fish/core', 'drizzle-orm', 'zod'] },
      rollupOptions: {
        input: { index: resolve('main/index.ts') },
        onwarn(warning, warn) {
          // Comments in zod that Rollup can't place; it drops them, and the bundle is fine.
          if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('/zod/')) return
          warn(warning)
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve('preload/index.ts') },
        // A sandboxed preload can't be an ES module.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'renderer',
    plugins: [svelte({ configFile: false })],
    build: {
      rollupOptions: { input: resolve('renderer/index.html') },
      // Every asset a file of its own: a small font inlined as a data: URL breaks the CSP.
      assetsInlineLimit: 0,
    },
  },
})
