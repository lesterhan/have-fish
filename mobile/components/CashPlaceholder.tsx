import { StyleSheet, Text, View } from 'react-native'
import { useShellMode } from '@/lib/shell-mode-context'
import { theme } from '@/lib/theme'
import { GlossSurface } from './GlossSurface'

interface Props {
  title: string
  /** One sentence on what this tab will do, in the user's terms. */
  detail: string
  /** Which story of the epic builds it — honest about why the tab is empty. */
  story: string
}

/**
 * Stand-in for a Cash tab that has its route but not yet its screen.
 *
 * Story 2 restructures the shell, which means the Cash tab set has to exist and
 * be navigable before the screens behind it do. Rather than three blank views
 * that read as breakage, each says what it will hold and which story builds it.
 * Every one of these is deleted by the story it names.
 */
export function CashPlaceholder({ title, detail, story }: Props) {
  const { accent } = useShellMode()

  return (
    <View style={styles.screen}>
      <GlossSurface style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.detail}>{detail}</Text>
        <View style={[styles.tag, { backgroundColor: accent.soft, borderColor: accent.line }]}>
          <Text style={[styles.tagText, { color: accent.ink }]}>Coming in {story}</Text>
        </View>
      </GlossSurface>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.color.appBg,
    padding: theme.sp.md,
    justifyContent: 'center',
  },
  card: { padding: theme.sp.lg, alignItems: 'center', gap: theme.sp.xs },
  title: {
    fontFamily: theme.font.serif,
    fontSize: theme.text.xl,
    color: theme.color.ink,
  },
  detail: {
    fontSize: theme.text.sm,
    color: theme.color.ink2,
    textAlign: 'center',
    lineHeight: 20,
  },
  tag: {
    marginTop: theme.sp.xs,
    paddingHorizontal: theme.sp.sm,
    paddingVertical: 5,
    borderRadius: theme.radius.chip,
    borderWidth: 1,
  },
  tagText: {
    fontFamily: theme.font.monoMedium,
    fontSize: theme.text.xs,
  },
})
