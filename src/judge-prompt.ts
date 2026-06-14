import type { FusionResponse } from "./types.js";

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
