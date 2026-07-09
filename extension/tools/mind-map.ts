import { Type } from "typebox";
import { buildMindMapPrompt } from "../mind-map-injector.js";

export function createMindMapTool(sendUserMessage: (msg: string, opts: any) => void) {
  return {
    name: "mind_map",
    label: "Generate Mind Map",
    description:
      "Generate a Mermaid mind map (graph TD) from research findings or any text content. The agent responds with a Mermaid diagram block. Use save_path to persist to a file.",
    parameters: Type.Object({
      topic: Type.String({ description: "Topic for the mind map" }),
      content: Type.String({ description: "Content to base the mind map on (findings, notes, report text)" }),
      save_path: Type.Optional(Type.String({ description: "Optional file path to save the mind map diagram" })),
    }),
    async execute(_toolCallId: string, params: any) {
      const prompt = buildMindMapPrompt(
        params.topic as string,
        undefined,
        params.content as string,
        (params.save_path as string | undefined) ?? undefined,
      );
      sendUserMessage(prompt, { deliverAs: "steer" });

      return {
        content: [
          {
            type: "text",
            text:
              `Mind map prompt sent. Respond with a Mermaid \`graph TD\` block for topic: ${params.topic}.` +
              (params.save_path ? ` Save to: ${params.save_path}` : ""),
          },
        ],
        details: { topic: params.topic, save_path: params.save_path },
      };
    },
  };
}
