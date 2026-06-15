import type { FusionConfig, FusionResult, FusionResponse, FusionFailure, FusionAnalysis, ResolvedPanelMember } from "./types.js";
import { resolveMember, validateConfig } from "./config.js";
import { runWithTools } from "./tool-loop.js";
import { buildJudgePrompt, buildVerifierPrompt } from "./judge-prompt.js";
import { PANEL_TOOLS } from "./tools.js";

const PANEL_SYSTEM_PROMPT = `You are a knowledgeable AI assistant contributing to a multi-model deliberation panel. You have access to web_search and web_fetch tools to find current information — use them when needed.

Before answering, think through the problem systematically:
1. What are the key aspects of this question?
2. What edge cases or risks should be considered?
3. What might other perspectives miss?

Then provide a thorough but concise response. Avoid excessive meta-commentary or internal reasoning visible to the user.`;

// Role-based deliberation: each panel model gets a different analytical lens.
// This mirrors how human code review teams work — different people check different things.
const STYLE_GATE = `IMPORTANT: Only report issues that cause incorrect behavior, security vulnerabilities, or runtime failures. Do NOT flag style preferences (naming, formatting, const vs let, early returns, etc.). If the code would work correctly under real inputs, it is NOT a bug.`;

const ROLE_PROMPTS = [
  `${STYLE_GATE}\n\nYour specific role: focus on CORRECTNESS. Look for logic errors, off-by-one bugs, null/nil handling, algorithmic flaws, and incorrect assumptions. What would actually break in production? Only flag issues that cause wrong behavior.`,
  `${STYLE_GATE}\n\nYour specific role: focus on SECURITY & ROBUSTNESS. Look for injection vectors, race conditions, resource leaks, error handling gaps, and input validation. What could an attacker exploit? What fails under load? Only flag exploitable or crash-inducing issues.`,
  `${STYLE_GATE}\n\nYour specific role: focus on EDGE CASES & MISSING REQUIREMENTS. Look for boundary conditions, implicit assumptions, missing error states, and unhandled scenarios. What happens at scale? What if inputs are malformed? Only flag gaps that cause incorrect behavior.`,
];

