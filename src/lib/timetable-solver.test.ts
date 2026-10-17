import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyOrganicoFixes, buildSeed, EMPTY_DATA } from "./seed.ts";
import {
  buildReport,
  dayPatternOptions,
  diffFacts,
  dispAfterLessons,
  dispIntoGaps,
  dispOutcome,
  evaluateCurrent,
  patternExcess,
  prepare,
  solveTimetable,
  TimetableSolver,
  teacherDayInfo,
  teacherHoursHere,
  TimetableEditor,
  type Fact,
  type FindTarget,
  type Prep,
  type FixOption,
  type RowKey,
  type TimetableReport,
} from "./timetable-solver.ts";
import { isMergedSubject, splitMerged } from "./subject-groups.ts";
import { timetableDemand } from "./build-timetable.ts";
import type { DayOfWeek, PersistedData, Teacher, TimetableSlot } from "./types.ts";

function withSlots(data: PersistedData, res: ReturnType<typeof solveTimetable>): PersistedData {
  const ids = new Set(res.slots.map((s) => s.teacherId));
  const keep = data.slots.filter((s) => !ids.has(s.teacherId) || /mensa|p7|p8/.test(s.periodId));
  const { dispSlots } = dispAfterLessons(data, res.slots);
  const teachers = data.teachers.map((t) => (dispSlots[t.id] ? { ...t, dispSlots: dispSlots[t.id] } : t));
  return { ...data, teachers, slots: [...keep, ...res.slots] };
}

/** Orologio finto per la ricerca: lo stesso orario di partenza anche col computer sotto carico. */
function ticks(): () => number {
  let t = 0;
  return () => t++;
}

