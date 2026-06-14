---
name: pi-fusion
description: Uses the fusion tool for multi-model deliberation — fanning queries to 3+ AI models in parallel with web search, then synthesizing structured analysis via a judge. Use for architecture decisions, code review, debugging, and tech evaluation where independent verification adds value.
---

# pi-fusion Skill

You have access to the `fusion` tool — a local multi-model deliberation engine that fans out your query to 3+ independent AI models in parallel, each with web search, then has a judge synthesize structured analysis. The architecture is inspired by OpenRouter Fusion's multi-model deliberation pattern: parallel panel → judge synthesis. Costs ~$0.01/query, runs in 30-120 seconds.

This skill teaches you when to reach for fusion, how to frame prompts for maximum return, and how to act on the output — not just display it.

## The $0.01 Test

Before calling fusion, ask one question: **is this decision worth 1 cent and 30-120 seconds?**

The answer is yes when:
- You're making a design or architecture choice that affects hours of implementation
- You're debugging a problem that has already cost more than 1 cent of your time
- You're reviewing code where a missed issue could cause a bug, outage, or security incident
- Multiple plausible approaches exist and you want independent verification
- You have genuine uncertainty and the answer will change what you do next

The answer is no when:
- You already know the answer with high confidence
- The question is trivial (fact lookup, syntax check, single-line logic)
- The latency would interrupt a fast, interactive workflow
- You'd need to call it iteratively (refine → try again → refine — batch instead, see below)
- The user explicitly asked for speed over thoroughness

## Prompt Framing

Fusion gives you back what you ask for. A vague prompt produces vague consensus. A precise prompt produces actionable analysis.

### Good prompts

- Specific: *"Compare Actix-web (Rust) and Gin (Go) for a REST API handling 50K req/s with PostgreSQL. Consider: latency under load, connection pooling, middleware ecosystem, operator ergonomics, and deployment complexity. I need a concrete recommendation with tradeoffs."*
- Constrained: *"Review this authentication middleware for session fixation and timing attacks. Here's the code: [code]. Focus on security, not style."*
- Open-ended with guardrails: *"We need to pick a database for a multi-tenant SaaS with 1M+ users. PostgreSQL vs CockroachDB. Evaluate: operational complexity, cost at scale, migration path from our current Postgres, and vendor risk. Assume we deploy on Fly.io."*

### Bad prompts

