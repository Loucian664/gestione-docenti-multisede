import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import {
  applyTheme,
  DEFAULT_SCHEDULE,
  readThemePreference,
  readThemeSchedule,
  resolveTheme,
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
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    typeof window === "undefined" ? "system" : readThemePreference(),
  );
  const [schedule, setScheduleState] = useState<ThemeSchedule>(() =>
    typeof window === "undefined" ? DEFAULT_SCHEDULE : readThemeSchedule(),
  );
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    typeof window === "undefined"
      ? "light"
      : resolveTheme(readThemePreference(), readThemeSchedule()),
  );

  useLayoutEffect(() => {
    setResolved(applyTheme(preference, schedule));
    writeThemePreference(preference);
    writeThemeSchedule(schedule);
  }, [preference, schedule]);

  useEffect(() => {
    if (preference !== "system") return;

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
  }, [preference, schedule]);

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
