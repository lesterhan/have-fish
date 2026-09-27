// The backend's one outbound call: a published daily rate from frankfurter.app.
//
// Everything else the app knows it knows from its own database. This is the single place
// that reaches the network, so an offline build, or a test, stubs this and nothing else.
// Not a `-service`: it touches no database; `rate-service.ts` caches what it returns.

/**
 * The ECB rate for one day, `base` → `quote`, or null when the source has none (weekends
 * and holidays) or answers with an error. The date goes into the path of the URL, so the
 * caller checks it is a date before it gets here.
 */
export async function fetchPublishedRate(
  date: string,
  base: string,
  quote: string,
): Promise<number | null> {
  // Response shape: { amount: 1, base: "EUR", date: "2024-01-15", rates: { "CAD": 1.4732 } }
  const res = await fetch(`https://api.frankfurter.app/${date}?from=${base}&to=${quote}`)
  if (!res.ok) return null

  const json = (await res.json()) as { rates?: Record<string, number> }
  return json.rates?.[quote] ?? null
}
