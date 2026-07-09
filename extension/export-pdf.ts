import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname } from "node:path";

export interface ConvertToPdfParams {
  reportPath: string;
  outputPath?: string;
}

export interface ConvertToPdfResult {
  kind: "success" | "fallback" | "error";
  outputPath: string;
  method?: "pandoc" | "agent";
  error?: string;
}

/**
 * Convert markdown report to PDF.
 * Primary: pandoc + weasyprint.
 * Fallback: returns result for agent-based conversion.
 */
export async function convertToPdf(params: ConvertToPdfParams): Promise<ConvertToPdfResult> {
  const reportPath = params.reportPath;
  const outputPath = params.outputPath ?? reportPath.replace(/\.md$/, ".pdf");

  if (!existsSync(reportPath)) {
    return {
      kind: "error",
      outputPath,
      error: `Report not found: ${reportPath}`,
    };
  }

  // Ensure output directory exists (regardless of method)
  mkdirSync(dirname(outputPath), { recursive: true });

  // Pre-flight: check system tools
  const pandocOk = commandExists("pandoc");
  const weasyOk = commandExists("weasyprint");

  if (pandocOk && weasyOk) {
    // Primary: pandoc + weasyprint
    try {
      const topic = extractTopic(reportPath);
      const mermaidOk = commandExists("mermaid-filter");

      const args = [
        reportPath,
        "-o",
        outputPath,
        "--pdf-engine=weasyprint",
        "-f",
        "markdown",
        "--metadata",
        `title=Research: ${topic}`,
      ];
      if (mermaidOk) args.push("--filter", "mermaid-filter");

      execFileSync("pandoc", args, { timeout: 30_000 });

      return {
        kind: "success",
        outputPath,
        method: "pandoc",
      };
    } catch (err: any) {
      return {
        kind: "error",
        outputPath,
        error: `PDF conversion failed: ${err.message ?? String(err)}`,
      };
    }
  }

  // Fallback: agent-based conversion
  const missing = [!pandocOk && "pandoc", !weasyOk && "weasyprint"].filter(Boolean).join(", ");

  return {
    kind: "fallback",
    outputPath,
    method: "agent",
    error: `${missing} not installed.`,
  };
}

/** Check if a command is available. Cross-platform (Unix `which` / Windows `where`). */
function commandExists(cmd: string): boolean {
  try {
    execSync(process.platform === "win32" ? `where ${cmd}` : `which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Extract a human-readable topic from a report filename. */
function extractTopic(path: string): string {
  const base = basename(path);
  // Strip date prefix and .md extension
  return base
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .replace(/^\d{8}-/, "")
    .replace(/\.md$/, "")
    .replace(/-/g, " ");
}
