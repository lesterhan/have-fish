import { useEffect, useState } from 'react'
import { View, Text, TextInput, StyleSheet, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { getEmail, getBaseUrl, setBaseUrl, clearSession } from '@/lib/auth'
import { ScreenHeader } from '@/components/ScreenHeader'
import { Button } from '@/components/Button'
import { theme, cardStyle } from '@/lib/theme'

/**
 * Settings screen.
 *
 * TODO:
 * - Show offline queue length with a "Clear queue" button
 * - Add a "Test connection" button that pings /api/health (or any unauthenticated endpoint)
 */
export default function SettingsScreen() {
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)
  const [serverUrl, setServerUrlState] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    async function load() {
      const [e, u] = await Promise.all([getEmail(), getBaseUrl()])
      setEmail(e)
      if (u) setServerUrlState(u)
    }
    load()
  }, [])

  async function handleSaveUrl() {
    await setBaseUrl(serverUrl.trim())
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
    <View style={styles.container}>
      <ScreenHeader title="Settings" onBack={() => router.back()} />

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Signed in as</Text>
          <Text style={styles.rowValue}>{email ?? '—'}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Server</Text>
        <Text style={styles.inputLabel}>Backend URL</Text>
        <TextInput
          style={styles.input}
          value={serverUrl}
          onChangeText={setServerUrlState}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://myserver:8887"
        />
        <Button
          title={saved ? 'Saved ✓' : 'Save URL'}
          size="sm"
          onPress={handleSaveUrl}
          style={styles.saveButton}
        />
      </View>

      <View style={styles.section}>
        <Button title="Sign out" variant="danger" onPress={handleLogout} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.desktop },
  section: {
    ...cardStyle,
    marginHorizontal: theme.sp.md,
    marginTop: theme.sp.md,
    padding: theme.sp.md,
  },
  sectionLabel: {
    fontSize: theme.text.xs,
    fontWeight: theme.weight.semibold,
    color: theme.color.textMuted,
    textTransform: 'uppercase',
    marginBottom: theme.sp.xs,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  rowLabel: { fontSize: theme.text.sm, color: theme.color.text },
  rowValue: { fontSize: theme.text.sm, color: theme.color.textMuted },
  inputLabel: { fontSize: theme.text.sm, color: theme.color.text, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: theme.color.rule,
    borderRadius: theme.radius.lg,
    padding: theme.sp.sm,
    fontSize: theme.text.sm,
    backgroundColor: theme.color.windowInset,
    marginBottom: theme.sp.xs,
  },
  saveButton: { alignSelf: 'flex-start' },
})
