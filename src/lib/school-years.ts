import { isoDate, schoolYearRange } from "./dates";
import { withFormerTeachers } from "./replace-teacher";
import { officialData } from "./saved-timetables";
import { allSedi, editSede, FIRST_SEDE_ID, sedeAsData, sedeIdOf, sedeName, setSchoolYear } from "./sedi";
import type { ArchivedSedeData, ArchivedYear, PersistedData } from "./types";
import { uid } from "./utils";

/** Una sede così com'è adesso, con l'orario in vigore (slot 0) a cui si riferiscono le sostituzioni. */
function archiveSede(data: PersistedData): ArchivedSedeData {
  const official = officialData(data);
  return {
    settings: data.settings,
    teachers: official.teachers,
    formerTeachers: data.formerTeachers ?? [],
    classes: data.classes,
    slots: official.slots,
    absences: data.absences,
    substitutions: data.substitutions,
    cattedre: data.cattedre,
  };
}

/** L'anno in corso così com'è adesso, con tutte le sedi: ognuna con i suoi dati. */
export function archiveCurrentYear(data: PersistedData, archivedAt = Date.now()): ArchivedYear {
  const sedi = allSedi(data);
  return {
    id: uid("y"),
    schoolYear: data.settings.schoolYear.trim(),
    archivedAt,
    data: archiveSede(data),
    sedeId: sedeIdOf(data),
    altreSedi: sedi.filter((s) => !s.active).map((s) => ({ id: s.id, data: archiveSede(sedeAsData(data, s.data)) })),
    ordineSedi: sedi.map((s) => s.id),
  };
}

/**
 * «Nuovo anno scolastico», in tutte le sedi insieme: l'anno in corso va in archivio (se in una sede ci sono assenze o
 * sostituzioni) e assenze, sostituzioni e chi non è più in servizio ripartono da zero. Docenti, classi, orari (anche
 * negli slot), campanelle e impostazioni restano. Senza anno scritto resta quello di prima.
 */
export function startNewSchoolYear(data: PersistedData, schoolYear: string, archivedAt = Date.now()): PersistedData {
  const archived = data.archivedYears ?? [];
  const hasWork = allSedi(data).some((s) => s.data.absences.length > 0 || s.data.substitutions.length > 0);
  let next = setSchoolYear(data, schoolYear.trim() || data.settings.schoolYear);
  for (const s of allSedi(next)) {
    next = editSede(next, s.id, (sede) => ({ ...sede, absences: [], substitutions: [], formerTeachers: [] }));
  }
  return { ...next, archivedYears: hasWork ? [...archived, archiveCurrentYear(data, archivedAt)] : archived };
}

/** Le sedi di un anno in archivio, nell'ordine di allora. */
export function archivedSedi(year: ArchivedYear): { id: string; name: string; data: ArchivedSedeData }[] {
  const list = [{ id: year.sedeId || FIRST_SEDE_ID, data: year.data }, ...(year.altreSedi ?? [])];
  const order = year.ordineSedi ?? [];
  const pos = (id: string, i: number) => {
    const at = order.indexOf(id);
    return at < 0 ? order.length + i : at;
  };
  return list
    .map((x, i) => ({ x, at: pos(x.id, i) }))
    .sort((a, b) => a.at - b.at)
    .map(({ x }) => ({ id: x.id, name: sedeName(x.data.settings), data: x.data }));
}

/**
 * I dati di una sede in un anno in archivio, pronti per il Report (con chi allora non era più in servizio): la sede
 * con quell'id o, se non c'è, con lo stesso nome; null se quell'anno la sede non c'era.
 */
export function archivedYearData(year: ArchivedYear, sedeId: string, name = ""): PersistedData | null {
  const sedi = archivedSedi(year);
  const sede = sedi.find((s) => s.id === sedeId) ?? (name ? sedi.find((s) => s.name === name) : undefined);
  if (!sede) return null;
  return withFormerTeachers({
    ...sede.data,
    selectedDate: schoolYearRange(year.schoolYear, isoDate(new Date(year.archivedAt))).to,
    activeSlot: 0,
  });
}

/** Assenze e sostituzioni di un anno in archivio, in tutte le sue sedi. */
export function archivedCounts(year: ArchivedYear): { absences: number; substitutions: number; sedi: number } {
  const sedi = archivedSedi(year);
  return {
    absences: sedi.reduce((n, s) => n + s.data.absences.length, 0),
    substitutions: sedi.reduce((n, s) => n + s.data.substitutions.length, 0),
    sedi: sedi.length,
  };
}

/** Gli id di assenze, sostituzioni e docenti non più in servizio già in archivio, di tutte le sedi. */
export function archivedIds(years: ArchivedYear[]): Set<string> {
  return new Set(
    years.flatMap((y) =>
      archivedSedi(y).flatMap((s) =>
        [...s.data.absences, ...s.data.substitutions, ...(s.data.formerTeachers ?? [])].map((x) => x.id),
      ),
    ),
  );
}

/** Nomi da mostrare per gli anni in archivio: lo stesso anno archiviato due volte prende «(2)». */
export function archivedYearLabels(years: ArchivedYear[]): Map<string, string> {
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const y of years) {
    const label = y.schoolYear || "Anno senza nome";
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    out.set(y.id, n > 1 ? `${label} (${n})` : label);
  }
  return out;
}
