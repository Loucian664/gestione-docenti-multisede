import type { StateStorage } from "zustand/middleware";
import {
  DEFAULT_SCHOOL_NAME,
  LEGACY_SCHOOL_NAMES,
  SEED_ABSENCE_IDS,
  SEED_CLASS_TEMPO,
  SEED_SEDE_NAMES,
  SEED_TEACHER_IDS,
  buildSeed,
} from "./seed";
import type { PersistedData } from "./types";

/** Nessun nome vecchio: l'app di Rombiolo (copertura-plesso…) sta sullo stesso sito e i suoi dati non vanno né letti né cancellati. */
const OLD_KEYS: string[] = [];
const IDB_NAME = "gestione-docenti-multisede";
const IDB_STORE = "kv";
const PERSIST_KEY = "gestione-docenti-multisede";
export const PERSIST_VERSION = 7;

let writesEnabled = false;
let userMutated = false;
let mutationGen = 0;
let hydrated = false;

export function enablePersistWrites(): void {
  writesEnabled = true;
}

export function markHydrated(): void {
  hydrated = true;
  writesEnabled = true;
}

export function persistWritesEnabled(): boolean {
  return writesEnabled;
}

/** Call on every user edit so the save is never dropped, even mid-boot. */
export function noteUserMutation(): void {
  userMutated = true;
  mutationGen += 1;
  writesEnabled = true;
  hydrated = true;
}

export function didUserMutate(): boolean {
  return userMutated;
}

export function mutationGeneration(): number {
  return mutationGen;
}

function memoryFallback(): StateStorage {
  const map = new Map<string, string>();
  return {
    getItem: (name) => map.get(name) ?? null,
    setItem: (name, value) => {
      map.set(name, value);
    },
    removeItem: (name) => {
      map.delete(name);
    },
  };
}

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // quota / private mode
  }
}

function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<string | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSet(key: string, value: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

async function idbRemove(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

function ssGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function ssSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

const SEED_IDS = new Set<string>(SEED_TEACHER_IDS);
const SEED_ABSENCE = new Set<string>(SEED_ABSENCE_IDS);
const SHIPPED_SCHOOL_NAMES = new Set<string>([DEFAULT_SCHOOL_NAME, ...LEGACY_SCHOOL_NAMES, ...SEED_SEDE_NAMES]);

function isShippedSchoolName(name: string | undefined): boolean {
  return !name || SHIPPED_SCHOOL_NAMES.has(name);
}

/** Docenti di tutte le sedi: la sede in uso può essere nuova e ancora vuota. */
function allTeachersCount(data: PersistSlice): number {
  return (data.teachers?.length ?? 0) + (data.altreSedi ?? []).reduce((n, a) => n + (a.data?.teachers?.length ?? 0), 0);
}

/** Deliberate wipe: empty organico with a user stamp. Not the shipped example. */
export function isClearedRegister(data: PersistSlice | null | undefined): boolean {
  if (!data || data.origin === "seed") return false;
  if ((Number(data.savedAt) || 0) <= 0) return false;
  const others = (data.altreSedi ?? []).some(
    (a) => (a.data?.teachers?.length ?? 0) + (a.data?.classes?.length ?? 0) + (a.data?.slots?.length ?? 0) > 0,
  );
  return (
    !others &&
    (data.teachers?.length ?? 0) === 0 &&
    (data.classes?.length ?? 0) === 0 &&
    (data.slots?.length ?? 0) === 0
  );
}

export type PersistSlice = PersistedData;

function slotSignature(slots: PersistSlice["slots"] = []): string {
  return [...slots]
    .map((s) => `${s.id}\t${s.teacherId}\t${s.subject}`)
    .sort()
    .join("\n");
}

let cachedSeedSlotSig: string | null = null;
function seedSlotSignature(): string {
  if (cachedSeedSlotSig != null) return cachedSeedSlotSig;
  cachedSeedSlotSig = slotSignature(buildSeed().slots);
  return cachedSeedSlotSig;
}

/** Organico/orario still match the shipped example (ignores origin). */
export function structuralSeed(data: PersistSlice): boolean {
  const name = data.settings?.schoolName ?? "";
  if (name && !isShippedSchoolName(name)) return false;
  if (data.settings?.responsabile) return false;
  const teachers = data.teachers ?? [];
  if (teachers.length !== SEED_IDS.size) return false;
  if (teachers.some((t) => t.id && !SEED_IDS.has(t.id))) return false;
  const absences = data.absences ?? [];
  if (absences.some((a) => a.id && !SEED_ABSENCE.has(a.id))) return false;
  const subs = data.substitutions ?? [];
  if (subs.some((s) => s.id && !String(s.id).startsWith("sub-seed-"))) return false;
  for (const c of data.classes ?? []) {
    const expected = SEED_CLASS_TEMPO[c.id];
    if (expected && c.tempo !== expected) return false;
  }
  const slots = data.slots ?? [];
  if (slots.length > 0 && slotSignature(slots) !== seedSlotSignature()) return false;
  return true;
}

export function isSeedLike(data: PersistSlice | null | undefined): boolean {
  if (!data) return true;
  if (data.origin === "user") return false;
  if (data.origin === "seed") return true;
  return structuralSeed(data);
}

export function withOrigin(data: PersistSlice): PersistSlice {
  if (data.origin === "user" || data.origin === "seed") return data;
  return { ...data, origin: structuralSeed(data) ? "seed" : "user" };
}

export function parsePersist(raw: string | null): PersistSlice | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { state?: PersistSlice } & PersistSlice;
    const state = (parsed.state ?? parsed) as PersistSlice;
    if (!Array.isArray(state.teachers) || !Array.isArray(state.classes)) return null;
    return withOrigin(state);
  } catch {
    return null;
  }
}

