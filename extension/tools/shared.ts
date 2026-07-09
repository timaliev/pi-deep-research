import { existsSync, readFileSync } from "node:fs";
import type { PrefilterArtifact } from "../prefilter.js";

export interface PlanArtifactResult {
  ok: true;
  artifact: PrefilterArtifact;
  path: string;
}

export interface PlanArtifactError {
  ok: false;
  error: "artifact_not_found" | "invalid_json";
  path: string;
}

/**
 * Read and parse a plan artifact file.
 * Single validation seam for all tools that consume plan artifacts.
 */
export function readPlanArtifact(filePath: string): PlanArtifactResult | PlanArtifactError {
  if (!existsSync(filePath)) {
    return { ok: false, error: "artifact_not_found", path: filePath };
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const artifact: PrefilterArtifact = JSON.parse(raw);
    return { ok: true, artifact, path: filePath };
  } catch {
    return { ok: false, error: "invalid_json", path: filePath };
  }
}
