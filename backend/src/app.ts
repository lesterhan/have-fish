import { buildApp } from './build-app'
import { serverEdge } from './server-edge'

export type { AppVariables } from './build-app'

/**
 * The server build's app: what the hosted edition serves and what the test suite imports.
 * The local build makes its own from `buildApp` with the local edge (`local/launch.ts`), and
 * never loads this file, so it never constructs Better Auth.
 */
export const app = buildApp(serverEdge)
