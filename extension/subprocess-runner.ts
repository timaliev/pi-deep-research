/**
 * Spawn a pi subprocess in JSON mode, send a prompt, capture text output.
 * Pattern from official pi subagent extension. Supports streaming via onChunk.
 */
import { spawn } from "node:child_process";

export function callPiJson(
  prompt: string,
  model: string,
  cwd: string,
  signal?: AbortSignal,
  timeoutMs = 120_000,
  onChunk?: (text: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("pi", ["--mode", "json", "-p", "--no-session", "--model", model], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("Subprocess timed out"));
    }, timeoutMs);

    if (signal) {
      const onAbort = () => {
        proc.kill("SIGTERM");
        reject(new Error("Aborted"));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    let buffer = "";
    let output = "";
    let stderr = "";

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.stdout.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          // Streaming: pass text deltas to callback in real-time
          if (event.type === "text_delta" && event.delta && onChunk) {
            onChunk(event.delta as string);
          }
          // Capture final text from message_end
          if (event.type === "message_end" && event.message?.role === "assistant") {
            for (const part of event.message.content ?? []) {
              if (part.type === "text") output += part.text;
            }
          }
        } catch {
          // skip unparseable lines
        }
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else reject(new Error(`Subprocess exited with code ${code}: ${stderr.trim() || "no stderr output"}`));
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.stdin.write(`${prompt}\n`);
    proc.stdin.end();
  });
}
