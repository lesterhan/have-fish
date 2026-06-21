import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { DEFAULT_PORT, type Scheme } from '@/lib/server-url'
import { theme } from '@/lib/theme'
import { GlossSurface } from './GlossSurface'

const SCHEMES: Scheme[] = ['http', 'https']

interface Props {
  scheme: Scheme
  host: string
  port: string
  onScheme: (s: Scheme) => void
  onHost: (h: string) => void
  onPort: (p: string) => void
}

/**
 * Server-address entry: an `http`/`https` segmented toggle plus host + port
 * inputs (port placeholder = the app's standard backend port). Shared by the
 * login screen and the account-settings Server card so the two stay in sync.
 * Controlled — the parent owns the parts and composes them via
 * `composeServerUrl`.
 */
export function ServerAddressFields({ scheme, host, port, onScheme, onHost, onPort }: Props) {
  return (
    <View>
      <View style={styles.scheme}>
        {SCHEMES.map((s) => {
          const active = s === scheme
          return (
            <Pressable key={s} style={styles.schemeBtn} onPress={() => onScheme(s)}>
              <GlossSurface
                base={active ? theme.color.accentSoft : theme.color.surface2}
                radius={theme.radius.field}
                elevated={false}
                style={styles.schemeInner}
              >
                <Text style={[styles.schemeText, active && styles.schemeTextActive]}>{s}://</Text>
              </GlossSurface>
            </Pressable>
          )
        })}
      </View>
      <View style={styles.hostRow}>
        <TextInput
          style={[styles.input, styles.hostInput]}
          value={host}
          onChangeText={onHost}
          placeholder="myserver"
          placeholderTextColor={theme.color.ink3}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <TextInput
          style={[styles.input, styles.portInput]}
          value={port}
          onChangeText={onPort}
          placeholder={DEFAULT_PORT}
          placeholderTextColor={theme.color.ink3}
          keyboardType="number-pad"
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  scheme: { flexDirection: 'row', gap: theme.sp.xs, marginBottom: theme.sp.xs },
  schemeBtn: { flex: 1 },
  schemeInner: { alignItems: 'center', justifyContent: 'center', height: 40 },
  schemeText: { fontFamily: theme.font.mono, fontSize: theme.text.sm, color: theme.color.ink2 },
  schemeTextActive: { color: theme.color.accentInk },
  hostRow: { flexDirection: 'row', gap: theme.sp.xs },
  input: {
    borderWidth: 1,
    borderColor: theme.color.line,
    borderRadius: theme.radius.field,
    paddingHorizontal: theme.sp.sm,
    height: 44,
    fontSize: theme.text.base,
    color: theme.color.ink,
    backgroundColor: theme.color.field,
  },
  hostInput: { flex: 1 },
  portInput: { width: 88, textAlign: 'center' },
})
