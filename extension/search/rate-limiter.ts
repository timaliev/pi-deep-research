/**
 * RateLimiter — single module owning all rate-limiting logic.
 *
 * Absorbs waitIfNeeded, engineLastCall, ENGINE_MIN_DELAY from web-search.ts
 * and exponential backoff + rate-limit detection from duckduckgo.ts.
 *
 * Interface:
 *   waitIfNeeded(engine)     — pre-request stagger
 *   retryOnRateLimit(engine, fn) — DDG retry wrapper (no-op for other engines)
 *   recordCall(engine)       — post-success timestamp recording
 */

// ─── Types ──────────────────────────────────────────────────────

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  rateLimitIndicators: string[];
}

export interface EngineRateLimitConfig {
  minDelayMs: number;
  /** Random pre-stagger delay range (0–preStaggerMs) for first call in a burst (DDG only). */
  preStaggerMs?: number;
  /** Retry with exponential backoff. Only DDG uses this; other engines have no retry config. */
  retry?: RetryConfig;
}

// ─── RateLimitError ─────────────────────────────────────────────

export class RateLimitError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Rate limited (status ${status})`);
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimited(status: number, body: string, indicators: string[]): boolean {
  if (status === 202 || status === 429 || status >= 500) return true;
  const lower = body.toLowerCase();
  return indicators.some((i) => lower.includes(i));
}

// ─── RateLimiter ────────────────────────────────────────────────

export class RateLimiter {
  private lastCall: Record<string, number> = {};

  constructor(private readonly configs: Record<string, EngineRateLimitConfig>) {}

  /**
   * Wait if the engine was called too recently.
   * For engines with preStaggerMs: applies a random pre-delay on first call in a burst.
   */
  async waitIfNeeded(engine: string): Promise<void> {
    const config = this.configs[engine];
    if (!config) return;

    // Pre-stagger: random delay before first call in a burst (DDG)
    if (config.preStaggerMs && !this.lastCall[engine]) {
      const preDelay = Math.random() * config.preStaggerMs;
      this.lastCall[engine] = Date.now() + preDelay;
      await sleep(preDelay);
      return;
    }

    const last = this.lastCall[engine] ?? 0;
    const elapsed = Date.now() - last;
    if (elapsed < config.minDelayMs) {
      const waitTime = config.minDelayMs - elapsed + Math.random() * 500;
      await sleep(waitTime);
    }
  }

  /**
   * Execute fn with retry on rate-limit for engines with retry config.
   * Non-retry engines: passes through to fn() directly.
   */
  async retryOnRateLimit<T>(engine: string, fn: () => Promise<T>): Promise<T> {
    const retryConfig = this.configs[engine]?.retry;
    if (!retryConfig) return fn();

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = this.calcBackoff(attempt - 1, retryConfig);
        await sleep(delay);
      }

      try {
        return await fn();
      } catch (err) {
        if (err instanceof RateLimitError && isRateLimited(err.status, err.body, retryConfig.rateLimitIndicators)) {
          if (attempt < retryConfig.maxRetries) continue;
          throw new Error(`DuckDuckGo rate-limited after ${retryConfig.maxRetries + 1} attempts`);
        }
        // Non-rate-limit error or non-RateLimitError: don't retry, bubble up
        if (attempt < retryConfig.maxRetries) {
          // Also check raw error shape for backward compat (status + body properties)
          const status = (err as any)?.status;
          const body = (err as any)?.body;
          if (
            typeof status === "number" &&
            typeof body === "string" &&
            isRateLimited(status, body, retryConfig.rateLimitIndicators)
          ) {
            continue;
          }
        }
        throw err;
      }
    }

    throw new Error(`DuckDuckGo rate-limited after ${retryConfig.maxRetries + 1} attempts`);
  }

  /** Record a successful call timestamp. Must be called after a successful search. */
  recordCall(engine: string): void {
    this.lastCall[engine] = Date.now();
  }

  // ── private ──

  private calcBackoff(attempt: number, retry: RetryConfig): number {
    let delay = retry.baseDelayMs * retry.backoffMultiplier ** attempt;
    if (delay > retry.maxDelayMs) delay = retry.maxDelayMs;
    delay += Math.random() * 500; // jitter
    return Math.floor(delay);
  }
}

// ─── Default configs (mirror previous ENGINE_MIN_DELAY + DDG specifics) ──

export const DEFAULT_RATE_LIMIT_CONFIGS: Record<string, EngineRateLimitConfig> = {
  duckduckgo: {
    minDelayMs: 2500,
    preStaggerMs: 2000,
    retry: {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30_000,
      backoffMultiplier: 2.0,
      rateLimitIndicators: [
        "captcha",
        "rate limit",
        "too many requests",
        "blocked",
        "automated",
        "bots use duckduckgo",
        "challenge",
        "anomaly",
      ],
    },
  },
  searxng: { minDelayMs: 2000 },
  brave: { minDelayMs: 500 },
  tavily: { minDelayMs: 200 },
  yandex: { minDelayMs: 500 },
};

/** Singleton RateLimiter used by engine adapters and searchAllEngines. */
export const rateLimiter = new RateLimiter(DEFAULT_RATE_LIMIT_CONFIGS);
