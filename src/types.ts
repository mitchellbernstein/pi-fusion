// ===== Fusion output types (match OpenRouter schema exactly) =====

export interface FusionAnalysis {
  consensus: string[];
  contradictions: { topic: string; stances: { model: string; stance: string }[] }[];
  partial_coverage: { models: string[]; point: string }[];
  unique_insights: { model: string; insight: string }[];
  blind_spots: string[];
}

export interface FusionResponse {
  model: string;
  content: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface FusionFailure {
  model: string;
  reason: string;
}

export type FusionResult =
  | {
      status: "ok";
      analysis?: FusionAnalysis;
      responses: FusionResponse[];
      failed_models?: FusionFailure[];
    }
  | {
      status: "error";
      error: string;
      failure_reason:
        | "all_panels_failed"
        | "insufficient_credits"
        | "rate_limited"
        | "fusion_invocation_capped"
        | "unexpected_error";
    };

// ===== Provider-agnostic panel config =====

export type PresetName = "deepseek" | "minimax" | "openrouter";

export interface PanelMember {
  model: string;
  preset?: PresetName;
  baseUrl?: string;
  apiKeyEnv?: string;
  openrouterHeaders?: boolean;
}

export interface ResolvedPanelMember {
  model: string;
  baseUrl: string;
  apiKey: string;
  openrouterHeaders?: boolean;
}

export interface FusionConfig {
  panel: PanelMember[];
  judge: PanelMember;
  maxToolCalls?: number;
  temperature?: number;
  maxCompletionTokens?: number;
  perModelTimeoutMs?: number;
  search?: { apiKeyEnv?: string };
}

// ===== API types =====

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletion {
  content: string | null;
  tool_calls?: ToolCall[];
  usage?: { promptTokens: number; completionTokens: number };
}

export class FusionApiError extends Error {
  constructor(
    public type:
      | "auth_error"
      | "rate_limited"
      | "api_error"
      | "network_error"
      | "timeout",
    public model: string,
    message: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = "FusionApiError";
  }
}
