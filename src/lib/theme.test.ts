import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clockToMinutes,
  cycleTheme,
  isDarkAtMinutes,
  msUntilNextBoundary,
  parseClock,
  parseThemePreference,
  parseThemeSchedule,
  resolveTheme,
} from "./theme.ts";

describe("theme", () => {
  it("parses stored preference and defaults to system", () => {
    assert.equal(parseThemePreference("light"), "light");
    assert.equal(parseThemePreference("dark"), "dark");
    assert.equal(parseThemePreference("system"), "system");
    assert.equal(parseThemePreference(null), "system");
    assert.equal(parseThemePreference("nope"), "system");
  });

  it("cycles system → light → dark → system", () => {
    assert.equal(cycleTheme("system"), "light");
    assert.equal(cycleTheme("light"), "dark");
    assert.equal(cycleTheme("dark"), "system");
  });

  it("normalizes clocks", () => {
    assert.equal(parseClock("7:00"), "07:00");
    assert.equal(parseClock("20:30"), "20:30");
    assert.equal(parseClock("24:00"), "");
    assert.equal(parseClock("nope"), "");
    assert.equal(clockToMinutes("20:00"), 20 * 60);
    assert.equal(clockToMinutes("07:00"), 7 * 60);
  });

  it("reads a schedule with defaults", () => {
    assert.deepEqual(parseThemeSchedule(null), { from: "20:00", until: "07:00" });
    assert.deepEqual(parseThemeSchedule({ from: "19:30", until: "6:15" }), { from: "19:30", until: "06:15" });
  });

  it("treats 20:00–07:00 as dark across midnight", () => {
    assert.equal(isDarkAtMinutes("20:00", "07:00", clockToMinutes("19:59")), false);
    assert.equal(isDarkAtMinutes("20:00", "07:00", clockToMinutes("20:00")), true);
    assert.equal(isDarkAtMinutes("20:00", "07:00", clockToMinutes("23:50")), true);
    assert.equal(isDarkAtMinutes("20:00", "07:00", clockToMinutes("00:10")), true);
    assert.equal(isDarkAtMinutes("20:00", "07:00", clockToMinutes("06:59")), true);
    assert.equal(isDarkAtMinutes("20:00", "07:00", clockToMinutes("07:00")), false);
    assert.equal(isDarkAtMinutes("20:00", "07:00", clockToMinutes("12:00")), false);
  });

  it("supports a same-day dark window", () => {
    assert.equal(isDarkAtMinutes("08:00", "18:00", clockToMinutes("07:59")), false);
    assert.equal(isDarkAtMinutes("08:00", "18:00", clockToMinutes("08:00")), true);
    assert.equal(isDarkAtMinutes("08:00", "18:00", clockToMinutes("17:59")), true);
    assert.equal(isDarkAtMinutes("08:00", "18:00", clockToMinutes("18:00")), false);
  });

  it("resolves automatic from the clock, forced values stay forced", () => {
    const night = { from: "20:00", until: "07:00" };
    assert.equal(resolveTheme("system", night, clockToMinutes("21:00")), "dark");
    assert.equal(resolveTheme("system", night, clockToMinutes("10:00")), "light");
    assert.equal(resolveTheme("light", night, clockToMinutes("21:00")), "light");
    assert.equal(resolveTheme("dark", night, clockToMinutes("10:00")), "dark");
  });

  it("waits until the next from/until boundary", () => {
    const wait = msUntilNextBoundary({ from: "20:00", until: "07:00" }, new Date(2026, 8, 17, 19, 59, 59, 750));
    assert.ok(wait >= 250 && wait <= 1500, String(wait));
  });
});
