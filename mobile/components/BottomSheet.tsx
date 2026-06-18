import { type ReactNode } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { theme } from '@/lib/theme'

interface Props {
  visible: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}

/**
 * Bottom-sheet primitive (handoff "Bottom sheet"): a dimmed scrim with a panel
 * that slides up from the bottom. `surface` panel, top radius 18, 1px top
 * border, a grab handle, and an optional title + close button. Reused by the
 * Groups sheet (this epic) and the Currency / Date sheets (Epic 2).
 */
export function BottomSheet({ visible, onClose, title, children }: Props) {
  const insets = useSafeAreaInsets()

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        {/* Stop taps inside the panel from closing the sheet. */}
        <Pressable
          style={[styles.panel, { paddingBottom: insets.bottom + theme.sp.md }]}
          onPress={() => {}}
        >
          <View style={styles.handle} />
          {title != null && (
            <View style={styles.titleRow}>
              <Text style={styles.title}>{title}</Text>
              <Pressable hitSlop={10} onPress={onClose}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>
          )}
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: theme.color.scrim,
    justifyContent: 'flex-end',
  },
  panel: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: theme.radius.sheet,
    borderTopRightRadius: theme.radius.sheet,
    borderTopWidth: 1,
    borderTopColor: theme.color.line,
    paddingHorizontal: theme.sp.md,
    paddingTop: theme.sp.sm,
    ...theme.gloss.shadowSheet,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.color.line,
    marginBottom: theme.sp.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.sp.sm,
  },
  title: {
    fontFamily: theme.font.serif,
    fontSize: 19,
    fontWeight: theme.weight.semibold,
    color: theme.color.ink,
  },
  close: { fontSize: 18, color: theme.color.ink3, paddingHorizontal: theme.sp.xs },
})
