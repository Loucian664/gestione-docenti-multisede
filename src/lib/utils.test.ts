import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countOf } from "./utils.ts";

describe("countOf", () => {
  it("scrive il singolare solo per 1", () => {
    assert.equal(countOf(1, "ora", "ore"), "1 ora");
    assert.equal(countOf(0, "ora", "ore"), "0 ore");
    assert.equal(countOf(2, "ora", "ore"), "2 ore");
  });
});