describe("timetable-solver", () => {
  it("dati vuoti: nessun errore e nessuna ora", () => {
    const res = solveTimetable(EMPTY_DATA, { timeMs: 200, seed: 1 });
    assert.equal(res.slots.length, 0);
    assert.equal(res.report.lessons, 0);
  });

  it("esempio: tutte le ore, nessun vincolo rigido violato", () => {
    const data = buildSeed();
    const res = solveTimetable(data, { timeMs: 1500, seed: 3 });
    const r = res.report;
    assert.equal(r.lessons, r.lessonsExpected);
    const hard = Object.values(r.hard).reduce((n, l) => n + l.length, 0);
    assert.equal(hard, 0);
    // nessun docente in due classi nella stessa ora
    const seen = new Set<string>();
    for (const s of res.slots) {
      const k = `${s.teacherId}|${s.day}|${s.periodId}`;
      assert.ok(!seen.has(k), `sovrapposizione ${k}`);
      seen.add(k);
    }
    // la valutazione dell'orario applicato coincide col resoconto (senza disposizioni segnate)
    const applied = withSlots(data, res);
    const again = evaluateCurrent({ ...applied, teachers: applied.teachers.map((x) => ({ ...x, dispSlots: [] })) });
    assert.equal(again.gapsTotal, r.gapsTotal);
    assert.equal(again.didattica.sameRun.length, r.didattica.sameRun.length);
  });

  it("classe con meno ore: i buchi vanno in fondo, mai in mezzo", () => {
    const data = buildSeed();
    const c0 = data.classes[0]!.id;
    const rows = timetableDemand(data).lessons;
    const next = rows.filter((l) => !(l.classId === c0 && /musica/i.test(l.subject)));
    assert.ok(next.length < rows.length);
    const d2: PersistedData = {
      ...data,
      cattedre: next.map((l) => ({ classId: l.classId, subject: l.subject, teacherId: l.teacherId, hours: l.hours })),
    };
    const res = solveTimetable(d2, { timeMs: 1200, seed: 5 });
    assert.equal(res.report.hard.holes.length, 0);
    assert.equal(res.report.lessons, res.report.lessonsExpected);
  });

  it("obbligo esplicito: più caselle che ore non producono violazioni impossibili", () => {
    const data = buildSeed();
    const t = data.teachers.find((x) => x.role === "religione" || /religione/i.test(x.subjects.join(" "))) as Teacher;
    assert.ok(t);
    const cls = data.classes.slice(0, 2).map((c) => c.id);
    const musts = [
      { day: 1 as const, periodId: "p5", classIds: cls, level: "obbligo" as const },
      { day: 1 as const, periodId: "p6", classIds: cls, level: "obbligo" as const },
      { day: 3 as const, periodId: "p5", classIds: cls, level: "obbligo" as const },
      { day: 3 as const, periodId: "p6", classIds: cls, level: "obbligo" as const },
    ];
    const d2 = { ...data, teachers: data.teachers.map((x) => (x.id === t.id ? { ...x, mustSlots: musts, awaySlots: [] } : x)) };
    const res = solveTimetable(d2, { timeMs: 1500, seed: 2 });
    assert.equal(res.report.hard.must.length, 0);
    const placed = res.slots.filter((s) => s.teacherId === t.id && cls.includes(s.classId));
    for (const s of placed) {
      assert.ok(musts.some((m) => m.day === s.day && m.periodId === s.periodId), `religione fuori dalle caselle: ${s.day} ${s.periodId}`);
    }
  });

  it("preferenza di classe (senza livello): non è un vincolo rigido", () => {
    const data = buildSeed();
    const t = data.teachers.find((x) => x.role === "religione" || /religione/i.test(x.subjects.join(" "))) as Teacher;
    const cls = data.classes.slice(0, 2).map((c) => c.id);
    const wishes = [{ day: 1 as const, periodId: "p6", classIds: cls }];
    const d2 = { ...data, teachers: data.teachers.map((x) => (x.id === t.id ? { ...x, mustSlots: wishes, awaySlots: [] } : x)) };
    const res = solveTimetable(d2, { timeMs: 1200, seed: 9 });
    assert.equal(res.report.hard.must.length, 0);
    assert.equal(res.report.classPref.want, 1);
  });

  it("«Tutte»: vale una qualsiasi classe del docente, anche assegnata dopo; i vecchi «Vorrei» diventano «Tutte»", () => {
    const data = buildSeed();
    const classesOf = (p: Prep, ti: number) => {
      const out = new Set<number>();
      for (let u = 0; u < p.unitTeacher.length; u++) if (p.unitTeacher[u] === ti) out.add(p.unitClass[u]!);
      return [...out].sort((a, b) => a - b);
    };
    const p0 = prepare(data, "demand");
    const ti = p0.teachers.findIndex((_, i) => classesOf(p0, i).length >= 2);
    assert.ok(ti >= 0, "un docente con almeno due classi");
    const id = p0.teachers[ti]!.id;
    const all = classesOf(p0, ti);
    const clean = { awaySlots: [], avoidSlots: [], rientroDays: [], otherPlesso: false };
    // «tutte» obbligatoria, con la copia delle classi ferma a una sola: valgono tutte quelle di adesso
    const marks = [
      { day: 2 as const, periodId: "p3", classIds: [p0.classes[all[0]!]!.id], allClasses: true, level: "obbligo" as const },
    ];
    const d2 = { ...data, teachers: data.teachers.map((x) => (x.id === id ? { ...x, ...clean, mustSlots: marks } : x)) };
    const p2 = prepare(d2, "demand");
    const t2 = p2.teachers.findIndex((x) => x.id === id);
    assert.deepEqual([...p2.must[t2]![0]!.classes].sort((a, b) => a - b), all);
    const res = solveTimetable(d2, { timeMs: 1200, seed: 5 });
    assert.equal(res.report.hard.must.length, 0);
    assert.ok(res.slots.some((x) => x.teacherId === id && x.day === 2 && x.periodId === "p3"), "lezione in quell'ora");
    // i vecchi «Vorrei» (✓): «Classe · se possibile · tutte», una volta per casella; dove c'è già un segno, niente
    const old = {
      ...data,
      teachers: data.teachers.map((x) =>
        x.id === id
          ? {
              ...x,
              ...clean,
              mustSlots: [],
              awaySlots: [{ day: 1 as const, periodId: "p5" }],
              preferSlots: [
                { day: 1 as const, periodId: "p1" },
                { day: 1 as const, periodId: "p5" },
                { day: 1 as const, periodId: "p1" },
              ],
            }
          : x,
      ),
    };
    const fixed = applyOrganicoFixes(old);
    const ft = fixed.teachers.find((x) => x.id === id)!;
    assert.equal(ft.preferSlots, undefined);
    assert.deepEqual(
      (ft.mustSlots ?? []).map((a) => [a.day, a.periodId, a.allClasses, a.level]),
      [[1, "p1", true, "preferenza"]],
    );
    const p3 = prepare(fixed, "demand");
    const t3 = p3.teachers.findIndex((x) => x.id === id);
    assert.equal(p3.cpref[t3]!.length, 1);
    assert.deepEqual([...p3.cpref[t3]![0]!.classes].sort((a, b) => a - b), all);
  });

  it("«no»: mai lezioni in quell'ora", () => {
    const data = buildSeed();
    const picked = data.teachers.filter((x) => x.role === "cattedra").slice(0, 3).map((x) => x.id);
    const no = [1, 2, 3, 4, 5].map((d) => ({ day: d as 1 | 2 | 3 | 4 | 5, periodId: "p1" }));
    const d2 = { ...data, teachers: data.teachers.map((x) => (picked.includes(x.id) ? { ...x, avoidSlots: no } : x)) };
    const res = solveTimetable(d2, { timeMs: 1500, seed: 8 });
    assert.equal(res.report.hard.no.length, 0);
    const bad = res.slots.filter((s) => picked.includes(s.teacherId) && s.periodId === "p1");
    assert.equal(bad.length, 0);
  });

  it("«no» e ×: con «no» l'ora dopo si può usare, con × (altro plesso) serve per lo spostamento", () => {
    const data = buildSeed();
    const res = solveTimetable(data, { timeMs: 1200, seed: 12 });
    const applied = withSlots(data, res);
    const hit = res.slots.find((s) => s.periodId === "p2");
    assert.ok(hit, "c'è almeno una lezione alla 2ª");
    const mark = (patch: Partial<Teacher>): PersistedData => ({
      ...applied,
      teachers: applied.teachers.map((x) =>
        x.id === hit.teacherId ? { ...x, otherPlesso: true, awaySlots: [], avoidSlots: [], ...patch } : x,
      ),
    });
    const first = [{ day: hit.day, periodId: "p1" }];
    const base = evaluateCurrent(mark({}));
    // «no» alla 1ª: la lezione alla 2ª va bene e il giorno non è diviso tra due plessi
    const withNo = evaluateCurrent(mark({ avoidSlots: first }));
    assert.equal(withNo.hard.travel.length, 0);
    assert.equal(withNo.docenti.mixed.length, base.docenti.mixed.length);
    // × alla 1ª per chi è su due plessi: la 2ª serve per lo spostamento
    const withAway = evaluateCurrent(mark({ awaySlots: first }));
    assert.ok(withAway.hard.travel.length > 0, "con × la 2ª resta per lo spostamento");
    assert.equal(withAway.docenti.mixed.length, base.docenti.mixed.length + 1);
    // «no» proprio sull'ora della lezione: vincolo rigido violato
    const onLesson = evaluateCurrent(mark({ avoidSlots: [{ day: hit.day, periodId: "p2" }] }));
    assert.equal(onLesson.hard.no.length, 1);
    assert.ok(onLesson.score.hard > 0);
  });

  it("materie unite: si spostano insieme, ma nella proposta ogni ora ha la sua materia vera", () => {
    const data = buildSeed();
    const rows = timetableDemand(data).lessons;
    const byKey = new Map<string, Map<string, number>>();
    for (const r of rows) {
      if (!["Italiano", "Storia", "Geografia"].includes(r.subject)) continue;
      const k = `${r.classId}|${r.teacherId}`;
      const m = byKey.get(k) ?? new Map<string, number>();
      m.set(r.subject, (m.get(r.subject) ?? 0) + r.hours);
      byKey.set(k, m);
    }
    const merged = [...byKey.entries()].filter(([, m]) => m.size >= 2);
    assert.ok(merged.length > 0, "nell'esempio c'è almeno un docente con italiano, storia e geografia");
    const res = solveTimetable(data, { timeMs: 1500, seed: 10 });
    const odd = res.slots.filter((x) => isMergedSubject(x.subject)).map((x) => x.subject);
    assert.deepEqual(odd, [], "nessuna materia inventata");
    for (const [k, want] of merged) {
      const [classId, teacherId] = k.split("|");
      const got = new Map<string, number>();
      for (const x of res.slots) {
        if (x.classId === classId && x.teacherId === teacherId) got.set(x.subject, (got.get(x.subject) ?? 0) + 1);
      }
      for (const [subject, hours] of want) assert.equal(got.get(subject) ?? 0, hours, `${k} ${subject}`);
    }
    // il resoconto le considera ancora unite: nessuna «materia spezzata» per loro
    assert.ok(!res.report.didattica.split.some((i) => /Italiano|Storia|Geografia/.test(i.text)));
  });

  it("divisione delle ore unite: italiano alle prime ore, le altre in giorni diversi", () => {
    const M = 6;
    // lun 1ª-2ª-3ª, mar 2ª-3ª, mer 4ª-5ª, gio 1ª-2ª, ven 5ª: 10 ore
    const cells = [0, 1, 2, 7, 8, 15, 16, 18, 19, 28];
    const counts = new Map([
      ["Italiano", 6],
      ["Storia", 2],
      ["Geografia", 2],
    ]);
    const subs = splitMerged(cells, M, counts, "Italiano", new Set([0, 1]));
    assert.equal(subs[0], "Italiano");
    assert.equal(subs[1], "Italiano");
    for (const [x, n] of counts) assert.equal(subs.filter((s) => s === x).length, n);
    const days = new Map<number, string[]>();
    cells.forEach((z, i) => days.set(Math.floor(z / M), [...(days.get(Math.floor(z / M)) ?? []), subs[i]!]));
    for (const list of days.values()) {
      assert.ok(list.filter((s) => s === "Storia").length <= 1, list.join(" "));
      assert.ok(list.filter((s) => s === "Geografia").length <= 1, list.join(" "));
      assert.ok(!(list.length === 3 && new Set(list).size === 1), "3 ore di fila della stessa materia");
    }
  });

  it("dalla 1ª alla 6ª con 2 ore buche: vincolo rigido", () => {
    const data = buildSeed();
    const res = solveTimetable(data, { timeMs: 800, seed: 16 });
    const applied = withSlots(data, res);
    const free = (id: string) => {
      const t = applied.teachers.find((x) => x.id === id)!;
      return !t.awaySlots?.length && !t.avoidSlots?.length && !t.rientroDays?.length;
    };
    const morning = new Set(["p1", "p2", "p3", "p4", "p5", "p6"]);
    let pick: { id: string; day: number } | null = null;
    for (const s of res.slots) {
      const mine = applied.slots.filter((x) => x.teacherId === s.teacherId && x.day === s.day);
      if (free(s.teacherId) && mine.length >= 2 && mine.every((x) => morning.has(x.periodId))) {
        pick = { id: s.teacherId, day: s.day };
        break;
      }
    }
    assert.ok(pick, "serve un docente con almeno 2 lezioni in un giorno");
    const mine = applied.slots.filter((x) => x.teacherId === pick!.id && x.day === pick!.day);
    const moved = [
      { ...mine[0]!, periodId: "p1" },
      { ...mine[1]!, periodId: "p6" },
    ];
    const others = applied.slots.filter((x) => !(x.teacherId === pick!.id && x.day === pick!.day));
    const rep = evaluateCurrent({ ...applied, slots: [...others, ...moved] });
    assert.equal(rep.hard.longGaps.length, 1);
    assert.ok(rep.score.hard > 0);
  });

  it("prime ore: italiano e matematica almeno una volta alla 1ª–2ª in ogni classe", () => {
    const res = solveTimetable(buildSeed(), { timeMs: 2500, seed: 11 });
    assert.ok(res.report.firstHours.total > 0);
    assert.equal(res.report.firstHours.ok, res.report.firstHours.total);
  });

  it("prime ore: se il docente alla 1ª non può mai, valgono la 2ª e la 3ª", () => {
    const data = buildSeed();
    const c0 = data.classes[0]!;
    const ita = timetableDemand(data).lessons.find((r) => r.classId === c0.id && r.subject === "Italiano");
    assert.ok(ita, "nell'esempio la prima classe ha italiano");
    const no = [1, 2, 3, 4, 5].map((d) => ({ day: d as 1 | 2 | 3 | 4 | 5, periodId: "p1" }));
    const d2 = {
      ...data,
      teachers: data.teachers.map((x) => (x.id === ita.teacherId ? { ...x, avoidSlots: no, awaySlots: [] } : x)),
    };
    const res = solveTimetable(d2, { timeMs: 2500, seed: 13 });
    assert.ok(res.report.firstHours.shifted.some((i) => i.text.startsWith(`${c0.name}:`)), "blocco alla 2ª–3ª");
    assert.equal(res.report.firstHours.ok, res.report.firstHours.total);
    assert.ok(!res.slots.some((s) => s.teacherId === ita.teacherId && s.periodId === "p1"));
  });

  it("rientro: niente lezioni prima della 4ª in quel giorno", () => {
    const data = buildSeed();
    const t = data.teachers.find((x) => x.role === "cattedra" && /italiano/i.test(x.subjects.join(" ")))!;
    const d2 = { ...data, teachers: data.teachers.map((x) => (x.id === t.id ? { ...x, rientroDays: [2 as const] } : x)) };
    const res = solveTimetable(d2, { timeMs: 1200, seed: 4 });
    const early = res.slots.filter((s) => s.teacherId === t.id && s.day === 2 && ["p1", "p2", "p3"].includes(s.periodId));
    assert.equal(early.length, 0);
  });

  it("altro plesso: mai nell'ora attaccata", () => {
    const data = buildSeed();
    const t = data.teachers.find((x) => x.role === "cattedra" && /inglese/i.test(x.subjects.join(" ")))!;
    const away = [{ day: 1 as const, periodId: "p3" }];
    const d2 = { ...data, teachers: data.teachers.map((x) => (x.id === t.id ? { ...x, otherPlesso: true, awaySlots: away } : x)) };
    const res = solveTimetable(d2, { timeMs: 1200, seed: 6 });
    const bad = res.slots.filter((s) => s.teacherId === t.id && s.day === 1 && ["p2", "p3", "p4"].includes(s.periodId));
    assert.equal(bad.length, 0);
  });

  it("disposizioni: il motore non le tocca; restano, tolte solo quelle sopra una lezione", () => {
    const data = buildSeed();
    const t = data.teachers.find((x) => x.role === "cattedra")!;
    const all = [1, 2, 3, 4, 5].flatMap((d) => ["p1", "p2", "p3", "p4", "p5", "p6"].map((periodId) => ({ day: d as 1 | 2 | 3 | 4 | 5, periodId })));
    const d2 = { ...data, teachers: data.teachers.map((x) => (x.id === t.id ? { ...x, dispSlots: all, dispHours: 2 } : x)) };
    const res = solveTimetable(d2, { timeMs: 800, seed: 7 });
    assert.ok(!("dispSlots" in res), "il risultato contiene solo lezioni");
    const mine = res.slots.filter((s) => s.teacherId === t.id);
    assert.ok(mine.length > 0);
    const { dispSlots, removed } = dispAfterLessons(d2, res.slots);
    assert.equal(removed.length, mine.length);
    assert.equal(dispSlots[t.id]!.length, all.length - mine.length);
    for (const a of dispSlots[t.id]!) {
      assert.ok(!mine.some((s) => s.day === a.day && s.periodId === a.periodId), "disposizione sopra una lezione");
    }
  });

  it("a scuola dalla 1ª alla 6ª e 6 lezioni: solo se non c'è altro modo", () => {
    const res = solveTimetable(buildSeed(), { timeMs: 2500, seed: 14 });
    assert.equal(res.report.docenti.six.length, 0);
    assert.equal(res.report.docenti.span6.length, 0);
  });

  it("materie da 2 ore in giorni diversi, scienze motorie nelle ultime ore, docenti a 18 ore senza buche", () => {
    const res = solveTimetable(buildSeed(), { timeMs: 3000, seed: 17 });
    const r = res.report;
    assert.deepEqual(r.didattica.twoBlock.map((x) => x.text), []);
    assert.ok(r.pe.total > 0);
    assert.equal(r.pe.ok, r.pe.total, r.pe.missing.map((x) => x.text).join("; "));
    assert.deepEqual(r.docenti.full.map((x) => x.text), []);
  });

  it("mai 2 ore buche nello stesso giorno quando si può evitare", () => {
    for (const mode of ["scratch", "improve"] as const) {
      const res = solveTimetable(buildSeed(), { timeMs: 2000, seed: 15, mode });
      assert.equal(res.report.docenti.multiGap.length, 0, `${mode}: ${res.report.docenti.multiGap.map((x) => x.text).join("; ")}`);
    }
  });

  it("Migliora l'attuale: nessuna voce del confronto peggiora", () => {
    const data = buildSeed();
    const applied = withSlots(data, solveTimetable(data, { timeMs: 500, seed: 21 }));
    const cur = evaluateCurrent(applied);
    const res = solveTimetable(applied, { timeMs: 1500, seed: 22, mode: "improve" });
    const r = res.report;
    assert.equal(r.score.pen, 0);
    const low: [string, (x: TimetableReport) => number][] = [
      ["1ª–6ª", (x) => x.docenti.span6.length],
      ["6 lezioni", (x) => x.docenti.six.length],
      ["5 lezioni", (x) => x.docenti.five.length],
      ["buche", (x) => x.gapsTotal],
      ["2+ buche", (x) => x.docenti.multiGap.length],
      ["18 ore", (x) => x.docenti.full.length],
      ["plessi", (x) => x.docenti.mixed.length],
      ["ora sola", (x) => x.docenti.single.length],
      ["ultime ore", (x) => x.docenti.lastHours[0]?.count ?? 0],
      ["2 ore stesso giorno", (x) => x.didattica.twoBlock.length],
      ["pesanti", (x) => x.didattica.heavy.length],
      ["senza leggere", (x) => x.didattica.noLight.length],
      ["lingue", (x) => x.didattica.langBlock.length],
      ["3 di fila", (x) => x.didattica.sameRun.length],
      ["spezzate", (x) => x.didattica.split.length],
      ["prime ore mancate", (x) => x.firstHours.total - x.firstHours.ok],
      ["motoria mancata", (x) => x.pe.total - x.pe.ok],
      ["classi preferite mancate", (x) => x.classPref.want - x.classPref.hit],
    ];
    for (const [name, f] of low) assert.ok(f(r) <= f(cur), `${name}: ${f(cur)} → ${f(r)}`);
  });

  it("disposizioni dell'orario in uso: non sono ore buche e «Migliora» le lascia dove sono", () => {
    const data = buildSeed();
    const res = solveTimetable(data, { timeMs: 600, seed: 23 });
    const applied = withSlots(data, res);
    // un docente con almeno 3 ore libere nel mattino di un giorno con lezioni: mettiamo lì una disposizione
    const morning = ["p1", "p2", "p3", "p4", "p5", "p6"];
    let pick: { id: string; day: DayOfWeek; periodId: string } | null = null;
    for (const s of res.slots) {
      const mine = new Set(applied.slots.filter((x) => x.teacherId === s.teacherId && x.day === s.day).map((x) => x.periodId));
      const t = applied.teachers.find((x) => x.id === s.teacherId)!;
      const free = morning.find((pid) => !mine.has(pid) && !(t.awaySlots ?? []).some((a) => a.day === s.day && a.periodId === pid));
      if (free && !t.otherPlesso) {
        pick = { id: s.teacherId, day: s.day, periodId: free };
        break;
      }
    }
    assert.ok(pick);
    const withDisp: PersistedData = {
      ...applied,
      teachers: applied.teachers.map((x) => (x.id === pick!.id ? { ...x, dispSlots: [{ day: pick!.day, periodId: pick!.periodId }] } : x)),
    };
    const improved = solveTimetable(withDisp, { timeMs: 800, seed: 24, mode: "improve" });
    assert.ok(!improved.slots.some((x) => x.teacherId === pick!.id && x.day === pick!.day && x.periodId === pick!.periodId));
    // una disposizione in mezzo a due lezioni non è un'ora buca
    const t = withDisp.teachers.find((x) => x.id === pick!.id)!;
    const lessons = withDisp.slots.filter((x) => x.teacherId === t.id && x.day === pick!.day);
    const moved = [
      { ...lessons[0]!, periodId: "p1" },
      ...(lessons[1] ? [{ ...lessons[1], periodId: "p3" }] : []),
    ];
    const others = withDisp.slots.filter((x) => !(x.teacherId === t.id && x.day === pick!.day));
    const gapsOf = (disp: { day: DayOfWeek; periodId: string }[]) =>
      evaluateCurrent({
        ...withDisp,
        slots: [...others, ...moved],
        teachers: withDisp.teachers.map((x) => (x.id === t.id ? { ...x, awaySlots: [], dispSlots: disp } : x)),
      }).gapsByTeacher.find((g) => g.id === t.id)!.gaps;
    if (lessons[1]) {
      assert.equal(gapsOf([]) - gapsOf([{ day: pick!.day, periodId: "p2" }]), 1);
    }
  });
  it("ore al giorno: l'ordine dei giorni è libero e le disposizioni da mettere non contano come errore", () => {
    assert.equal(patternExcess([2, 5, 3, 5, 3], [4, 4, 4, 3, 3]), 2);
    assert.equal(patternExcess([3, 4, 4, 3, 4], [4, 4, 4, 3, 3]), 0);
    assert.equal(patternExcess([4, 4, 4, 4, 2], [4, 4, 4, 3, 3]), 1);
    // 16 lezioni con 2 disposizioni ancora da mettere: basta che nessun giorno vada oltre
    assert.equal(patternExcess([4, 4, 3, 3, 2], [4, 4, 4, 3, 3]), 0);
    const opts = dayPatternOptions(18, [6, 6, 6, 6, 6]);
    assert.deepEqual(opts[0], [4, 4, 4, 3, 3]);
    assert.ok(opts.some((o) => o.join() === "5,5,4,4,0"), "con un giorno libero");
    assert.ok(opts.every((o) => Math.max(...o) <= 5 && o.reduce((a, b) => a + b, 0) === 18));
    // tutto il mercoledì altrove: al massimo 4 giorni
    assert.ok(dayPatternOptions(18, [6, 6, 0, 6, 6]).every((o) => o.filter((x) => x > 0).length <= 4));
  });

  it("ore al giorno scelte: rispettate con «Da zero» e sistemate da «Migliora»", () => {
    const data = buildSeed();
    const hours = teacherHoursHere(data);
    const t = data.teachers
      .filter((x) => x.role === "cattedra" && !x.otherPlesso && !(x.rientroDays ?? []).length)
      .sort((a, b) => (hours.get(b.id) ?? 0) - (hours.get(a.id) ?? 0))[0]!;
    const h = hours.get(t.id)!;
    const info = teacherDayInfo(data, t.id)!;
    assert.equal(info.hours, h);
    // una scelta con un giorno libero: la più equilibrata tra quelle in 4 giorni
    const pattern = dayPatternOptions(h, info.cap).find((o) => o.filter((x) => x > 0).length === 4);
    assert.ok(pattern, `una suddivisione in 4 giorni per ${h} ore`);
    const d2 = { ...data, teachers: data.teachers.map((x) => (x.id === t.id ? { ...x, dayPattern: pattern } : x)) };
    const perDay = (slots: { teacherId: string; day: number; periodId: string }[]) => {
      const days = [1, 2, 3, 4, 5].map((d) => new Set(slots.filter((s) => s.teacherId === t.id && s.day === d).map((s) => s.periodId)).size);
      return days;
    };
    const res = solveTimetable(d2, { timeMs: 2500, seed: 31 });
    assert.deepEqual(res.report.hard.pattern.map((x) => x.text), []);
    assert.equal(res.report.patterns.ok, 1);
    const applied = withSlots(d2, res);
    assert.equal(patternExcess(perDay(applied.slots), pattern), 0, perDay(applied.slots).join("-"));
    assert.ok(perDay(applied.slots).includes(0), "il giorno libero c'è");

    // l'orario in uso non la rispetta: «Migliora» la sistema
    const plain = withSlots(data, solveTimetable(data, { timeMs: 800, seed: 32 }));
    const withPattern = { ...plain, teachers: plain.teachers.map((x) => (x.id === t.id ? { ...x, dayPattern: pattern } : x)) };
    const before = evaluateCurrent(withPattern);
    assert.ok(patternExcess(perDay(plain.slots), pattern) > 0, "senza la scelta il docente viene tutti i giorni");
    assert.equal(before.hard.pattern.length, 1);
    assert.ok(before.score.hard > 0);
    const improved = solveTimetable(withPattern, { timeMs: 3000, seed: 33, mode: "improve" });
    assert.deepEqual(improved.report.hard.pattern.map((x) => x.text), []);
    assert.equal(patternExcess(perDay(withSlots(withPattern, improved).slots), pattern), 0);
  });
  it("più suddivisioni scelte: ne basta una", () => {
    const data = buildSeed();
    const hours = teacherHoursHere(data);
    const t = data.teachers
      .filter((x) => x.role === "cattedra" && !x.otherPlesso && !(x.rientroDays ?? []).length)
      .sort((a, b) => (hours.get(b.id) ?? 0) - (hours.get(a.id) ?? 0))[0]!;
    const info = teacherDayInfo(data, t.id)!;
    const four = dayPatternOptions(info.hours, info.cap).filter((o) => o.filter((x) => x > 0).length === 4);
    assert.ok(four.length >= 2, "almeno due suddivisioni in 4 giorni");
    const chosen = four.slice(0, 2);
    const d2 = { ...data, teachers: data.teachers.map((x) => (x.id === t.id ? { ...x, dayPatterns: chosen } : x)) };
    const res = solveTimetable(d2, { timeMs: 2500, seed: 41 });
    assert.deepEqual(res.report.hard.pattern.map((x) => x.text), []);
    const row = res.report.patterns.rows.find((r) => r.id === t.id)!;
    assert.equal(row.excess, 0);
    assert.ok(row.fits.length >= 1);
    const perDay = [1, 2, 3, 4, 5].map((d) => new Set(res.slots.filter((x) => x.teacherId === t.id && x.day === d).map((x) => x.periodId)).size);
    assert.ok(chosen.some((pt) => patternExcess(perDay, pt) === 0), perDay.join("-"));
    // la versione precedente (una sola suddivisione) vale ancora
    const old = { ...data, teachers: data.teachers.map((x) => (x.id === t.id ? { ...x, dayPattern: chosen[0] } : x)) };
    assert.equal(evaluateCurrent(old).patterns.total, 1);
  });

  it("ore bloccate: «Da zero» e «Migliora» le lasciano dove sono, con la loro materia", () => {
    const data = buildSeed();
    const applied = withSlots(data, solveTimetable(data, { timeMs: 800, seed: 42 }));
    const morning = new Set(["p1", "p2", "p3", "p4", "p5", "p6"]);
    const mine = applied.slots.filter((x) => morning.has(x.periodId));
    const pick = [mine[3]!, mine[17]!, mine[40]!];
    const week = mine.find((x) => !pick.some((y) => y.teacherId === x.teacherId))!.teacherId;
    const locked: PersistedData = {
      ...applied,
      teachers: applied.teachers.map((t) => ({
        ...t,
        lockedSlots: pick.filter((x) => x.teacherId === t.id).map((x) => ({ day: x.day, periodId: x.periodId, classId: x.classId })),
        lockWeek: t.id === week,
      })),
    };
    const kept = [...pick, ...mine.filter((x) => x.teacherId === week)];
    for (const mode of ["scratch", "improve"] as const) {
      const res = solveTimetable(locked, { timeMs: 1500, seed: 43, mode });
      for (const k of kept) {
        assert.ok(
          res.slots.some((x) => x.teacherId === k.teacherId && x.classId === k.classId && x.day === k.day && x.periodId === k.periodId && x.subject === k.subject),
          `${mode}: ${k.subject} ${k.day} ${k.periodId} non è rimasta`,
        );
      }
      assert.equal(res.report.lessons, res.report.lessonsExpected);
    }
  });

  it("ritocchi a mano: l'effetto annunciato è quello che si ottiene, e le ore bloccate non si spostano", () => {
    const data = buildSeed();
    const applied = withSlots(data, solveTimetable(data, { timeMs: 800, seed: 44 }));
    const ed = new TimetableEditor(applied);
    const before = evaluateCurrent(applied);
    const c = applied.classes[0]!.id;
    const effects = ed.effects(c, 0);
    let checked = 0;
    for (let z = 1; z < effects.length && checked < 6; z++) {
      const eff = effects[z];
      if (!eff || eff.verdict === "breaks") continue;
      const fresh = new TimetableEditor(applied);
      const out = fresh.apply(c, 0, z)!;
      assert.ok(out, `scambio 0 → ${z}`);
      const keep = applied.slots.filter((x) => !out.slots.some((y) => y.id === x.id) && !/^p[1-6]$/.test(x.periodId));
      const after = evaluateCurrent({ ...applied, slots: [...keep, ...out.slots] });
      // le ore restano le stesse
      assert.equal(out.slots.length, applied.slots.filter((x) => /^p[1-6]$/.test(x.periodId)).length);
      const val = (r: TimetableReport, key: string) =>
        ({
          gaps: r.gapsTotal,
          five: r.docenti.five.length,
          span6: r.docenti.span6.length,
          firstHours: r.firstHours.ok,
          pe: r.pe.ok,
          twoBlock: r.didattica.twoBlock.length,
          heavy: r.didattica.heavy.length,
          langBlock: r.didattica.langBlock.length,
          split: r.didattica.split.length,
          single: r.docenti.single.length,
          lastMax: r.docenti.lastHours[0]?.count ?? 0,
        })[key];
      for (const row of eff.rows) {
        const v0 = val(before, row.key);
        if (v0 === undefined) continue;
        assert.equal(v0, row.from, `${row.key} prima`);
        assert.equal(val(after, row.key), row.to, `${row.key} dopo (0 → ${z})`);
      }
      // nessun docente in due classi insieme
      const seen = new Set<string>();
      for (const x of out.slots) {
        const k = `${x.teacherId}|${x.day}|${x.periodId}`;
        assert.ok(!seen.has(k), `sovrapposizione ${k}`);
        seen.add(k);
      }
      checked += 1;
    }
    assert.ok(checked > 0);
    // un'ora bloccata non si sposta e non viene spostata
    const first = applied.slots.find((x) => x.classId === c && x.day === 1 && x.periodId === "p1")!;
    const lockedData = {
      ...applied,
      teachers: applied.teachers.map((t) =>
        t.id === first.teacherId ? { ...t, lockedSlots: [{ day: 1 as const, periodId: "p1", classId: c }] } : t,
      ),
    };
    const ed2 = new TimetableEditor(lockedData);
    assert.ok(ed2.lessonAt(c, 0)!.locked);
    assert.ok(ed2.effects(c, 0).every((e) => e === null));
    assert.equal(ed2.effect(c, 3, 0), null);
  });
  it("«Trova»: ogni proposta toglie la buca (o sposta la lezione), senza vincoli in più e con l'effetto annunciato", () => {
    const seed = buildSeed();
    const solved = withSlots(seed, solveTimetable(seed, { timeMs: 800, seed: 44 }));
    const withMorning = (slots: TimetableSlot[]): PersistedData => ({
      ...solved,
      slots: [...solved.slots.filter((x) => !/^p[1-6]$/.test(x.periodId)), ...slots],
    });
    // una mossa che crea buche senza vincoli in più: poi «Trova» deve saperle togliere
    const c0 = solved.classes[0]!.id;
    const ed0 = new TimetableEditor(solved);
    const y0 = ed0
      .effects(c0, 0)
      .findIndex((e) => e !== null && e.hard === 0 && e.rows.some((r) => r.key === "gaps" && r.to > r.from));
    assert.ok(y0 > 0, "una mossa che crea buche");
    const data = withMorning(ed0.apply(c0, 0, y0)!.slots);
    const before = evaluateCurrent(data);
    const beforeFacts = new TimetableEditor(data).report(0).facts;
    const val = (r: TimetableReport, key: RowKey): number =>
      ({
        span6: r.docenti.span6.length,
        six: r.docenti.six.length,
        five: r.docenti.five.length,
        gaps: r.gapsTotal,
        multiGap: r.docenti.multiGap.length,
        full: r.docenti.full.length,
        mixed: r.docenti.mixed.length,
        single: r.docenti.single.length,
        lastMax: r.docenti.lastHours[0]?.count ?? 0,
        firstHours: r.firstHours.ok,
        twoBlock: r.didattica.twoBlock.length,
        pe: r.pe.ok,
        heavy: r.didattica.heavy.length,
        noLight: r.didattica.noLight.length,
        langBlock: r.didattica.langBlock.length,
        sameRun: r.didattica.sameRun.length,
        split: r.didattica.split.length,
        patterns: r.patterns.ok,
        classPref: r.classPref.hit,
      })[key];
    const KEYS: RowKey[] = ["span6", "six", "five", "gaps", "multiGap", "full", "mixed", "single", "lastMax", "firstHours"];
    KEYS.push("twoBlock", "pe", "heavy", "noLight", "langBlock", "sameRun", "split", "patterns", "classPref");
    const run = (ed: TimetableEditor, target: FindTarget) => {
      const it = ed.findFixes(target);
      let r = it.next();
      while (!r.done) r = it.next();
      return r.value;
    };
    // rifà le mosse da capo e confronta con il resoconto vero
    const check = (opt: FixOption) => {
      const ed = new TimetableEditor(data);
      let out: ReturnType<TimetableEditor["apply"]> = null;
      for (const st of opt.steps) {
        out = ed.apply(st.classId, st.from, st.to);
        assert.ok(out, "la mossa si può fare");
      }
      const after = evaluateCurrent(withMorning(out!.slots));
      assert.ok(after.score.hard <= before.score.hard, "nessun vincolo rigido in più");
      const rows = new Map(opt.effect.rows.map((r) => [r.key, r]));
      for (const k of KEYS) assert.equal(val(after, k), rows.get(k)?.to ?? val(before, k), `${k} come annunciato`);
      assert.deepEqual(opt.effect.who, diffFacts(beforeFacts, ed.report(0).facts), "chi cambia come annunciato");
      return { ed, after };
    };
    let found = 0;
    for (const g of before.gapsByTeacher.filter((x) => x.gaps > 0)) {
      for (const cell of g.cells) {
        const ed = new TimetableEditor(data);
        const res = run(ed, { kind: "gap", teacherId: g.id, z: ed.cell(cell.day, cell.periodId) });
        assert.equal(res.partial, false);
        assert.ok(res.options.length <= 3);
        for (const opt of res.options) {
          const { after } = check(opt);
          assert.ok(after.gapsTotal < before.gapsTotal, "le ore buche calano");
          const still = after.gapsByTeacher
            .find((x) => x.id === g.id)
            ?.cells.some((x) => x.day === cell.day && x.periodId === cell.periodId);
          assert.ok(!still, "la buca non c'è più");
          found += 1;
        }
      }
    }
    assert.ok(found > 0, "almeno una proposta per le buche");
    // una lezione: va davvero altrove
    const ed1 = new TimetableEditor(data);
    const z1 = [3, 4, 5, 6, 7].find((z) => ed1.lessonAt(c0, z))!;
    const lesson = ed1.lessonAt(c0, z1)!;
    const res = run(ed1, { kind: "lesson", classId: c0, z: z1 });
    assert.ok(res.options.length > 0);
    for (const opt of res.options) {
      const now = check(opt).ed.lessonAt(c0, z1);
      assert.ok(!now || now.teacherId !== lesson.teacherId || now.subject !== lesson.subject, "la lezione non è più lì");
    }
    // «Ferma»: finisce subito, con quello che ha trovato fin lì
    const it = new TimetableEditor(data).findFixes({ kind: "lesson", classId: c0, z: z1 });
    it.next();
    let r = it.next(true);
    while (!r.done) r = it.next(true);
    assert.equal(r.value.partial, true);
  });

  it("chi cambia: per docente e per classe, come le voci in tutto, senza toccare l'orario", () => {
    const data = buildSeed();
    const applied = withSlots(data, solveTimetable(data, { timeMs: 800, seed: 44 }));
    const ed = new TimetableEditor(applied);
    const before = ed.report(0).facts;
    const sig = JSON.stringify(before);
    // per prime ore, motoria, ore al giorno e classi preferite le voci in tutto contano quelle che vanno bene
    const HIGH = new Set<RowKey>(["firstHours", "pe", "patterns", "classPref"]);
    const count = (facts: Fact[], row: RowKey) =>
      facts.filter((f) => f.row === row).reduce((a, f) => a + (row === "classPref" ? f.n : 1), 0);
    let checked = 0;
    let gapTold = 0;
    for (const cl of applied.classes.slice(0, 3)) {
      for (let from = 0; from < 6; from++) {
        if (!ed.lessonAt(cl.id, from)) continue;
        ed.effects(cl.id, from).forEach((eff, to) => {
          if (!eff) return;
          const who = ed.whoChanges([{ classId: cl.id, from, to }]);
          assert.ok(who, `${cl.name} ${from} → ${to}: si può fare`);
          assert.equal(JSON.stringify(ed.report(0).facts), sig, "l'orario resta com'era");
          const done = new TimetableEditor(applied);
          done.apply(cl.id, from, to);
          const after = done.report(0).facts;
          assert.deepEqual(who, diffFacts(before, after), "come facendo davvero lo spostamento");
          for (const r of eff.rows) {
            if (r.key === "full" || r.key === "lastMax") continue;
            const d = count(after, r.key) - count(before, r.key);
            assert.equal(d, HIGH.has(r.key) ? r.from - r.to : r.to - r.from, `${r.key}: per docente e classe come in tutto`);
          }
          // a chi va un'ora buca in più è scritto
          const gaps = eff.rows.find((r) => r.key === "gaps");
          if (gaps && gaps.to > gaps.from) {
            const told = who!.some(
              (w) =>
                w.who.kind === "teacher" &&
                w.parts.some((p) => p.day && p.items.some((i) => !i.better && /^or[ae] buc[ah]e? nuov[ae] \(/.test(i.text))),
            );
            assert.ok(told, `${cl.name} ${from} → ${to}: l'ora buca nuova ha un nome`);
            gapTold += 1;
          }
          checked += 1;
        });
      }
    }
    assert.ok(checked > 100 && gapTold > 0);
  });

  it("ore buche: un'ora vuota tra due lezioni; «no» in mezzo conta, disposizione e × no", () => {
    const data = buildSeed();
    const applied = withSlots(data, solveTimetable(data, { timeMs: 600, seed: 51 }));
    const morning = new Set(["p1", "p2", "p3", "p4", "p5", "p6"]);
    let pick: { id: string; day: DayOfWeek } | null = null;
    for (const s of applied.slots) {
      const t = applied.teachers.find((x) => x.id === s.teacherId)!;
      if (t.otherPlesso || t.awaySlots?.length || t.avoidSlots?.length || t.rientroDays?.length || t.dispSlots?.length) continue;
      const mine = applied.slots.filter((x) => x.teacherId === s.teacherId && x.day === s.day);
      if (mine.length >= 2 && mine.every((x) => morning.has(x.periodId))) {
        pick = { id: s.teacherId, day: s.day };
        break;
      }
    }
    assert.ok(pick, "serve un docente con almeno 2 lezioni in un giorno");
    const mine = applied.slots.filter((x) => x.teacherId === pick!.id && x.day === pick!.day);
    // solo due lezioni quel giorno, alla 1ª e alla 3ª: la 2ª è vuota
    const moved = [
      { ...mine[0]!, periodId: "p1" },
      { ...mine[1]!, periodId: "p3" },
    ];
    const others = applied.slots.filter((x) => !(x.teacherId === pick!.id && x.day === pick!.day));
    const at = (patch: Partial<Teacher>) =>
      evaluateCurrent({
        ...applied,
        slots: [...others, ...moved],
        teachers: applied.teachers.map((x) => (x.id === pick!.id ? { ...x, ...patch } : x)),
      });
    const p2 = [{ day: pick.day, periodId: "p2" }];
    const gapsOf = (r: TimetableReport) => r.gapsByTeacher.find((g) => g.id === pick!.id)!;
    const free = at({});
    assert.ok(gapsOf(free).cells.some((c) => c.day === pick!.day && c.periodId === "p2"));
    const base = gapsOf(free).gaps;
    assert.equal(free.gapsTotal, free.gapsByTeacher.reduce((n, g) => n + g.cells.length, 0));
    // «no» alla 2ª: resta un'ora buca
    assert.equal(gapsOf(at({ avoidSlots: p2 })).gaps, base);
    // a disposizione alla 2ª: non è una buca, ma si vede tra le ore «tra due lezioni»
    const disp = at({ dispSlots: p2, dispHours: 1 });
    assert.equal(gapsOf(disp).gaps, base - 1);
    assert.equal(disp.notGaps.disp.length, 1);
    // altrove alla 2ª: non è una buca
    const away = at({ awaySlots: p2 });
    assert.equal(gapsOf(away).gaps, base - 1);
    assert.equal(away.notGaps.away.length, 1);
  });
  it("«Da zero»: le buche dove vanno le disposizioni del docente non contano (ore al giorno permettendo)", () => {
    const data = buildSeed();
    const applied = withSlots(data, solveTimetable(data, { timeMs: 600, seed: 52 }));
    const morning = new Set(["p1", "p2", "p3", "p4", "p5", "p6"]);
    let pick: { id: string; day: DayOfWeek } | null = null;
    for (const s of applied.slots) {
      const t = applied.teachers.find((x) => x.id === s.teacherId)!;
      if (t.otherPlesso || t.awaySlots?.length || t.avoidSlots?.length || t.rientroDays?.length) continue;
      const mine = applied.slots.filter((x) => x.teacherId === s.teacherId && x.day === s.day);
      if (mine.length === 2 && mine.every((x) => morning.has(x.periodId))) {
        pick = { id: s.teacherId, day: s.day };
        break;
      }
    }
    assert.ok(pick, "serve un docente con 2 lezioni in un giorno");
    const mine = applied.slots.filter((x) => x.teacherId === pick!.id && x.day === pick!.day);
    const others = applied.slots.filter((x) => !(x.teacherId === pick!.id && x.day === pick!.day));
    // lezioni alla 1ª e alla 4ª: la 2ª e la 3ª sono buche
    const slots = [...others, { ...mine[0]!, periodId: "p1" }, { ...mine[1]!, periodId: "p4" }];
    // come in «Da zero»: le disposizioni non sono ancora al loro posto
    const report = (patch: Partial<Teacher>) => {
      const d2: PersistedData = {
        ...applied,
        slots,
        teachers: applied.teachers.map((x) => (x.id === pick!.id ? { ...x, dispSlots: [], ...patch } : x)),
      };
      const prep = prepare(d2, "slots", { keepDisp: false });
      const s = new TimetableSolver(prep, 1);
      s.setState(prep.unitStart);
      return buildReport(s, prep.U);
    };
    const row = (r: TimetableReport) => r.gapsByTeacher.find((g) => g.id === pick!.id)!;
    assert.equal(row(report({ dispHours: 0 })).gaps, 2);
    // una disposizione: va in una delle due buche, ne resta una
    const one = report({ dispHours: 1 });
    assert.equal(row(one).gaps, 1);
    assert.equal(row(one).fill.length, 1);
    assert.ok(one.dispFill.some((i) => i.text.startsWith(row(one).name)));
    assert.ok(!one.docenti.multiGap.some((i) => i.text.startsWith(row(one).name)), "non sono più 2 buche nello stesso giorno");
    // due disposizioni: nessuna buca
    assert.equal(row(report({ dispHours: 2 })).gaps, 0);
    // ore al giorno scelte esattamente come le lezioni: riempire la buca le supererebbe, quindi resta
    const perDay = [1, 2, 3, 4, 5].map(
      (d) => new Set(slots.filter((x) => x.teacherId === pick!.id && x.day === d).map((x) => x.periodId)).size,
    );
    const exact = [...perDay].sort((a, b) => b - a);
    const tight = report({ dispHours: 1, dayPatterns: [exact] });
    assert.equal(row(tight).gaps, 2);
    assert.equal(row(tight).fill.length, 0);
    // con un'ora in più proprio per quel giorno, la disposizione ci entra
    const roomy = [...perDay];
    roomy[pick.day - 1]! += 1;
    const loose = report({ dispHours: 1, dayPatterns: [roomy.sort((a, b) => b - a)] });
    assert.equal(row(loose).gaps, 1);
    assert.equal(row(loose).fill.length, 1);
    assert.equal(loose.hard.pattern.length, 0);
  });

  /** Un docente «semplice» (niente ×, «no», rientri, disposizioni) con `n` lezioni del mattino in un giorno. */
  function pickTeacherDay(applied: PersistedData, n: number): { id: string; day: DayOfWeek } {
    const morning = new Set(["p1", "p2", "p3", "p4", "p5", "p6"]);
    for (const s of applied.slots) {
      const t = applied.teachers.find((x) => x.id === s.teacherId)!;
      if (t.otherPlesso || t.awaySlots?.length || t.avoidSlots?.length || t.rientroDays?.length || t.dispSlots?.length) continue;
      if ((t.lockedSlots?.length ?? 0) > 0 || t.lockWeek) continue;
      const mine = applied.slots.filter((x) => x.teacherId === s.teacherId && x.day === s.day);
      if (mine.length === n && mine.every((x) => morning.has(x.periodId))) return { id: s.teacherId, day: s.day };
    }
    throw new Error(`serve un docente con ${n} lezioni in un giorno`);
  }

  /**
   * Lo stesso orario, con le lezioni di quel docente e giorno alle ore date (scambiate con quelle della
   * classe, così nessuna classe ha due lezioni insieme) e le modifiche al docente.
   */
  function reshape(applied: PersistedData, pick: { id: string; day: DayOfWeek }, periods: string[], patch: Partial<Teacher>) {
    const slots = applied.slots.map((x) => ({ ...x }));
    const idx = new Map(applied.settings.periods.map((x) => [x.id, x.index]));
    const mine = slots
      .filter((x) => x.teacherId === pick.id && x.day === pick.day)
      .sort((a, b) => idx.get(a.periodId)! - idx.get(b.periodId)!);
    mine.forEach((x, i) => {
      const target = periods[i]!;
      if (x.periodId === target) return;
      const other = slots.find((y) => y !== x && y.classId === x.classId && y.day === x.day && y.periodId === target);
      if (other) other.periodId = x.periodId;
      x.periodId = target;
    });
    return { ...applied, slots, teachers: applied.teachers.map((x) => (x.id === pick.id ? { ...x, ...patch } : x)) };
  }

  it("al massimo un'ora libera tra le lezioni: contano buche e disposizioni, salvo chi ne accetta 2", () => {
    const data = buildSeed();
    const applied = withSlots(data, solveTimetable(data, { timeMs: 600, seed: 61 }));
    const pick = pickTeacherDay(applied, 3);
    const name = prepare(applied, "slots").teachers.find((t) => t.id === pick.id)!.name;
    // lezioni alla 1ª, 2ª e 5ª: in mezzo la 3ª e la 4ª
    const at = (patch: Partial<Teacher>) => reshape(applied, pick, ["p1", "p2", "p5"], patch);
    const mine = (r: TimetableReport) => r.hard.longGaps.filter((i) => i.text.startsWith(`${name} · `));
    const hardOf = (d: PersistedData) => {
      const prep = prepare(d, "slots");
      const s = new TimetableSolver(prep, 1);
      s.setState(prep.unitStart);
      return s.hard;
    };
    const two = evaluateCurrent(at({}));
    assert.equal(mine(two).length, 1);
    assert.match(mine(two)[0]!.text, /2 ore libere tra le lezioni$/);
    // disposizioni alla 3ª e alla 4ª: niente buche, ma restano 2 ore libere in mezzo
    const disp2 = evaluateCurrent(
      at({ dispHours: 2, dispSlots: [{ day: pick.day, periodId: "p3" }, { day: pick.day, periodId: "p4" }] }),
    );
    assert.equal(disp2.gapsByTeacher.find((g) => g.id === pick.id)?.gaps ?? 0, 0);
    assert.match(mine(disp2)[0]!.text, /2 ore libere tra le lezioni \(a disposizione\)$/);
    const disp1 = evaluateCurrent(at({ dispHours: 1, dispSlots: [{ day: pick.day, periodId: "p3" }] }));
    assert.match(mine(disp1)[0]!.text, /\(1 a disposizione\)$/);
    // una sola ora libera in mezzo: va bene
    assert.equal(mine(evaluateCurrent(reshape(applied, pick, ["p1", "p2", "p4"], {}))).length, 0);
    // il docente le accetta: niente vincolo, e il motore conta un vincolo in meno
    assert.equal(mine(evaluateCurrent(at({ allowTwoFree: true }))).length, 0);
    assert.equal(hardOf(at({})), hardOf(at({ allowTwoFree: true })) + 1);
  });

  it("chi non accetta ore libere non ha buche; «accetta 2 ore libere» non vale; una disposizione non è una buca", () => {
    const data = buildSeed();
    const applied = withSlots(data, solveTimetable(data, { timeMs: 600, seed: 61, now: ticks() }));
    const pick = pickTeacherDay(applied, 3);
    const name = prepare(applied, "slots").teachers.find((t) => t.id === pick.id)!.name;
    const mine = (r: TimetableReport) => r.hard.longGaps.filter((i) => i.text.startsWith(`${name} · `));
    const hardOf = (d: PersistedData) => {
      const prep = prepare(d, "slots");
      const s = new TimetableSolver(prep, 1);
      s.setState(prep.unitStart);
      return s.hard;
    };
    // lezioni alla 1ª, 2ª e 4ª: in mezzo una buca (la 3ª), che di norma va bene
    const hole = (patch: Partial<Teacher>) => reshape(applied, pick, ["p1", "p2", "p4"], patch);
    const none = /1 ora buca, che il docente non accetta$/;
    assert.ok(!mine(evaluateCurrent(hole({}))).some((i) => none.test(i.text)));
    assert.ok(mine(evaluateCurrent(hole({ noGaps: true }))).some((i) => none.test(i.text)));
    assert.ok(hardOf(hole({ noGaps: true })) > hardOf(hole({})));
    // lezioni alla 1ª, 2ª e 5ª: «accetta 2 ore libere» non basta a chi non accetta ore libere
    const two = reshape(applied, pick, ["p1", "p2", "p5"], { noGaps: true, allowTwoFree: true });
    assert.ok(mine(evaluateCurrent(two)).some((i) => /2 ore buche, che il docente non accetta$/.test(i.text)));
    // un'ora a disposizione tra le lezioni è presenza, non una buca
    const disp = hole({ noGaps: true, dispHours: 1, dispSlots: [{ day: pick.day, periodId: "p3" }] });
    assert.ok(!mine(evaluateCurrent(disp)).some((i) => /non accetta$/.test(i.text)));
  });

  it("«Migliora l'attuale» toglie la buca a chi non la accetta", () => {
    const data = buildSeed();
    const applied = withSlots(data, solveTimetable(data, { timeMs: 600, seed: 61, now: ticks() }));
    const pick = pickTeacherDay(applied, 3);
    const name = prepare(applied, "slots").teachers.find((t) => t.id === pick.id)!.name;
    const refused = (r: TimetableReport) =>
      r.hard.longGaps.filter((i) => i.text.startsWith(`${name} · `) && i.text.includes("che il docente non accetta"));
    // lezioni alla 1ª, 2ª e 4ª: una buca alla 3ª; il docente non le accetta
    const start = reshape(applied, pick, ["p1", "p2", "p4"], { noGaps: true });
    assert.ok(refused(evaluateCurrent(start)).length > 0, "all'inizio la buca c'è");
    const res = solveTimetable(start, { timeMs: 1500, seed: 71, mode: "improve", now: ticks() });
    assert.equal(refused(res.report).length, 0);
    assert.equal(res.report.gapsByTeacher.find((g) => g.id === pick.id)?.gaps ?? 0, 0);
  });

  it("disposizioni: nei ritocchi si spostano nello stesso giorno per chiudere un'ora buca, nell'orario in uso no", () => {
    const data = buildSeed();
    const applied = withSlots(data, solveTimetable(data, { timeMs: 600, seed: 62 }));
    const pick = pickTeacherDay(applied, 2);
    // disposizione alla 3ª, lezioni alla 5ª e 6ª: la 4ª è una buca
    const d2 = reshape(applied, pick, ["p5", "p6"], { dispHours: 1, dispSlots: [{ day: pick.day, periodId: "p3" }] });
    const gapCells = (r: TimetableReport) => r.gapsByTeacher.find((g) => g.id === pick.id)?.cells ?? [];
    assert.ok(gapCells(evaluateCurrent(d2)).some((c) => c.day === pick.day && c.periodId === "p4"));
    const ed = new TimetableEditor(d2);
    assert.ok(!gapCells(ed.report(0)).some((c) => c.day === pick.day), "la disposizione chiude la buca");
    assert.equal(ed.teacherAt(pick.id, ed.cell(pick.day, "p4")).kind, "disp");
    assert.equal(ed.teacherAt(pick.id, ed.cell(pick.day, "p3")).kind, "free");
    const out = dispOutcome(d2, ed.slots(), ed.dispChange());
    assert.deepEqual(out.moved, [{ teacherId: pick.id, day: pick.day, from: "p3", to: "p4" }]);
    assert.deepEqual(out.dispSlots[pick.id], [{ day: pick.day, periodId: "p4" }]);
    assert.equal(out.removed.length, 0);
    // senza le informazioni del motore («Da zero»): come prima
    assert.deepEqual(dispOutcome(d2, ed.slots(), null), { ...dispAfterLessons(d2, ed.slots()), moved: [] });
  });

  it("ritocchi: una lezione sull'ora a disposizione la sposta nello stesso giorno (effetto annunciato = ottenuto)", () => {
    const data = buildSeed();
    const applied = withSlots(data, solveTimetable(data, { timeMs: 600, seed: 63 }));
    const pick = pickTeacherDay(applied, 2);
    // lezioni alla 1ª e 2ª, disposizione alla 3ª; la lezione della 2ª va alla 3ª
    const d2 = reshape(applied, pick, ["p1", "p2"], { dispHours: 1, dispSlots: [{ day: pick.day, periodId: "p3" }] });
    const lesson = d2.slots.find((x) => x.teacherId === pick.id && x.day === pick.day && x.periodId === "p2")!;
    const ed = new TimetableEditor(d2);
    const from = ed.cell(pick.day, "p2");
    const to = ed.cell(pick.day, "p3");
    const eff = ed.effects(lesson.classId, from)[to];
    assert.ok(eff, "lo spostamento si può fare");
    assert.equal(eff.dispLost.length, 0);
    assert.equal(eff.dispMoved.length, 1);
    assert.match(eff.dispMoved[0]!, / 3ª → 2ª$/);
    const done = ed.apply(lesson.classId, from, to)!;
    assert.deepEqual(done.dispMoved, eff.dispMoved);
    assert.equal(ed.teacherAt(pick.id, ed.cell(pick.day, "p2")).kind, "disp");
    // dopo il salvataggio: la disposizione alla 2ª
    const keep = d2.slots.filter((x) => !done.slots.some((y) => y.id === x.id));
    const after = { ...d2, slots: [...keep, ...done.slots] };
    const out = dispOutcome(d2, done.slots, new TimetableEditor(after).dispChange());
    assert.deepEqual(out.dispSlots[pick.id], [{ day: pick.day, periodId: "p2" }]);
  });

  it("«Migliora l'attuale»: nessuna disposizione che, spostata nello stesso giorno, chiuderebbe un'ora buca", () => {
    const data = buildSeed();
    const applied = withSlots(data, solveTimetable(data, { timeMs: 600, seed: 64 }));
    const pick = pickTeacherDay(applied, 2);
    const d2 = reshape(applied, pick, ["p5", "p6"], { dispHours: 1, dispSlots: [{ day: pick.day, periodId: "p3" }] });
    const res = solveTimetable(d2, { timeMs: 800, seed: 65, mode: "improve" });
    assert.ok(res.disp, "la proposta dice dove stanno le disposizioni");
    const idx = new Map(d2.settings.periods.map((x) => [x.id, x.index]));
    // ore buche tra il primo e l'ultimo impegno (lezioni e disposizioni) del mattino
    const gapsOf = (busy: number[]) => {
      const lo = Math.min(...busy);
      const hi = Math.max(...busy);
      let n = 0;
      for (let h = lo + 1; h < hi; h++) if (!busy.includes(h)) n += 1;
      return n;
    };
    for (const day of d2.settings.days) {
      const lessons = res.slots.filter((x) => x.teacherId === pick.id && x.day === day).map((x) => idx.get(x.periodId)!);
      const disp = res.disp.after.filter((x) => x.teacherId === pick.id && x.day === day).map((x) => idx.get(x.periodId)!);
      if (!lessons.length || !disp.length) continue;
      const now = gapsOf([...lessons, ...disp]);
      for (const a of disp)
        for (let h = 1; h <= 6; h++) {
          if (lessons.includes(h) || disp.includes(h)) continue;
          const moved = disp.map((x) => (x === a ? h : x));
          assert.ok(gapsOf([...lessons, ...moved]) >= now, `giorno ${day}: la disposizione della ${a}ª chiuderebbe una buca alla ${h}ª`);
        }
    }
  });

  /** Docenti con 3 lezioni del mattino un giorno (a) e 2 o 4 un altro (b): per le disposizioni nelle buche. */
  function* twoDays(applied: PersistedData) {
    const morning = new Set(["p1", "p2", "p3", "p4", "p5", "p6"]);
    for (const t of applied.teachers) {
      if (t.otherPlesso || t.awaySlots?.length || t.avoidSlots?.length || t.rientroDays?.length || t.dispSlots?.length) continue;
      if ((t.lockedSlots?.length ?? 0) > 0 || t.lockWeek || t.dayPatterns?.length || t.dayPattern) continue;
      const on = (day: DayOfWeek) => applied.slots.filter((x) => x.teacherId === t.id && x.day === day);
      const ok = (day: DayOfWeek, n: number[]) => n.includes(on(day).length) && on(day).every((x) => morning.has(x.periodId));
      for (const a of applied.settings.days) {
        if (!ok(a, [3])) continue;
        for (const b of applied.settings.days) if (b !== a && ok(b, [2, 4])) yield { id: t.id, a, b, nB: on(b).length };
      }
    }
  }

  /** Il primo docente di twoDays per cui `make` dà un orario con `gaps` ore buche nella settimana. */
  function withGaps(applied: PersistedData, gaps: number, make: (c: { id: string; a: DayOfWeek; b: DayOfWeek; nB: number }) => PersistedData) {
    for (const c of twoDays(applied)) {
      const d = make(c);
      if (gapsOf(d, c.id) === gaps) return { ...c, d };
    }
    throw new Error(`serve un docente con ${gaps} ore buche`);
  }

  function gapsOf(d: PersistedData, id: string): number {
    return evaluateCurrent(d).gapsByTeacher.find((g) => g.id === id)?.gaps ?? 0;
  }

  function withPlan(d: PersistedData, plan: ReturnType<typeof dispIntoGaps>): PersistedData {
    return { ...d, teachers: d.teachers.map((t) => (plan.dispSlots[t.id] ? { ...t, dispSlots: plan.dispSlots[t.id] } : t)) };
  }

  it("disposizioni nelle buche: anche da un altro giorno, ma solo se nient'altro peggiora", () => {
    const data = buildSeed();
    const applied = withSlots(data, solveTimetable(data, { timeMs: 600, seed: 61, now: ticks() }));
    // giorno a: lezioni alla 1ª, 2ª e 4ª (buca alla 3ª); giorno b: lezioni di fila e la disposizione subito dopo
    const { d, id, a, b, nB } = withGaps(applied, 1, (c) =>
      reshape(reshape(applied, { id: c.id, day: c.a }, ["p1", "p2", "p4"], {}), { id: c.id, day: c.b }, ["p1", "p2", "p3", "p4"].slice(0, c.nB), {
        dispHours: 1,
        dispSlots: [{ day: c.b, periodId: `p${c.nB + 1}` }],
      }),
    );
    const plan = dispIntoGaps(d);
    assert.deepEqual(plan.moves, [{ teacherId: id, from: { day: b, periodId: `p${nB + 1}` }, to: { day: a, periodId: "p3" } }]);
    assert.deepEqual(plan.dispSlots, { [id]: [{ day: a, periodId: "p3" }] });
    assert.equal(gapsOf(withPlan(d, plan), id), 0);
    assert.equal(evaluateCurrent(withPlan(d, plan)).score.hard, evaluateCurrent(d).score.hard);
    // con le ore al giorno di adesso come scelta lo spostamento le cambierebbe: la disposizione resta dov'è
    const now = [...teacherDayInfo(d, id)!.now!].sort((x, y) => y - x);
    const fixed = { ...d, teachers: d.teachers.map((t) => (t.id === id ? { ...t, dayPatterns: [now] } : t)) };
    assert.deepEqual(dispIntoGaps(fixed), { dispSlots: {}, moves: [] });
  });

  it("disposizioni: si spostano anche per rispettare le ore al giorno scelte, senza fare buche", () => {
    const data = buildSeed();
    const applied = withSlots(data, solveTimetable(data, { timeMs: 600, seed: 61, now: ticks() }));
    // giorno a: lezioni alla 1ª, 2ª e 3ª; giorno b: lezioni di fila e la disposizione subito dopo
    const { d, id, a, b, nB } = withGaps(applied, 0, (c) =>
      reshape(reshape(applied, { id: c.id, day: c.a }, ["p1", "p2", "p3"], {}), { id: c.id, day: c.b }, ["p1", "p2", "p3", "p4"].slice(0, c.nB), {
        dispHours: 1,
        dispSlots: [{ day: c.b, periodId: `p${c.nB + 1}` }],
      }),
    );
    // ore al giorno scelte: quelle con la disposizione nel giorno a invece che nel b
    const days = prepare(d, "slots").days;
    const want = [...teacherDayInfo(d, id)!.now!];
    want[days.indexOf(a)]! += 1;
    want[days.indexOf(b)]! -= 1;
    const fixed = { ...d, teachers: d.teachers.map((t) => (t.id === id ? { ...t, dayPatterns: [want.sort((x, y) => y - x)] } : t)) };
    assert.equal(evaluateCurrent(fixed).hard.pattern.length, 1);
    const plan = dispIntoGaps(fixed);
    assert.equal(plan.moves.length, 1);
    assert.deepEqual(plan.moves[0]!.from, { day: b, periodId: `p${nB + 1}` });
    const after = evaluateCurrent(withPlan(fixed, plan));
    assert.equal(after.hard.pattern.length, 0);
    assert.ok(after.score.hard < evaluateCurrent(fixed).score.hard);
    assert.equal(gapsOf(withPlan(fixed, plan), id), 0);
  });

  it("disposizioni nelle buche: prima quella sotto una lezione, poi quella dichiarata ma non segnata", () => {
    const data = buildSeed();
    const applied = withSlots(data, solveTimetable(data, { timeMs: 600, seed: 61, now: ticks() }));
    // lezioni alla 1ª, 2ª e 4ª: buca alla 3ª; disposizione alla 1ª, sotto una lezione
    const at = (c: { id: string; a: DayOfWeek }, patch: Partial<Teacher>) => reshape(applied, { id: c.id, day: c.a }, ["p1", "p2", "p4"], patch);
    const { id, a } = withGaps(applied, 1, (c) => at(c, {}));
    const under = { day: a, periodId: "p1" };
    const hole = { day: a, periodId: "p3" };
    const one = dispIntoGaps(at({ id, a }, { dispHours: 1, dispSlots: [under] }));
    assert.deepEqual(one, { dispSlots: { [id]: [hole] }, moves: [{ teacherId: id, from: under, to: hole }] });
    const loose = dispIntoGaps(at({ id, a }, { dispHours: 1, dispSlots: [] }));
    assert.deepEqual(loose, { dispSlots: { [id]: [hole] }, moves: [{ teacherId: id, from: null, to: hole }] });
    // due da mettere e una buca: va quella sotto la lezione
    const two = dispIntoGaps(at({ id, a }, { dispHours: 2, dispSlots: [under] }));
    assert.deepEqual(two, { dispSlots: { [id]: [hole] }, moves: [{ teacherId: id, from: under, to: hole }] });
  });

  it("disposizioni «Da zero»: si rimettono tutte senza fare buche; a parità restano dov'erano", () => {
    const data = buildSeed();
    const applied = withSlots(data, solveTimetable(data, { timeMs: 600, seed: 61, now: ticks() }));
    // lezioni alla 1ª, 2ª e 3ª e disposizione alla 1ª, sotto una lezione
    const under = withGaps(applied, 0, (c) =>
      reshape(applied, { id: c.id, day: c.a }, ["p1", "p2", "p3"], { dispHours: 1, dispSlots: [{ day: c.a, periodId: "p1" }] }),
    );
    assert.deepEqual(dispIntoGaps(under.d).moves, [], "senza buche, nell'orario salvato non si sposta");
    const plan = dispIntoGaps(under.d, { replace: true });
    assert.deepEqual(plan.moves, [
      { teacherId: under.id, from: { day: under.a, periodId: "p1" }, to: { day: under.a, periodId: "p4" } },
    ]);
    assert.equal(gapsOf(withPlan(under.d, plan), under.id), 0);
    // disposizione subito dopo le lezioni del giorno b: resta dov'è
    const after = withGaps(applied, 0, (c) =>
      reshape(applied, { id: c.id, day: c.b }, ["p1", "p2", "p3", "p4"].slice(0, c.nB), {
        dispHours: 1,
        dispSlots: [{ day: c.b, periodId: `p${c.nB + 1}` }],
      }),
    );
    assert.deepEqual(dispIntoGaps(after.d, { replace: true }), { dispSlots: {}, moves: [] });
  });
});
