import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  DEFAULT_SHELL_MODE,
  SHELL_MODE_KEY,
  accentFor,
  restoreShellMode,
  type ModeAccent,
  type ShellMode,
} from './shell-mode'

interface ShellModeContextValue {
  /** The ledger currently on screen. */
  mode: ShellMode
  /** That mode's accent tokens — tab tint, chips, primary fills. */
  accent: ModeAccent
  /**
   * False until the persisted mode has been read. The shell renders the default
   * meanwhile; callers that must not flash the wrong mode can wait on this.
   */
  ready: boolean
  /** Switch ledgers and remember the choice. */
  setMode: (mode: ShellMode) => void
}

const ShellModeContext = createContext<ShellModeContextValue | null>(null)

/**
 * Owns which ledger the shell is showing. Lives above the tab navigator so the
 * header, the tab set, and every screen agree on one answer.
 *
 * The mode is restored from AsyncStorage on mount and written on every change.
 * Reads and writes are both tolerant of storage failing: the mode is shell
 * navigation, not data, so a device that can't persist it should still switch
 * normally and merely forget the choice between launches.
 */
export function ShellModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ShellMode>(DEFAULT_SHELL_MODE)
  const [ready, setReady] = useState(false)

  // Guards the restore against a user who switched modes before the read landed:
  // their deliberate choice must win over the stored value arriving late.
  const touched = useRef(false)
  // StrictMode double-mounts in dev; restore once.
  const restored = useRef(false)

  useEffect(() => {
    if (restored.current) return
    restored.current = true
    AsyncStorage.getItem(SHELL_MODE_KEY)
      .then((stored) => {
        setModeState((current) => restoreShellMode(stored, touched.current, current))
      })
      .catch(() => {})
      .finally(() => setReady(true))
  }, [])

  const setMode = useCallback((next: ShellMode) => {
    touched.current = true
    setModeState(next)
    AsyncStorage.setItem(SHELL_MODE_KEY, next).catch(() => null)
  }, [])

  const value = useMemo<ShellModeContextValue>(
    () => ({ mode, accent: accentFor(mode), ready, setMode }),
    [mode, ready, setMode],
  )

  return <ShellModeContext.Provider value={value}>{children}</ShellModeContext.Provider>
}

export function useShellMode(): ShellModeContextValue {
  const ctx = useContext(ShellModeContext)
  if (!ctx) throw new Error('useShellMode must be used within a ShellModeProvider')
  return ctx
}
