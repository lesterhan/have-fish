import * as SecureStore from 'expo-secure-store'

const KEY_BASE_URL = 'havefish_base_url'
const KEY_SESSION = 'havefish_session'
const KEY_EMAIL = 'havefish_email'

export async function getBaseUrl(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_BASE_URL)
}

export async function setBaseUrl(url: string): Promise<void> {
  // Normalise: strip trailing slash
  await SecureStore.setItemAsync(KEY_BASE_URL, url.replace(/\/$/, ''))
}

export async function getSession(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_SESSION)
}

export async function setSession(cookie: string, email: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEY_SESSION, cookie),
    SecureStore.setItemAsync(KEY_EMAIL, email),
  ])
}

export async function getEmail(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_EMAIL)
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY_SESSION),
    SecureStore.deleteItemAsync(KEY_EMAIL),
  ])
}

export async function isAuthenticated(): Promise<boolean> {
  const [url, session] = await Promise.all([getBaseUrl(), getSession()])
  return Boolean(url && session)
}

/**
 * Sign in via Better Auth. Returns the raw Set-Cookie string on success,
 * throws on failure.
 */
export async function signIn(baseUrl: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as any).message ?? 'Sign in failed')
  }

  // React Native fetch exposes Set-Cookie via the headers map
  const cookie = res.headers.get('set-cookie')
  if (!cookie) throw new Error('No session cookie received')
  return cookie
}
