import { type ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { theme } from '@/lib/theme'
import { GlossSurface } from './GlossSurface'
import { Label } from './Label'

interface CardProps {
  title: string
  /** Optional fine print under the card (e.g. the web-managed caption). */
  caption?: string
  children: ReactNode
}

/**
 * A settings section: an uppercase `Label` heading over a soft-gloss `surface`
 * card whose direct children are stacked as `1px lineSoft`-divided rows. Shared
 * by both the group-settings and app-settings screens.
 */
export function SettingsCard({ title, caption, children }: CardProps) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : [children]
  return (
    <View style={styles.section}>
      <Label style={styles.heading}>{title}</Label>
      <GlossSurface radius={theme.radius.cardSm} style={styles.card}>
        {rows.map((row, i) => (
          <View key={i} style={[styles.rowWrap, i > 0 && styles.divided]}>
            {row}
          </View>
        ))}
      </GlossSurface>
      {caption != null && <Text style={styles.caption}>{caption}</Text>}
    </View>
  )
}

interface RowProps {
  label: string
  /** Right-side mono value (read-only rows). Ignored when `children` is given. */
  value?: string
  /** Right-side control (stepper, switch…). Takes precedence over `value`. */
  children?: ReactNode
}

/** A label-left / value-right row inside a {@link SettingsCard}. */
export function SettingsRow({ label, value, children }: RowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {children != null ? children : <Text style={styles.rowValue}>{value}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: theme.sp.xs },
  heading: { marginLeft: theme.sp.xs },
  card: { paddingHorizontal: theme.sp.md },
  rowWrap: {},
  divided: { borderTopWidth: 1, borderTopColor: theme.color.lineSoft },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingVertical: theme.sp[10],
    gap: theme.sp.sm,
  },
  rowLabel: { flexShrink: 1, fontFamily: theme.font.sans, fontSize: 14.5, color: theme.color.ink2 },
  rowValue: {
    fontFamily: theme.font.monoSemibold,
    fontSize: 13,
    color: theme.color.ink,
    textAlign: 'right',
    flexShrink: 1,
  },
  caption: {
    marginLeft: theme.sp.xs,
    marginTop: 2,
    fontFamily: theme.font.mono,
    fontSize: 10.5,
    lineHeight: 15,
    color: theme.color.ink3,
  },
})
