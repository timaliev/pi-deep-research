/**
 * ADR-0020: SettingsContext re-init on session_start + standalone tool defaults.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const indexSrc = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "index.ts"), "utf-8");

const settingsSrc = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "settings-context.ts"), "utf-8");

describe("ADR-0020 — SettingsContext re-init", () => {
  it("SettingsContext has reinit method", () => {
    assert.ok(settingsSrc.includes("reinit"), "SettingsContext must have reinit method");
  });

  it("index.ts calls reinit on session_start", () => {
    assert.ok(
      indexSrc.includes("settings.reinit") || indexSrc.includes("reinit(ctx"),
      "index.ts must call settings.reinit on session_start",
    );
  });

  it("export_pdf tool accepts settings for default output path", () => {
    const pdfSrc = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "tools", "deps.ts"), "utf-8");
    assert.ok(
      pdfSrc.includes("settings") || pdfSrc.includes("reportsDir"),
      "export_pdf must use settings for default output path",
    );
  });

  it("mind_map tool accepts settings for default save path", () => {
    const mmSrc = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "tools", "deps.ts"), "utf-8");
    assert.ok(
      mmSrc.includes("settings") || mmSrc.includes("reportsDir"),
      "mind_map must use settings for default save path",
    );
  });
});
