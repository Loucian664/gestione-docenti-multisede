import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { nodeVersionOk } from "./versione-node.mjs";

const range = "^20.19.0 || >=22.12.0";

test("versione di Node: il minimo di package.json, anche per le versioni future", () => {
  assert.equal(nodeVersionOk("22.12.0", range), true);
  assert.equal(nodeVersionOk("v22.23.4", range), true);
  assert.equal(nodeVersionOk("30.1.0", range), true);
  assert.equal(nodeVersionOk("20.19.2", range), true);
  assert.equal(nodeVersionOk("22.11.0", range), false);
  assert.equal(nodeVersionOk("21.7.3", range), false);
  assert.equal(nodeVersionOk("20.18.0", range), false);
  assert.equal(nodeVersionOk("18.20.0", range), false);
  // un formato che non si sa leggere non blocca
  assert.equal(nodeVersionOk("22.0.0", "22.x"), null);
});

test("package.json chiede la stessa versione dei programmi che compilano il motore", () => {
  // se un aggiornamento cambia il minimo di rolldown o vite, va cambiato anche in package.json
  const engines = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")).engines?.node;
  const ours = engines("../package.json");
  assert.ok(ours);
  assert.equal(engines("../node_modules/rolldown/package.json"), ours);
  assert.equal(engines("../node_modules/vite/package.json"), ours);
});
