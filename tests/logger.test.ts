import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { JsonlLogger } from "../extension/logger.js";

const TEST_DIR = join(import.meta.dirname ?? ".", "../test-logs");

describe("JsonlLogger", () => {
  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("writes JSONL events to file", () => {
    const logPath = join(TEST_DIR, "test.log");
    const logger = new JsonlLogger("run-001", logPath);

    logger.event("search_executed", { query: "test", resultCount: 3 });
    logger.event("phase_changed", { from: "searching", to: "extracting" });

    assert.ok(existsSync(logPath), "log file must exist");

    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    assert.equal(lines.length, 2, "two events = two lines");

    const e1 = JSON.parse(lines[0]);
    assert.equal(e1.type, "search_executed");
    assert.equal(e1.runId, "run-001");
    assert.equal(e1.query, "test");
    assert.equal(e1.resultCount, 3);
    assert.ok(e1.ts, "must have timestamp");

    const e2 = JSON.parse(lines[1]);
    assert.equal(e2.type, "phase_changed");
    assert.equal(e2.from, "searching");
    assert.equal(e2.to, "extracting");
  });

  it("automatically creates parent directories", () => {
    const logPath = join(TEST_DIR, "nested", "dir", "test.log");
    const logger = new JsonlLogger("run-002", logPath);
    logger.event("run_started", { topic: "test" });
    assert.ok(existsSync(logPath), "log file must exist in nested dir");
  });

  it("appends to existing log file", () => {
    const logPath = join(TEST_DIR, "append.log");
    const logger1 = new JsonlLogger("run-003", logPath);
    logger1.event("first", {});

    const logger2 = new JsonlLogger("run-003", logPath);
    logger2.event("second", {});

    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    assert.equal(lines.length, 2, "two events appended");
    assert.ok(lines[0].includes("first"));
    assert.ok(lines[1].includes("second"));
  });

  it("each event has timestamp and runId", () => {
    const logPath = join(TEST_DIR, "meta.log");
    const logger = new JsonlLogger("run-004", logPath);

    logger.event("test_event", { key: "value" });

    const line = JSON.parse(readFileSync(logPath, "utf-8").trim());
    assert.ok(line.ts, "must have ts field");
    assert.ok(line.ts.endsWith("Z") || line.ts.includes("+") || line.ts.includes("T"), "ts must be ISO 8601");
    assert.equal(line.runId, "run-004");
    assert.equal(line.type, "test_event");
    assert.equal(line.key, "value");
  });
});
