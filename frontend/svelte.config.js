import adapter from '@sveltejs/adapter-static'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

export default {
  preprocess: vitePreprocess(),
  kit: {
    // A single-page app: no prerendering, no server. `fallback` is the document every
    // unknown path is served, which is what lets client-side routing own every route
    // without the host needing to know them.
    adapter: adapter({ fallback: 'index.html' }),
  },
}
