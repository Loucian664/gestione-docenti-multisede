import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pdfTabUrl, textToPdf } from "./pdf.ts";

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

describe("pdfTabUrl", () => {
  it("mette il nome del file dopo il # perché il lettore PDF lo proponga quando si salva", () => {
    assert.equal(pdfTabUrl("blob:https://sito.example/abc-123", "orario-classi-Rombiolo.pdf"), "blob:https://sito.example/abc-123#orario-classi-Rombiolo.pdf");
  });

  it("aggiunge .pdf se manca e codifica gli spazi e i caratteri strani", () => {
    assert.equal(pdfTabUrl("blob:x/1", "orario docenti"), "blob:x/1#orario%20docenti.pdf");
    assert.equal(pdfTabUrl("blob:x/1", "orario-Nicotera-è.PDF"), "blob:x/1#orario-Nicotera-%C3%A8.PDF");
  });
});
