# Example: Cache Stampede PR Review

**Code review use case** — all 3 models responded with production-quality analysis.

**Prompt:**
> "You're reviewing a PR that adds a caching layer using Redis. The developer chose a cache-aside pattern but didn't handle cache stampedes. What's the right fix? Evaluate: Redis SETNX locking, probabilistic early recomputation, and local mutex with distributed TTL jitter."

**Elapsed:** 173 seconds | **Cost:** ~$0.01

| Model | Status |
|-------|--------|
| deepseek-v4-pro | ✅ Responded |
| MiniMax-M3 | ✅ Responded |
| moonshotai/kimi-k2.7-code | ✅ Responded |

---

## Core Agreement: Layer the solutions, don't pick one

All three models independently recommended a **layered strategy** rather than picking a single approach:

| Layer | Approach | What it solves |
|-------|----------|---------------|
| L1: In-process | Local mutex (single-flight) | Collapses N goroutines → 1 DB call per process |
| L2: Fleet-wide | TTL jitter | Desynchronizes expiration across instances |
| L3: Cross-instance | Probabilistic early recomputation (X-Fetch) | Eliminates the hard expiration cliff |
| L3 alt | Redis SETNX lock | Fallback for hard cache misses |

### Recommended implementation order (consensus)

1. **TTL jitter** — one-line change, massive impact
2. **Local single-flight** — no external dependencies
3. **Probabilistic early recomputation** — primary defense for hot keys
4. **SETNX lock** — safety net for hard misses only

### Key insights per model

**DeepSeek:** SETNX adds Redis round-trips and creates a lock-holder SPOF. X-Fetch is "the best choice for read-heavy, high-throughput systems where bounded staleness is acceptable."

**MiniMax:** X-Fetch is "theoretically optimal stampede reduction" but introduces a staleness window. Cloudflare adopted this approach in production. Jitter is "non-negotiable."

**Kimi:** SETNX with stale-while-revalidate for waiters. "Don't implement a naive 'everyone waits on Redis.'"

### What to push back on in the PR (from MiniMax)

- Locks with no discussion of crash semantics → ask for Lua release script + failure-injection test
- A single fixed TTL across many keys → "Jitter is non-negotiable"
- No measurement of recompute time delta → "Add a histogram"
- "The cache will absorb the burst" → "It doesn't; that's the whole problem"
