import { createAuthClient } from 'better-auth/svelte'

// Talks to the Better Auth handler mounted at /api/auth on the backend.
// VITE_API_URL must be set in frontend .env (e.g. http://localhost:3001)
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL,
})

export const { signIn, signUp, signOut, useSession } = authClient
