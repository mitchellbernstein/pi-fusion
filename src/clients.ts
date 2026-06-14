import type { ChatMessage, ChatCompletion, ToolDefinition } from "./types.js";
import { FusionApiError } from "./types.js";

export async function chatCompletion(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools?: ToolDefinition[],
  options?: {
    maxTokens?: number;
    temperature?: number;
    openrouterHeaders?: boolean;
  },
): Promise<ChatCompletion> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (options?.openrouterHeaders) {
    headers["HTTP-Referer"] = "http://localhost";
    headers["X-Title"] = "fusion-local";
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 4096,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "unknown error");
      const status = res.status;
      if (status === 401 || status === 403) {
        throw new FusionApiError("auth_error", model, text, status);
      }
      if (status === 429) {
        throw new FusionApiError("rate_limited", model, text, status);
      }
      throw new FusionApiError("api_error", model, text, status);
    }

    const json = await res.json() as {
      choices?: { message?: { content?: string | null; tool_calls?: ToolDefinition["function"] extends never ? never : { id: string; type: "function"; function: { name: string; arguments: string } }[] } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const choice = json.choices?.[0];
    const msg = choice?.message;

    return {
      content: msg?.content ?? null,
      tool_calls: msg?.tool_calls as ChatCompletion["tool_calls"],
      usage: json.usage
        ? { promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens }
        : undefined,
    };
  } catch (err) {
    if (err instanceof FusionApiError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new FusionApiError("timeout", model, "Request timed out after 60s");
    }
    throw new FusionApiError("network_error", model, (err as Error).message);
  } finally {
    clearTimeout(timer);
  }
}
