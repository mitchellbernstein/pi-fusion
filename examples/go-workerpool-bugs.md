# Example: Go WorkerPool Concurrency Bug Hunt

**Degraded test** — demonstrates how fusion handles model failures gracefully. Only 1 of 3 panel models (DeepSeek V4 Pro) responded within the per-model timeout; MiniMax M3 and Kimi K2.7 Code both timed out. The single model still found 9 bugs with detailed fix recommendations. Without a second response, the judge was skipped and the response was returned directly.

**Prompt:**
> "Review this Go WorkerPool for correctness, race conditions, resource leaks, and production hardening. Focus only on bugs — not style..."

**Elapsed:** 90.1s | **Cost:** ~$0.01 | **Models:** 1/3 (degraded)

---

## The Code Under Review

```go
type WorkerPool struct {
    mu      sync.Mutex
    workers int
    ctx     context.Context
    cancel  context.CancelFunc
    tasks   chan func()
}

func NewWorkerPool(size int) *WorkerPool {
    ctx, cancel := context.WithCancel(context.Background())
    return &WorkerPool{workers: size, ctx: ctx, cancel: cancel, tasks: make(chan func())}
}

func (wp *WorkerPool) Start() {
    for i := 0; i < wp.workers; i++ {
        go func() {
            for {
                select {
                case task, ok := <-wp.tasks:
                    if !ok { return }
                    task()
                case <-wp.ctx.Done():
                    return
                }
            }
        }()
    }
}

func (wp *WorkerPool) Submit(task func()) bool {
    wp.mu.Lock()
    defer wp.mu.Unlock()
    select {
    case <-wp.ctx.Done():
        return false
    default:
        wp.tasks <- task
        return true
    }
}

func (wp *WorkerPool) Shutdown() {
    wp.cancel()
    close(wp.tasks)
}

func (wp *WorkerPool) ActiveWorkers() int {
    wp.mu.Lock()
    defer wp.mu.Unlock()
    return wp.workers
}
```

---

## Bugs Found (Single Model: DeepSeek V4 Pro)

All 9 bugs were found by the single responding model. Since no second model responded, there was no judge synthesis — the raw analysis is presented directly.

### Critical Bugs

| # | Bug | Severity | Description |
|---|-----|----------|-------------|
| 1 | **Mutex held across blocking channel send** | **Critical** | `Submit` holds `wp.mu` while blocking on `wp.tasks <- task` to an unbuffered channel. If all workers are busy, every other caller freezes behind the mutex — complete pool deadlock under load. |
| 2 | **`close(channel)` with blocked sender panics** | **Critical** | `Shutdown` calls `cancel()` then `close(wp.tasks)`. If a goroutine is blocked on `wp.tasks <- task`, closing the channel panics with `send on closed channel`. |

### High Severity

| # | Bug | Severity | Description |
|---|-----|----------|-------------|
| 3 | **Double `Shutdown` panics** | **High** | `close(wp.tasks)` on second call panics with `close of closed channel`. No `sync.Once` guard. |
| 4 | **`Submit` before `Start` deadlocks** | **High** | No workers running + unbuffered channel = permanent block on send. No error return for "pool not started." |
| 5 | **`Start` not idempotent → goroutine leak** | **High** | No `sync.Once` or started flag. Each `Start()` call spawns another `workers` goroutines. Old set competes for the same channel, never cleaned up. |
| 6 | **`Shutdown` doesn't drain pending tasks** | **High** | Workers exit immediately on `ctx.Done()` while tasks remain queued. `Submit` may have returned `true` (task accepted) but the task is silently discarded. |

### Medium / Design

| # | Bug | Severity | Description |
|---|-----|----------|-------------|
| 7 | **Data race on `wp.workers`** | **Medium** | `Start()` reads `wp.workers` without the mutex while `ActiveWorkers()` reads it under the lock. The race detector flags this. |
| 8 | **`ActiveWorkers` semantically broken** | **Medium** | Returns static config value, not live active worker count. After `Shutdown`, still returns original count. |
| 9 | **Mutex provides false atomicity** | **Design** | The lock serializes `Submit` callers but `Shutdown` never acquires it, so the "check + send" atomicity is an illusion — `cancel()` can fire between the select check and the channel send. |

---

## 10K Concurrent Submit Calls

DeepSeek's analysis concluded the pool **collapses immediately** under high concurrency:

1. **Unbuffered channel**: every send waits for a worker rendezvous
2. **Mutex held across send**: only one goroutine can attempt delivery at a time (others queue on `mu.Lock()`, not the channel)
3. **Once one blocks** (all workers busy), the entire submit path deadlocks permanently

---

## Degradation Path

This test demonstrates fusion's graceful degradation when panel models fail:

| Model | Status | Reason |
|-------|--------|--------|
| DeepSeek V4 Pro | ✅ Responded (90.1s) | Complete 9-bug analysis |
| MiniMax M3 | ❌ Timed out | Exceeded 90s per-model timeout |
| Kimi K2.7 Code (OpenRouter) | ❌ Timed out | Exceeded 90s per-model timeout |

Since only 1 model responded, the judge was **skipped** — the raw response was returned directly. This is fusion's built-in degradation behavior: **2+ responses → judge synthesis, 1 response → pass through, 0 responses → error.**

### What was lost by degradation

| Feature | With 3/3 models | With 1/3 models |
|---------|-----------------|-----------------|
| Consensus verification | ✅ Independent confirmation of top bugs | ❌ No cross-referencing |
| Contradictions | ✅ Models disagree → surface real tradeoffs | ❌ Not applicable |
| Unique insights | ✅ Blind spots each model discovered alone | ❌ Only one perspective |
| Blind spots | ✅ Judge identifies what NO model discussed | ❌ No judge to surface gaps |
| Severity calibration | ✅ Average of multiple severity assessments | ❌ Single model's judgment |
| Fixed code examples | ✅ Community of models provides tested fixes | ✅ DeepSeek provided detailed fixes alone |

Even in degraded mode, DeepSeek's single-analysis output was comprehensive — the model found 9 bugs with detailed fix prose and concurrency analysis in a single pass for ~$0.01.

---

## Why This Test Matters

| Category | Without Fusion | With Fusion (1/3 degraded) |
|----------|---------------|---------------------------|
| Time to review | 20+ min (human) | 90s |
| Cost | $100+/hr (engineer time) | ~$0.01 |
| Bugs found | Depends on reviewer expertise | 9 (critical, high, medium) |
| Code-level explanation | Varies | Deep analysis with fix examples |
| Concurrency analysis | Requires deep Go expertise | Automatic (deadlock, panic, race scenarios) |

A single human code reviewer might catch 3–5 of these 9 bugs in a first pass. The model found all 9 in 90 seconds. With all 3 models responding and a judge, the analysis would be richer — but even the degraded path delivers high value.
