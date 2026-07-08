/**
 * Single source of truth for the mind-map injection prompt.
 *
 * Called by the Research Run Orchestrator (auto-generation with findings)
 * and the standalone mind_map tool (manual generation with rawContent).
 *
 * Replaces the duplicated prompt template previously embedded in both
 * index.ts and tools/run-research.ts.
 */
export function buildMindMapPrompt(
  topic: string,
  findings?: string,
  rawContent?: string,
  savePath?: string,
): string {
  const saveHint = savePath
    ? `\nSave the diagram block to: ${savePath}`
    : "";

  const contentBlock = findings
    ? `**Key findings:**\n${findings}`
    : `**Content:**\n${(rawContent ?? "").substring(0, 3000)}`;

  return [
    `## Generate Mind Map`,
    ``,
    `Create a Mermaid mind map diagram (\`graph TD\`) for this topic:`,
    ``,
    `**Topic:** ${topic}`,
    ``,
    contentBlock,
    ``,
    `Respond with a \`\`\`mermaid\`\`\` block containing the \`graph TD\` diagram.`,
    `Use short node labels. Group related concepts. Show hierarchy with arrows.${saveHint}`,
  ].join("\n");
}
