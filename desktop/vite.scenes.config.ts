// Builds the scenes into scenes-out/, never out/: electron-builder ships out/, and the scenes
// are for the e2e suite and design work only. It shares the renderer's Svelte plugin, fonts and
// tokens.

import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export const SCENES_OUT = resolve(import.meta.dirname, 'scenes-out')

export default defineConfig({
  root: resolve(import.meta.dirname, 'scenes'),
  base: './',
  plugins: [svelte({ configFile: false })],
  build: { outDir: SCENES_OUT, emptyOutDir: true, assetsInlineLimit: 0 },
})
