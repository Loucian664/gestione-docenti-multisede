/**
 * Più sedi nello stesso archivio.
 *
 * La sede in uso tiene i suoi dati in cima (impostazioni, docenti, classi, orario…), esattamente come
 * l'archivio di un plesso solo: tutte le pagine e il motore lavorano su quelli. Le altre sedi stanno in
 * `altreSedi`, ciascuna con gli stessi dati; cambiare sede scambia i due.
 *
 * Un docente che insegna in più sedi ha una scheda in ognuna, con lo stesso `personId`. Nome, materie,
 * ruolo e colore restano uguali in tutte; classi, ore, × e disposizioni sono di ogni sede.
 */
import type { DayOfWeek, Period, PersistedData, SedeData, Settings, Teacher } from "./types";
import { cattedreOfTeacher } from "./build-timetable";
import { uid } from "./utils";

/** Id della sede di un archivio che non ne ha ancora uno (un backup dell'app di Rombiolo). */
export const FIRST_SEDE_ID = "sede-1";

const SEDE_KEYS = [
  "settings",
  "teachers",
  "classes",
  "slots",
  "absences",
  "substitutions",
  "cattedre",
  "cattedraBackup",
  "cattedraDispBackup",
  "savedTimetables",
  "activeSlot",
  "officialBackup",
] as const satisfies readonly (keyof SedeData)[];

export function sedeIdOf(data: PersistedData): string {
  return data.sedeId || FIRST_SEDE_ID;
}

export function sedeName(settings: Settings): string {
  return settings.schoolName?.trim() || "Sede senza nome";
}

/** I dati della sede in uso. */
export function pickSede(data: PersistedData): SedeData {
  const out = {} as Record<string, unknown>;
  for (const k of SEDE_KEYS) out[k] = data[k];
  return out as SedeData;
}

/** Tutte le voci della sede, anche quelle assenti, così prendono il posto di quelle della sede lasciata. */
function sedeFields(sede: SedeData): SedeData {
  const out = {} as Record<string, unknown>;
  for (const k of SEDE_KEYS) out[k] = sede[k];
  return out as SedeData;
}

/** Una sede come archivio completo (data scelta e salvataggio presi da `data`), per le funzioni di un plesso. */
export function sedeAsData(data: PersistedData, sede: SedeData): PersistedData {
  return { ...data, ...sedeFields(sede) };
}

export type SedeEntry = { id: string; data: SedeData; active: boolean };

/** Le sedi nell'ordine scelto; quella in uso con i suoi dati attuali. */
export function allSedi(data: PersistedData): SedeEntry[] {
  const activeId = sedeIdOf(data);
  const list: SedeEntry[] = [
    { id: activeId, data: pickSede(data), active: true },
    ...(data.altreSedi ?? []).filter((a) => a.id !== activeId).map((a) => ({ id: a.id, data: a.data, active: false })),
  ];
  const order = data.ordineSedi ?? [];
  const pos = (id: string, i: number) => {
    const at = order.indexOf(id);
    return at < 0 ? order.length + i : at;
  };
  return list
    .map((entry, i) => ({ entry, at: pos(entry.id, i) }))
    .sort((a, b) => a.at - b.at)
    .map((x) => x.entry);
}

/** La sede `id` diventa quella in uso; quella lasciata va tra le altre, con tutti i suoi dati. */
export function switchSede(data: PersistedData, id: string): PersistedData {
  const activeId = sedeIdOf(data);
  if (id === activeId) return data;
  const target = (data.altreSedi ?? []).find((a) => a.id === id);
  if (!target) return data;
  const ordineSedi = allSedi(data).map((s) => s.id);
  return {
    ...data,
    ...sedeFields(target.data),
    sedeId: id,
    altreSedi: [...(data.altreSedi ?? []).filter((a) => a.id !== id), { id: activeId, data: pickSede(data) }],
    ordineSedi,
  };
}

