// Loaded before every test run (`bunfig.toml`): the suite runs with the network switched off
// (#287). The local build promises it needs nothing from the internet for the personal ledger,
// and this is where that promise is tested rather than asserted. `network.test.ts` limits which
// files may call out at all; this makes any call that does get made during a test fail loudly
// instead of quietly depending on a service being up.
//
// Loopback stays open: the launch test talks to a local build it started itself.

const realFetch = globalThis.fetch

async function fetchLoopbackOnly(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input.toString())
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
    return realFetch(input, init)
  }
  throw new Error(
    `a test reached the network (${url.origin}). The suite runs offline: stub the module that ` +
      'makes the call (fx/rate-source.ts is the only one today).',
  )
}

globalThis.fetch = Object.assign(fetchLoopbackOnly, { preconnect: realFetch.preconnect })
