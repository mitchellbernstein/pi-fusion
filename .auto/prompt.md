# Autoresearch: Maximize pi-fusion Quality Beyond F1

## Objective
Optimize pi-fusion prompts to maximize bug-finding RECALL (bugs found/total) while minimizing FALSE ALARMS. F1 is secondary — the primary goals are:
1. MAXIMIZE recall (% of real bugs found)
2. MINIMIZE false alarms (things flagged that aren't bugs)
3. MAXIMIZE blind spots surfaced (things no model caught)
4. MAINTAIN or reduce cost

## Metrics
- **Primary**: recall (fraction 0-1, higher is better) — % of known bugs found
- **Secondary**: false_alarms (count, lower is better), f1 (fraction), blind_spots (count, higher is better)

## How to Run
`./.auto/measure.sh` — runs benchmark-semantic.ts (pi-fusion vs single vs OR) and outputs METRIC lines.

## Files in Scope
- `src/engine.ts` — PANEL_SYSTEM_PROMPT, ROLE_PROMPTS, STYLE_GATE
- `src/judge-prompt.ts` — buildJudgePrompt, buildVerifierPrompt

## Off Limits
- Architecture (no new API calls, no model changes)
- `src/clients.ts`, `src/tool-loop.ts`, `src/tools.ts`, `src/config.ts`
- `.env`, `package.json`, `benchmark-semantic.ts`

## Constraints
- Must compile: `npx tsc --noEmit` must pass
- No new API calls — cost per run must stay same
- Only change prompt TEXT

## What's Been Tried
- Role-based deliberation: correctness/security/edge cases lenses (90% F1)
- Style gate + rebuttal judge (92% F1 keyword, 85% F1 semantic)
- Two-pass verifier judge with temperature 0
- SQL-specific anti-patterns in style gate (made things worse)
- Semantic scoring: LLM evaluates findings, not keyword matching

## Key Insights
- Remaining FPs are models giving reasonable advice, not false claims
- Noise floor is ±3-5 F1 points due to LLM non-determinism
- The biggest wins came from role diversity, not prompt wording
- Focus on RECALL — finding ALL bugs matters more than perfect precision