/** Cambia i dati di una sede, in uso o no. */
export function editSede(data: PersistedData, id: string, fn: (sede: SedeData) => SedeData): PersistedData {
  if (id === sedeIdOf(data)) return { ...data, ...sedeFields(fn(pickSede(data))), sedeId: id };
  const list = data.altreSedi ?? [];
  if (!list.some((a) => a.id === id)) return data;
  return { ...data, sedeId: sedeIdOf(data), altreSedi: list.map((a) => (a.id === id ? { id, data: fn(a.data) } : a)) };
}

/** Una sede vuota con giorni e campanella copiati da `from`. */
export function newSedeData(from: Settings, name: string): SedeData {
  return {
    settings: {
      ...from,
      schoolName: name,
      responsabile: "",
      days: [...from.days],
      periods: from.periods.map((p) => ({ ...p })),
      monteOre: from.monteOre?.map((r) => ({ ...r })),
    },
    teachers: [],
    classes: [],
    slots: [],
    absences: [],
    substitutions: [],
    cattedre: undefined,
    cattedraBackup: undefined,
    cattedraDispBackup: undefined,
    savedTimetables: [],
    activeSlot: 0,
    officialBackup: undefined,
  };
}

export function addSede(data: PersistedData, sede: SedeData): { data: PersistedData; id: string } {
  const taken = new Set(allSedi(data).map((s) => s.id));
  let id = uid("sede");
  while (taken.has(id)) id = uid("sede");
  return {
    id,
    data: {
      ...data,
      sedeId: sedeIdOf(data),
      altreSedi: [...(data.altreSedi ?? []), { id, data: sede }],
      ordineSedi: [...allSedi(data).map((s) => s.id), id],
    },
  };
}

/** Si elimina solo una sede senza classi, e mai l'ultima. */
/** Si elimina ogni sede tranne l'ultima, con tutto quello che ha (dopo l'avviso con `sedeContents`). */
export function canRemoveSede(data: PersistedData, id: string): boolean {
  const list = allSedi(data);
  return list.length > 1 && list.some((s) => s.id === id);
}

/**
 * Cosa si perde eliminando una sede: classi, lezioni dell'orario, docenti che insegnano solo lì, orari
 * salvati, assenze. I docenti in comune (`shared`) restano nelle altre sedi, senza le ore di questa.
 */
export function sedeContents(data: PersistedData, id: string) {
  const list = allSedi(data);
  const sede = list.find((s) => s.id === id);
  if (!sede) return null;
  const elsewhere = new Set(
    list.filter((s) => s.id !== id).flatMap((s) => s.data.teachers.flatMap((t) => (t.personId ? [t.personId] : []))),
  );
  const shared = sede.data.teachers.filter((t) => t.personId && elsewhere.has(t.personId)).length;
  return {
    classes: sede.data.classes.length,
    lessons: sede.data.slots.length,
    teachers: sede.data.teachers.length - shared,
    shared,
    saved: (sede.data.savedTimetables ?? []).length,
    absences: sede.data.absences.length,
  };
}

export function removeSede(data: PersistedData, id: string): PersistedData {
  if (!canRemoveSede(data, id)) return data;
  let next = data;
  if (id === sedeIdOf(data)) {
    const other = allSedi(data).find((s) => s.id !== id);
    if (!other) return data;
    next = switchSede(data, other.id);
  }
  return {
    ...next,
    altreSedi: (next.altreSedi ?? []).filter((a) => a.id !== id),
    ordineSedi: (next.ordineSedi ?? []).filter((x) => x !== id),
  };
}

/** Una classe con lezioni o cattedre assegnate non si sposta in un'altra sede. */
export function classInUse(sede: SedeData, classId: string): boolean {
  return (
    sede.slots.some((s) => s.classId === classId) ||
    (sede.cattedre ?? []).some((x) => x.classId === classId && x.teacherId) ||
    sede.teachers.some((t) => (t.cardRows ?? []).some((r) => r.classId === classId && r.hours > 0))
  );
}

