import type { Bridge } from '../shared/commands'

declare global {
  interface Window {
    /** The preload's bridge to main: `preload/index.ts`. */
    haveFish: Bridge
  }
}

declare module '*.svelte' {
  import type { Component } from 'svelte'

  const component: Component
  export default component
}
