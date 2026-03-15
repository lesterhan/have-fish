import type { Handle } from '@sveltejs/kit'

export const handle: Handle = async ({ event, resolve }) => {
  const response = await fetch(
    `${import.meta.env.VITE_API_URL}/api/auth/get-session`,
    { headers: { cookie: event.request.headers.get('cookie') ?? '' } }
  )

  if (response.ok) {
    event.locals.session = await response.json()
  } else {
    event.locals.session = null
  }

  return resolve(event)
}
