import { Link, useRouterState } from "@tanstack/react-router";
import {
  CalendarDays,
  ClipboardList,
  LayoutGrid,
  Settings,
  Users,
  BookOpen,
  BarChart3,
} from "lucide-react";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/store";
import { officialData } from "@/lib/saved-timetables";
import { coverageNeeds, isCovered } from "@/lib/coverage";
import { snapshot } from "@/lib/store";
import { applyOrganicoFixes, DEFAULT_SCHOOL_NAME, LEGACY_SCHOOL_NAMES } from "@/lib/seed";
import {
  didUserMutate,
  isSeedLike,
  isClearedRegister,
  markHydrated,
  mergeSlices,
  parsePersist,
  readMergedPersistSync,
  readPersistedIdb,
  requestPersistentStorage,
  withOrigin,
  writePersistSync,
} from "@/lib/persist-storage";
import type { PersistedData } from "@/lib/types";
import { ThemeCycleButton, ThemePicker } from "@/components/theme-toggle";

const NAV = [
  { to: "/", label: "Oggi", icon: CalendarDays },
  { to: "/orario", label: "Orario", icon: LayoutGrid },
  { to: "/assenze", label: "Assenze", icon: ClipboardList },
  { to: "/docenti", label: "Docenti", icon: Users },
  { to: "/classi", label: "Classi", icon: BookOpen },
  { to: "/report", label: "Report", icon: BarChart3 },
  { to: "/impostazioni", label: "Impostazioni", icon: Settings },
] as const;

