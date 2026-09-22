import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 8888,
    // `hooks.server.ts` used to proxy these. It is gone, and with it the SvelteKit server,
    // so in dev Vite forwards /api to the backend instead. `changeOrigin` stays false on
    // purpose: Better Auth checks the Origin header against its trusted origins, and
    // rewriting it to the backend's host would fail that check on every sign-in.
    proxy: {
      '/api': {
        // Dev only. Production has no Vite; the compose variable of the same name is
        // gone with the SvelteKit server that used it.
        target: process.env.HAVEFISH_DEV_API_URL ?? 'http://localhost:8887',
        changeOrigin: false,
      },
    },
  },
})
