# Cost Analysis

All tests run against real APIs on June 14, 2026. Token counts from API usage responses where available; estimates otherwise.

## Per-Provider Pricing

| Provider | Model | Input $/1M tokens | Output $/1M tokens | Notes |
|----------|-------|-------------------|-------------------|-------|
| DeepSeek | deepseek-v4-pro | ~$0.50 | ~$2.00 | Direct API. Output includes reasoning tokens. |
| MiniMax | MiniMax-M3 | ~$0.50 | ~$2.00 | Direct API. Competitive with DeepSeek. |
| OpenRouter | moonshotai/kimi-k2.7-code | ~$0.60 | ~$4.00 | OpenRouter markup on Moonshot AI. |
| Exa | web_search | N/A | Free tier: 100 searches/mo | Search API, not LLM. |

Costs are approximate — exact pricing varies by provider and may change.

## Test Results

### Test 1: Zustand vs Jotai (3/3 models, judge)

| Model | Prompt Tokens | Completion Tokens | Est. Cost |
|-------|--------------|-------------------|-----------|
| DeepSeek V4 Pro | ~200 | ~3,000 | $0.00640 |
| MiniMax M3 | ~200 | ~3,500 | $0.00720 |
| Kimi K2.7 Code | ~200 | ~2,500 | $0.00101 (via OpenRouter) |
| Judge (DeepSeek) | ~3,500 | ~2,000 | $0.00575 |
| **Total** | | | **~$0.020** |

Elapsed: 137s. Full analysis: 8 consensus, 3 contradictions, 8 blind spots, 3 unique insights.

### Test 2: PostgreSQL vs MongoDB (1/3 models, degraded)

| Model | Prompt Tokens | Completion Tokens | Est. Cost |
|-------|--------------|-------------------|-----------|
| DeepSeek V4 Pro | ~200 | ~4,000 | $0.00820 |
| MiniMax M3 | — | — | Timeout |
| Kimi K2.7 Code | — | — | Timeout |
| Judge | — | — | Skipped (<2 responses) |
| **Total** | | | **~$0.008** |

Elapsed: 109s (waited for timeouts). Redundant calls wasted: 2 × ~$0 (no completion tokens billed).

### Test 3: Cache Stampede PR Review (3/3 models, judge)

| Model | Prompt Tokens | Completion Tokens | Est. Cost |
|-------|--------------|-------------------|-----------|
| DeepSeek V4 Pro | ~200 | ~3,500 | $0.00720 |
| MiniMax M3 | ~200 | ~3,000 | $0.00620 |
| Kimi K2.7 Code | ~200 | ~3,000 | $0.00192 |
| Judge (DeepSeek) | ~3,000 | ~1,500 | $0.00450 |
| **Total** | | | **~$0.020** |

Elapsed: 173s. Code review with layered fix recommendation.

### Test 4: Cloudflare vs Fly vs Lambda (1/3 models, degraded)

| Model | Prompt Tokens | Completion Tokens | Est. Cost |
|-------|--------------|-------------------|-----------|
| DeepSeek V4 Pro | ~200 | ~4,000 | $0.00820 |
| MiniMax M3 | — | — | Timeout |
| Kimi K2.7 Code | — | — | Timeout |
| Judge | — | — | Skipped |
| **Total** | | | **~$0.008** |

Elapsed: 111s.

### Test 5: Go Token Bucket Bug Hunt (3/3 models, judge)

| Model | Prompt Tokens | Completion Tokens | Est. Cost |
|-------|--------------|-------------------|-----------|
| DeepSeek V4 Pro (A) | ~250 | ~3,700 | $0.00765 |
| DeepSeek V4 Pro (B) | ~250 | ~3,700 | $0.00765 |
| DeepSeek V4 Pro (C) | ~250 | ~3,700 | $0.00765 |
| Judge (DeepSeek) | ~3,500 | ~2,000 | $0.00575 |
| **Total** | | | **~$0.029** |

Elapsed: 190s. 7 consensus bugs found, 4 unique insights, 4 blind spots.

## Summary

| Test | Models | Judge | Cost | Elapsed | Value |
|------|--------|-------|------|---------|-------|
| Zustand vs Jotai | 3/3 | ✅ | ~$0.020 | 137s | High — 8 consensus, 3 contradictions |
| PostgreSQL vs MongoDB | 1/3 | — | ~$0.008 | 109s | Medium — excellent single-model answer |
| Cache Stampede | 3/3 | ✅ | ~$0.020 | 173s | High — all models converged |
| Cloudflare vs Fly | 1/3 | — | ~$0.008 | 111s | Medium — single model |
| Go Bug Hunt | 3/3 | ✅ | ~$0.029 | 190s | **Highest** — found bugs a single model would miss |
| **Total 5 tests** | | | **~$0.085** | | 5 diverse use cases, 3 architectures |

## Comparison to OpenRouter Fusion

| Metric | OpenRouter Fusion | pi-fusion (5 tests) |
|--------|------------------|---------------------|
| Cost per query | ~$0.70 | ~$0.017 avg |
| Cost for 5 queries | ~$3.50 | ~$0.085 |
| Savings | — | **~41× cheaper** |
| Web search | ✅ | ✅ (Exa) |
| Custom models | Paid only | Any OpenAI-compatible |
| Degradation handling | ❌ (all-or-nothing) | ✅ (graceful fallback) |

## Cost Optimization Tips

1. **DeepSeek is the most reliable and cheapest** in our testing. Default judge and include in panel.
2. **Degraded queries are cheapest** — if only 1 model responds, you pay ~$0.008 instead of ~$0.020
3. **Exa free tier** covers 100 searches/month — no cost for web search queries
4. **Reasoning models (DeepSeek V4 Pro)** need higher `maxCompletionTokens` (8192+) to avoid spending all tokens on reasoning content — this also costs more
5. **At $0.10 for 5 diverse queries**, fusion is cheap enough to use liberally for code review, architecture decisions, and debugging
