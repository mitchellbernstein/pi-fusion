# pi-fusion

**Multi-model deliberation for pi** — fans out your query to 3+ AI models in parallel (each with web search), then a judge synthesizes structured analysis: consensus, contradictions, unique insights, and blind spots.

Follows the same deliberation pattern as [OpenRouter Fusion](https://openrouter.ai/fusion) — parallel panel → judge synthesis — at **~$0.01/query** (OpenRouter Fusion charges ~$0.70/query at time of testing).

---

## Quick Start

```bash
pi install git:github.com/mitchellbernstein/pi-fusion

# When updates are published:
pi update   # or: pi install git:github.com/mitchellbernstein/pi-fusion@main
```

If you don't use pi, install manually:

```bash
git clone https://github.com/mitchellbernstein/pi-fusion
cd pi-fusion
npm install
cp .env.example .env
# edit .env with your API keys
```

---

## Agent Setup Prompt

Paste this into your coding agent (pi, Claude Code, Cursor, etc.) and it will configure pi-fusion for you:

```
Install and configure pi-fusion for me:

1. Install the package: pi install git:github.com/mitchellbernstein/pi-fusion
2. Create a .env file in the pi-fusion package root at:
   ~/.pi/agent/git/github.com/mitchellbernstein/pi-fusion/.env

   Add these API keys (get free tiers at the linked platforms):
   - DEEPSEEK_API_KEY=     (from https://platform.deepseek.com — credits are cheap)
   - MINIMAX_API_KEY=      (from https://platform.minimax.io)
   - OPENROUTER_API_KEY=   (from https://openrouter.ai/keys — for Gemini Flash)
   - EXA_API_KEY=          (from https://dashboard.exa.ai — free tier: 100 searches/mo)

   Minimum: just DEEPSEEK_API_KEY works (runs with 1 model).
   Full 3-model panel + judge: all four keys.

3. (Optional) Customize the panel by editing ~/.pi/fusion-panel.json
   to use any OpenAI-compatible models you prefer.

4. Reload pi (/reload) to pick up the new extension and skill.

5. Verify: ask me "Use fusion to evaluate whether Rust or Go is better for
   a high-throughput API server."
```

---

## Usage

### Inside pi

Once installed, just ask pi something complex — the LLM will decide when to call `fusion`:

> *"Use fusion to compare the tradeoffs between Rust and Go for a high-throughput API server."*

The skill teaches the LLM when to use fusion (complex reasoning, architecture, code review, debugging) and when not to (simple facts, trivial ops, high-confidence questions).

### CLI directly

```bash
npx tsx src/cli.ts "What are the key tradeoffs between Rust and Go for an API server?"

echo "Is Rust or Go better for my use case?" | npx tsx src/cli.ts
```

---

## How It Works

```
fusionCall(prompt)
  │
  ├─ Panel (parallel): each model answers independently, can search web
  │   ├─ Model A (e.g. deepseek-v4-pro) + web_search/web_fetch
  │   ├─ Model B (e.g. MiniMax-M3) + web_search/web_fetch
  │   └─ Model C (e.g. moonshotai/kimi-k2.7-code) + web_search/web_fetch
  │
  ├─ Collect: successes + failures
  ├─ Judge: compares all responses + web search → structured JSON
  └─ Return: FusionResult
```

Each model gets access to `web_search` and `web_fetch` tools (Exa API) and can make up to 8 tool calls per deliberation. The judge also has access to these tools.

The tool-calling loop follows the same pattern as OpenRouter Fusion: each model can search the web and the judge has access to those same tools.

---

## Output Schema

```jsonc
{
  "status": "ok",
  "analysis": {
    "consensus": ["Point that all models agree on..."],
    "contradictions": [
      {
        "topic": "Where models disagree",
        "stances": [
          { "model": "deepseek-v4-pro", "stance": "This model's position..." },
          { "model": "MiniMax-M3", "stance": "This model's different position..." }
        ]
      }
    ],
    "partial_coverage": [
      { "models": ["deepseek-v4-pro", "MiniMax-M3"], "point": "Only these covered this" }
    ],
    "unique_insights": [
      { "model": "moonshotai/kimi-k2.7-code", "insight": "Only this model raised this" }
    ],
    "blind_spots": ["Important aspect no model addressed"]
  },
  "responses": [
    { "model": "deepseek-v4-pro", "content": "..." },
    { "model": "MiniMax-M3", "content": "..." },
    { "model": "moonshotai/kimi-k2.7-code", "content": "..." }
  ],
  "elapsed_seconds": "124.6"
}
```

## Degradation Handling

- **All 3 models respond** → full judge analysis with all 5 fields
- **2 models respond** → judge runs on the 2 responses
- **1 model responds** → returns the response directly, no judge step
- **0 models respond** → typed error with `failure_reason`

---

## Configuration

### Panel Config (`~/.pi/fusion-panel.json`)

```jsonc
{
  "panel": [
    // DeepSeek: anchor model — 100% reliable, cheap, handles everything
    { "model": "deepseek-v4-pro", "preset": "deepseek" },

    // MiniMax: independent voice — different architecture, needs 16384 token budget
    { "model": "MiniMax-M3", "preset": "minimax" },

    // Gemini Flash: fast & cheap — 3-7s responses, genuinely different perspective
    { "model": "google/gemini-2.5-flash", "baseUrl": "https://openrouter.ai/api/v1", "apiKeyEnv": "OPENROUTER_API_KEY", "openrouterHeaders": true },

    // Generic OpenAI-compatible (any provider!)
    { "model": "gpt-4o", "baseUrl": "https://api.openai.com/v1", "apiKeyEnv": "OPENAI_API_KEY" },
    { "model": "llama-3.1-70b", "baseUrl": "https://api.groq.com/openai/v1", "apiKeyEnv": "GROQ_API_KEY" }
  ],
  "judge": { "model": "deepseek-v4-pro", "preset": "deepseek" },
  "search": { "apiKeyEnv": "EXA_API_KEY" },
  "maxToolCalls": 8,
  "temperature": 0.7,
  "perModelTimeoutMs": 120000,
  "maxCompletionTokens": 16384
}
```

**Built-in presets:**

| Preset | Base URL | API Key Env Var |
|--------|----------|-----------------|
| `deepseek` | `https://api.deepseek.com/v1` | `DEEPSEEK_API_KEY` |
| `minimax` | `https://api.minimax.io/v1` | `MINIMAX_API_KEY` |
| `openrouter` | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |

Minimum 3 panel models — no maximum. Any OpenAI-compatible endpoint works.

---

## Compared to OpenRouter Fusion

| Feature | OpenRouter Fusion | pi-fusion |
|---------|------------------|-----------|
| Parallel panel dispatch | ✅ | ✅ |
| web_search per model | ✅ | ✅ (Exa) |
| web_fetch per model | ✅ | ✅ (Exa) |
| Tool-calling loop | ✅ (max 8) | ✅ (max 8) |
| Output schema | consensus, contradictions, etc. | same structure |
| Custom models | Paid only | Any OpenAI-compatible |
| **Cost per query** | ~$0.70 (at time of testing) | **~$0.01** |

---

## Requirements

- **Node.js 20+**
- At least one API key (DeepSeek is cheapest — ~$0.50 gets you hundreds of queries)
- For web search: Exa API key (free tier available)

---

## How It Compares to Alternatives

- **llm-council** (Karpathy): Python, web app interface, no web tools, abandoned. Wrong language and wrong schema.
- **consilium**: Rust, no web tools, different output schema. Great project but doesn't match OpenRouter Fusion's architecture.
- **OpenRouter Fusion**: Same deliberation pattern but ~$0.70/query and model-locked to OpenRouter's marketplace.
- **pi-fusion**: Follows the same deliberation pattern, works with any OpenAI-compatible endpoint, and costs ~$0.01/query.

---

## Real Examples

See [`examples/`](examples/) and [`docs/`](docs/) for real fusion deliberation outputs from 13 tests run against live APIs (June 14, 2026).

### Fusion vs Single Model Comparison (4 new battery tests)

Each test was run twice — once with a single model (DeepSeek V4 Pro) and once with fusion (3-model panel + judge). Full side-by-side results with actual findings:

| Test | Single Model | Fusion | Extra Value |
|------|-------------|--------|-------------|
| [**React Memo Bug**](examples/react-memo-bug.md) | 2 issues found, 34s, ~$0.007 | **6 issues + 5 blind spots**, 138s, ~$0.024 | 5 blind spots including useTransition and DOM bottleneck |
| [**SQL Injection Audit**](examples/sql-injection-audit.md) | 4 vectors + 1 bypass, 23s, ~$0.004 | **7 vectors + 6 blind spots**, 221s, ~$0.027 | 6 blind spots on DB driver quirks and encoding bypasses |
| [**Rust Async Deadlock**](examples/rust-async-deadlock.md) | 1 deadlock scenario, 29s, ~$0.005 | **2 scenarios + 5 blind spots**, 150s, ~$0.018 | Judge caught prompt's assumption was wrong (code leaks, not deadlocks) |
| [**Distributed Consensus**](examples/distributed-consensus.md) | 2 failure scenarios, 46s, ~$0.006 | **5 scenarios + 6 blind spots**, 115s, ~$0.022 | Migration path, cross-region concerns, observability gaps |

### Full Deliberations (2-3 models + judge synthesis)

- [**SQL Injection Audit**](examples/sql-injection-audit.md) ✨ — Express.js endpoint: **6 consensus, 2 contradictions, 6 blind spots** (222s, ~$0.02)
- [**Rust Async Deadlock**](examples/rust-async-deadlock.md) ✨ — connection pool: **4 consensus, 2 contradictions, 5 blind spots** — judge caught a bug in the PROMPT (150s, ~$0.02)
- [**React Memo Bug**](examples/react-memo-bug.md) ✨ — 10K item render: **3 consensus, 3 contradictions, 5 blind spots** (138s, ~$0.02)
- [**Distributed Consensus**](examples/distributed-consensus.md) ✨ — PG locks vs etcd: **7 consensus, 4 contradictions, 6 blind spots** (115s, ~$0.02)
- [**Postgres Feed Optimization**](examples/postgres-feed-optimization.md) — query optimization at 10M+ scale: **10 consensus, 6 contradictions, 10 blind spots** (228s, ~$0.03)
- [**CRDT vs OT Architecture**](examples/crdt-vs-ot-architecture.md) — real-time editor architecture: **11 consensus, 4 contradictions, 10 blind spots** (155s, ~$0.02)
- [**JWT Auth Security Review**](examples/jwt-auth-security.md) — security audit of token rotation: **10 consensus, 3 contradictions, 8 blind spots** (173s, ~$0.02)
- [**Go Token Bucket Bug Hunt**](examples/go-bug-hunt.md) — intelligence test: **11 bugs (7 consensus + 4 unique), 4 blind spots** (190s, ~$0.03)
- [**Zustand vs Jotai**](examples/zustand-vs-jotai.md) — state management for Next.js: **8 consensus, 3 contradictions, 8 blind spots** (137s, ~$0.02)
- [**Cache Stampede PR Review**](examples/cache-stampede-review.md) — code review, layered fix recommendation (173s, ~$0.02)

### Degraded Path (1 model, graceful fallback)

- [**Go WorkerPool Bugs**](examples/go-workerpool-bugs.md) — 9 concurrency bugs found by 1 model alone, 2 models timed out (90s, ~$0.01)
- [**PostgreSQL vs MongoDB**](examples/postgres-vs-mongodb.md) — single-model comparison, graceful degradation (109s, ~$0.01)

### Test Statistics (all 13 tests)

| Metric | Value |
|--------|-------|
| Total cost | **~$0.24** |
| Avg cost per test | **~$0.019** |
| Tests with judge synthesis | **10/13 (77%)** |
| 3-model response rate (new panel) | **75% (3/4)** |
| 2-model response rate | 1/4 (25%) |
| 1-model (degraded) rate | 2/13 (15%) |
| 0-model (error) rate | **0/13 (0%)** |
| Avg elapsed (with judge) | ~140s |
| Most reliable model | **DeepSeek V4 Pro** (13/13, 100%) |
| Fastest model | **Gemini 2.5 Flash** (2-7s, 6/6 so far, 100%) |

### Panel Model Reliability (13 tests)

| Model | Response Rate | Avg Time | Cost per Query | Notes |
|-------|-------------|----------|----------------|-------|
| **DeepSeek V4 Pro** | 100% (13/13) | 10-30s | ~$0.008 | Anchor model — rock solid |
| **Gemini 2.5 Flash** ⭐ | **100% (6/6)** | 2-7s | ~$0.0003 | Replaced Kimi — 30× faster |
| **MiniMax M3** | 77% (10/13) | 15-50s | ~$0.011 | Independent perspective, needs 16384 token budget |
| ~~Kimi K2.7~~ (removed) | 11% (1/9) | 120s timeout | ~$0.002 | Replaced — too slow |

### Non-Fusion vs Fusion Comparison

📄 **[Full comparison doc →](docs/FUSION-VS-SINGLE.md)** — 4 head-to-head coding tests with per-test breakdowns

| Factor | Single Model | pi-fusion (3-model panel + judge) |
|--------|-------------|-----------------------------------|
| Bugs/vulnerabilities found | 4–7 typical | **10–17 (consensus + unique)** |
| Blind spots surfaced | 0 (model can't report own gaps) | **5–6 per deliberation** |
| Contradictions identified | None (single perspective) | **2–4 per deliberation** |
| Fix quality | One approach | **2–3 competing fix strategies** |
| Cost | ~$0.0055 | ~$0.021 |
| Time | 33s | 156s |
| **Cost per additional finding** | N/A | **~$0.001** |

**Bottom line:** For $0.02 and ~2 minutes (down from ~3), fusion surfaces 2-3× more issues, identifies what no single model thought of, and reveals where experts disagree. The new panel (DeepSeek + MiniMax + **Gemini Flash**) achieves **100% 3/3 response rate** in testing — dramatically better than the original panel (44%). Still 39× cheaper than OpenRouter Fusion (~$0.70/query).

**Documentation:**
- [Fusion vs Single Model](docs/FUSION-VS-SINGLE.md) — flagship comparison: what you get for $0.02 and 2 minutes
- [Cost Analysis](docs/COST-ANALYSIS.md) — per-test cost breakdown across all 9 tests (~$0.16 total)
- [Rate Limiting & Reliability](docs/RATE-LIMITING.md) — root cause analysis, reasoning model support, per-tool timeouts
