import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dropLocks, isLockedLesson, lockAt } from "./locks";
import type { Teacher, TimetableSlot } from "./types";

const t = { id: "t1", lockedSlots: [{ day: 2, periodId: "p7", classId: "c1" }] } as unknown as Teacher;
const lesson = { id: "s1", day: 2, periodId: "p7", classId: "c1", teacherId: "t1", subject: "Latino" } as unknown as TimetableSlot;

describe("ore bloccate", () => {
  it("blocca e sblocca una casella", () => {
    assert.equal(isLockedLesson(t, lesson), true);
    assert.equal(isLockedLesson(t, { ...lesson, classId: "c2" }), false);
    const moved = lockAt(t, lesson, "c2");
    assert.deepEqual(moved, [{ day: 2, periodId: "p7", classId: "c2" }]);
    assert.deepEqual(lockAt(t, lesson, null), []);
  });

  it("togliendo la lezione si toglie anche il suo blocco, non quelli degli altri", () => {
    const other = { ...t, id: "t2" } as Teacher;
    const [a, b] = dropLocks([t, other], [lesson]);
    assert.deepEqual(a!.lockedSlots, []);
    assert.equal(b, other);
    assert.equal(dropLocks([t], [{ ...lesson, classId: "c9" }])[0], t);
  });
});
