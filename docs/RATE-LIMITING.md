# Rate Limiting & Reliability

## Root Cause

Fusion fires 3+ API calls in parallel via `Promise.allSettled`. When any provider rate-limits, the slowest model blocks the entire pipeline — even if 2/3 models responded instantly.

### Example from testing

| Test | DeepSeek | MiniMax | OpenRouter | Total wait |
|------|----------|---------|------------|------------|
| Zustand vs Jotai | 10s | 30s | 25s | ~30s |
| PostgreSQL vs MongoDB | 10s | TIMEOUT (60s) | TIMEOUT (60s) | **60s** ⚠️ |
| Cache Stampede | 15s | 50s | 40s | ~50s |
| Cloudflare vs Fly vs Lambda | 10s | TIMEOUT (60s) | TIMEOUT (60s) | **60s** ⚠️ |

The timeout was the old 60s hard limit in `chatCompletion`. Two causes:
1. **Rate limiting**: MiniMax and OpenRouter throttle after rapid-fire calls (4 fusion tests in 5 minutes = 12+ API calls)
2. **No retry with backoff**: A single 429 or hang meant 60s of dead air

## Mitigations Implemented

### 1. Per-model timeout (`perModelTimeoutMs`)

Each model gets an independent deadline via `Promise.race`. Default: 40s. After a model is cut off, other models continue and results are collected.

```typescript
// engine.ts
const perModelTimeoutMs = config.perModelTimeoutMs ?? 40_000;
Promise.race([
  runWithTools(...),
  timeout(perModelTimeoutMs),
])
```

### 2. Retry with exponential backoff

`chatCompletion` retries rate-limited and timed-out requests up to 2 times (configurable via `maxRetries`). Backoff: 2s → 4s, capped at 30s.

```typescript
// clients.ts
for (let attempt = 0; attempt <= maxRetries; attempt++) {
  if (attempt > 0) {
    const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30_000);
    await new Promise((r) => setTimeout(r, delay));
  }
  // ... try again
}
```

### 3. Retry-After header support

When a provider returns HTTP 429, the `retry-after` header is read and included in the error message for observability.

### 4. Reasoning model support

DeepSeek V4 Pro is a reasoning model — it spends tokens on internal `reasoning_content`. If `content` is null/empty, the engine falls back to `reasoning_content`. Combined with increased `maxCompletionTokens` (default 4096 → recommended 8192 for reasoning models).

## Degradation Paths

| Scenario | Behavior |
|----------|----------|
| 3/3 models respond | Full judge analysis |
| 2/3 respond | Judge synthesizes from the 2 |
| 1/3 responds | Returns response directly, no judge |
| 0/3 respond | Typed error with `failure_reason` |
| Rate-limited mid-session | Retry × 2 with backoff, then report to user |

## Recommendations for Users

1. **Space out fusion calls** — rapid consecutive calls hit provider rate limits
2. **Set `perModelTimeoutMs`** in `~/.pi/fusion-panel.json`:
   ```json
   { "perModelTimeoutMs": 40000 }
   ```
3. **Use providers with generous rate limits** as panel defaults (DeepSeek has been the most reliable in testing)
4. **For reasoning models (DeepSeek V4 Pro)**, set `maxCompletionTokens` to 8192 or higher to leave room for both reasoning and visible content
