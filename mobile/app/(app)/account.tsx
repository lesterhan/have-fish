import { useEffect, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { addServer, clearSession, getBaseUrl, getEmail, setBaseUrl } from '@/lib/auth'
import { composeServerUrl, DEFAULT_PORT, parseServerUrl, type Scheme } from '@/lib/server-url'
import * as haptics from '@/lib/haptics'
import { theme } from '@/lib/theme'
import { Button } from '@/components/Button'
import { GlossButton } from '@/components/GlossButton'
import { ServerAddressFields } from '@/components/ServerAddressFields'
import { SettingsCard, SettingsRow } from '@/components/SettingsCard'

/**
 * Account & app settings — the rightmost shell tab. Device/account config that
 * isn't tied to a group: signed-in identity, the backend URL, app preferences,
 * and sign-out. The future home for more app-level settings.
 */
export default function AccountScreen() {
  const router = useRouter()
  const [email, setEmailState] = useState<string | null>(null)
  const [scheme, setScheme] = useState<Scheme>('http')
  const [host, setHost] = useState('')
  const [port, setPort] = useState(DEFAULT_PORT)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hapticsOn, setHapticsOn] = useState(haptics.isHapticsEnabled())

  useEffect(() => {
    async function load() {
      const [e, u, raw] = await Promise.all([
        getEmail(),
        getBaseUrl(),
        AsyncStorage.getItem(haptics.HAPTICS_ENABLED_KEY),
      ])
      setEmailState(e)
      if (u) {
        const parts = parseServerUrl(u)
        setScheme(parts.scheme)
        setHost(parts.host)
        setPort(parts.port || DEFAULT_PORT)
      }
      setHapticsOn(haptics.parseHapticsEnabled(raw))
    }
    load()
  }, [])

  async function toggleHaptics(value: boolean) {
    setHapticsOn(value)
    await haptics.setHapticsEnabled(value)
    if (value) haptics.selection() // buzz once so the change is felt immediately
  }

  async function handleSaveUrl() {
    const url = composeServerUrl({ scheme, host, port })
    if (!url) {
      setError('Enter a server address')
      return
    }
    setError(null)
    await setBaseUrl(url)
    await addServer(url)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function handleLogout() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await clearSession()
          router.replace('/(auth)/login')
        },
      },
    ])
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SettingsCard title="Account">
        <SettingsRow label="Signed in as" value={email ?? '—'} />
      </SettingsCard>

      <SettingsCard title="Server" caption="The backend this app talks to.">
        <View style={styles.field}>
          <ServerAddressFields
            scheme={scheme}
            host={host}
            port={port}
            onScheme={setScheme}
            onHost={setHost}
            onPort={setPort}
          />
          {error != null && <Text style={styles.error}>{error}</Text>}
          <GlossButton
            label={saved ? '✓ Saved' : 'Save URL'}
            success={saved}
            onPress={handleSaveUrl}
            height={42}
            style={styles.saveBtn}
          />
        </View>
      </SettingsCard>

      <SettingsCard title="Preferences">
        <View style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <Text style={styles.toggleLabel}>Haptics</Text>
            <Text style={styles.toggleHint}>Subtle vibration on the numpad and buttons</Text>
          </View>
          <Switch
            value={hapticsOn}
            onValueChange={toggleHaptics}
            trackColor={{ true: theme.color.accent, false: theme.color.line }}
            thumbColor={theme.color.surface}
          />
        </View>
      </SettingsCard>

      <Button title="Sign out" variant="danger" onPress={handleLogout} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.appBg },
  content: { padding: theme.sp.md, gap: theme.sp.md, paddingBottom: theme.sp.xl },

  field: { paddingVertical: theme.sp.sm, gap: theme.sp.sm },
  error: { fontFamily: theme.font.sans, fontSize: theme.text.sm, color: theme.color.red },
  saveBtn: { alignSelf: 'flex-start', minWidth: 120, marginTop: theme.sp[4] },

  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: theme.sp.sm, gap: theme.sp.sm },
  toggleText: { flex: 1 },
  toggleLabel: { fontFamily: theme.font.sans, fontSize: 14.5, color: theme.color.ink },
  toggleHint: { fontFamily: theme.font.mono, fontSize: 10.5, color: theme.color.ink3, marginTop: 2 },
})
