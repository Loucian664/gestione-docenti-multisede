import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textToPdf } from "./pdf.ts";

describe("textToPdf", () => {
  it("emits a PDF with the daily sheet text", async () => {
    const blob = textToPdf("SOSTITUZIONI - lunedi\n1ª A  Italiano  |  assente Rossi A.  |  copre Bianchi L.");
    const buf = new Uint8Array(await blob.arrayBuffer());
    const head = new TextDecoder("latin1").decode(buf.slice(0, 8));
    assert.ok(head.startsWith("%PDF-1."));
    const all = new TextDecoder("latin1").decode(buf);
    assert.match(all, /%%EOF/);
    assert.match(all, /SOSTITUZIONI/);
    assert.match(all, /1ª A|1\\252 A/);
  });
});
