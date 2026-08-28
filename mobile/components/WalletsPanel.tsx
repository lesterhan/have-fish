import { useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { formatAmount, type WalletView } from '@/lib/cash-accounts'
import { useShellMode } from '@/lib/shell-mode-context'
import { useWallets } from '@/lib/wallet-context'
import * as haptics from '@/lib/haptics'
import { theme } from '@/lib/theme'
import { GlossButton } from './GlossButton'
import { GlossSurface } from './GlossSurface'
import { WalletCreateSheet } from './WalletCreateSheet'

/**
 * Wallets tab — what is in each cash wallet, and the way to make one.
 *
 * With no wallets the tab runs the create flow rather than showing an empty
 * state: Cash mode is never hidden (epic decision, 2026-08-27), so the tab a
 * new user lands on has to be able to get them a usable wallet without leaving
 * the phone.
 */
export function WalletsPanel() {
  const { wallets, activeWalletId, setActiveWallet, loading, error, reload } = useWallets()
  const [createOpen, setCreateOpen] = useState(false)

  if (loading && wallets.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    )
  }

  const empty = wallets.length === 0

  return (
    <>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      >
        {/* The last-loaded balances stay on screen behind this — a tailnet drop
            shouldn't blank out figures the user was reading. */}
        {error != null && <Text style={styles.error}>{error}</Text>}

        {empty ? (
          <EmptyState onStart={() => setCreateOpen(true)} />
        ) : (
          <>
            {wallets.map((wallet) => (
              <WalletCard
                key={wallet.id}
                wallet={wallet}
                active={wallet.id === activeWalletId}
                onPress={() => {
                  haptics.selection()
                  setActiveWallet(wallet.id)
                }}
              />
            ))}
            <GlossButton
              label="Add a wallet"
              variant="neutral"
              height={44}
              onPress={() => setCreateOpen(true)}
              style={styles.add}
            />
          </>
        )}
      </ScrollView>

      <WalletCreateSheet visible={createOpen} onClose={() => setCreateOpen(false)} first={empty} />
    </>
  )
}

function WalletCard({
  wallet,
  active,
  onPress,
}: {
  wallet: WalletView
  active: boolean
  onPress: () => void
}) {
  const { accent } = useShellMode()
  const negative = parseFloat(wallet.amount) < 0

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }}>
      <GlossSurface
        base={active ? accent.soft : theme.color.surface}
        style={[styles.card, active && { borderColor: accent.line }]}
      >
        <View style={styles.cardHead}>
          <Text style={[styles.cardLabel, active && { color: accent.ink }]} numberOfLines={1}>
            {wallet.label}
          </Text>
          {active && (
            <Ionicons name="checkmark-circle" size={18} color={accent.accent} />
          )}
        </View>

        <View style={styles.amountRow}>
          {/* A negative wallet means an unrecorded top-up, not an impossibility —
              show it as the warning it is rather than clamping it to zero. */}
          <Text style={[styles.amount, negative && styles.amountNegative]}>
            {formatAmount(wallet.amount)}
          </Text>
          {wallet.currency != null && <Text style={styles.currency}>{wallet.currency}</Text>}
        </View>

        {/* Money in a currency this wallet isn't meant to hold. Off-convention,
            so it is surfaced rather than hidden — hiding it would lose it. */}
        {wallet.extra.map((b) => (
          <Text key={b.currency} style={styles.extra}>
            also {formatAmount(b.amount)} {b.currency}
          </Text>
        ))}
      </GlossSurface>
    </Pressable>
  )
}

function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <GlossSurface style={styles.empty}>
      <Text style={styles.emptyTitle}>No wallets yet</Text>
      <Text style={styles.emptyBody}>
        A wallet tracks the cash you actually carry — the notes in your pocket, one wallet per
        currency. Make one and you can start logging what you spend from it.
      </Text>
      <GlossButton label="Add your first wallet" onPress={onStart} style={styles.emptyAction} />
    </GlossSurface>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.appBg },
  content: { padding: theme.sp.md, gap: theme.sp.sm },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.appBg,
  },
  error: {
    fontSize: theme.text.sm,
    color: theme.color.red,
    textAlign: 'center',
  },
  card: { padding: theme.sp.md, gap: 2 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.sp.xs },
  cardLabel: {
    fontSize: theme.text.base,
    fontWeight: theme.weight.medium,
    color: theme.color.ink,
    flexShrink: 1,
  },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  amount: {
    fontFamily: theme.font.monoSemibold,
    fontSize: 28,
    color: theme.color.ink,
  },
  amountNegative: { color: theme.color.red },
  currency: {
    fontFamily: theme.font.mono,
    fontSize: theme.text.sm,
    color: theme.color.ink3,
  },
  extra: {
    fontFamily: theme.font.mono,
    fontSize: theme.text.xs,
    color: theme.color.ink2,
    marginTop: 2,
  },
  add: { marginTop: theme.sp.xs },
  empty: { padding: theme.sp.lg, gap: theme.sp.xs, alignItems: 'center' },
  emptyTitle: {
    fontFamily: theme.font.serif,
    fontSize: theme.text.xl,
    color: theme.color.ink,
  },
  emptyBody: {
    fontSize: theme.text.sm,
    color: theme.color.ink2,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyAction: { alignSelf: 'stretch', marginTop: theme.sp.sm },
})
