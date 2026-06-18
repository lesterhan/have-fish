import { useEffect, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import { getEmail, getBaseUrl, setBaseUrl, clearSession } from '@/lib/auth'
import { ScreenHeader } from '@/components/ScreenHeader'
import { theme } from '@/lib/theme'

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
      <ScreenHeader title="Settings" />

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
        <TouchableOpacity style={styles.saveButton} onPress={handleSaveUrl}>
          <Text style={styles.saveButtonText}>{saved ? 'Saved ✓' : 'Save URL'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.desktop },
  section: {
    backgroundColor: '#fff',
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#e0e0e0',
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#666',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  rowLabel: { fontSize: 14, color: '#444' },
  rowValue: { fontSize: 14, color: '#888' },
  inputLabel: { fontSize: 13, color: '#444', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    padding: 10,
    fontSize: 14,
    backgroundColor: '#fafafa',
    marginBottom: 10,
  },
  saveButton: {
    backgroundColor: '#2563eb',
    borderRadius: 6,
    padding: 10,
    alignItems: 'center',
  },
  saveButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  logoutButton: {
    padding: 12,
    alignItems: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e74c3c',
  },
  logoutText: { color: '#e74c3c', fontWeight: '600', fontSize: 14 },
})
