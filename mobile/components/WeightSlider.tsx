import { useEffect, useRef } from 'react'
import { PanResponder, StyleSheet, View } from 'react-native'
import { theme } from '@/lib/theme'
import * as haptics from '@/lib/haptics'

interface Props {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  /** Snap increment. Touches round to the nearest multiple. */
  step?: number
  disabled?: boolean
}

/**
 * Pure-JS percentage slider — a track + fill + draggable thumb built from core
 * RN primitives (PanResponder), so it needs no native module and works in Expo
 * Go and any existing binary. Tap or drag anywhere on the track to set the
 * value; snaps to `step`, clamps to `[min, max]`, and buzzes on each change.
 *
 * The visual layers are `pointerEvents="none"` so the touch always lands on the
 * track itself — otherwise a tap on the thumb/fill reports `locationX` relative
 * to that child (near 0) and the value snaps to the floor before correcting.
 *
 * The track width is measured via `onLayout`; positions render as percentages so
 * the bar reflows with the sheet.
 */
export function WeightSlider({ value, onChange, min = 5, max = 95, step = 5, disabled = false }: Props) {
  const widthRef = useRef(0)
  // Keep the latest props reachable from the PanResponder closure (created once).
  const onChangeRef = useRef(onChange)
  const disabledRef = useRef(disabled)
  const lastRef = useRef(value)
  useEffect(() => {
    onChangeRef.current = onChange
    disabledRef.current = disabled
    lastRef.current = value
  })

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponder: () => !disabledRef.current,
      onPanResponderGrant: (e) => setFromX(e.nativeEvent.locationX),
      onPanResponderMove: (e) => setFromX(e.nativeEvent.locationX),
    }),
  ).current

  function setFromX(x: number) {
    const w = widthRef.current
    if (w <= 0) return
    const snapped = Math.round((x / w) * 100 / step) * step
    const clamped = Math.min(max, Math.max(min, snapped))
    if (clamped === lastRef.current) return
    lastRef.current = clamped
    haptics.selection()
    onChangeRef.current(clamped)
  }

  const pct = Math.min(max, Math.max(min, value))

  return (
    <View
      style={styles.track}
      onLayout={(e) => (widthRef.current = e.nativeEvent.layout.width)}
      {...pan.panHandlers}
    >
      <View pointerEvents="none" style={styles.rail} />
      <View pointerEvents="none" style={[styles.fill, { width: `${pct}%` }]} />
      <View pointerEvents="none" style={[styles.thumb, { left: `${pct}%` }, disabled && styles.thumbDisabled]} />
    </View>
  )
}

const RAIL_H = 6
const THUMB = 22
const TRACK_H = 40

const styles = StyleSheet.create({
  track: { height: TRACK_H, justifyContent: 'center' },
  rail: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: RAIL_H,
    borderRadius: RAIL_H / 2,
    backgroundColor: theme.color.line,
  },
  fill: {
    position: 'absolute',
    left: 0,
    height: RAIL_H,
    borderRadius: RAIL_H / 2,
    backgroundColor: theme.color.accent,
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    marginLeft: -THUMB / 2,
    borderRadius: THUMB / 2,
    backgroundColor: theme.color.accent,
    borderWidth: 2,
    borderColor: theme.color.surface,
    ...theme.gloss.shadowButton,
  },
  thumbDisabled: { opacity: 0.5 },
})
