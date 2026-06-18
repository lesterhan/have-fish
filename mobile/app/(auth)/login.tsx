import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import { signIn, setBaseUrl, setSession } from '@/lib/auth'
import { Button } from '@/components/Button'
import { theme, cardStyle } from '@/lib/theme'

/**
 * Login screen — first launch asks for server URL + credentials.
 *
 * TODO:
 * - Validate that the URL looks like http(s)://... before attempting sign-in
 * - Show a "forgot password" note (Better Auth supports reset flows if configured)
 * - On success navigate to /(app) and let the root layout handle redirect
 */
export default function LoginScreen() {
  const router = useRouter()
  const [serverUrl, setServerUrl] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogin() {
    setError(null)
    setLoading(true)
    try {
      const url = serverUrl.trim().replace(/\/$/, '')
      const cookie = await signIn(url, email.trim(), password)
      await setBaseUrl(url)
      await setSession(cookie, email.trim())
      router.replace('/(app)')
    } catch (e: any) {
      setError(e.message ?? 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.card}>
        <Text style={styles.title}>有鱼 · have-fish</Text>
        <Text style={styles.subtitle}>Pocket Companion</Text>

        <Text style={styles.label}>Server URL</Text>
        <TextInput
          style={styles.input}
          value={serverUrl}
          onChangeText={setServerUrl}
          placeholder="http://myserver:8887"
          placeholderTextColor={theme.color.textDisabled}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={theme.color.textDisabled}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
          placeholderTextColor={theme.color.textDisabled}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          title="Sign in"
          onPress={handleLogin}
          loading={loading}
          style={styles.button}
        />
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.color.desktop,
    justifyContent: 'center',
    padding: theme.sp.lg,
  },
  card: {
    ...cardStyle,
    padding: theme.sp.lg,
  },
  title: {
    fontSize: theme.text['2xl'],
    fontWeight: theme.weight.semibold,
    marginBottom: 4,
    color: theme.color.text,
  },
  subtitle: {
    fontSize: theme.text.sm,
    color: theme.color.textMuted,
    marginBottom: theme.sp.lg,
  },
  label: {
    fontSize: theme.text.sm,
    fontWeight: theme.weight.semibold,
    color: theme.color.text,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.color.rule,
    borderRadius: theme.radius.lg,
    padding: theme.sp.sm,
    fontSize: theme.text.base,
    marginBottom: theme.sp.md,
    backgroundColor: theme.color.windowInset,
  },
  error: {
    color: theme.color.danger,
    fontSize: theme.text.sm,
    marginBottom: theme.sp.sm,
  },
  button: {
    marginTop: 4,
  },
})
