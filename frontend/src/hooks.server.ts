import type { Handle } from '@sveltejs/kit'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import zlib from 'node:zlib'

const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? 'http://localhost:8887'

// Content types worth compressing. Images, fonts and archives are already compressed —
// running them through gzip burns CPU to make them marginally larger.
const COMPRESSIBLE =
  /^(?:text\/|application\/(?:json|javascript|xml|manifest\+json)|image\/svg\+xml)/

// Below this the framing overhead and the CPU cost outweigh the saving.
const MIN_COMPRESS_BYTES = 1024

/**
 * The client's preferred encoding among the ones we can produce, or null if it wants none.
 * Brotli first: at the quality used below it lands ~15% under gzip, and on a link where
 * bytes cost more than CPU that difference is the whole point.
 */
function pickEncoding(accept: string | null): 'br' | 'gzip' | null {
  if (!accept) return null
  const offered = new Set<string>()
  for (const part of accept.toLowerCase().split(',')) {
    const [token, ...params] = part.trim().split(';')
    // `q=0` is an explicit refusal of that encoding, not an offer.
    if (params.some((p) => /^q=0(?:\.0+)?$/.test(p.replace(/\s/g, '')))) continue
    offered.add(token.trim())
  }
  if (offered.has('br')) return 'br'
  if (offered.has('gzip')) return 'gzip'
  return null
}

function compressBody(
  body: ReadableStream<Uint8Array>,
  encoding: 'br' | 'gzip',
): ReadableStream<Uint8Array> {
  const engine =
    encoding === 'br'
      ? zlib.createBrotliCompress({
          params: {
            // Brotli's default quality is 11, which is built for build-time assets, not for
            // recompressing a payload on every request. 4 keeps most of the ratio for a
            // small fraction of the CPU.
            [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
            [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
          },
        })
      : zlib.createGzip({ level: 6 })

  // The DOM and node:stream/web ReadableStream types don't structurally overlap, though the
  // objects are interchangeable at runtime — hence the casts on both ends of the pipe.
  const source = body as unknown as NodeReadableStream<Uint8Array>
  const compressed = Readable.fromWeb(source).pipe(engine)
  return Readable.toWeb(compressed) as unknown as ReadableStream<Uint8Array>
}

/**
 * Compresses a response when the client asked for it and the payload is worth it.
 *
 * Static assets are already precompressed at build time by adapter-node, but the two
 * things that dominate a page load here — the SSR HTML and the JSON proxied from the
 * backend — were going out raw. Transaction JSON is highly repetitive (UUIDs, repeated
 * account paths, ISO dates) and compresses by roughly an order of magnitude, which is
 * the difference between a fast page and a slow one on a long-haul connection. There is
 * no reverse proxy in front of the app, so this is the only place it can happen.
 */
function maybeCompress(request: Request, response: Response): Response {
  if (!response.body) return response
  // Never double-encode something upstream already encoded.
  if (response.headers.has('content-encoding')) return response

  const type = response.headers.get('content-type')
  if (!type || !COMPRESSIBLE.test(type)) return response

  // A known-small body isn't worth it. A *missing* content-length means a streamed response
  // of unknown size, which is exactly where compression pays — so those go through. (Testing
  // `Number(null)` here would read as 0 and skip every streamed response.)
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null && Number(declaredLength) < MIN_COMPRESS_BYTES) return response

  const encoding = pickEncoding(request.headers.get('accept-encoding'))
  if (!encoding) return response

  const headers = new Headers(response.headers)
  headers.set('content-encoding', encoding)
  // The compressed size isn't known until the stream ends.
  headers.delete('content-length')
  const vary = headers.get('vary')
  if (!vary) headers.set('vary', 'Accept-Encoding')
  else if (!/\baccept-encoding\b/i.test(vary)) headers.set('vary', `${vary}, Accept-Encoding`)

  return new Response(compressBody(response.body, encoding), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export const handle: Handle = async ({ event, resolve }) => {
  // Sub-requests are `event.fetch` calls from server `load` functions. They never reach a
  // browser — the load function reads the body directly — so compressing them would just
  // hand it bytes it has to inflate again.
  const finish = (response: Response) =>
    event.isSubRequest ? response : maybeCompress(event.request, response)

  // Proxy all /api/* requests to the backend, keeping a
  // single ingress point at the frontend port.
  if (event.url.pathname.startsWith('/api/')) {
    const url = `${INTERNAL_API_URL}${event.url.pathname}${event.url.search}`
    const headers = new Headers(event.request.headers)
    // The backend hop is loopback (or container-local), where compression buys nothing and
    // would force an inflate/deflate cycle here. Ask it for plain bytes and encode once, at
    // the edge, against what the real client accepts.
    headers.delete('accept-encoding')
    const request = new Request(url, {
      method: event.request.method,
      headers,
      body: ['GET', 'HEAD'].includes(event.request.method)
        ? undefined
        : event.request.body,
      // @ts-expect-error — duplex required for streaming request bodies in Node 18+
      duplex: 'half',
    })
    return finish(await fetch(request))
  }

  const response = await fetch(`${INTERNAL_API_URL}/api/auth/get-session`, {
    headers: { cookie: event.request.headers.get('cookie') ?? '' },
  })

  if (response.ok) {
    event.locals.session = await response.json()
  } else {
    event.locals.session = null
  }

  return finish(await resolve(event))
}
