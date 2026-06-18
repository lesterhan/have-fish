import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { theme } from '@/lib/theme'

interface Props {
  visible: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)
const DURATION = 220

/**
 * Bottom-sheet primitive (handoff "Bottom sheet"): a panel that slides up from
 * the bottom over a scrim that **fades** in place — not the default Modal
 * behaviour where the whole modal (scrim included) slides up together.
 *
 * `surface` panel, top radius 18, 1px top border, a grab handle, optional title
 * + close. Reused by the Groups sheet (this epic) and Currency / Date (Epic 2).
 */
export function BottomSheet({ visible, onClose, title, children }: Props) {
  const insets = useSafeAreaInsets()
  const anim = useRef(new Animated.Value(0)).current
  const [panelHeight, setPanelHeight] = useState(600)
  // Keep the Modal mounted through the exit animation.
  const [mounted, setMounted] = useState(visible)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      Animated.timing(anim, {
        toValue: 1,
        duration: DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start()
    } else if (mounted) {
      Animated.timing(anim, {
        toValue: 0,
        duration: DURATION,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  if (!mounted) return null

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [panelHeight, 0],
  })

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <AnimatedPressable style={[styles.scrim, { opacity: anim }]} onPress={onClose} />
        <Animated.View
          onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)}
          style={[
            styles.panel,
            { paddingBottom: insets.bottom + theme.sp.md, transform: [{ translateY }] },
          ]}
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
        </Animated.View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.color.scrim },
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
