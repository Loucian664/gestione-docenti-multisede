import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dateOnLaunch,
  dateOnResume,
  formatDayName,
  formatItDate,
  formatItFileDate,
  formatLong,
  monthSchoolDays,
  toSchoolDay,
} from "./dates.ts";
import { dayNameUpper } from "./types.ts";
import { dailySheetHeading } from "./export.ts";

describe("home date", () => {
  it("opens on today even if the last visit was weeks ago", () => {
    assert.equal(dateOnLaunch("2026-09-17"), "2026-09-17");
  });

  it("on resume, a past day becomes today; today and future stay", () => {
    assert.equal(dateOnResume("2026-08-01", "2026-09-17"), "2026-09-17");
    assert.equal(dateOnResume("2026-09-16", "2026-09-17"), "2026-09-17");
    assert.equal(dateOnResume("2026-09-17", "2026-09-17"), "2026-09-17");
    assert.equal(dateOnResume("2026-09-18", "2026-09-17"), "2026-09-18");
  });
});

describe("giorni per esteso", () => {
  it("usa ì accentata, non l’apostrofo", () => {
    assert.equal(dayNameUpper(1), "LUNEDÌ");
    assert.equal(dayNameUpper(2), "MARTEDÌ");
    assert.equal(dayNameUpper(3), "MERCOLEDÌ");
    assert.equal(dayNameUpper(4), "GIOVEDÌ");
    assert.equal(dayNameUpper(5), "VENERDÌ");
    assert.equal(formatDayName("2026-09-14"), "lunedì");
    assert.match(formatLong("2026-09-14"), /lunedì/);
    assert.match(dailySheetHeading("2026-09-14"), /LUNEDÌ/);
    assert.doesNotMatch(dailySheetHeading("2026-09-14"), /LUNEDI'/);
  });
});

describe("date italiane", () => {
  it("usa giorno/mese/anno, non anno-mese-giorno", () => {
    assert.equal(formatItDate("2026-09-21"), "21/09/2026");
    assert.equal(formatItFileDate("2026-09-21"), "21-09-2026");
  });
});

describe("calendario delle assenze", () => {
  it("da lunedì a venerdì: niente sabato e domenica, settimane senza giorni del mese tolte", () => {
    // novembre 2026 comincia di domenica: la prima settimana (26–30 ottobre) non serve
    const nov = monthSchoolDays("2026-11-15", false);
    assert.equal(nov[0], "2026-11-02");
    assert.equal(nov.length % 5, 0);
    assert.ok(nov.every((d) => toSchoolDay(d) !== null && toSchoolDay(d)! <= 5));
    assert.ok(nov.includes("2026-11-30"));
    assert.equal(nov.at(-1), "2026-12-04");
  });

  it("con il sabato: sei giorni a settimana, mai la domenica", () => {
    // agosto 2026 comincia di sabato: con il sabato la prima settimana resta
    const aug = monthSchoolDays("2026-08-10", true);
    assert.equal(aug[0], "2026-07-27");
    assert.equal(aug[5], "2026-08-01");
    assert.equal(aug.length % 6, 0);
    assert.ok(aug.every((d) => toSchoolDay(d) !== null));
    assert.equal(monthSchoolDays("2026-08-10", false)[0], "2026-08-03");
  });
});
