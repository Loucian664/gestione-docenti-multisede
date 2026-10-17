export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export type ThemeSchedule = { from: string; until: string };

export const THEME_STORAGE_KEY = "gestione-docenti-theme";
export const THEME_SCHEDULE_KEY = "gestione-docenti-theme-hours";
export const THEME_META_LIGHT = "#1F4A3C";
export const THEME_META_DARK = "#0c1411";
export const DEFAULT_DARK_FROM = "20:00";
export const DEFAULT_DARK_UNTIL = "07:00";
export const DEFAULT_SCHEDULE: ThemeSchedule = { from: DEFAULT_DARK_FROM, until: DEFAULT_DARK_UNTIL };

const MINUTES_DAY = 24 * 60;

export function parseThemePreference(value: string | null | undefined): ThemePreference {
  if (value === "light" || value === "dark" || value === "system") return value;
  return "system";
}

export function parseClock(value: string | null | undefined): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec((value ?? "").trim());
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function parseThemeSchedule(raw: unknown): ThemeSchedule {
  const source = typeof raw === "string" ? safeJson(raw) : raw;
  const from = parseClock((source as ThemeSchedule | null)?.from) || DEFAULT_DARK_FROM;
  const until = parseClock((source as ThemeSchedule | null)?.until) || DEFAULT_DARK_UNTIL;
  return { from, until };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function clockToMinutes(clock: string): number {
  const ok = parseClock(clock) || "00:00";
  const [hours, minutes] = ok.split(":").map(Number);
  return hours * 60 + minutes;
}

export function nowMinutes(date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Dark window. `20:00`→`07:00` wraps midnight. Equal clocks = always light. */
export function isDarkAtMinutes(from: string, until: string, minutes: number): boolean {
  const start = clockToMinutes(parseClock(from) || DEFAULT_DARK_FROM);
  const end = clockToMinutes(parseClock(until) || DEFAULT_DARK_UNTIL);
  const now = ((minutes % MINUTES_DAY) + MINUTES_DAY) % MINUTES_DAY;
  if (start === end) return false;
  if (start < end) return now >= start && now < end;
  return now >= start || now < end;
}

export function cycleTheme(current: ThemePreference): ThemePreference {
  if (current === "system") return "light";
  if (current === "light") return "dark";
  return "system";
}

export function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function writeThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // private mode / quota
  }
}

export function readThemeSchedule(): ThemeSchedule {
  try {
    return parseThemeSchedule(localStorage.getItem(THEME_SCHEDULE_KEY));
  } catch {
    return { ...DEFAULT_SCHEDULE };
  }
}

export function writeThemeSchedule(schedule: ThemeSchedule): void {
  try {
    localStorage.setItem(THEME_SCHEDULE_KEY, JSON.stringify(parseThemeSchedule(schedule)));
  } catch {
    // private mode / quota
  }
}

export function resolveTheme(
  preference: ThemePreference,
  schedule: ThemeSchedule = DEFAULT_SCHEDULE,
  minutes = nowMinutes(),
): ResolvedTheme {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return isDarkAtMinutes(schedule.from, schedule.until, minutes) ? "dark" : "light";
}

export function msUntilNextBoundary(schedule: ThemeSchedule, now = new Date()): number {
  const current = now.getHours() * 60 + now.getMinutes();
  const start = clockToMinutes(schedule.from);
  const end = clockToMinutes(schedule.until);
  const targets = start === end ? [0] : [start, end];
  let waitMin = MINUTES_DAY;
  for (const target of targets) {
    let delta = target - current;
    if (delta <= 0) delta += MINUTES_DAY;
    if (delta < waitMin) waitMin = delta;
  }
  const remainder = waitMin * 60 * 1000 - now.getSeconds() * 1000 - now.getMilliseconds() + 250;
  return Math.max(250, remainder);
}

export function applyTheme(
  preference: ThemePreference,
  schedule: ThemeSchedule = DEFAULT_SCHEDULE,
  minutes = nowMinutes(),
): ResolvedTheme {
  const resolved = resolveTheme(preference, schedule, minutes);
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.dataset.theme = preference;
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "dark" ? THEME_META_DARK : THEME_META_LIGHT);
  return resolved;
}

export function formatScheduleHint(schedule: ThemeSchedule): string {
  return `Scuro dalle ${schedule.from} alle ${schedule.until}`;
}

/** Inline boot: first paint already matches the saved preference and hours. */
export const THEME_BOOT_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var sk=${JSON.stringify(THEME_SCHEDULE_KEY)};var t=localStorage.getItem(k);if(t!=="light"&&t!=="dark")t="system";var d=t==="dark";if(t==="system"){var from=${JSON.stringify(DEFAULT_DARK_FROM)};var until=${JSON.stringify(DEFAULT_DARK_UNTIL)};try{var raw=localStorage.getItem(sk);if(raw){var p=JSON.parse(raw);if(p&&p.from)from=p.from;if(p&&p.until)until=p.until;}}catch(e){}function toM(s){var a=String(s||"").split(":");var h=+a[0];var m=+a[1];if(!(h>=0&&h<24&&m>=0&&m<60))return 0;return h*60+m;}var now=new Date();var n=now.getHours()*60+now.getMinutes();var a=toM(from);var b=toM(until);d=a===b?false:(a<b?(n>=a&&n<b):(n>=a||n<b));}var r=document.documentElement;r.classList.toggle("dark",d);r.dataset.theme=t;r.style.colorScheme=d?"dark":"light";var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",d?${JSON.stringify(THEME_META_DARK)}:${JSON.stringify(THEME_META_LIGHT)});}catch(e){}})();`;
