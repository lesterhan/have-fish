import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { RECENT_CURRENCIES_KEY, orderByRecent, topRecents } from '@/lib/currency'
import { CASH_PARENT, defaultWalletName, walletPath } from '@/lib/cash-wallet-create'
import { useShellMode } from '@/lib/shell-mode-context'
import { useWallets } from '@/lib/wallet-context'
import { theme } from '@/lib/theme'
import { BottomSheet } from './BottomSheet'
import { CurrencyGrid } from './CurrencyGrid'
import { GlossButton } from './GlossButton'
import { GlossSurface } from './GlossSurface'

interface Props {
  visible: boolean
  onClose: () => void
  /** True when the user has no wallets yet — changes the copy, not the flow. */
  first: boolean
}

/**
 * Create-a-wallet flow: pick a currency, confirm the path, create.
 *
 * This is what the Cash mode shows instead of a dead empty state. The strict
 * tag rule means an untagged ledger has no wallets at all, and telling a
 * traveller to go find a laptop is not an answer — so the tab that would be
 * empty makes the wallet instead.
 *
 * Deliberately narrow: the `assets:cash:` prefix is fixed and shown read-only,
 * and the leaf is the currency. One wallet per currency keeps every balance
 * unambiguous and matches the pattern the ledger already uses for Wise. Anyone
 * wanting a different path uses the web app.
 */
export function WalletCreateSheet({ visible, onClose, first }: Props) {
  const { accent } = useShellMode()
  const { taken, createWallet } = useWallets()

  const [currency, setCurrency] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [recents, setRecents] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fresh start on each open — a half-finished pick from last time is noise.
  useEffect(() => {
    if (!visible) return
    setCurrency(null)
    setExpanded(false)
    setError(null)
    AsyncStorage.getItem(RECENT_CURRENCIES_KEY)
      .then((raw) => setRecents(raw ? JSON.parse(raw) : []))
      .catch(() => setRecents([]))
  }, [visible])

  const codes = expanded ? orderByRecent(recents) : topRecents(currency ?? '', recents)

  async function create() {
    if (!currency || busy) return
    setBusy(true)
    setError(null)
    try {
      await createWallet(currency)
      onClose()
    } catch (e: any) {
      setError(e?.message ?? "Couldn't create the wallet.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title={first ? 'Add your first wallet' : 'Add a wallet'}>
      <Text style={styles.intro}>
        {first
          ? 'A wallet tracks the cash you actually carry. Pick the currency it holds — one wallet per currency.'
          : 'Pick the currency this wallet holds. Currencies you already carry are greyed out.'}
      </Text>

      <ScrollView
        style={expanded && styles.scroll}
        contentContainerStyle={styles.grid}
        showsVerticalScrollIndicator={false}
      >
        <CurrencyGrid
          codes={codes}
          selected={currency}
          disabledCodes={taken}
          tint={{ soft: accent.soft, ink: accent.ink }}
          onSelect={setCurrency}
        />
      </ScrollView>

      {!expanded && (
        <GlossButton
          label="More currencies ▾"
          variant="neutral"
          height={44}
          onPress={() => setExpanded(true)}
          style={styles.more}
        />
      )}

      {currency != null && (
        <GlossSurface base={theme.color.surface2} style={styles.preview}>
          <Text style={styles.previewLabel}>New account</Text>
          <Text style={styles.previewPath}>
            <Text style={styles.previewPrefix}>{CASH_PARENT}:</Text>
            {walletPath(currency).slice(CASH_PARENT.length + 1)}
          </Text>
          <Text style={styles.previewName}>Shown as “{defaultWalletName(currency)}”</Text>
        </GlossSurface>
      )}

      {error != null && <Text style={styles.error}>{error}</Text>}

      <GlossButton
        label={busy ? 'Creating…' : currency ? `Create ${currency} wallet` : 'Pick a currency'}
        disabled={currency == null || busy}
        onPress={create}
        style={styles.create}
      />
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  intro: {
    fontSize: theme.text.sm,
    color: theme.color.ink2,
    lineHeight: 20,
    marginBottom: theme.sp.sm,
  },
  scroll: { maxHeight: 260 },
  grid: { gap: theme.sp[9] },
  more: { marginTop: theme.sp[9] },
  preview: {
    marginTop: theme.sp.sm,
    padding: theme.sp.sm,
    gap: 2,
  },
  previewLabel: {
    fontSize: theme.text.xs,
    color: theme.color.ink3,
  },
  previewPath: {
    fontFamily: theme.font.monoMedium,
    fontSize: 15,
    color: theme.color.ink,
  },
  // The fixed prefix is faint so the eye lands on the part the pick controls.
  previewPrefix: { color: theme.color.ink3 },
  previewName: {
    fontSize: theme.text.xs,
    color: theme.color.ink2,
    marginTop: 2,
  },
  error: {
    marginTop: theme.sp.xs,
    fontSize: theme.text.sm,
    color: theme.color.red,
  },
  create: { marginTop: theme.sp.sm },
})
