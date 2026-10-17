/** Minimal XLSX (Office Open XML, no compression) — no extra libraries. */

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type Cell = string | number | null | undefined;

export type XlsxRichCell = { v?: Cell; s?: number };
export type XlsxCellInput = Cell | XlsxRichCell;

export type XlsxSheetSpec = {
  rows: XlsxCellInput[][];
  sheetName?: string;
  merges?: string[];
  colWidths?: number[];
  rowHeights?: number[];
  freezeRow?: number;
  freezeCol?: number;
  autoFilter?: boolean;
  headerRow?: boolean;
  landscape?: boolean;
};

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function zipStore(files: { path: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = enc.encode(file.path);
    const crc = crc32(file.data);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(name.length),
      u16(0),
      name,
      file.data,
    ]);
    locals.push(local);
    centrals.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(file.data.length),
        u32(file.data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += local.length;
  }
  const central = concat(centrals);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);
  return concat([...locals, central, end]);
}

function xmlEscape(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u0026lt;")
    .replace(/>/g, "\u0026gt;")
    .replace(/"/g, "\u0026quot;");
}

function colLetter(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, " ").trim() || "Foglio";
  return cleaned.slice(0, 31);
}

function isRich(c: XlsxCellInput): c is XlsxRichCell {
  return typeof c === "object" && c !== null && ("v" in c || "s" in c);
}

/** Testo di una tabella con la stessa griglia sottile dell’orario. */
export const XLSX_GRID_TEXT = 11;
/** Etichetta del giorno, centrata nel blocco di righe di quel giorno. */
export const XLSX_GRID_DAY = 12;

function cellValue(c: XlsxCellInput | undefined): Cell {
  if (isRich(c)) return c.v;
  return c;
}

function cellStyle(c: XlsxCellInput | undefined, header: boolean): number | undefined {
  if (isRich(c) && typeof c.s === "number") return c.s;
  if (header) return 1;
  return undefined;
}

type StringTable = { list: string[]; index: Map<string, number>; refs: number };

function intern(table: StringTable, value: string): number {
  table.refs += 1;
  const found = table.index.get(value);
  if (found != null) return found;
  const i = table.list.length;
  table.list.push(value);
  table.index.set(value, i);
  return i;
}

function cellXml(
  row: number,
  col: number,
  raw: XlsxCellInput | undefined,
  header: boolean,
  table: StringTable,
): string {
  const ref = `${colLetter(col)}${row}`;
  const value = cellValue(raw);
  const style = cellStyle(raw, header);
  const styleAttr = style != null ? ` s="${style}"` : "";
  if (value == null || value === "") return `<c r="${ref}"${styleAttr}/>`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"${styleAttr}><v>${value}</v></c>`;
  }
  const i = intern(table, String(value));
  return `<c r="${ref}"${styleAttr} t="s"><v>${i}</v></c>`;
}

function autoColWidths(rows: XlsxCellInput[][]): number[] {
  const width = Math.max(1, ...rows.map((r) => r.length));
  return Array.from({ length: width }, (_, i) => {
    let max = 8;
    for (const row of rows) {
      const v = cellValue(row[i]);
      if (v == null || v === "") continue;
      const len = Math.max(...String(v).split("\n").map((line) => line.length));
      if (len > max) max = len;
    }
    return Math.min(52, Math.max(10, max + 2));
  });
}

function sheetXml(spec: XlsxSheetSpec, table: StringTable): string {
  const rows = spec.rows;
  const width = Math.max(1, ...rows.map((r) => r.length));
  const headerRow = spec.headerRow !== false && !spec.merges?.length;
  const widths = spec.colWidths ?? autoColWidths(rows);
  const cols = Array.from({ length: width }, (_, i) => {
    const w = widths[i] ?? 12;
    return `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`;
  }).join("");
  const last = `${colLetter(width - 1)}${Math.max(1, rows.length)}`;
  const body = rows
    .map((row, ri) => {
      const r = ri + 1;
      const ht = spec.rowHeights?.[ri];
      const htAttr = ht != null ? ` ht="${ht}" customHeight="1"` : "";
      const cells = Array.from({ length: width }, (_, ci) =>
        cellXml(r, ci, row[ci], headerRow && ri === 0, table),
      );
      return `<row r="${r}" spans="1:${width}"${htAttr}>${cells.join("")}</row>`;
    })
    .join("");
  const freezeRow = spec.freezeRow ?? (headerRow ? 1 : 0);
  const freezeCol = spec.freezeCol ?? 0;
  let views = `<sheetViews><sheetView workbookViewId="0">`;
  if (freezeRow > 0 || freezeCol > 0) {
    const top = `${colLetter(freezeCol)}${freezeRow + 1}`;
    const paneAttrs = [
      freezeRow > 0 ? `ySplit="${freezeRow}"` : "",
      freezeCol > 0 ? `xSplit="${freezeCol}"` : "",
      `topLeftCell="${top}"`,
      `activePane="${freezeRow > 0 && freezeCol > 0 ? "bottomRight" : freezeRow > 0 ? "bottomLeft" : "topRight"}"`,
      `state="frozen"`,
    ]
      .filter(Boolean)
      .join(" ");
    views += `<pane ${paneAttrs}/>`;
  }
  views += `</sheetView></sheetViews>`;
  const filter =
    spec.autoFilter === false ? "" : `<autoFilter ref="A1:${last}"/>`;
  const merges = spec.merges?.length
    ? `<mergeCells count="${spec.merges.length}">${spec.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>`
    : "";
  const pagePr =
    spec.landscape === true ? `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` : `<sheetPr/>`;
  const setup =
    spec.landscape === true
      ? `<printOptions horizontalCentered="1" verticalCentered="1"/><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="1"/>`
      : "";
  // Order is schema-strict: sheetPr, dimension, sheetViews, cols, sheetData, autoFilter, mergeCells, printOptions, pageMargins, pageSetup
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  ${pagePr}
  <dimension ref="A1:${last}"/>
  ${views}
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${cols}</cols>
  <sheetData>${body}</sheetData>
  ${filter}${merges}${setup}
</worksheet>`;
}

function sharedStringsXml(table: StringTable): string {
  const items = table.list
    .map((s) => {
      const space = /^\s|\s$|\n|\t/.test(s) ? ` xml:space="preserve"` : "";
      return `<si><t${space}>${xmlEscape(s)}</t></si>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${table.refs}" uniqueCount="${table.list.length}">${items}</sst>`;
}

