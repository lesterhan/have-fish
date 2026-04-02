import type { Handle } from '@sveltejs/kit'

const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? import.meta.env.VITE_API_URL ?? 'http://localhost:8887'

export const handle: Handle = async ({ event, resolve }) => {
  const response = await fetch(
    `${INTERNAL_API_URL}/api/auth/get-session`,
    { headers: { cookie: event.request.headers.get('cookie') ?? '' } }
  )

  if (response.ok) {
    event.locals.session = await response.json()
  } else {
    event.locals.session = null
  }

  return resolve(event)
}
