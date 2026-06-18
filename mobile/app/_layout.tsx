import { useEffect, useState } from 'react'
import { useFonts } from 'expo-font'
import { Slot, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { isAuthenticated } from '@/lib/auth'
import { flushOfflineQueue } from '@/lib/api'
import { loadHapticsEnabled } from '@/lib/haptics'
import { fontAssets } from '@/lib/fonts'

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
  const [fontsLoaded] = useFonts(fontAssets)

  useEffect(() => {
    async function bootstrap() {
      try {
        // Hydrate the haptics preference before any tactile UI can fire.
        loadHapticsEnabled()

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

  // Gate the navigator on both the auth check and the bundled fonts so the UI
  // never flashes a system-font frame before the Companion faces are ready.
  if (!checked || !fontsLoaded) return null

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Slot />
    </SafeAreaProvider>
  )
}
