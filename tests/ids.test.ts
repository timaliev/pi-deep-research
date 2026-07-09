import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateRunId } from "../extension/ids.js";

describe("generateRunId", () => {
  it("formats as YYYYMMDD-HHmmss", () => {
    const id = generateRunId();
    assert.match(id, /^\d{8}-\d{6}$/, "must be YYYYMMDD-HHmmss format");
  });

  it("includes valid date and time components", () => {
    const id = generateRunId();
    const [date, time] = id.split("-");
    assert.equal(date.length, 8);
    assert.equal(time.length, 6);
    const month = parseInt(date.substring(4, 6));
    const day = parseInt(date.substring(6, 8));
    const hour = parseInt(time.substring(0, 2));
    const min = parseInt(time.substring(2, 4));
    const sec = parseInt(time.substring(4, 6));
    assert.ok(month >= 1 && month <= 12, "valid month");
    assert.ok(day >= 1 && day <= 31, "valid day");
    assert.ok(hour >= 0 && hour <= 23, "valid hour");
    assert.ok(min >= 0 && min <= 59, "valid minute");
    assert.ok(sec >= 0 && sec <= 59, "valid second");
  });
});
