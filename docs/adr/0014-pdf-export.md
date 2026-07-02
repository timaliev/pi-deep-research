# ADR-0014: PDF export of research reports

**Date:** 2026-07-02
**Status:** proposed

## Context

Reports are currently generated as markdown files only. Users want PDF versions for sharing, archiving, and offline reading. TODO.md has tracked this as a pending item.

## Decision

### 1. Dual-mode: auto-export + standalone tool

Same pattern as mind-map (see ADR-0013):

| Mode | Trigger | Gated by |
|------|---------|----------|
| Auto-export | End of Research Run (after report saved) | `deepResearch.pdfExport` setting |
| Standalone | Agent calls `export_pdf` tool | Always available |

**Orchestrator flow (auto-export):** After the state machine returns `done`, the orchestrator checks `deepResearch.pdfExport`. If enabled and report was saved successfully, the orchestrator invokes the same conversion logic used by the standalone `export_pdf` tool.

### 2. PDF generation: pandoc (primary) + agent injection (fallback)

#### Primary: pandoc + weasyprint

The `export_pdf` tool shells out to pandoc via Node.js `child_process`:

```bash
pandoc "{reportPath}" -o "{outputPath}" \
  --pdf-engine=weasyprint \
  -f markdown \
  --metadata title="Research: {topic}"
```

**Mermaid handling:** Before invocation, check `which mermaid-filter`. If found, append `--filter mermaid-filter` to the pandoc command. If not found, Mermaid blocks render as plain code in the PDF — still readable, not a failure.

**Pre-flight checks (in order):**
1. `which pandoc` — if missing, skip to fallback. Error message: "Install pandoc: `brew install pandoc` / `apt install pandoc`"
2. `which weasyprint` — if missing, skip to fallback. Error message: "Install weasyprint: `pip install weasyprint`"
3. `which mermaid-filter` — if present, enable `--filter mermaid-filter`; if not, proceed without (non-blocking)

#### Fallback: agent injection

If pandoc or weasyprint is not available, the tool injects a prompt asking the agent to convert the report to PDF using available tools:

```
## PDF Export — Agent Fallback

Pandoc/weasyprint not installed. Convert this report to PDF using available tools:

1. Open the report file in a browser
2. Use Print → Save as PDF
3. Or use any other available PDF conversion tool

Report: {reportPath}
Output: {outputPath}
```

The agent handles PDF generation via `bash`, browser tools, or any other available mechanism. The extension does not dictate the fallback method — it delegates to the agent.

#### Standalone `export_pdf` tool

```typescript
export_pdf(report_path: string, output_path?: string)
```

- `report_path` — path to existing markdown report (required)
- `output_path` — optional; defaults to same directory + same filename with `.pdf` extension

If `report_path` points to a non-existent file, returns error. If `output_path` directory doesn't exist, creates it.

### 3. Settings

New setting: `deepResearch.pdfExport` (boolean, default `false`).

**Cascade:** env `DEEP_RESEARCH_PDF_EXPORT` → `.pi/settings.json` → `~/.pi/agent/settings.json` → built-in `false`.

Read by the orchestrator after the state machine completes. Independent of `deepResearch.mindMap` — mind-map and PDF export are separate toggles.

### 4. Tool implementation

```typescript
pi.registerTool({
  name: "export_pdf",
  label: "Export PDF",
  description: "Export a research report as PDF using pandoc+weasyprint. Falls back to agent-based conversion if pandoc not installed.",
  parameters: Type.Object({
    report_path: Type.String({ description: "Path to the markdown report" }),
    output_path: Type.Optional(Type.String({ description: "Output PDF path (defaults to same name + .pdf)" })),
  }),
  async execute(_toolCallId, params) {
    const reportPath = params.report_path;
    const outputPath = params.output_path ?? reportPath.replace(/\.md$/, ".pdf");

    if (!existsSync(reportPath)) {
      return { content: [{ type: "text", text: "Error: report not found at {reportPath}" }] };
    }

    // Pre-flight: check pandoc
    const pandocOk = execSync("which pandoc", { stdio: "ignore" }).status === 0 ?? false;
    const weasyOk = execSync("which weasyprint", { stdio: "ignore" }).status === 0 ?? false;

    if (pandocOk && weasyOk) {
      // Primary: pandoc conversion
      const topic = extractTopicFromPath(reportPath);
      const mermaidFilterOk = execSync("which mermaid-filter", { stdio: "ignore" }).status === 0 ?? false;
      const filterArg = mermaidFilterOk ? " --filter mermaid-filter" : "";
      const cmd = `pandoc "${reportPath}" -o "${outputPath}" --pdf-engine=weasyprint -f markdown --metadata title="Research: ${topic}"${filterArg}`;
      try {
        execSync(cmd, { timeout: 30_000 });
        return { content: [{ type: "text", text: `PDF saved: ${outputPath}` }], details: { pdf_path: outputPath } };
      } catch (err) {
        return { content: [{ type: "text", text: `PDF conversion failed: ${err.message}` }], details: { error: err.message } };
      }
    }

    // Fallback: agent-based conversion
    const missing = [!pandocOk && "pandoc", !weasyOk && "weasyprint"].filter(Boolean).join(", ");
    pi.sendUserMessage(
      `## PDF Export — Agent Fallback\n\n${missing} not installed. Convert the report to PDF:\n` +
      `- Report: ${reportPath}\n- Output: ${outputPath}\n\n` +
      `Use print-to-PDF in browser, or any other available PDF tool.`,
      { deliverAs: "steer" }
    );
    return {
      content: [{ type: "text", text: `${missing} not installed. Prompt sent for agent-based conversion.` }],
      details: { fallback: true, missing_tools: missing },
    };
  },
});
```

### 5. Output location

PDF is saved alongside the markdown report in the same directory (`reports/`):

```
reports/
├── 2026-07-02-my-topic.md
└── 2026-07-02-my-topic.pdf
```

If `output_path` is explicitly provided, that path is used instead.

### 6. Telemetry

PDF export adds one row to Telemetry if auto-export was enabled:

```markdown
| PDF exported | yes (pandoc) / yes (agent) / no |
```

## Consequences

- **Opt-in by default** — PDF generation adds system dependency; disabled unless user enables
- **Standalone always available** — convert any report to PDF on-demand regardless of `pdfExport` setting
- **No npm dependencies** — pandoc + weasyprint are system tools, not Node packages; extension has no new `package.json` dependencies
- **Graceful degradation** — if pandoc missing, delegates to agent fallback; if mermaid-filter missing, Mermaid renders as plain code
- **Mermaid-aware** — when `mermaid-filter` is present, mind-map diagrams render as vector graphics in PDF
- **Non-breaking** — when `deepResearch.pdfExport` is `false`, zero change to existing behavior