export function userSignal(data: PersistSlice | null | undefined): number {
  if (!data) return 0;
  const teachers = data.teachers ?? [];
  const extraTeachers = teachers.filter((t) => t.id && !SEED_IDS.has(t.id)).length;
  const customName = data.settings?.schoolName && !isShippedSchoolName(data.settings.schoolName) ? 1 : 0;
  const customResp = data.settings?.responsabile ? 1 : 0;
  const extraAbs = (data.absences ?? []).filter((a) => a.id && !SEED_ABSENCE.has(a.id)).length;
  const extraSub = (data.substitutions ?? []).filter((s) => s.id && !String(s.id).startsWith("sub-seed-")).length;
  let tempoDiff = 0;
  for (const c of data.classes ?? []) {
    const expected = SEED_CLASS_TEMPO[c.id];
    if (expected && c.tempo !== expected) tempoDiff += 1;
  }
  const countDiff = Math.abs(teachers.length - SEED_IDS.size);
  const saved = Number(data.savedAt) || 0;
  return (
    extraTeachers * 20_000 +
    customName * 50_000 +
    customResp * 4_000 +
    extraAbs * 1_000 +
    extraSub * 400 +
    tempoDiff * 3_000 +
    countDiff * 8_000 +
    (saved > 0 ? 1 : 0)
  );
}

function byCattedra(
  a: PersistSlice["cattedre"] = [],
  b: PersistSlice["cattedre"] = [],
  preferB: boolean,
): PersistSlice["cattedre"] {
  const map = new Map<string, NonNullable<PersistSlice["cattedre"]>[number]>();
  for (const item of a ?? []) {
    if (item?.classId && item.subject) map.set(`${item.classId}|${item.subject}`, item);
  }
  for (const item of b ?? []) {
    if (!item?.classId || !item.subject) continue;
    const k = `${item.classId}|${item.subject}`;
    if (!map.has(k) || preferB) map.set(k, item);
  }
  return [...map.values()];
}

function byId<T extends { id: string }>(a: T[] = [], b: T[] = [], preferB: boolean): T[] {
  const map = new Map<string, T>();
  for (const item of a) {
    if (item?.id) map.set(item.id, item);
  }
  for (const item of b) {
    if (!item?.id) continue;
    if (!map.has(item.id) || preferB) map.set(item.id, item);
  }
  return [...map.values()];
}