export function AppLayout({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const data = useAppStore();
  const [persistReady, setPersistReady] = useState(false);
  useLayoutEffect(() => {
    let cancelled = false;
    let finished = false;

    const applySlice = (incoming: PersistedData) => {
      if (didUserMutate()) return;
      try {
        const current = snapshot(useAppStore.getState());
        if (isSeedLike(incoming) && !isSeedLike(current)) return;
        if (
          isClearedRegister(current) &&
          !isClearedRegister(incoming) &&
          (Number(current.savedAt) || 0) >= (Number(incoming.savedAt) || 0)
        ) {
          return;
        }
        const merged = isSeedLike(current) ? incoming : mergeSlices(current, incoming);
        const fixed = withOrigin(applyOrganicoFixes(merged));
        useAppStore.setState(fixed);
      } catch {
        // ignore corrupt storage
      }
    };

    const finish = (persistUser: boolean) => {
      if (cancelled || finished) return;
      finished = true;
      markHydrated();
      requestPersistentStorage();
      useAppStore.getState().snapToToday();
      const snap = snapshot(useAppStore.getState());
      if (persistUser && !isSeedLike(snap)) {
        writePersistSync({ ...snap, origin: "user" });
      }
      setPersistReady(true);
    };

    const synced = readMergedPersistSync();
    if (synced) applySlice(synced);
    const syncedIsUser = synced != null && !isSeedLike(synced);
    if (syncedIsUser) {
      finish(true);
      void readPersistedIdb().then((idb) => {
        if (cancelled || didUserMutate() || !idb) return;
        const extra = parsePersist(idb);
        if (extra) applySlice(extra);
        useAppStore.getState().snapToToday();
        const snap = snapshot(useAppStore.getState());
        if (!isSeedLike(snap)) writePersistSync({ ...snap, origin: "user" });
      });
      return () => {
        cancelled = true;
      };
    }

    let failSafe = 0;
    failSafe = window.setTimeout(() => finish(false), 700);
    void readPersistedIdb().then((idb) => {
      if (cancelled) return;
      window.clearTimeout(failSafe);
      const extra = parsePersist(idb);
      if (extra) applySlice(extra);
      else if (synced) applySlice(synced);
      const snap = snapshot(useAppStore.getState());
      finish(!isSeedLike(snap));
    });
    return () => {
      cancelled = true;
      window.clearTimeout(failSafe);
    };
  }, []);

  useEffect(() => {
    if (!persistReady) return;
    const name = useAppStore.getState().settings.schoolName;
    if ((LEGACY_SCHOOL_NAMES as readonly string[]).includes(name)) {
      useAppStore.getState().updateSettings({ schoolName: DEFAULT_SCHOOL_NAME });
    }
  }, [persistReady]);

  useEffect(() => {
    if (!persistReady) return;
    const onWake = () => useAppStore.getState().resumeTodayIfStale();
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("pageshow", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("pageshow", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [persistReady]);

  // ore da coprire oggi: con l'orario in vigore (slot 0)
  const snap = officialData(snapshot(data));
  const uncovered = coverageNeeds(snap, data.selectedDate).filter((n) => !isCovered(n)).length;

  return (
    <div className="app-shell flex min-h-dvh">
      <aside
        data-print-hide
        className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex"
      >
        <div className="px-5 pt-6 pb-5">
          <p className="font-display text-[1.45rem] leading-[1.15] tracking-tight text-sidebar-foreground">
            Orario Generale
          </p>
          <p className="mt-2 text-[12px] leading-snug text-sidebar-muted">
            {persistReady ? data.settings.schoolName : "\u00a0"}
            <br />
            {persistReady ? data.settings.schoolYear : "\u00a0"}
          </p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {NAV.map((item) => {
            const active = item.to === "/" ? path === "/" : path.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex h-10 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors duration-150",
                  active
                    ? "bg-white/10 text-sidebar-foreground"
                    : "text-sidebar-muted hover:bg-white/6 hover:text-sidebar-foreground",
                )}
              >
                <Icon className="size-4" strokeWidth={1.75} />
                <span className="flex-1">{item.label}</span>
                {item.to === "/" && persistReady && uncovered > 0 && (
                  <span className="rounded-full bg-warning-soft px-1.5 text-[11px] font-semibold text-warning tabular-nums">
                    {uncovered}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto px-3 pb-4">
          <ThemePicker compact />
          <p className="mt-3 px-2 text-[11px] leading-snug text-sidebar-muted">
            Dati salvati solo su questo dispositivo
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          data-print-hide
          className="flex items-center justify-between gap-3 border-b border-border bg-card/80 px-4 py-3 backdrop-blur md:hidden"
        >
          <div>
            <p className="font-display text-lg leading-none">Orario Generale</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {persistReady ? data.settings.schoolName : "\u00a0"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {persistReady && uncovered > 0 && (
              <span className="mr-1 rounded-full bg-danger-soft px-2 py-1 text-[11px] font-semibold text-destructive tabular-nums">
                {uncovered} scoperte
              </span>
            )}
            <ThemeCycleButton />
            <Link
              to="/report"
              className="flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              aria-label="Report"
            >
              <BarChart3 className="size-4" />
            </Link>
            <Link
              to="/impostazioni"
              className="flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              aria-label="Impostazioni"
            >
              <Settings className="size-4" />
            </Link>
          </div>
        </header>
        <main
          className={cn(
            "flex-1 px-4 py-5 pb-24 md:px-8 md:py-7 md:pb-7",
            !persistReady && "pointer-events-none",
          )}
        >
          {persistReady ? (
            children
          ) : (
            <div>
              <h1 className="font-display text-3xl font-medium tracking-tight">Orario Generale</h1>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">Caricamento dei dati…</p>
            </div>
          )}
        </main>
        <nav
          data-print-hide
          className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card/95 backdrop-blur md:hidden"
        >
          {NAV.slice(0, 5).map((item) => {
            const active = item.to === "/" ? path === "/" : path.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px]",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="size-4" strokeWidth={1.75} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  actionsFullWidth = false,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  /**
   * Sotto i 1024 px i tasti vanno sotto la descrizione, affiancati e larghi quanto la pagina
   * (come in Oggi); più larghi, a destra e sempre su una riga.
   */
  actionsFullWidth?: boolean;
}) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-3",
        actionsFullWidth
          ? "lg:flex-row lg:items-end lg:justify-between"
          : "sm:flex-row sm:items-end sm:justify-between",
      )}
    >
      <div>
        <h1 className="font-display text-3xl font-medium tracking-tight text-foreground md:text-4xl">
          {title}
        </h1>
        {description && <p className="mt-1 max-w-xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && (
        <div
          className={
            actionsFullWidth
              ? "grid auto-cols-fr grid-flow-col gap-2 *:w-full lg:flex lg:shrink-0 lg:items-center lg:*:w-auto"
              : "flex flex-wrap items-center gap-2"
          }
        >
          {actions}
        </div>
      )}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="paper-panel rounded-xl px-6 py-12 text-center">
      <p className="font-display text-xl">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}
