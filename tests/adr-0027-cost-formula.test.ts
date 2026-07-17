/**
 * ADR-0027: Tool-computed research cost estimate.
 * Replaces agent-written plan.estimatedCost with tool-computed formula.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** ADR-0027 cost formula: searches = breadth × depth × questions, scrapes = ceil(searches × 1.5). */
function computeResearchCost(breadth: number, depth: number, questionCount: number) {
  const searchCalls = breadth * depth * questionCount;
  const scrapeCalls = Math.ceil(searchCalls * 1.5);
  return { searchCalls, scrapeCalls };
}

describe("ADR-0027 — Tool-computed research cost", () => {
  it("deep profile: 6 breadth × 3 depth × 8 questions = 144 searches, 216 scrapes", () => {
    const { searchCalls, scrapeCalls } = computeResearchCost(6, 3, 8);
    assert.equal(searchCalls, 144);
    assert.equal(scrapeCalls, 216);
  });

  it("default profile: 4 × 2 × 5 = 40 searches, 60 scrapes", () => {
    const { searchCalls, scrapeCalls } = computeResearchCost(4, 2, 5);
    assert.equal(searchCalls, 40);
    assert.equal(scrapeCalls, 60);
  });

  it("fast profile: 2 × 1 × 3 = 6 searches, 9 scrapes", () => {
    const { searchCalls, scrapeCalls } = computeResearchCost(2, 1, 3);
    assert.equal(searchCalls, 6);
    assert.equal(scrapeCalls, 9);
  });

  it("single question: 4 × 2 × 1 = 8 searches, 12 scrapes", () => {
    const { searchCalls, scrapeCalls } = computeResearchCost(4, 2, 1);
    assert.equal(searchCalls, 8);
    assert.equal(scrapeCalls, 12);
  });

  it("custom profile: 5 × 4 × 10 = 200 searches, 300 scrapes", () => {
    const { searchCalls, scrapeCalls } = computeResearchCost(5, 4, 10);
    assert.equal(searchCalls, 200);
    assert.equal(scrapeCalls, 300);
  });
});