/** L'anno scolastico è lo stesso per tutte le sedi. */
export function setSchoolYear(data: PersistedData, schoolYear: string): PersistedData {
  return {
    ...data,
    settings: { ...data.settings, schoolYear },
    altreSedi: (data.altreSedi ?? []).map((a) => ({
      id: a.id,
      data: { ...a.data, settings: { ...a.data.settings, schoolYear } },
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Docenti in più sedi

/** Cognome e nome senza accenti, maiuscole e spazi doppi: così si riconosce la stessa persona. */
export function personKey(t: Pick<Teacher, "lastName" | "firstName">): string {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  return `${norm(t.lastName)}|${norm(t.firstName)}`;
}

export type TeacherRecord = { sedeId: string; sede: SedeData; teacher: Teacher; active: boolean };

/** Le schede della stessa persona nelle altre sedi (non in quella in uso). */
export function linkedElsewhere(data: PersistedData, t: Teacher): TeacherRecord[] {
  if (!t.personId) return [];
  const activeId = sedeIdOf(data);
  return (data.altreSedi ?? [])
    .filter((a) => a.id !== activeId)
    .flatMap((a) =>
      a.data.teachers
        .filter((x) => x.personId === t.personId)
        .map((x) => ({ sedeId: a.id, sede: a.data, teacher: x, active: false })),
    );
}

/** Ore di lezione di una scheda nella sua sede: le cattedre, oppure le ore in orario (sostegno). */
export function hoursIn(data: PersistedData, sede: SedeData, teacherId: string): number {
  const asData = sedeAsData(data, sede);
  const cattedre = cattedreOfTeacher(asData, teacherId).reduce((n, c) => n + c.hours, 0);
  if (cattedre > 0) return cattedre;
  return sede.slots.filter((s) => s.teacherId === teacherId).length;
}

export type PersonRow = {
  key: string;
  /** schede della persona, nell'ordine delle sedi */
  records: (TeacherRecord & { sedeName: string; hours: number })[];
};

/** Un docente per riga anche se insegna in più sedi. */
export function persons(data: PersistedData): PersonRow[] {
  const rows = new Map<string, PersonRow>();
  for (const s of allSedi(data)) {
    for (const t of s.data.teachers) {
      const key = t.personId ? `p:${t.personId}` : `t:${s.id}:${t.id}`;
      const row = rows.get(key) ?? { key, records: [] };
      row.records.push({
        sedeId: s.id,
        sede: s.data,
        teacher: t,
        active: s.active,
        sedeName: sedeName(s.data.settings),
        hours: hoursIn(data, s.data, t.id),
      });
      rows.set(key, row);
    }
  }
  return [...rows.values()];
}

const SHARED_FIELDS = ["lastName", "firstName", "subjects", "role", "color"] as const;

/** Dopo aver salvato la scheda nella sede in uso: nome, materie, ruolo e colore uguali nelle altre sedi. */
export function syncPersonFields(data: PersistedData, teacherId: string): PersistedData {
  const t = data.teachers.find((x) => x.id === teacherId);
  if (!t?.personId || !data.altreSedi?.length) return data;
  const shared: Partial<Teacher> = {};
  for (const k of SHARED_FIELDS) (shared as Record<string, unknown>)[k] = t[k];
  return {
    ...data,
    altreSedi: data.altreSedi.map((a) =>
      a.data.teachers.some((x) => x.personId === t.personId)
        ? {
            id: a.id,
            data: {
              ...a.data,
              teachers: a.data.teachers.map((x) => (x.personId === t.personId ? { ...x, ...shared } : x)),
            },
          }
        : a,
    ),
  };
}

/** Una scheda si toglie da una sede solo se lì non ha lezioni né cattedre. */
export function canRemoveRecord(sede: SedeData, teacherId: string): boolean {
  if (sede.slots.some((s) => s.teacherId === teacherId)) return false;
  const t = sede.teachers.find((x) => x.id === teacherId);
  if ((t?.cardRows ?? []).some((r) => r.hours > 0)) return false;
  return !(sede.cattedre ?? []).some((c) => c.teacherId === teacherId && c.hours > 0);
}

function freeTeacherId(sede: SedeData): string {
  const taken = new Set(sede.teachers.map((t) => t.id));
  let id = uid("t");
  while (taken.has(id)) id = uid("t");
  return id;
}

/**
 * Le sedi in cui insegna il docente della sede in uso: nelle sedi aggiunte nasce una scheda collegata
 * (stesso nome, materie, ruolo e colore, senza classi); da quelle tolte la scheda sparisce, se lì non ha
 * lezioni né cattedre. `blocked` elenca le sedi da cui non si è potuto togliere.
 */
export function setTeacherSedi(
  data: PersistedData,
  teacherId: string,
  sedeIds: string[],
): { data: PersistedData; blocked: string[] } {
  const activeId = sedeIdOf(data);
  const t = data.teachers.find((x) => x.id === teacherId);
  if (!t) return { data, blocked: [] };
  const personId = t.personId ?? uid("p");
  const blocked: string[] = [];
  const wanted = new Set(sedeIds);
  let next: PersistedData = t.personId
    ? data
    : { ...data, teachers: data.teachers.map((x) => (x.id === teacherId ? { ...x, personId } : x)) };
  for (const s of allSedi(next)) {
    if (s.id === activeId) continue;
    const there = s.data.teachers.find((x) => x.personId === personId);
    if (wanted.has(s.id) && !there) {
      const record: Teacher = {
        id: freeTeacherId(s.data),
        personId,
        lastName: t.lastName,
        firstName: t.firstName,
        subjects: [...t.subjects],
        role: t.role,
        color: t.color,
        weeklyHours: 0,
        notes: "",
        assignedClassIds: [],
      };
      next = editSede(next, s.id, (sede) => ({ ...sede, teachers: [...sede.teachers, record] }));
    } else if (!wanted.has(s.id) && there) {
      if (!canRemoveRecord(s.data, there.id)) {
        blocked.push(sedeName(s.data.settings));
        continue;
      }
      next = editSede(next, s.id, (sede) => ({
        ...sede,
        teachers: sede.teachers.filter((x) => x.id !== there.id),
        absences: sede.absences.filter((a) => a.teacherId !== there.id),
      }));
    }
  }
  return { data: next, blocked };
}

/** Per ogni docente del backup, le persone con lo stesso cognome e nome già presenti nelle sedi. */
export function nameMatches(
  data: PersistedData,
  incoming: Teacher[],
): { incoming: Teacher; matches: (TeacherRecord & { sedeName: string })[] }[] {
  const out: { incoming: Teacher; matches: (TeacherRecord & { sedeName: string })[] }[] = [];
  const sedi = allSedi(data);
  for (const t of incoming) {
    const key = personKey(t);
    const seen = new Set<string>();
    const matches: (TeacherRecord & { sedeName: string })[] = [];
    for (const s of sedi) {
      for (const x of s.data.teachers) {
        if (personKey(x) !== key) continue;
        // la stessa persona in più sedi conta una volta
        const who = x.personId ? `p:${x.personId}` : `t:${s.id}:${x.id}`;
        if (seen.has(who)) continue;
        seen.add(who);
        matches.push({ sedeId: s.id, sede: s.data, teacher: x, active: s.active, sedeName: sedeName(s.data.settings) });
      }
    }
    if (matches.length) out.push({ incoming: t, matches });
  }
  return out;
}

/**
 * Aggiunge come nuova sede quella in uso nel backup. `links` dice quali docenti del backup sono la stessa
 * persona di un docente già presente (sede e scheda): avranno lo stesso `personId`.
 */
export function importSede(
  data: PersistedData,
  incoming: PersistedData,
  links: { incomingId: string; sedeId: string; teacherId: string }[],
): { data: PersistedData; id: string } {
  let next = data;
  const pidOf = new Map<string, string>();
  for (const link of links) {
    const target = allSedi(next).find((s) => s.id === link.sedeId)?.data.teachers.find((x) => x.id === link.teacherId);
    if (!target) continue;
    const personId = target.personId ?? uid("p");
    if (!target.personId) {
      next = editSede(next, link.sedeId, (sede) => ({
        ...sede,
        teachers: sede.teachers.map((x) => (x.id === link.teacherId ? { ...x, personId } : x)),
      }));
    }
    pidOf.set(link.incomingId, personId);
  }
  const sede = pickSede(incoming);
  const teachers = sede.teachers.map((t) => {
    const personId = pidOf.get(t.id);
    return personId ? { ...t, personId } : t;
  });
  return addSede(next, {
    ...sede,
    settings: { ...sede.settings, schoolYear: data.settings.schoolYear },
    teachers,
    savedTimetables: sede.savedTimetables ?? [],
    activeSlot: sede.activeSlot ?? 0,
  });
}

// ---------------------------------------------------------------------------------------------
// Ore nelle altre sedi

function minutes(hhmm: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Due ore di campanelle diverse si toccano se i loro orari si sovrappongono (senza orari: stessa ora). */
function overlaps(a: Period, b: Period): boolean {
  const as = minutes(a.start);
  const ae = minutes(a.end);
  const bs = minutes(b.start);
  const be = minutes(b.end);
  if (as == null || ae == null || bs == null || be == null) return a.index === b.index;
  return Math.max(as, bs) < Math.min(ae, be);
}

export type ElsewhereCell = {
  day: DayOfWeek;
  /** ora della campanella della sede in uso */
  periodId: string;
  sedeName: string;
  /** classe (o «disp.») nell'altra sede */
  label: string;
  subject: string;
};

/**
 * Le ore in cui il docente della sede in uso insegna (o è a disposizione) in un'altra sede, riportate
 * sulla campanella della sede in uso.
 */
export function elsewhereCells(data: PersistedData, t: Teacher): ElsewhereCell[] {
  const here = data.settings.periods;
  const out = new Map<string, ElsewhereCell>();
  for (const link of linkedElsewhere(data, t)) {
    const theirs = link.sede.settings.periods;
    const name = sedeName(link.sede.settings);
    const busy = [
      ...link.sede.slots
        .filter((s) => s.teacherId === link.teacher.id)
        .map((s) => ({
          day: s.day,
          periodId: s.periodId,
          label: link.sede.classes.find((c) => c.id === s.classId)?.name ?? "lezione",
          subject: s.subject,
        })),
      ...(link.teacher.dispSlots ?? []).map((d) => ({ day: d.day, periodId: d.periodId, label: "disp.", subject: "" })),
    ];
    for (const b of busy) {
      const pb = theirs.find((p) => p.id === b.periodId);
      if (!pb) continue;
      for (const pa of here) {
        if (!overlaps(pa, pb)) continue;
        const key = `${b.day}|${pa.id}`;
        if (!out.has(key)) out.set(key, { day: b.day, periodId: pa.id, sedeName: name, label: b.label, subject: b.subject });
      }
    }
  }
  return [...out.values()];
}

/** Le ore altrove che non sono già una × messa a mano: sono quelle che l'app aggiunge da sé. */
export function autoAwayCells(data: PersistedData, t: Teacher): ElsewhereCell[] {
  const own = t.awaySlots ?? [];
  return elsewhereCells(data, t).filter((c) => !own.some((a) => a.day === c.day && a.periodId === c.periodId));
}

/**
 * I dati della sede in uso per Costruisci e i controlli: chi insegna anche in un'altra sede dell'archivio
 * è «su più plessi» e ha come × le ore che lì è occupato (l'ora di spostamento la lascia il motore).
 */
export function withOtherSedi(data: PersistedData): PersistedData {
  if (!data.altreSedi?.length) return data;
  let changed = false;
  const teachers = data.teachers.map((t) => {
    if (!linkedElsewhere(data, t).length) return t;
    changed = true;
    const extra = autoAwayCells(data, t).map((c) => ({ day: c.day, periodId: c.periodId }));
    return { ...t, otherPlesso: true, awaySlots: [...(t.awaySlots ?? []), ...extra] };
  });
  return changed ? { ...data, teachers } : data;
}
