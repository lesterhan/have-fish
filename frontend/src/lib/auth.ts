import { createAuthClient } from 'better-auth/svelte'

// The auth client talks to /api/auth/* on the same origin as the frontend.
export const authClient = createAuthClient({})

export const { signIn, signUp, signOut, useSession } = authClient