function contentTypesXml(sheetCount: number): string {
  const sheets = Array.from(
    { length: sheetCount },
    (_, i) =>
      `  <Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets}
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const CORE_PROPS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>Orario</dc:creator>
  <cp:lastModifiedBy>Orario</cp:lastModifiedBy>
</cp:coreProperties>`;

const APP_PROPS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Excel</Application>
</Properties>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="6">
    <font><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFF4EFE4"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="14"/><color rgb="FF111111"/><name val="Calibri"/><family val="2"/></font>
    <font><sz val="10"/><color rgb="FF444444"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FF111111"/><name val="Calibri"/><family val="2"/></font>
    <font><sz val="9"/><color rgb="FF111111"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F4A3C"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEEE8DC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF111111"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF111111"/></left>
      <right style="thin"><color rgb="FF111111"/></right>
      <top style="thin"><color rgb="FF111111"/></top>
      <bottom style="thin"><color rgb="FF111111"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="13">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" textRotation="90"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  </cellXfs>
</styleSheet>`;

function workbookXml(names: string[]): string {
  const sheets = names
    .map(
      (name, i) =>
        `<sheet name="${xmlEscape(sanitizeSheetName(name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <workbookPr/>
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="15000"/></bookViews>
  <sheets>${sheets}</sheets>
  <calcPr calcId="124519"/>
</workbook>`;
}

function workbookRelsXml(sheetCount: number): string {
  const sheetRels = Array.from(
    { length: sheetCount },
    (_, i) =>
      `  <Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join("\n");
  const stylesId = sheetCount + 1;
  const sstId = sheetCount + 2;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheetRels}
  <Relationship Id="rId${stylesId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId${sstId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;
}

function packXlsx(specs: XlsxSheetSpec[]): Blob {
  const sheets = specs.length ? specs : [{ rows: [], sheetName: "Foglio" }];
  const names = sheets.map((s, i) => s.sheetName ?? `Foglio${i + 1}`);
  const table: StringTable = { list: [], index: new Map(), refs: 0 };
  const xmls = sheets.map((spec) => sheetXml(spec, table));
  const enc = new TextEncoder();
  const utf = (s: string) => enc.encode(s);
  const files = [
    { path: "[Content_Types].xml", data: utf(contentTypesXml(sheets.length)) },
    { path: "_rels/.rels", data: utf(ROOT_RELS) },
    { path: "docProps/app.xml", data: utf(APP_PROPS) },
    { path: "docProps/core.xml", data: utf(CORE_PROPS) },
    { path: "xl/workbook.xml", data: utf(workbookXml(names)) },
    { path: "xl/_rels/workbook.xml.rels", data: utf(workbookRelsXml(sheets.length)) },
    { path: "xl/styles.xml", data: utf(STYLES) },
    { path: "xl/sharedStrings.xml", data: utf(sharedStringsXml(table)) },
    ...xmls.map((xml, i) => ({ path: `xl/worksheets/sheet${i + 1}.xml`, data: utf(xml) })),
  ];
  const bytes = zipStore(files);
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type: XLSX_MIME });
}

export function rowsToXlsx(rows: Cell[][], sheetName = "Foglio"): Blob {
  return packXlsx([{ rows, headerRow: true, sheetName }]);
}

export function specToXlsx(spec: XlsxSheetSpec): Blob {
  return packXlsx([spec]);
}

export function specsToXlsx(specs: XlsxSheetSpec[]): Blob {
  return packXlsx(specs);
}

export function xlsxFile(filename: string, rows: Cell[][], sheetName: string): File {
  const name = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  return new File([rowsToXlsx(rows, sheetName)], name, { type: XLSX_MIME });
}

export function xlsxSpecFile(filename: string, spec: XlsxSheetSpec): File {
  const name = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  return new File([specToXlsx({ ...spec, sheetName: spec.sheetName ?? "Foglio" })], name, { type: XLSX_MIME });
}

export function xlsxWorkbookFile(filename: string, specs: XlsxSheetSpec[]): File {
  const name = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  return new File([specsToXlsx(specs)], name, { type: XLSX_MIME });
}

