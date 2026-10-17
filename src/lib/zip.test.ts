import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crc32, zipStore } from "./zip.ts";

describe("zipStore", () => {
  it("packs two files with PK headers and filenames", () => {
    const enc = new TextEncoder();
    const bytes = zipStore([
      { name: "a/Lentini.pdf", data: enc.encode("%PDF-1.4 fake") },
      { name: "Giofre.pdf", data: enc.encode("hello") },
    ]);
    const text = new TextDecoder("latin1").decode(bytes);
    assert.equal(String.fromCharCode(bytes[0]!, bytes[1]!), "PK");
    assert.match(text, /Lentini\.pdf/);
    assert.match(text, /Giofre\.pdf/);
    assert.match(text, /PK\x05\x06/);
    assert.equal(crc32(enc.encode("hello")), 0x3610a686);
  });
});
