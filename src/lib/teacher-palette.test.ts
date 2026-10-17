import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyOrganicoFixes, buildSeed } from "./seed.ts";
import {
  AUTO_COLORS,
  TEACHER_PALETTE,
  VIVID_TONE,
  VIVID_TEXT_2,
  findPastel,
  nextTeacherColor,
  teacherCell,
  withPaletteColors,
} from "./teacher-palette.ts";

const person = (lastName: string, color: string) => ({ lastName, firstName: "X", color });

describe("tavolozza dei docenti", () => {
  it("48 colori diversi; in automatico tutti i 36 non vivaci, una volta sola", () => {
    const all = TEACHER_PALETTE.flatMap((h) => h.tones);
    assert.equal(all.length, 48);
    assert.equal(new Set(all).size, 48);
    const pastel = TEACHER_PALETTE.flatMap((h) => h.tones.filter((_, i) => i !== VIVID_TONE));
    assert.equal(AUTO_COLORS.length, 36);
    assert.deepEqual([...AUTO_COLORS].sort(), [...pastel].sort());
  });

  it("i colori di prima diventano colori della tavolozza, tutti diversi; quelli nuovi restano", () => {
    const legacy = ["#3d5a4c", "#000000", "#ff0000", "", "#ff8080"];
    const teachers = Array.from({ length: 26 }, (_, i) =>
      person(`Docente ${String(i).padStart(2, "0")}`, legacy[i % 5]!),
    );
    teachers[3] = person("Docente 03", "#d9e8de");
    const out = withPaletteColors(teachers);
    assert.ok(out.every((t) => findPastel(t.color)));
    assert.equal(new Set(out.map((t) => t.color.toUpperCase())).size, 26);
    assert.equal(out[3]!.color, "#d9e8de");
    assert.ok(out.every((t) => findPastel(t.color)!.tone !== VIVID_TONE));
    assert.equal(withPaletteColors(out), out);
  });

  it("in ordine alfabetico, a prescindere dall'ordine nell'elenco", () => {
    const a = withPaletteColors([person("Rossi", "#111111"), person("Bianchi", "#222222")]);
    assert.equal(a[1]!.color, AUTO_COLORS[0]);
    assert.equal(a[0]!.color, AUTO_COLORS[1]);
  });

  it("nuovo docente: il primo colore libero, poi il meno usato", () => {
    assert.equal(nextTeacherColor([]), AUTO_COLORS[0]);
    assert.equal(nextTeacherColor([AUTO_COLORS[0]!.toLowerCase(), "#000000"]), AUTO_COLORS[1]);
    assert.equal(nextTeacherColor([...AUTO_COLORS, AUTO_COLORS[0]]), AUTO_COLORS[1]);
  });

  it("l'esempio e i dati aperti hanno solo colori della tavolozza", () => {
    const seed = buildSeed();
    assert.ok(seed.teachers.every((t) => findPastel(t.color)));
    assert.equal(new Set(seed.teachers.map((t) => t.color)).size, seed.teachers.length);
    const old = { ...seed, teachers: seed.teachers.map((t) => ({ ...t, color: "#3d5a4c" })) };
    const fixed = applyOrganicoFixes(old);
    assert.equal(new Set(fixed.teachers.map((t) => t.color)).size, seed.teachers.length);
    assert.deepEqual(applyOrganicoFixes(fixed).teachers, fixed.teachers);
  });

  it("vivace: testo secondario più scuro; in scuro la tinta è più forte a ogni intensità", () => {
    const hue = TEACHER_PALETTE[0]!;
    assert.equal(teacherCell(hue.tones[VIVID_TONE]).text2, VIVID_TEXT_2);
    const mixes = hue.tones.map((c) =>
      String((teacherCell(c).style as Record<string, string>)["--tc-dark"]),
    );
    const pct = mixes.map((m) => Number(/ (\d+)%/.exec(m)![1]));
    assert.deepEqual(
      [...pct].sort((x, y) => x - y),
      pct,
    );
    assert.equal(new Set(pct).size, 4);
  });
});
