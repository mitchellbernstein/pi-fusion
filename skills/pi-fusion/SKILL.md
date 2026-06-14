# pi-fusion Skill

You have access to the `fusion` tool, which implements multi-model deliberation (equivalent to OpenRouter Fusion). Use it deliberately for decisions where multiple perspectives improve the outcome.

## When to use fusion

- **Complex reasoning**: Architecture decisions, design tradeoffs, system design
- **Code review**: Significant PRs, refactoring plans, security-sensitive changes
- **Debugging**: Hard bugs where multiple perspectives help identify the root cause
- **Uncertainty**: When you're unsure and want confirmation from independent models
- **Evaluation**: Comparing approaches, technologies, or strategies with structured analysis

## When NOT to use fusion

- Simple factual questions ("what is 2+2?")
- Trivial file operations (read, write, edit single files)
- Questions you're highly confident about
- When latency matters (fusion takes 10-30 seconds per deliberation)

## How it works

`fusion(prompt)` fans out to 3+ independent AI models in parallel. Each model can search the web for current information. A judge model then compares all responses and produces structured analysis showing:

- **consensus**: what all or most models agree on
- **contradictions**: where models disagree, with per-model stances
- **partial_coverage**: points only some models covered
- **unique_insights**: valuable points only one model raised
- **blind_spots**: important aspects NO model addressed

## Cost

~$0.01/query (vs ~$0.70 for OpenRouter Fusion). Costs are determined by the panel models configured in `~/.pi/fusion-panel.json`.
