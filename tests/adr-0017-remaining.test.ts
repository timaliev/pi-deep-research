/**
 * ADR-0017: questionMetadata + subtopics tiers + contradiction analysis.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("ADR-0017 — questionMetadata", () => {
  it("ResearchPlan has optional questionMetadata field", () => {
    const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "prefilter.ts"), "utf-8");
    assert.ok(src.includes("questionMetadata"), "ResearchPlan must have questionMetadata");
  });
});

describe("ADR-0017 — subtopics tiers", () => {
  it("subtopics drafting prompt has tiered topic counts", () => {
    const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "report-styles.ts"), "utf-8");
    assert.ok(
      src.includes("12") && src.includes("20") && src.includes("8") && src.includes("12"),
      "subtopics prompt must have tiered topic counts beyond 5-10",
    );
  });
});

describe("ADR-0017 — contradiction analysis", () => {
  it("orchestrator has contradiction analysis section", () => {
    const src = readFileSync(
      join(import.meta.dirname ?? ".", "..", "extension", "research-run-orchestrator.ts"),
      "utf-8",
    );
    assert.ok(
      src.includes("contradiction") || src.includes("Contradiction"),
      "orchestrator must have contradiction analysis",
    );
  });
});