- Too vague: *"What's the best language?"* (no context, no constraints, no actionability)
- Simple facts: *"What version of Node.js is current?"* (not worth the $0.01)
- Redundant: *"Is 2+2=4?"* (you know this)
- Premature: *"Should we use Rust?"* (before you've described the problem)

## Reading the Output

Fusion returns structured analysis — don't just paste it. Use it.

### consensus
These are the points all (or most) models independently agreed on. **Act on consensus with high confidence.** When all three models reach the same conclusion without coordinating, it's the closest thing to ground truth you'll get from LLMs.

### contradictions
This is the highest-value section. Models disagreed on a specific topic, and you can see each model's stance. **Contradictions don't mean the output is flawed — they mean you found the frontier where reasonable people disagree.** Read them to understand the shape of the tradeoff space. If all three models take different positions, you need human judgment. If two agree and one dissents, dig into *why* the dissenter sees it differently.

### partial_coverage
These are points only some models raised. **Partial coverage reveals model blind spots.** If only one model caught a security concern, that model happened to look at it from the right angle — the other two missed it. Treat partial-coverage points as information, not votes.

### unique_insights
Single-model observations. **These are leads, not conclusions.** A unique insight might be brilliant or hallucinated — you need to verify before acting. But unique insights are also where fusion earns its keep: they're things you (or a single model) would never have thought of.

### blind_spots
What NO model addressed. **This is the most actionable section.** If the judge says "no model discussed error handling," go verify error handling yourself. Blind spots are gaps in the collective answer — they don't tell you what's wrong, they tell you what to double-check.

## Post-Fusion Workflow

1. **Read the blind spots first.** These are your action items — things to verify, test, or design.
2. **Resolve contradictions with evidence.** If models disagree about whether approach A or B is faster, don't pick based on vote count — run a benchmark.
3. **Incorporate consensus into your plan.** Consensus is trustworthy enough to build on.
4. **Verify unique insights before acting.** One model said something nobody else saw? Check it before you depend on it.
5. **Keep the result for context.** Future turns may need it — don't make the user repeat decisions.

## Batching: One Fusion, Many Questions

If you have multiple fusion-worthy questions, batch them into a single deliberation rather than calling fusion repeatedly:

```
Evaluate these three design decisions for our API server:

1. Should we use connection pooling at the app level or at the proxy (pgbouncer)?
2. Is it worth adopting Rust async traits (nightly) vs. stable async_trait macro?
3. Should we use JSONB columns or normalized tables for user preferences?

For each decision, consider: performance, maintainability, hiring, and operational risk.
```

This gets you 3× the value for the same cost and latency. The judge will structure the analysis per-question if you number them clearly.

## Anti-Patterns

| Anti-pattern | Why it's wrong | What to do instead |
|---|---|---|
| Fusion loop | Calling fusion, reading the output, calling fusion again to refine → burns time and credits | Frame the prompt thoroughly the first time. If you need refinement, edit the output yourself. |
| Fusion as search | *"Fusion: find the latest Next.js docs on server actions"* | That's a web search, not a deliberation. Use search directly. |
| Ignoring the output | Calling fusion then proceeding with your original plan unchanged | If the output didn't change anything, you didn't need fusion. If it surfaced problems, address them. |
| Posting raw JSON | Dumping the full FusionResult into the conversation without interpretation | Summarize: what changed your plan, what you're verifying, what you adopted. |
| Fusion for confidence theater | Calling fusion to look thorough when you already decided | Be honest — if you know the answer, say so. Fusion adds value, not legitimacy. |
| Fusion when the user is waiting | Blocking an interactive flow for 60+ seconds | Ask: "This is a complex tradeoff — want me to run a multi-model deliberation? Takes about a minute." |

## Complexity Gating

The value of fusion scales with decision complexity. Use this to decide:

| Decision Complexity | Fusion Value | Example |
|---|---|---|
| **Trivial** — one obvious answer, no tradeoffs | Negative (waste) | Which port to use for local dev |
| **Low** — narrow scope, low risk, well-understood | Low | Picking between two similar npm packages |
| **Medium** — cross-module, moderate risk, multiple approaches | **Good** | Database schema design, API contract decisions |
| **High** — new subsystem, security/safety, irreversible | **Excellent** | Auth architecture, data model for multi-tenant, language/platform choice |
| **Defer candidate** — too broad, ambiguous success criteria | Risky | "Should we rewrite the whole app?" |

Don't fuse for trivial or low-complexity decisions. For defer candidates, narrow the scope first with the user before fusing.

## Cost Reference

| Scenario | Approximate Cost |
|---|---|
| Full 3-model panel + judge (DeepSeek/MiniMax/Kimi) | $0.008–$0.012 |
| With web search (models search Exa) | $0.010–$0.015 |
| Degraded (1–2 models only) | $0.002–$0.005 |
| OpenRouter Fusion equivalent | $0.40–$0.70 |

Fusion is cheap enough to use liberally for code review, architecture, and debugging — but not free. Treat each call as 1 cent of your tool budget.

## When the User Should Decide

Ask before fusing:
1. If the user hasn't used fusion before (establish consent/cost awareness)
2. If the decision is high-stakes and they'll want to see the raw panel responses
3. If you're unsure whether the question is fusion-worthy

Don't ask:
- When the user explicitly said "use fusion" or "deliberate on this"
- When the task is clearly in the fusion sweet spot (architecture, security review, hard debugging)
- When the user is blocked and the latency is worth the insight
