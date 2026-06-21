import { useEffect, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { addServer, getServers, removeServer, setBaseUrl, setSession, signIn } from '@/lib/auth'
import {
  composeServerUrl,
  DEFAULT_PORT,
  parseServerUrl,
  type Scheme,
} from '@/lib/server-url'
import { GlossButton } from '@/components/GlossButton'
import { GlossSurface } from '@/components/GlossSurface'
import { theme } from '@/lib/theme'

const SCHEMES: Scheme[] = ['http', 'https']

/**
 * Login screen — first launch (and every re-login) asks for the self-hosted
 * server address + credentials. The address is entered as a scheme toggle +
 * host + port (port prefilled to the app's standard backend port) and
 * previously-used servers are remembered for one-tap re-selection, so returning
 * users rarely hand-type the whole URL.
 */
export default function LoginScreen() {
  const router = useRouter()
  const [scheme, setScheme] = useState<Scheme>('http')
  const [host, setHost] = useState('')
  const [port, setPort] = useState(DEFAULT_PORT)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [servers, setServers] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getServers().then(setServers)
  }, [])

  function pickServer(url: string) {
    const parts = parseServerUrl(url)
    setScheme(parts.scheme)
    setHost(parts.host)
    setPort(parts.port || DEFAULT_PORT)
    setError(null)
  }

  async function forgetServer(url: string) {
    await removeServer(url)
    setServers((prev) => prev.filter((s) => s !== url))
  }

  async function handleLogin() {
    setError(null)
    const url = composeServerUrl({ scheme, host, port })
    if (!url) {
      setError('Enter a server address')
      return
    }
    setLoading(true)
    try {
      const trimmedEmail = email.trim()
      const cookie = await signIn(url, trimmedEmail, password)
      await setBaseUrl(url)
      await setSession(cookie, trimmedEmail)
      await addServer(url)
      router.replace('/(app)')
    } catch (e: any) {
      setError(e?.message ?? 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <GlossSurface radius={theme.radius.card} style={styles.card}>
          <Text style={styles.title}>有鱼 · have-fish</Text>
          <Text style={styles.subtitle}>Pocket Companion</Text>

          {servers.length > 0 && (
            <View style={styles.recents}>
              <Text style={styles.label}>Recent servers</Text>
              {servers.map((url) => {
                const current = composeServerUrl({ scheme, host, port })
                const active = url === current
                return (
                  <View key={url} style={styles.recentRow}>
                    <Pressable style={styles.recentPick} onPress={() => pickServer(url)}>
                      <GlossSurface
                        base={active ? theme.color.accentSoft : theme.color.surface2}
                        radius={theme.radius.chip}
                        elevated={false}
                        style={styles.recentChip}
                      >
                        <Text
                          style={[styles.recentText, active && styles.recentTextActive]}
                          numberOfLines={1}
                        >
                          {url}
                        </Text>
                      </GlossSurface>
                    </Pressable>
                    <Pressable
                      style={styles.forget}
                      hitSlop={8}
                      onPress={() => forgetServer(url)}
                      accessibilityLabel={`Forget ${url}`}
                    >
                      <Text style={styles.forgetText}>✕</Text>
                    </Pressable>
                  </View>
                )
              })}
            </View>
          )}

          <Text style={styles.label}>Server</Text>
          <View style={styles.scheme}>
            {SCHEMES.map((s) => {
              const active = s === scheme
              return (
                <Pressable key={s} style={styles.schemeBtn} onPress={() => setScheme(s)}>
                  <GlossSurface
                    base={active ? theme.color.accentSoft : theme.color.surface2}
                    radius={theme.radius.field}
                    elevated={false}
                    style={styles.schemeInner}
                  >
                    <Text style={[styles.schemeText, active && styles.schemeTextActive]}>
                      {s}://
                    </Text>
                  </GlossSurface>
                </Pressable>
              )
            })}
          </View>
          <View style={styles.hostRow}>
            <TextInput
              style={[styles.input, styles.hostInput]}
              value={host}
              onChangeText={setHost}
              placeholder="myserver"
              placeholderTextColor={theme.color.ink3}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <TextInput
              style={[styles.input, styles.portInput]}
              value={port}
              onChangeText={setPort}
              placeholder={DEFAULT_PORT}
              placeholderTextColor={theme.color.ink3}
              keyboardType="number-pad"
            />
          </View>

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={theme.color.ink3}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={theme.color.ink3}
          />

          {error != null && <Text style={styles.error}>{error}</Text>}

          <GlossButton
            label={loading ? 'Signing in…' : 'Sign in'}
            onPress={handleLogin}
            disabled={loading}
            height={48}
            style={styles.button}
          />
        </GlossSurface>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.appBg },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: theme.sp.lg },
  card: { padding: theme.sp.lg },
  title: {
    fontFamily: theme.font.serif,
    fontSize: theme.text['2xl'],
    color: theme.color.ink,
    marginBottom: 2,
  },
  subtitle: {
    fontFamily: theme.font.mono,
    fontSize: theme.text.sm,
    color: theme.color.ink2,
    marginBottom: theme.sp.lg,
  },
  label: {
    fontFamily: theme.font.sans,
    fontSize: theme.text.sm,
    fontWeight: theme.weight.semibold,
    color: theme.color.ink,
    marginBottom: theme.sp.xs,
  },
  recents: { marginBottom: theme.sp.md },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.xs, marginBottom: theme.sp.xs },
  recentPick: { flex: 1 },
  recentChip: { paddingHorizontal: theme.sp.sm, paddingVertical: theme.sp[10] },
  recentText: { fontFamily: theme.font.mono, fontSize: theme.text.sm, color: theme.color.ink2 },
  recentTextActive: { color: theme.color.accentInk },
  forget: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  forgetText: { fontSize: theme.text.base, color: theme.color.ink3 },
  scheme: { flexDirection: 'row', gap: theme.sp.xs, marginBottom: theme.sp.xs },
  schemeBtn: { flex: 1 },
  schemeInner: { alignItems: 'center', justifyContent: 'center', height: 40 },
  schemeText: { fontFamily: theme.font.mono, fontSize: theme.text.sm, color: theme.color.ink2 },
  schemeTextActive: { color: theme.color.accentInk },
  hostRow: { flexDirection: 'row', gap: theme.sp.xs, marginBottom: theme.sp.md },
  input: {
    borderWidth: 1,
    borderColor: theme.color.line,
    borderRadius: theme.radius.field,
    paddingHorizontal: theme.sp.sm,
    height: 44,
    fontSize: theme.text.base,
    color: theme.color.ink,
    backgroundColor: theme.color.field,
    marginBottom: theme.sp.md,
  },
  hostInput: { flex: 1, marginBottom: 0 },
  portInput: { width: 88, marginBottom: 0, textAlign: 'center' },
  error: {
    color: theme.color.red,
    fontFamily: theme.font.sans,
    fontSize: theme.text.sm,
    marginBottom: theme.sp.sm,
  },
  button: { marginTop: theme.sp.xs },
})