export async function fusionCall(
  prompt: string,
  config: FusionConfig,
  options?: { fusionDepth?: number },
): Promise<FusionResult> {
  if ((options?.fusionDepth ?? 0) >= 1) {
    return {
      status: "error",
      error: "Fusion already invoked in this turn",
      failure_reason: "fusion_invocation_capped",
    };
  }

  validateConfig(config);

  const searchApiKeyEnv = config.search?.apiKeyEnv ?? "EXA_API_KEY";
  const searchApiKey = process.env[searchApiKeyEnv] ?? "";

  const panelMembers: ResolvedPanelMember[] = [];
  const resolveErrors: FusionFailure[] = [];
  for (const m of config.panel) {
    try {
      panelMembers.push(resolveMember(m));
    } catch (err) {
      resolveErrors.push({ model: m.model, reason: (err as Error).message });
    }
  }

  let judge: ResolvedPanelMember;
  try {
    judge = resolveMember(config.judge);
  } catch (err) {
    judge = panelMembers[0] ?? resolveMember({ model: "deepseek-chat", preset: "deepseek" });
  }

  if (panelMembers.length === 0) {
    return {
      status: "error",
      error: "No panel models configured or all failed to resolve",
      failure_reason: "insufficient_credits",
    };
  }

  const perModelTimeoutMs = config.perModelTimeoutMs ?? 90_000;

  const panelResults = await Promise.allSettled(
    panelMembers.map((m, i) => {
      const rolePrompt = ROLE_PROMPTS[i % ROLE_PROMPTS.length];
      const fullSystemPrompt = PANEL_SYSTEM_PROMPT + "\n\n" + rolePrompt;
      return Promise.race([
        runWithTools(m, fullSystemPrompt, prompt, PANEL_TOOLS, searchApiKey, {
          maxToolCalls: config.maxToolCalls,
          maxTokens: config.maxCompletionTokens,
          temperature: config.temperature,
          timeoutMs: perModelTimeoutMs,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new (class PerModelTimeout extends Error { type = "timeout" })())
            , perModelTimeoutMs),
        ),
      ]);
    }),
  );

  const responses: FusionResponse[] = [];
  const failedModels: FusionFailure[] = [...resolveErrors];

  for (let i = 0; i < panelResults.length; i++) {
    const result = panelResults[i];
    const model = panelMembers[i].model;
    if (result.status === "fulfilled") {
      responses.push({ model, content: result.value.content, usage: result.value.usage });
    } else {
      const err = result.reason;
      let reason: string;
      if (err?.type === "auth_error") reason = "authentication_failed";
      else if (err?.type === "rate_limited") reason = "rate_limited";
      else if (err?.type === "timeout") reason = "timeout";
      else if (err instanceof Error && err.name === "PerModelTimeout") reason = "timeout";
      else reason = err?.message ?? "unknown error";
      failedModels.push({ model, reason });
    }
  }

  if (responses.length === 0) {
    const hasAuth = failedModels.some((f) => f.reason === "authentication_failed");
    const hasRate = failedModels.some((f) => f.reason === "rate_limited");
    let failureReason: "all_panels_failed" | "insufficient_credits" | "rate_limited";
    if (hasAuth) failureReason = "insufficient_credits";
    else if (hasRate) failureReason = "rate_limited";
    else failureReason = "all_panels_failed";
    return {
      status: "error",
      error: "All panel models failed",
      failure_reason: failureReason,
    };
  }

  if (responses.length < 2) {
    return {
      status: "ok",
      responses,
      failed_models: failedModels.length > 0 ? failedModels : undefined,
    };
  }

  const { system, user } = buildJudgePrompt(prompt, responses);
  let judgeResponse: { content: string };
  try {
    judgeResponse = await runWithTools(judge, system, user, PANEL_TOOLS, searchApiKey, {
      maxToolCalls: config.maxToolCalls,
      maxTokens: config.maxCompletionTokens,
      temperature: config.temperature,
    });
  } catch {
    return {
      status: "ok",
      responses,
      failed_models: failedModels.length > 0 ? failedModels : undefined,
    };
  }

  let analysis: FusionAnalysis;
  try {
    let jsonText = judgeResponse.content.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }
    analysis = JSON.parse(jsonText) as FusionAnalysis;
  } catch {
    try {
      const retrySystem = `${system}\n\nYou MUST return ONLY valid JSON. No markdown fences, no commentary.`;
      const retry = await runWithTools(judge, retrySystem, user, [], searchApiKey, {
        maxTokens: config.maxCompletionTokens,
        temperature: 0.3,
      });
      let jsonText = retry.content.trim();
      if (jsonText.startsWith("```")) {
        jsonText = jsonText.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
      }
      analysis = JSON.parse(jsonText) as FusionAnalysis;
    } catch {
      return {
        status: "ok",
        responses,
        failed_models: failedModels.length > 0 ? failedModels : undefined,
      };
    }
  }

  // === Fable 5-inspired: verifier pass ===
  // "Separate, fresh-context verifier subagents tend to outperform self-critique."
  // Have the judge re-examine its own analysis against the raw panel responses.
  // This catches hallucinated consensus, missed blind spots, and false contradictions.
  try {
    const { system: vSystem, user: vUser } = buildVerifierPrompt(prompt, responses, analysis);
    const verifierResponse = await runWithTools(judge, vSystem, vUser, [], searchApiKey, {
      maxTokens: config.maxCompletionTokens,
      temperature: 0.2,
    });
    let vText = verifierResponse.content.trim();
    if (vText.startsWith("```")) {
      vText = vText.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }
    const verified = JSON.parse(vText) as FusionAnalysis;
    // Merge: use verified data, keeping originals as fallback
    analysis = verified;
  } catch {
    // Verifier failed — keep original analysis. Better than nothing.
  }

  return {
    status: "ok",
    analysis,
    responses,
    failed_models: failedModels.length > 0 ? failedModels : undefined,
  };
}
