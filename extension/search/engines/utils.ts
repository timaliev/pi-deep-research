// Shared engine utility — engine rate-limiting state
import { waitIfNeeded as _waitIfNeeded } from "../web-search.js";

export async function waitIfNeeded(engine: string): Promise<void> {
  await _waitIfNeeded(engine);
}
