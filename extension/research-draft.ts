import { deflateSync, inflateSync } from "node:zlib";

/**
 * Owns the draft report lifecycle.
 *
 * Replaces the bare `draftReport: string` field on ResearchSnapshot.
 * Single source of truth for draft text — no triple-path recovery,
 * no agent-text re-extraction, no proxy boolean fields.
 *
 * Persistence: encode() → zlib-deflated base64url (stored in session entries).
 * Restore: static decode() → inflates + reconstructs.
 */
export class ResearchDraft {
  private text: string;

  constructor(text?: string) {
    this.text = text ?? "";
  }

  /** Overwrite the draft. Last write wins. */
  set(text: string): void {
    this.text = text;
  }

  /** Read the current draft text. */
  get(): string {
    return this.text;
  }

  /** True when the draft has enough content to persist (≥ 40 chars — same threshold as before). */
  isReady(): boolean {
    return this.text.length >= 40;
  }

  /**
   * Encode the draft for session persistence.
   * Returns base64url-encoded zlib-deflated text, or undefined if the draft is not ready.
   */
  encode(): string | undefined {
    if (!this.isReady()) return undefined;
    const buf = deflateSync(Buffer.from(this.text, "utf-8"));
    return buf.toString("base64url");
  }

  /**
   * Decode a previously encoded draft.
   * Returns a ready ResearchDraft instance. Never throws — corrupted input
   * produces an empty draft (caller checks isReady()).
   */
  static decode(encoded: string): ResearchDraft {
    try {
      const buf = Buffer.from(encoded, "base64url");
      const inflated = inflateSync(buf);
      return new ResearchDraft(inflated.toString("utf-8"));
    } catch {
      return new ResearchDraft();
    }
  }
}