export function mergeSlices(a: PersistSlice, b: PersistSlice): PersistSlice {
  const aUser = !isSeedLike(a);
  const bUser = !isSeedLike(b);
  if (aUser && !bUser) {
    return { ...a, origin: "user", savedAt: Math.max(Number(a.savedAt) || 0, Number(b.savedAt) || 0) };
  }
  if (bUser && !aUser) {
    return { ...b, origin: "user", savedAt: Math.max(Number(a.savedAt) || 0, Number(b.savedAt) || 0) };
  }

  const aAt = Number(a.savedAt) || 0;
  const bAt = Number(b.savedAt) || 0;
  if (isClearedRegister(a) && aAt >= bAt) return { ...a, origin: "user" };
  if (isClearedRegister(b) && bAt >= aAt) return { ...b, origin: "user" };

  const preferB = bAt >= aAt;
  // sedi in uso diverse: i dati in cima sono di due sedi, non si mescolano
  if ((a.sedeId ?? "") !== (b.sedeId ?? "")) return preferB ? { ...b } : { ...a };
  const nameA = a.settings?.schoolName ?? "";
  const nameB = b.settings?.schoolName ?? "";
  const aCustom = Boolean(nameA && !isShippedSchoolName(nameA));
  const bCustom = Boolean(nameB && !isShippedSchoolName(nameB));
  const schoolName = bCustom && (!aCustom || preferB) ? nameB : aCustom ? nameA : nameB || nameA || DEFAULT_SCHOOL_NAME;
  const respA = a.settings?.responsabile ?? "";
  const respB = b.settings?.responsabile ?? "";
  const responsabile = respB && (!respA || preferB) ? respB : respA || respB;

  const classMap = new Map<string, PersistSlice["classes"][number]>();
  for (const c of a.classes ?? []) classMap.set(c.id, c);
  for (const c of b.classes ?? []) {
    const prev = classMap.get(c.id);
    if (!prev) {
      classMap.set(c.id, c);
      continue;
    }
    const expected = SEED_CLASS_TEMPO[c.id];
    const bUserTempo = expected ? c.tempo !== expected : false;
    const aUserTempo = expected ? prev.tempo !== expected : false;
    if (bUserTempo && !aUserTempo) classMap.set(c.id, c);
    else if (aUserTempo && !bUserTempo) classMap.set(c.id, prev);
    else classMap.set(c.id, preferB ? c : prev);
  }

  return {
    settings: {
      ...(preferB ? b.settings : a.settings),
      ...a.settings,
      ...b.settings,
      schoolName,
      responsabile,
    },
    teachers: byId(a.teachers, b.teachers, preferB),
    classes: [...classMap.values()],
    slots: byId(a.slots, b.slots, preferB),
    absences: byId(a.absences, b.absences, preferB),
    substitutions: byId(a.substitutions, b.substitutions, preferB),
    cattedre: byCattedra(a.cattedre, b.cattedre, preferB),
    formerTeachers: byId(a.formerTeachers, b.formerTeachers, preferB),
    cattedraBackup: preferB ? b.cattedraBackup ?? a.cattedraBackup : a.cattedraBackup ?? b.cattedraBackup,
    cattedraDispBackup: preferB
      ? b.cattedraDispBackup ?? a.cattedraDispBackup
      : a.cattedraDispBackup ?? b.cattedraDispBackup,
    savedTimetables: preferB ? b.savedTimetables ?? a.savedTimetables : a.savedTimetables ?? b.savedTimetables,
    activeSlot: preferB ? b.activeSlot ?? a.activeSlot : a.activeSlot ?? b.activeSlot,
    officialBackup: preferB ? b.officialBackup ?? a.officialBackup : a.officialBackup ?? b.officialBackup,
    selectedDate: preferB ? b.selectedDate || a.selectedDate : a.selectedDate || b.selectedDate,
    savedAt: Math.max(Number(a.savedAt) || 0, Number(b.savedAt) || 0),
    origin: aUser || bUser ? "user" : a.origin === "seed" || b.origin === "seed" ? "seed" : a.origin ?? b.origin,
    importedBackupName: preferB
      ? b.importedBackupName || a.importedBackupName
      : a.importedBackupName || b.importedBackupName,
    sedeId: a.sedeId ?? b.sedeId,
    altreSedi: preferB ? b.altreSedi ?? a.altreSedi : a.altreSedi ?? b.altreSedi,
    ordineSedi: preferB ? b.ordineSedi ?? a.ordineSedi : a.ordineSedi ?? b.ordineSedi,
  };
}

export function mergeAllRaw(raws: Array<string | null | undefined>): PersistSlice | null {
  let acc: PersistSlice | null = null;
  for (const raw of raws) {
    const parsed = parsePersist(raw ?? null);
    if (!parsed) continue;
    acc = acc ? mergeSlices(acc, parsed) : parsed;
  }
  return acc;
}

export function persistRichness(raw: string | null): number {
  return userSignal(parsePersist(raw));
}

