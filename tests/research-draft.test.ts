import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ResearchDraft } from "../extension/research-draft.js";

describe("ResearchDraft", () => {
  it("starts empty and not ready", () => {
    const d = new ResearchDraft();
    assert.equal(d.get(), "");
    assert.equal(d.isReady(), false);
  });

  it("accepts text via constructor", () => {
    const d = new ResearchDraft("# Report\n\nContent here with enough characters to pass the forty char threshold.");
    assert.equal(d.get(), "# Report\n\nContent here with enough characters to pass the forty char threshold.");
    assert.equal(d.isReady(), true);
  });

  it("set() overwrites previous text", () => {
    const d = new ResearchDraft("old text");
    d.set("new text that is at least forty characters long enough");
    assert.equal(d.get(), "new text that is at least forty characters long enough");
  });

  it("isReady() is false for text under 40 chars", () => {
    const d = new ResearchDraft("short");
    assert.equal(d.isReady(), false);
  });

  it("isReady() is true for text >= 40 chars", () => {
    const d = new ResearchDraft("a".repeat(40));
    assert.equal(d.isReady(), true);
  });

  it("encode() returns undefined when not ready", () => {
    const d = new ResearchDraft("short");
    assert.equal(d.encode(), undefined);
  });

  it("encode() returns base64url string when ready", () => {
    const d = new ResearchDraft("a".repeat(100));
    const encoded = d.encode();
    assert.ok(encoded, "encode must return a string");
    assert.equal(typeof encoded, "string");
    // Must be base64url-safe (no + / = chars)
    assert.ok(!encoded.includes("+"), "must not contain '+'");
    assert.ok(!encoded.includes("/"), "must not contain '/'");
    assert.ok(!encoded.includes("="), "must not contain '='");
  });

  it("decode(encode()) round-trips correctly", () => {
    const original = new ResearchDraft(
      "# Test Report\n\nThis is a comprehensive report with multiple sections.\n\n## Findings\n\n- Finding 1\n- Finding 2\n\n".repeat(
        10,
      ),
    );
    const encoded = original.encode()!;
    const restored = ResearchDraft.decode(encoded);
    assert.equal(restored.get(), original.get());
    assert.equal(restored.isReady(), true);
  });

  it("decode() returns empty draft for empty/invalid input", () => {
    const d = ResearchDraft.decode("not-valid-base64!!!");
    assert.equal(d.get(), "");
    assert.equal(d.isReady(), false);
  });

  it("decode() returns empty draft for empty string", () => {
    const d = ResearchDraft.decode("");
    assert.equal(d.get(), "");
    assert.equal(d.isReady(), false);
  });

  it("compresses large text significantly", () => {
    const text = "The quick brown fox jumps over the lazy dog. ".repeat(200); // ~8KB
    const d = new ResearchDraft(text);
    const encoded = d.encode()!;
    // Compressed + base64url should be much smaller than original
    assert.ok(
      encoded.length < text.length * 0.5,
      `Expected compressed < 50% of original, got ${Math.round((encoded.length / text.length) * 100)}%`,
    );
  });

  it("multiple set/get cycles are idempotent", () => {
    const d = new ResearchDraft();
    d.set("first attempt at writing a proper report with enough characters");
    assert.equal(d.isReady(), true);
    const enc1 = d.encode();

    d.set("second attempt at writing a different report that is even longer than the first one to ensure enough chars");
    const enc2 = d.encode();

    assert.notEqual(enc1, enc2, "each write produces a different encoding");
  });
});
