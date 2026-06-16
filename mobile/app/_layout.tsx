import { useEffect, useState } from 'react'
import { Slot, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { isAuthenticated } from '@/lib/auth'
import { flushOfflineQueue } from '@/lib/api'

/**
 * Root layout — guards the entire app behind authentication.
 *
 * Flow:
 * - On mount, check SecureStore for a session + base URL.
 * - If missing, redirect to /(auth)/login.
 * - If present, stay in /(app)/.
 * - Once inside /(app), attempt to flush any offline-queued requests.
 */
export default function RootLayout() {
  const router = useRouter()
  const segments = useSegments()
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    async function bootstrap() {
      try {
        const authed = await isAuthenticated()
        const inAuthGroup = segments[0] === '(auth)'

        if (!authed && !inAuthGroup) {
          router.replace('/(auth)/login')
        } else if (authed && inAuthGroup) {
          router.replace('/(app)')
        }

        if (authed) {
          // Best-effort: flush queued offline requests on startup
          flushOfflineQueue().catch(() => null)
        }
      } catch {
        // SecureStore can throw (e.g. keystore unavailable). Fall back to the
        // login screen rather than leaving the app stuck on a blank null render.
        router.replace('/(auth)/login')
      } finally {
        // Always flip `checked` so the navigator mounts — a thrown bootstrap must
        // never leave the root rendering `null` forever (the old blank-screen bug).
        setChecked(true)
      }
    }
    bootstrap()
  }, [])

  if (!checked) return null

  return (
    <>
      <StatusBar style="dark" />
      <Slot />
    </>
  )
}
