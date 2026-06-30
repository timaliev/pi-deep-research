/** Shared ID generators for deep-research artifacts. */

let _counter = 0;

export function generateRunId(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  // Monotonic counter prevents collisions within same millisecond
  _counter = (_counter + 1) % 1000;
  const seq = String(_counter).padStart(3, "0");
  return `${y}${m}${d}-${h}${mi}${s}${ms}${seq}`;
}
