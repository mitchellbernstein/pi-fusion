# pi-fusion

**Multi-model deliberation for pi** — fans out your query to 3+ AI models in parallel (each with web search), then a judge synthesizes structured analysis: consensus, contradictions, unique insights, and blind spots.

Matches [OpenRouter Fusion](https://openrouter.ai/fusion)'s architecture exactly, at **~$0.01/query** (vs ~$0.70 — roughly **70× cheaper**).

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
   - OPENROUTER_API_KEY=   (from https://openrouter.ai/keys)
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

The tool-calling loop mirrors OpenRouter Fusion's behavior exactly.

---

## Output Schema (matches OpenRouter Fusion)

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
    // Via preset (baseUrl + apiKeyEnv auto-resolved)
    { "model": "deepseek-v4-pro", "preset": "deepseek" },
    { "model": "MiniMax-M3", "preset": "minimax" },
    { "model": "moonshotai/kimi-k2.7-code", "preset": "openrouter" },

    // Generic OpenAI-compatible (any provider!)
    { "model": "gpt-4o", "baseUrl": "https://api.openai.com/v1", "apiKeyEnv": "OPENAI_API_KEY" },
    { "model": "llama-3.1-70b", "baseUrl": "https://api.groq.com/openai/v1", "apiKeyEnv": "GROQ_API_KEY" },
    { "model": "mistral-large", "baseUrl": "https://api.mistral.ai/v1", "apiKeyEnv": "MISTRAL_API_KEY" }
  ],
  "judge": { "model": "deepseek-v4-pro", "preset": "deepseek" },
  "search": { "apiKeyEnv": "EXA_API_KEY" },
  "maxToolCalls": 8,
  "temperature": 0.7,
  "maxCompletionTokens": 4096
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
| Output schema | consensus, contradictions, etc. | exact match |
| Custom models | Paid only | Any OpenAI-compatible |
| **Cost per query** | ~$0.70 | **~$0.01 (70× cheaper)** |

---

## Requirements

- **Node.js 20+**
- At least one API key (DeepSeek is cheapest — ~$0.50 gets you hundreds of queries)
- For web search: Exa API key (free tier available)

---

## How It Compares to Alternatives

- **llm-council** (Karpathy): Python, web app interface, no web tools, abandoned. Wrong language and wrong schema.
- **consilium**: Rust, no web tools, different output schema. Great project but doesn't match OpenRouter Fusion's architecture.
- **OpenRouter Fusion**: Identical architecture but ~$0.70/query and model-locked to OpenRouter's marketplace.
- **pi-fusion**: Matches the architecture exactly, works with any OpenAI-compatible endpoint, and costs ~$0.01/query.

---

## Real Examples

See the [`examples/`](examples/) directory for real fusion deliberation outputs:

- [**Zustand vs Jotai**](examples/zustand-vs-jotai.md) — full 3-model deliberation with judge analysis (8 consensus, 3 contradictions, 8 blind spots)
- [**Cache Stampede PR Review**](examples/cache-stampede-review.md) — code review use case, all 3 models, layered fix recommendation
- [**PostgreSQL vs MongoDB**](examples/postgres-vs-mongodb.md) — degraded path (1 model, graceful fallback)
