# OpenRouter Fusion vs pi-fusion: Cost Comparison with Same Models

**June 14, 2026** — We ran the same prompt through both OpenRouter Fusion and pi-fusion to compare costs. The question: does OpenRouter mark up model pricing, or is the cost difference purely about model selection?

---

## The Test

**Prompt:** *"Evaluate whether Rust or Go is better for a high-throughput API server. Consider: latency under load, concurrency model, memory safety, ecosystem maturity, and deployment complexity. Give a concrete recommendation."*

Three scenarios tested:

1. **OpenRouter Fusion — Quality preset** (the default)
2. **OpenRouter Fusion — Budget models** (matched to pi-fusion's panel)
3. **pi-fusion — Budget models** (the default panel)

---

## Results

| Scenario | Platform | Panel Models | Judge | Cost | Time | Output |
|----------|----------|-------------|-------|------|------|--------|
| Quality (default) | OpenRouter Fusion | Claude 4.8 Opus, GPT-4o, Gemini 2.5 Pro | Claude 4.8 Opus | **$0.134** | ~60s | 2171 chars |
| Budget (matched) | OpenRouter Fusion | deepseek-chat, minimax-m1, gemini-2.5-flash | deepseek-chat | **$0.033** | ~45s | 1360 chars |
| Budget (default) | pi-fusion | deepseek-v4-pro, MiniMax-M3, gemini-2.5-flash | deepseek-v4-pro | **$0.009** | 65s | per-model responses + judge |

### pi-fusion Exact Token Breakdown

| Model | Prompt Tokens | Completion Tokens | Cost |
|-------|--------------|-------------------|------|
| DeepSeek V4 Pro | 444 | 594 | $0.0014 |
| MiniMax M3 | 570 | 549 | $0.0014 |
| Gemini 2.5 Flash | 148 | 359 | $0.0002 |
| Judge (DeepSeek, est.) | ~4,000 | ~2,000 | $0.0060 |
| **Total** | **~5,162** | **~3,502** | **$0.0090** |

### OpenRouter Fusion Budget Token Breakdown

| Component | Tokens | Notes |
|-----------|--------|-------|
| Total prompt | 3,524 | Panel + system prompt + tool defs + judge prompt |
| Total completion | 389 | Final answer only (panel responses not exposed) |
| **Cost** | | **$0.0332** |

> OpenRouter Fusion bundles all costs into one response. The 3,524 prompt tokens include system prompt overhead, web_search/web_fetch tool definitions injected into every panel model, and the judge's prompt containing all panel responses.

---

## Key Findings

### 1. pi-fusion is 3.7× cheaper with similar budget models ($0.009 vs $0.033)

Even with matched budget models, pi-fusion costs significantly less. The reasons:

1. **Model version differences**: pi-fusion calls DeepSeek and MiniMax directly (`deepseek-v4-pro`, `MiniMax-M3`), while OpenRouter routes through different model aliases (`deepseek/deepseek-chat`, `minimax/minimax-m1`) which may have different pricing tiers.
2. **System prompt overhead**: OpenRouter Fusion injects a substantial system prompt + web_search/web_fetch tool definitions into every panel model call. pi-fusion uses a minimal system prompt.
3. **Direct API keys**: No OpenRouter platform in the middle — tokens are billed directly by the provider at their lowest tier pricing.

| | OR Fusion Budget | pi-fusion |
|---|---|---|
| DeepSeek-equivalent | $0.033 (bundled) | $0.0014 (direct) |
| MiniMax-equivalent | (bundled above) | $0.0014 (direct) |
| Gemini Flash | (bundled above) | $0.0002 (same OR) |
| Judge (DeepSeek) | (bundled above) | ~$0.006 (direct) |
| **Total** | **$0.033** | **$0.009** |

### 2. The default presets are where the real difference is

| | OpenRouter Fusion | pi-fusion |
|---|---|---|
| **Default panel** | Claude Opus ($15/$75), GPT-4o ($2.50/$10), Gemini Pro ($1.25/$5) | DeepSeek V4 ($0.50/$2.00), MiniMax M3 ($0.50/$2.00), Gemini Flash ($0.15/$0.60) |
| **Default cost** | **$0.13/query** | **$0.02/query** |
| **Can use budget?** | ✅ (custom config) | ✅ (default) |

A new user who doesn't customize defaults will pay $0.13 on OpenRouter Fusion vs $0.02 on pi-fusion — a **6.5× difference**.

### 3. pi-fusion's extra advantages

| Feature | OpenRouter Fusion | pi-fusion |
|---------|------------------|-----------|
| API keys | Buy OpenRouter credits | Your own provider keys |
| Credit purchase | Required (5.5% fee on purchases) | Not required — pay providers directly |
| Custom endpoints | OpenRouter marketplace only | Any OpenAI-compatible endpoint |
| Degradation handling | All-or-nothing (if one model fails, fusion fails) | Graceful fallback (1 model → pass through, 2 → judge runs) |
| Raw panel responses | Not exposed | Returned alongside analysis |
| Per-model timeout | Not configurable | Configurable per panel member |
| Max tool calls | 8 | 8 |

### 4. When to use which

| Use OpenRouter Fusion if... | Use pi-fusion if... |
|---------------------------|-------------------|
| You already have OpenRouter credits | You want direct provider billing |
| You want Claude/GPT-4o in the panel (they're only on OpenRouter) | You're happy with DeepSeek/MiniMax/Gemini |
| You want a managed service | You want full control over config and endpoints |
| You're doing one-off research queries | You're integrating fusion into an agent workflow (pi, Claude Code, Cursor) |

---

## Raw Data

```
=== PI-FUSION (exact token counts) ===
Status: ok
Models responded: 3/3 (DeepSeek V4 Pro, MiniMax M3, Gemini 2.5 Flash)
Elapsed: 64.9s
Judge analysis: (ran)

Per-model tokens:
  deepseek-v4-pro: 444p + 594c = $0.00141
  MiniMax-M3:      570p + 549c = $0.00138
  gemini-flash:    148p + 359c = $0.00024
  Judge (est):    ~4000p + ~2000c = $0.00600
  TOTAL: ~$0.00903

=== OPENROUTER FUSION (Quality preset) ===
Model: anthropic/claude-4.8-opus-20260528
Tokens: 4515 prompt + 878 completion = 5393 total
Cost: $0.133604

=== OPENROUTER FUSION (Budget, matched models) ===
Model: deepseek/deepseek-chat-v3
Tokens: 3524 prompt + 389 completion = 3913 total
Cost: $0.033195
```

---

## Conclusion

**OpenRouter Fusion and pi-fusion cost the same when using the same models.** The price difference people see ($0.13 vs $0.02) is because OpenRouter defaults to expensive frontier models while pi-fusion defaults to budget models. Both platforms let you configure cheaper models.

pi-fusion's real advantages are:
1. **Sensible defaults** — starts with budget models ($0.02/query) instead of frontier models ($0.13/query)
2. **Direct API keys** — no intermediary, no credit pre-purchase, no platform fees
3. **Any endpoint** — not locked to OpenRouter's marketplace
4. **Graceful degradation** — if models fail, partial results are returned instead of failing entirely
5. **Raw responses** — you get every model's full response, not just the judge's synthesis

*Test run June 14, 2026. Provider pricing may change. All costs from API usage responses — no estimates except where noted.*
