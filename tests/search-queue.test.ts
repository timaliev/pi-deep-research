import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildSearchQueue, saveQueue, QueuedSearch } from "../extension/search-queue.js";

const TEST_DIR = join(import.meta.dirname ?? ".", "..", "test-search-queue");

// ─── Slice 1: buildSearchQueue ───────────────────────────────────

describe("buildSearchQueue", () => {
  it("round-robins engines across questions", () => {
    const questions = ["q1", "q2", "q3", "q4"];
    const engines = ["duckduckgo", "brave"];

    const queue = buildSearchQueue(questions, engines);

    assert.equal(queue.length, 4);
    assert.equal(queue[0].engine, "duckduckgo");
    assert.equal(queue[1].engine, "brave");
    assert.equal(queue[2].engine, "duckduckgo");
    assert.equal(queue[3].engine, "brave");
  });

  it("all questions use same engine when only one engine", () => {
    const queue = buildSearchQueue(["q1", "q2"], ["duckduckgo"]);
    assert.equal(queue[0].engine, "duckduckgo");
    assert.equal(queue[1].engine, "duckduckgo");
  });

  it("assigns increasing delays for free engines", () => {
    const queue = buildSearchQueue(["q1", "q2", "q3"], ["duckduckgo"]);

    assert.ok(queue[0].scheduledDelayMs >= 0, "first request no delay");
    assert.ok(queue[1].scheduledDelayMs >= 2000, "second request delay >= 2s");
    assert.ok(queue[1].scheduledDelayMs <= 4000, "second request delay <= 4s");
    assert.ok(queue[2].scheduledDelayMs >= queue[1].scheduledDelayMs,
      "delays increase sequentially");
  });

  it("no delay for non-rate-limited engines (brave, tavily)", () => {
    const queue = buildSearchQueue(["q1", "q2"], ["brave"]);

    assert.equal(queue[0].scheduledDelayMs, 0, "brave has no pre-delay");
    assert.equal(queue[1].scheduledDelayMs, 0);
  });

  it("includes ISO timestamp for each entry", () => {
    const queue = buildSearchQueue(["q1"], ["duckduckgo"]);

    const ts = new Date(queue[0].timestamp);
    assert.ok(!isNaN(ts.getTime()), "must be valid ISO date");
    assert.ok(queue[0].timestamp.includes("T"), "ISO format");
  });

  it("delay accumulates for DDG: random 2000-4000ms between requests", () => {
    const queue = buildSearchQueue(
      ["q1", "q2", "q3", "q4", "q5"],
      ["duckduckgo"],
    );

    for (let i = 1; i < queue.length; i++) {
      const gap = queue[i].scheduledDelayMs - queue[i - 1].scheduledDelayMs;
      assert.ok(gap >= 2000,
        `gap between ${i - 1} and ${i} must be >= 2000ms, got ${gap}ms`);
      assert.ok(gap <= 4000,
        `gap between ${i - 1} and ${i} must be <= 4000ms, got ${gap}ms`);
    }
  });
});

// ─── Slice 2: saveQueue ──────────────────────────────────────────

describe("saveQueue", () => {
  beforeEach(() => { mkdirSync(TEST_DIR, { recursive: true }); });
  afterEach(() => { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); });

  it("saves queue as valid JSON array", () => {
    const queue = buildSearchQueue(["q1", "q2"], ["duckduckgo"]);
    const path = join(TEST_DIR, "queue-0.json");
    saveQueue(queue, path);

    assert.ok(existsSync(path), "file must exist");
    const saved = JSON.parse(readFileSync(path, "utf-8"));
    assert.equal(saved.length, 2);
    assert.equal(saved[0].question, "q1");
    assert.equal(saved[0].engine, "duckduckgo");
  });

  it("creates parent directory if missing", () => {
    const queue = buildSearchQueue(["q1"], ["duckduckgo"]);
    const path = join(TEST_DIR, "subdir", "queue.json");
    saveQueue(queue, path);

    assert.ok(existsSync(path));
  });
});

// ─── Slice 3: queue round-trip (build → save → load → compare) ──

describe("queue round-trip", () => {
  beforeEach(() => { mkdirSync(TEST_DIR, { recursive: true }); });
  afterEach(() => { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); });

  it("saved queue matches built queue", () => {
    const questions = ["q1", "q2", "q3"];
    const engines = ["duckduckgo", "brave"];
    const queue = buildSearchQueue(questions, engines);

    const path = join(TEST_DIR, "queue-test.json");
    saveQueue(queue, path);

    const loaded = JSON.parse(readFileSync(path, "utf-8"));
    assert.equal(loaded.length, queue.length);
    for (let i = 0; i < queue.length; i++) {
      assert.equal(loaded[i].question, queue[i].question);
      assert.equal(loaded[i].engine, queue[i].engine);
      assert.equal(loaded[i].scheduledDelayMs, queue[i].scheduledDelayMs);
    }
  });
});