export function persistSavedAt(raw: string | null): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as { state?: { savedAt?: number }; savedAt?: number };
    const state = parsed.state ?? parsed;
    return Number(state.savedAt) || 0;
  } catch {
    return 0;
  }
}

export function encodePersist(state: unknown): string {
  return JSON.stringify({ state, version: PERSIST_VERSION });
}

/** Never write the example over a real registro. Older timestamps lose. */
export function shouldAcceptWrite(incoming: string, existing: string | null, force = false): boolean {
  if (force) return true;
  const inc = parsePersist(incoming);
  if (!inc) return false;
  const incSeed = isSeedLike(inc);
  const incAt = persistSavedAt(incoming);
  if (incSeed && incAt === 0) return false;
  const ex = parsePersist(existing);
  if (!ex) return !incSeed || incAt > 0;
  if (allTeachersCount(inc) === 0 && allTeachersCount(ex) > 0) {
    if (!isClearedRegister(inc) || incAt < persistSavedAt(existing)) return false;
  }
  const exSeed = isSeedLike(ex);
  if (incSeed && !exSeed) return false;
  if (!incSeed && exSeed) return true;
  if (incAt < persistSavedAt(existing)) return false;
  if (
    incAt === persistSavedAt(existing) &&
    (ex.cattedre?.length ?? 0) > (inc.cattedre?.length ?? 0)
  ) {
    return false;
  }
  return true;
}

function preferNewer(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return persistSavedAt(b) > persistSavedAt(a) ? b : a;
}

export function readPersistedJsonSync(): string | null {
  if (typeof window === "undefined") return null;
  return lsGet(PERSIST_KEY) ?? ssGet(PERSIST_KEY) ?? OLD_KEYS.map(lsGet).find((v) => v != null) ?? null;
}

export function readMergedPersistSync(): PersistSlice | null {
  if (typeof window === "undefined") return null;
  return mergeAllRaw([lsGet(PERSIST_KEY), ssGet(PERSIST_KEY), ...OLD_KEYS.map(lsGet)]);
}

export async function readPersistedIdb(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  return idbGet(PERSIST_KEY);
}

export async function mirrorPersisted(raw: string): Promise<void> {
  if (!shouldAcceptWrite(raw, lsGet(PERSIST_KEY))) return;
  lsSet(PERSIST_KEY, raw);
  ssSet(PERSIST_KEY, raw);
  for (const key of OLD_KEYS) lsRemove(key);
  await idbSet(PERSIST_KEY, raw);
}

/** Immediate localStorage write so a close mid-flight cannot lose the last edit. */
export function writePersistSync(state: unknown, opts?: { force?: boolean }): void {
  if (typeof window === "undefined") return;
  const value = encodePersist(state);
  if (!shouldAcceptWrite(value, lsGet(PERSIST_KEY), opts?.force === true)) return;
  writesEnabled = true;
  lsSet(PERSIST_KEY, value);
  ssSet(PERSIST_KEY, value);
  for (const key of OLD_KEYS) lsRemove(key);
  void idbSet(PERSIST_KEY, value);
}

/**
 * Writes stay blocked until the registro is loaded from storage.
 * Never overwrite a real save (savedAt > 0) with the example seed (savedAt 0).
 * localStorage is written synchronously; IndexedDB follows in the background.
 */
export function createDurableStorage(): StateStorage {
  if (typeof window === "undefined") return memoryFallback();

  return {
    getItem: (name) => {
      const fromLs = lsGet(name) ?? OLD_KEYS.map(lsGet).find((v) => v != null) ?? null;
      if (fromLs) return fromLs;
      return idbGet(name);
    },
    setItem: (name, value) => {
      if (!writesEnabled) return;
      if (!userMutated && isSeedLike(parsePersist(value))) return;
      const existingLs = lsGet(name);
      if (!shouldAcceptWrite(value, existingLs)) return;
      lsSet(name, value);
      ssSet(name, value);
      for (const key of OLD_KEYS) lsRemove(key);
      void (async () => {
        const idb = await idbGet(name);
        if (!shouldAcceptWrite(value, preferNewer(existingLs, idb))) return;
        await idbSet(name, value);
      })();
    },
    removeItem: (name) => {
      if (!writesEnabled) return;
      lsRemove(name);
      for (const key of OLD_KEYS) lsRemove(key);
      void idbRemove(name);
    },
  };
}

export function requestPersistentStorage(): void {
  if (typeof navigator === "undefined") return;
  void navigator.storage?.persist?.();
}
