// svelte-check needs TypeScript 5's API, and the repo's `typescript` is 7: this sends its
// imports of `typescript` to `typescript5`, the 5.9 the repo already installs.

import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, next) {
    const ts = /^typescript(\/.*)?$/.exec(specifier)
    if (ts === null) return next(specifier, context)
    return next(`typescript5${ts[1] ?? ''}`, { ...context, parentURL: import.meta.url })
  },
})
