// Builds the parts sheet into sheet-out/, never out/: electron-builder ships out/, and the sheet
// is for the capture script only. It shares the renderer's Svelte plugin, fonts and tokens.

import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export const SHEET_OUT = resolve(import.meta.dirname, 'sheet-out')

export default defineConfig({
  root: resolve(import.meta.dirname, 'sheet'),
  base: './',
  plugins: [svelte({ configFile: false })],
  build: { outDir: SHEET_OUT, emptyOutDir: true, assetsInlineLimit: 0 },
})
