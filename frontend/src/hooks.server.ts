import type { Handle } from '@sveltejs/kit'

const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? 'http://localhost:8887'

export const handle: Handle = async ({ event, resolve }) => {
  // Proxy all /api/* requests to the backend, keeping a
  // single ingress point at the frontend port.
  if (event.url.pathname.startsWith('/api/')) {
    const url = `${INTERNAL_API_URL}${event.url.pathname}${event.url.search}`
    const request = new Request(url, {
      method: event.request.method,
      headers: event.request.headers,
      body: ['GET', 'HEAD'].includes(event.request.method) ? undefined : event.request.body,
      // @ts-expect-error — duplex required for streaming request bodies in Node 18+
      duplex: 'half',
    })
    return fetch(request)
  }

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
