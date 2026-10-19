import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import {
  applyTheme,
  DEFAULT_SCHEDULE,
  readThemePreference,
  readThemeSchedule,
  writeThemePreference,
  writeThemeSchedule,
  msUntilNextBoundary,
  parseThemeSchedule,
  type ResolvedTheme,
  type ThemePreference,
  type ThemeSchedule,
} from "@/lib/theme";

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  schedule: ThemeSchedule;
  setPreference: (preference: ThemePreference) => void;
  setSchedule: (schedule: ThemeSchedule) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Il primo disegno è uguale a quello della pagina preparata in anticipo (senza le scelte salvate), altrimenti
  // React segnala che le due non coincidono; le scelte salvate si leggono subito dopo, prima che la pagina si veda
  // (i colori giusti li ha già messi THEME_BOOT_SCRIPT).
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [schedule, setScheduleState] = useState<ThemeSchedule>(DEFAULT_SCHEDULE);
  const [resolved, setResolved] = useState<ResolvedTheme>("light");
  const [loaded, setLoaded] = useState(false);

  useLayoutEffect(() => {
    setPreferenceState(readThemePreference());
    setScheduleState(readThemeSchedule());
    setLoaded(true);
  }, []);

  useLayoutEffect(() => {
    // prima di leggere le scelte salvate non si scrive niente, per non cancellarle
    if (!loaded) return;
    setResolved(applyTheme(preference, schedule));
    writeThemePreference(preference);
    writeThemeSchedule(schedule);
  }, [loaded, preference, schedule]);

  useEffect(() => {
    if (!loaded || preference !== "system") return;

    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      setResolved(applyTheme("system", schedule));
      timer = window.setTimeout(arm, msUntilNextBoundary(schedule));
    };
    arm();

    const onWake = () => arm();
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("pageshow", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("pageshow", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [loaded, preference, schedule]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolved,
      schedule,
      setPreference: setPreferenceState,
      setSchedule: (next) => setScheduleState(parseThemeSchedule(next)),
    }),
    [preference, resolved, schedule],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme deve stare dentro ThemeProvider");
  return ctx;
}
