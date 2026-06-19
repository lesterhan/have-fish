import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker'
import {
  type DateMode,
  resolveDate,
  toISODate,
  todayISO,
  yesterdayISO,
} from '@/lib/expense-date'
import * as haptics from '@/lib/haptics'
import { theme } from '@/lib/theme'
import { BottomSheet } from './BottomSheet'
import { GlossSurface } from './GlossSurface'

interface Props {
  visible: boolean
  /** Active date mode, for highlighting the chosen row. */
  mode: DateMode
  /** Stored picked ISO date (seeds the native picker), or null. */
  pickDate: string | null
  /** Commit a choice. `pickISO` is set only for the pick-a-date path. */
  onSelect: (mode: DateMode, pickISO?: string) => void
  onClose: () => void
}

/** Parse a local `YYYY-MM-DD` string to a local-midnight Date for the picker. */
function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/**
 * Date sheet — reached from the amount card's date chip. Three options: Today,
 * Yesterday, or a specific date via the native picker (capped at today). The
 * chosen relative options resolve at submit time, so "Today" stays today even
 * if the app is left open past midnight.
 */
export function DateSheet({ visible, mode, pickDate, onSelect, onClose }: Props) {
  const [showPicker, setShowPicker] = useState(false)

  function choose(next: DateMode) {
    onSelect(next)
    onClose()
  }

  function openPicker() {
    haptics.selection()
    setShowPicker(true)
  }

  function onPickerChange(event: DateTimePickerEvent, date?: Date) {
    setShowPicker(false)
    if (event.type !== 'set' || !date) return // dismissed → keep current
    onSelect('pick', toISODate(date))
    onClose()
  }

  const today = todayISO()
  const yesterday = yesterdayISO()
  const pickedLabel = mode === 'pick' ? resolveDate('pick', pickDate) : null

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Date">
      <View style={styles.list}>
        <Option
          label="Today"
          meta={today}
          selected={mode === 'today'}
          onPress={() => choose('today')}
        />
        <Option
          label="Yesterday"
          meta={yesterday}
          selected={mode === 'yesterday'}
          onPress={() => choose('yesterday')}
        />
        <Option
          label="Pick a date…"
          meta={pickedLabel ?? undefined}
          icon="calendar-outline"
          selected={mode === 'pick'}
          onPress={openPicker}
        />
      </View>

      {showPicker && (
        <DateTimePicker
          mode="date"
          display="default"
          value={pickDate ? parseISO(pickDate) : new Date()}
          maximumDate={new Date()}
          onChange={onPickerChange}
        />
      )}
    </BottomSheet>
  )
}

interface OptionProps {
  label: string
  meta?: string
  icon?: keyof typeof Ionicons.glyphMap
  selected: boolean
  onPress: () => void
}

function Option({ label, meta, icon, selected, onPress }: OptionProps) {
  return (
    <Pressable onPress={onPress} onPressIn={haptics.selection}>
      <GlossSurface
        base={selected ? theme.color.accentSoft : theme.color.surface2}
        radius={theme.radius.field}
        style={styles.option}
      >
        <View style={styles.optionLeft}>
          {icon && (
            <Ionicons
              name={icon}
              size={16}
              color={selected ? theme.color.accentInk : theme.color.ink2}
            />
          )}
          <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>{label}</Text>
        </View>
        {meta && <Text style={styles.optionMeta}>{meta}</Text>}
      </GlossSurface>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  list: { gap: theme.sp[9] },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.sp.sm,
    paddingHorizontal: theme.sp.md,
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.sm,
  },
  optionLabel: {
    fontFamily: theme.font.sans,
    fontSize: 15,
    fontWeight: theme.weight.bold,
    color: theme.color.ink,
  },
  optionLabelSelected: { color: theme.color.accentInk },
  optionMeta: {
    fontFamily: theme.font.mono,
    fontSize: 12,
    color: theme.color.ink3,
  },
})
