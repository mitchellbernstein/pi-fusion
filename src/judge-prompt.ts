import type { FusionResponse, FusionAnalysis } from "./types.js";

export function buildJudgePrompt(
  originalPrompt: string,
  responses: FusionResponse[],
): { system: string; user: string } {
  const system = `You are a precise deliberation judge. You compare responses from multiple AI models to the same prompt and produce structured analysis. Always return valid JSON with no additional text, no markdown fences, no commentary.`;

  const responsesText = responses
    .map((r) => `### Model: ${r.model}\n${r.content}`)
    .join("\n\n");

  const user = `## Original Prompt
${originalPrompt}

## Panel Responses
${responsesText}

## Instructions
1. CONSENSUS: Identify claims or conclusions that ALL or MOST models agree on. These are higher-confidence points.
2. CONTRADICTIONS: Find points where models directly disagree. For each contradiction, list the topic and each model's specific stance.
3. PARTIAL COVERAGE: Identify valuable points that only SOME models covered (not all, not just one). List which models covered each point.
4. UNIQUE INSIGHTS: Identify valuable points that only ONE model raised. Include the model name and the specific insight.
5. BLIND SPOTS: Identify important aspects of the original question that NO model addressed. What did everyone miss?

Before finalizing, review every flagged issue against this standard: Would a reasonable developer consider this a blocking defect? If the issue could be addressed by a linter rule or is a style preference (naming, formatting, const/let, early returns), DO NOT include it. Only keep findings that would cause incorrect behavior, crashes, or security vulnerabilities.

Return ONLY valid JSON in this exact format (no markdown fences, no surrounding text):
{"consensus":["string"],"contradictions":[{"topic":"string","stances":[{"model":"string","stance":"string"}]}],"partial_coverage":[{"models":["string"],"point":"string"}],"unique_insights":[{"model":"string","insight":"string"}],"blind_spots":["string"]}`;

  return { system, user };
}

export function buildVerifierPrompt(
  originalPrompt: string,
  responses: FusionResponse[],
  firstPassAnalysis: FusionAnalysis,
): { system: string; user: string } {
  const system = `You are a verification judge. You review a first-pass deliberation analysis against the original panel responses to catch errors, hallucinations, and missed findings. Always return valid JSON.`;

  const responsesText = responses
    .map((r) => `### Model: ${r.model}\n${r.content}`)
    .join("\n\n");

  const firstPassJson = JSON.stringify(firstPassAnalysis, null, 2);

  const user = `## Original Prompt
${originalPrompt}

## Panel Responses
${responsesText}

## First-Pass Analysis (to verify)
${firstPassJson}

## Verification Instructions
Re-examine the first-pass analysis against the RAW panel responses:

1. CONSENSUS: Check each claim against actual responses. Remove any not supported by most models. Add real agreements missed.
2. CONTRADICTIONS: Are claimed disagreements real or just different phrasings? Remove false ones.
3. PARTIAL COVERAGE & UNIQUE INSIGHTS: Verify these actually appear in the cited models' responses. Remove fabricated ones.
4. BLIND SPOTS: Re-scan the prompt and ALL responses. What did everyone miss? Add overlooked blind spots. Remove ones any model covered.

CRITICAL: Remove findings that are style preferences, not bugs. These are NOT bugs: naming conventions, const vs let, arrow functions, formatting, SERIAL vs BIGSERIAL, TEXT vs VARCHAR(n). Only keep findings about incorrect behavior, crashes, or vulnerabilities.

Return ONLY valid JSON in the same format as the input analysis. Be conservative — when in doubt, remove.`;

  return { system, user };
}
