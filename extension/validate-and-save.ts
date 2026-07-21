/**
 * validateAndSavePlan — pure function replacing PrefiterManager.finalize() pipeline.
 * ADR-0028: no state machine, no phase tracking, no prerequisite next() calls.
 */
import type { PrefilterArtifact, ResearchPlan } from "../prefilter.js";
import type { SearchEngine } from "../search/web-search.js";

/** Extract JSON from LLM output — handles markdown fences and bare JSON. */
function extractJson(text: string): string | null {
  if (!text) return null;

  // Try markdown code fence: ```json ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]?.trim()) return fence[1].trim();

  // Try bare JSON — must start with {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      /* not bare JSON */
    }
  }

  // Try to find JSON object anywhere in text
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      JSON.parse(objMatch[0]);
      return objMatch[0];
    } catch {
      /* fall through */
    }
  }

  return null;
}

export interface SavePlanInput {
  planJson: string;
  topic: string;
  engines: SearchEngine[];
  profileName: string;
  artifactsDir: string;
  enabledEngines: string[];
  profileNames: string[];
  reportStyle: string;
}

export interface SavePlanOk {
  ok: true;
  plan: ResearchPlan;
  planArtifactPath: string;
}

export interface SavePlanError {
  ok: false;
  error: string;
}

export type SavePlanResult = SavePlanOk | SavePlanError;

/** Parse and validate a plan JSON, apply engine rules, save artifact. */
export async function validateAndSavePlan(input: SavePlanInput): Promise<SavePlanResult> {
  // 1. Extract + parse JSON from LLM output
  const json = extractJson(input.planJson);
  if (!json)
    return { ok: false, error: "Failed to find valid JSON in plan output. Ensure response contains JSON plan." };

  let plan: unknown;
  try {
    plan = JSON.parse(json);
  } catch {
    return { ok: false, error: "Failed to parse plan JSON. Ensure valid JSON syntax." };
  }

  // 2. Validate required fields
  const validationError = validatePlan(plan, input.profileNames);
  if (validationError) return { ok: false, error: validationError };

  const p = plan as ResearchPlan;

  // 3. Enforce engine allowlist + expand engines
  p.engines = enforceEngineAllowlist(p.engines, input.enabledEngines);
  (p as Record<string, unknown>).enabledEngines = input.enabledEngines;
  if (input.enabledEngines.length > 0) {
    const missing = input.enabledEngines.filter((e) => !p.engines.includes(e as SearchEngine));
    if (missing.length > 0) {
      p.engines = [...p.engines, ...(missing as SearchEngine[])];
    }
  }

  // 4. Generate runId and save artifact
  const { generateRunId } = await import("./ids.js");
  const runId = generateRunId();
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  await fs.mkdir(input.artifactsDir, { recursive: true });

  const artifact: PrefilterArtifact = {
    version: 1,
    runId,
    createdAt: new Date().toISOString(),
    inputTopic: input.topic,
    plan: p,
    preliminarySearch: { query: input.topic, note: "plan created via subprocess prefilter (ADR-0028)" },
  };

  const fileName = `${runId}-prefilter.json`;
  const artifactPath = path.join(input.artifactsDir, fileName);
  await fs.writeFile(artifactPath, JSON.stringify(artifact, null, 2), "utf-8");

  return { ok: true, plan: p, planArtifactPath: artifactPath };
}

// ── Internal helpers (adapted from PrefiterManager) ─────────

function validatePlan(plan: unknown, profileNames: string[]): string | null {
  if (!plan || typeof plan !== "object") return "Plan must be a JSON object";
  const p = plan as Record<string, unknown>;

  if (!p.topic || typeof p.topic !== "string" || !p.topic.trim()) return "Plan must include 'topic'";
  if (!p.goal || typeof p.goal !== "string" || !p.goal.trim()) return "Plan must include 'goal'";
  if (!Array.isArray(p.researchQuestions) || p.researchQuestions.length === 0)
    return "Plan must include researchQuestions";
  if (!Array.isArray(p.engines) || p.engines.length === 0)
    return "Plan must include 'engines' array with at least one engine";
  if (!p.scope || typeof p.scope !== "object") return "Plan must include 'scope'";
  if (!p.estimatedCost || typeof p.estimatedCost !== "object") return "Plan must include 'estimatedCost'";
  if (!p.profile || typeof p.profile !== "object") return "Plan must include 'profile'";

  if (p.reportStyle !== undefined) {
    if (typeof p.reportStyle !== "string" || !["narrative", "subtopics"].includes(p.reportStyle as string)) {
      return "reportStyle must be 'narrative' or 'subtopics'";
    }
  }

  const prof = p.profile as Record<string, unknown>;
  const validNames = [...profileNames, "custom"];
  if (!prof.name || !validNames.includes(prof.name as string)) {
    return `profile.name must be one of: ${validNames.join(", ")}`;
  }
  if (prof.name === "custom") {
    if (typeof prof.breadth !== "number" || (prof.breadth as number) < 1)
      return "Custom profile must include 'breadth' >= 1";
    if (typeof prof.depth !== "number" || (prof.depth as number) < 1) return "Custom profile must include 'depth' >= 1";
    if (typeof prof.concurrency !== "number" || (prof.concurrency as number) < 1)
      return "Custom profile must include 'concurrency' >= 1";
  }

  return null;
}

function enforceEngineAllowlist(engines: SearchEngine[], enabledEngines: string[]): SearchEngine[] {
  if (!enabledEngines || enabledEngines.length === 0) return engines;
  const filtered = engines.filter((e) => enabledEngines.includes(e));
  if (filtered.length === 0) return ["duckduckgo"];
  return filtered;
}
