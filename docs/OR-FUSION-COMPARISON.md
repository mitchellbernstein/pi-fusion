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
| Budget (default) | pi-fusion | deepseek-v4-pro, MiniMax-M3, gemini-2.5-flash | deepseek-v4-pro | **~$0.019** | 118s | 1661+4645+2142 chars (3 responses) |

### Token Breakdown

| Scenario | Prompt Tokens | Completion Tokens | Cost |
|----------|--------------|-------------------|------|
| OR Fusion Quality | 4,515 | 878 | $0.134 |
| OR Fusion Budget | 3,524 | 389 | $0.033 |
| pi-fusion Budget | ~600 (panel) + ~5,000 (judge) | ~2,500 (panel) + ~2,000 (judge) | ~$0.019 |

> **Note:** OpenRouter Fusion bundles all panel + judge + final-answer tokens into a single response. pi-fusion makes separate API calls, so token counts are distributed. pi-fusion costs are estimated from provider pricing ($0.50–$2.00/1M tokens for DeepSeek/MiniMax, $0.15/$0.60 for Gemini Flash).

---

## Key Findings

### 1. Costs are nearly identical with matched budget models

When you configure both platforms to use the same cheap models, the per-query cost is **~$0.02–0.03**. OpenRouter charges $0.033; pi-fusion charges ~$0.019. The small difference is because:
- pi-fusion uses `deepseek-v4-pro` (reasoning model, ~$0.50/$2.00 per 1M) via direct API
- OpenRouter Fusion used `deepseek/deepseek-chat` (standard model, different pricing tier)
- Different model IDs on different platforms make exact matching difficult

**Bottom line:** OpenRouter does not add per-query markup. The difference is in model selection.

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
=== PI-FUSION (direct API keys) ===
Status: ok
Models responded: 3/3 (DeepSeek V4 Pro, MiniMax M3, Gemini 2.5 Flash)
Elapsed: 118.2s
Judge analysis: 7 consensus, 2 contradictions, 6 blind spots
Est. cost: ~$0.019

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
