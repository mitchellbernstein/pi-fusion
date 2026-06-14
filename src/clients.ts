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
    maxRetries?: number;
    timeoutMs?: number;
  },
): Promise<ChatCompletion> {
  const maxRetries = options?.maxRetries ?? 2;
  const timeoutMs = options?.timeoutMs ?? 60_000;
  let lastError: FusionApiError | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30_000);
      await new Promise((r) => setTimeout(r, delay));
    }
    try {
      return await chatCompletionOnce(baseUrl, apiKey, model, messages, tools, { ...options, timeoutMs });
    } catch (err) {
      lastError = err instanceof FusionApiError ? err : new FusionApiError("network_error", model, (err as Error).message);
      if (lastError.type === "rate_limited" || lastError.type === "timeout") {
        if (attempt < maxRetries) continue;
      }
      throw lastError;
    }
  }
  throw lastError!;
}

async function chatCompletionOnce(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools?: ToolDefinition[],
  options?: {
    maxTokens?: number;
    temperature?: number;
    openrouterHeaders?: boolean;
    timeoutMs?: number;
  },
): Promise<ChatCompletion> {
  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? 60_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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
        const retryAfter = res.headers.get("retry-after");
        const msg = retryAfter ? `Rate limited, retry after ${retryAfter}s` : text;
        throw new FusionApiError("rate_limited", model, msg, status);
      }
      throw new FusionApiError("api_error", model, text, status);
    }

    const json = await res.json() as {
      choices?: { message?: { content?: string | null; reasoning_content?: string | null; tool_calls?: ToolDefinition["function"] extends never ? never : { id: string; type: "function"; function: { name: string; arguments: string } }[] } }[];
      usage?: { prompt_tokens: number; completion_tokens: number; completion_tokens_details?: { reasoning_tokens?: number } };
    };

    const choice = json.choices?.[0];
    const msg = choice?.message;

    // DeepSeek V4 Pro is a reasoning model — content may be null/empty
    // if all tokens went to reasoning_content. Use reasoning_content as fallback.
    const content = msg?.content || msg?.reasoning_content || null;

    return {
      content,
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
