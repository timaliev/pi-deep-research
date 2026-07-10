/**
 * ADR-0018: Release monitor — checks GitHub for new releases on session start.
 *
 * Gated by 6-hour cooldown. Unauthenticated GitHub API call.
 * Network failure → silent skip. Only notifies when a newer version is found.
 */

import { readFileSync } from "node:fs";
import { get } from "node:https";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours
const REPO = "timaliev/pi-deep-research";

let lastCheck = 0;

export async function checkForNewRelease(sendUserMessage: (msg: string, opts: any) => void): Promise<void> {
  const now = Date.now();
  if (now - lastCheck < COOLDOWN_MS) return;
  lastCheck = now;

  const localVersion = readLocalVersion();

  try {
    const latest = await fetchLatestRelease();
    if (!latest || !localVersion) return;

    if (compareVersions(latest.tag_name, localVersion) > 0) {
      sendUserMessage(
        [
          `## Deep Research Update Available`,
          ``,
          `**v${latest.tag_name.replace(/^v/, "")}** is available (you have v${localVersion}).`,
          ``,
          `To upgrade:`,
          `- \`cd\` to your extension directory`,
          `- \`git pull\``,
          `- restart pi or run \`/reload\``,
          ``,
          `[View release notes](https://github.com/${REPO}/releases/tag/${latest.tag_name})`,
        ].join("\n"),
        { deliverAs: "steer" },
      );
    }
  } catch {
    // Silent skip on network failure — no user-facing error
  }
}

function readLocalVersion(): string | undefined {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version;
  } catch {
    return undefined;
  }
}

function fetchLatestRelease(): Promise<{ tag_name: string } | null> {
  return new Promise((resolve) => {
    const req = get(
      {
        hostname: "api.github.com",
        path: `/repos/${REPO}/releases/latest`,
        headers: {
          "User-Agent": `pi-deep-research/${readLocalVersion() ?? "unknown"}`,
          Accept: "application/vnd.github+json",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data) as { tag_name: string });
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

function compareVersions(a: string, b: string): number {
  const clean = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const [aMaj, aMin, aPat] = clean(a);
  const [bMaj, bMin, bPat] = clean(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPat - bPat;
}
