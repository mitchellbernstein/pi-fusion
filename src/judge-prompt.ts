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
Re-examine the first-pass analysis against the RAW panel responses. Specifically:

1. CONSENSUS: Check each consensus claim against the actual responses. Remove any that aren't actually supported by most models. Add any real agreements that were missed.
2. CONTRADICTIONS: Check if claimed contradictions are real disagreements or just different phrasings of the same point. Remove false contradictions. Add real ones that were missed.
3. PARTIAL COVERAGE & UNIQUE INSIGHTS: Verify these are actually present in the cited models' responses. Remove fabricated ones.
4. BLIND SPOTS: This is the most important check. Re-scan the original prompt and ALL responses. What important aspects did NO model address? Add any that were missed. Remove blind spots that are actually covered by a model (even partially).

Return ONLY valid JSON in the same format as the input analysis (consensus, contradictions, partial_coverage, unique_insights, blind_spots). Be conservative — remove things you're not confident about.`;

  return { system, user };
}
