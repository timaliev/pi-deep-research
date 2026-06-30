import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { topicToSlug } from "../extension/slug.js";

describe("topicToSlug", () => {
  it("transliterates Cyrillic to Latin", () => {
    const slug = topicToSlug("рынок бытовых эллиптических тренажёров в РФ");
    assert.ok(slug.length > 5, "slug must not be empty");
    assert.ok(/^[a-z0-9-]+$/.test(slug), "slug must contain only latin chars, digits, hyphens");
    assert.ok(!slug.includes("--"), "no double hyphens");
    assert.ok(!slug.startsWith("-"), "no leading hyphen");
    assert.ok(!slug.endsWith("-"), "no trailing hyphen");
    assert.ok(slug.includes("rynok"), "must transliterate рынок → rynok");
    assert.ok(slug.includes("trenazhyorov"), "must transliterate тренажёров → trenazhyorov");
  });

  it("handles mixed Latin+Cyrillic", () => {
    const slug = topicToSlug("API для РФ: 2026 обзор");
    assert.ok(slug.includes("api"));
    assert.ok(slug.includes("rf"));
    assert.ok(slug.includes("2026"));
    assert.ok(slug.includes("obzor"));
  });

  it("handles pure Latin unchanged", () => {
    const slug = topicToSlug("hello world: test 123");
    assert.equal(slug, "hello-world-test-123");
  });

  it("falls back to 'research' when all chars are non-word symbols", () => {
    const slug = topicToSlug("»« ");
    assert.equal(slug, "research");
  });

  it("truncates to 80 chars", () => {
    const long = "а".repeat(200);
    const slug = topicToSlug(long);
    assert.ok(slug.length <= 80);
  });
});

describe("report path consistency", () => {
  it("same topic produces same slug for both save_report and auto-save", () => {
    const planTopic = "рынок бытовых эллиптических тренажёров в РФ: характеристики, цены, отзывы пользователей";
    const saveReportTopic = planTopic;

    const autoSaveSlug = topicToSlug(planTopic);
    const saveReportSlug = topicToSlug(saveReportTopic);

    assert.equal(autoSaveSlug, saveReportSlug);
  });

  it("different topic strings produce different slugs — this is the bug scenario", () => {
    const planTopic = "рынок бытовых эллиптических тренажёров в РФ: характеристики, цены, отзывы пользователей";
    const saveReportTopic = "эллиптические тренажеры РФ";

    const autoSaveSlug = topicToSlug(planTopic);
    const saveReportSlug = topicToSlug(saveReportTopic);

    assert.notEqual(autoSaveSlug, saveReportSlug,
      "abbreviated topic must produce different slug than full plan topic");
  });
});

// ─── RED tests for resolveSaveReportPath ───────────────────────────

describe("resolveSaveReportPath", () => {
  const STATE_KEY = "deep-research:report-path";

  it("uses stored reportPath from state, ignoring params.topic", () => {
    const storedReportPath = "/tmp/reports/2026-06-26-rynok-bytovyh-trenazhyorov-v-rf.md";

    const mockEntries = [
      { customType: STATE_KEY, data: { path: storedReportPath } },
    ];

    const paramsTopic = "эллиптические тренажеры РФ"; // different from plan
    const runId = "20260630-191202";

    const resolved = resolveSaveReportPath(paramsTopic, runId, mockEntries);

    assert.equal(resolved, storedReportPath,
      "must use stored reportPath from state, not derive from params.topic");
  });

  it("falls back to runId-based filename when no state entry exists", () => {
    const paramsTopic = "эллиптические тренажеры РФ";
    const runId = "20260630-191202";
    const expectedSlug = topicToSlug(paramsTopic);

    const resolved = resolveSaveReportPath(paramsTopic, runId, []);

    assert.ok(resolved.endsWith(`${runId}-${expectedSlug}.md`),
      `must use runId-slug format, got: ${resolved}`);
    assert.ok(resolved.includes(expectedSlug));
  });

  it("falls back when state entry has no path field", () => {
    const paramsTopic = "тест";
    const runId = "20260630-191202";
    const expectedSlug = topicToSlug(paramsTopic);

    const mockEntries = [
      { customType: STATE_KEY, data: {} }, // missing path
    ];

    const resolved = resolveSaveReportPath(paramsTopic, runId, mockEntries);

    assert.ok(resolved.includes(expectedSlug));
    assert.ok(resolved.includes(runId));
  });
});

// ─── Stub implementation (will move to extension) ──────────────────

/**
 * Resolve the file path for saving a report.
 * Prefers the pre-computed path from session state (set by auto-save).
 * Falls back to deriving from params.topic.
 */
function resolveSaveReportPath(
  paramsTopic: string,
  runId: string,
  entries: Array<{ customType?: string; data?: Record<string, unknown> }>,
): string {
  // Prefer the pre-computed path from auto-save's session state
  const STATE_KEY = "deep-research:report-path";
  const stateEntry = [...entries].reverse().find((e) => e.customType === STATE_KEY);
  if (stateEntry?.data?.path && typeof stateEntry.data.path === "string") {
    return stateEntry.data.path;
  }
  // Fallback: derive from params.topic with runId prefix
  const slug = topicToSlug(paramsTopic);
  return `reports/${runId}-${slug}.md`;
}
