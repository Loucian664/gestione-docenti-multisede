import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rowsToXlsx, specToXlsx, specsToXlsx } from "./xlsx.ts";

async function unzipStrings(blob: Blob): Promise<Record<string, string>> {
  const JSZip = await import("node:zlib").catch(() => null);
  void JSZip;
  const buf = Buffer.from(await blob.arrayBuffer());
  const { unzipSync } = await import("node:zlib");
  void unzipSync;
  // Store-only zip: parse with Python-less local reader
  const out: Record<string, string> = {};
  let o = 0;
  const u16 = (i: number) => buf[i]! | (buf[i + 1]! << 8);
  const u32 = (i: number) => buf[i]! | (buf[i + 1]! << 8) | (buf[i + 2]! << 16) | (buf[i + 3]! << 24);
  while (o + 4 <= buf.length && u32(o) === 0x04034b50) {
    const nameLen = u16(o + 26);
    const extraLen = u16(o + 28);
    const size = u32(o + 18);
    const name = buf.subarray(o + 30, o + 30 + nameLen).toString("utf8");
    const start = o + 30 + nameLen + extraLen;
    out[name] = buf.subarray(start, start + size).toString("utf8");
    o = start + size;
  }
  return out;
}

describe("xlsx", () => {
  it("uses shared strings so Google Sheets can read cells", async () => {
    const blob = rowsToXlsx(
      [
        ["Classe", "Giorno"],
        ["1A", "Lun"],
      ],
      "Orario",
    );
    const files = await unzipStrings(blob);
    assert.ok(files["xl/sharedStrings.xml"]);
    assert.match(files["xl/sharedStrings.xml"]!, /<t>Classe<\/t>/);
    assert.match(files["xl/worksheets/sheet1.xml"]!, /t="s"/);
    assert.doesNotMatch(files["xl/worksheets/sheet1.xml"]!, /inlineStr/);
    assert.match(files["[Content_Types].xml"]!, /sharedStrings/);
    assert.match(files["xl/workbook.xml"]!, /bookViews/);
  });

  it("keeps merges and dimension on the class grid", async () => {
    const blob = specToXlsx({
      sheetName: "Per classe",
      rows: [
        [{ v: "Titolo", s: 2 }, { v: "", s: 2 }],
        [{ v: "H", s: 4 }, { v: "1A", s: 4 }],
      ],
      merges: ["A1:B1"],
      autoFilter: false,
      headerRow: false,
      landscape: true,
    });
    const files = await unzipStrings(blob);
    const sheet = files["xl/worksheets/sheet1.xml"]!;
    assert.match(sheet, /<dimension ref="A1:B2"\/>/);
    assert.match(sheet, /<mergeCell ref="A1:B1"\/>/);
    assert.match(sheet, /printOptions[^>]*horizontalCentered="1"/);
    assert.match(sheet, /printOptions[^>]*verticalCentered="1"/);
    assert.doesNotMatch(sheet, /autoFilter/);
  });

  it("packs two sheets into one workbook", async () => {
    const blob = specsToXlsx([
      { sheetName: "Cognomi", rows: [[{ v: "GIOFRÈ", s: 7 }]], autoFilter: false, headerRow: false },
      { sheetName: "Materie", rows: [[{ v: "ITALIANO", s: 7 }]], autoFilter: false, headerRow: false },
    ]);
    const files = await unzipStrings(blob);
    assert.match(files["xl/workbook.xml"]!, /name="Cognomi"/);
    assert.match(files["xl/workbook.xml"]!, /name="Materie"/);
    assert.ok(files["xl/worksheets/sheet1.xml"]);
    assert.ok(files["xl/worksheets/sheet2.xml"]);
    assert.match(files["[Content_Types].xml"]!, /sheet2\.xml/);
    assert.match(files["xl/sharedStrings.xml"]!, /<t>GIOFRÈ<\/t>/);
    assert.match(files["xl/sharedStrings.xml"]!, /<t>ITALIANO<\/t>/);
  });

  it("sizes columns from the longest cell, not only the header", async () => {
    const blob = rowsToXlsx(
      [
        ["Data", "Note"],
        ["21/09/2026", "Giofrè Teresa — permesso breve con nota lunga da leggere"],
      ],
      "Assenze",
    );
    const files = await unzipStrings(blob);
    const sheet = files["xl/worksheets/sheet1.xml"]!;
    const noteCol = sheet.match(/<col min="2" max="2" width="([^"]+)"/);
    assert.ok(noteCol);
    const w = Number(noteCol![1]);
    assert.ok(w > 40, `note column should fit content, got ${w}`);
    assert.ok(w <= 52, `note column should not explode, got ${w}`);
  });
});
