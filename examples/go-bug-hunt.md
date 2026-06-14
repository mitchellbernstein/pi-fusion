# Example: Go Token Bucket Bug Hunt

**Intelligence test** — proving fusion catches bugs a single model misses. All 3 models analyzed the same Go code with different reviewer perspectives (correctness, edge cases, production readiness). The judge synthesized 7 consensus findings, 5 contradictions, 4 unique insights, and 4 blind spots.

**Prompt:**
> "Analyze this Go token bucket rate limiter for correctness..."

**Elapsed:** 190s | **Cost:** ~$0.029 | **Models:** 3/3

---

## The Code Under Review

```go
type TokenBucket struct {
    mu         sync.Mutex
    capacity   int
    tokens     float64
    fillRate   float64
    lastRefill time.Time
}

func (tb *TokenBucket) refill() {
    now := time.Now()
    elapsed := now.Sub(tb.lastRefill).Seconds()
    tb.tokens += elapsed * tb.fillRate
    if tb.tokens > float64(tb.capacity) {
        tb.tokens = float64(tb.capacity)
    }
    tb.lastRefill = now
}

func (tb *TokenBucket) Allow() bool {
    tb.mu.Lock()
    defer tb.mu.Unlock()
    tb.refill()
    if tb.tokens >= 1.0 {
        tb.tokens -= 1.0
        return true
    }
    return false
}
```

---

## Bugs Found

### Consensus (found by all 3 reviewers)

| Bug | Severity | Description |
|-----|----------|-------------|
| No constructor → unusable from external packages | **Critical** | All fields unexported, no `New()` function |
| Zero-value `lastRefill` | **Critical** | `time.Time{}` → 2000+ years elapsed on first call, instantly fills bucket |
| No input validation | **High** | `capacity ≤ 0`, `fillRate ≤ 0`, NaN, Inf not checked |
| Float64 precision drift | **Medium** | Repeated `elapsed * fillRate` accumulation loses precision |
| No observability | **High** | No metrics, no token inspection, no allowed/denied counters |
| Only `Allow()` exists | **Medium** | Hardcoded 1.0 token cost, no `AllowN()`, no `Wait()` |
| Clock skew vulnerability | **Medium** | NTP adjustment, VM suspend, manual clock change can cause token loss |

### Unique Insights (found by only 1 reviewer)

1. **Catastrophic cancellation quantified**: At 1M QPS with fillRate=1.0 and capacity=1000.0, adding 1e-6 to 1000.0 is lost in the float64 mantissa — needs 18 digits but float64 has 15-17.
2. **Type inconsistency**: `capacity` is `int` but compared as `float64(capacity)` — a code smell. Fixed code unifies to `float64`.
3. **Clock not injectable**: `time.Now()` is hardcoded, making the bucket untestable with simulated time. Recommends a `Clock` interface.
4. **Missing `Wait`/`Reserve` API**: Elevated to HIGH severity — the absence of blocking semantics is a critical API gap, not a nice-to-have.

### Blind Spots (found by NO reviewer — surfaced by judge)

- **Mutex contention at high concurrency**: No reviewer discussed what happens with millions of goroutines hitting the same mutex. `sync.RWMutex`, lock-free atomics, or per-CPU sharding were never explored.
- **No test code provided**: Despite finding bugs, no reviewer wrote tests to verify the fixes.
- **Memory model analysis missing**: No explicit reasoning about happens-before guarantees and whether `sync.Mutex` alone is sufficient for visibility.
- **Lazy-refill design not evaluated**: The tradeoff between computing tokens on every `Allow()` vs. a background goroutine was never discussed.

---

## Why Fusion Beat a Single Model

| Category | Single Model | All 3 (Fusion) |
|----------|-------------|-----------------|
| Bugs found | 4-5 | 7+ (consensus) + 4 unique |
| Severity accuracy | Some misrated | Calibrated across reviewers |
| Blind spots surfaced | N/A (model can't report own gaps) | 4 surfaced by judge |
| Edge case depth | Shallow | One model quantified catastrophic cancellation |
| Production gaps | Maybe 1-2 | 4 identified (observability, testability, API surface, concurrency) |
