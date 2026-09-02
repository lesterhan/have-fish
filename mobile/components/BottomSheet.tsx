import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Animated,
  Easing,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
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
/** Leaves the scrim readable above the tallest sheet. */
const MAX_HEIGHT = '92%'

/**
 * Bottom-sheet primitive (handoff "Bottom sheet"): a panel that slides up from
 * the bottom over a scrim that **fades** in place — not the default Modal
 * behaviour where the whole modal (scrim included) slides up together.
 *
 * `surface` panel, top radius 18, 1px top border, a grab handle, optional title
 * + close. Reused by the Groups sheet (this epic) and Currency / Date (Epic 2).
 *
 * The panel lifts itself clear of the keyboard. Android's `adjustResize` resizes
 * the *app* window, and a Modal is its own window, so a sheet with a text field
 * would otherwise sit under the keyboard with its submit button unreachable.
 * Content taller than {@link MAX_HEIGHT} scrolls instead of growing past the top
 * of the screen — sheets with a long body give their scroller `flexShrink: 1`.
 */
export function BottomSheet({ visible, onClose, title, children }: Props) {
  const insets = useSafeAreaInsets()
  const anim = useRef(new Animated.Value(0)).current
  const [panelHeight, setPanelHeight] = useState(600)
  // Keep the Modal mounted through the exit animation.
  const [mounted, setMounted] = useState(visible)
  const [keyboardHeight, setKeyboardHeight] = useState(0)

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

  // iOS reports the keyboard before it animates, Android only once it is up;
  // either way the height is what the panel has to clear.
  useEffect(() => {
    if (!mounted) return
    const shown = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => setKeyboardHeight(e.endCoordinates.height),
    )
    const hidden = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardHeight(0),
    )
    return () => {
      shown.remove()
      hidden.remove()
      // Don't reopen with the last sheet's keyboard padding still applied.
      setKeyboardHeight(0)
    }
  }, [mounted])

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
            {
              // The keyboard covers the gesture bar it would otherwise clear, so
              // the two insets don't add up — take whichever is taller.
              paddingBottom: Math.max(insets.bottom, keyboardHeight) + theme.sp.md,
              transform: [{ translateY }],
            },
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
    maxHeight: MAX_HEIGHT,
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
