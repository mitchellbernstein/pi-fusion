import type { ChatMessage, ResolvedPanelMember, ToolDefinition } from "./types.js";
import { chatCompletion } from "./clients.js";
import { webSearch, webFetch } from "./tools.js";

const DEFAULT_MAX_TOOL_CALLS = 8;

export async function runWithTools(
  member: ResolvedPanelMember,
  systemPrompt: string,
  userPrompt: string,
  tools: ToolDefinition[],
  searchApiKey: string,
  options?: {
    maxToolCalls?: number;
    maxTokens?: number;
    temperature?: number;
  },
): Promise<{ content: string; messages: ChatMessage[] }> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const maxIterations = options?.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;

  for (let i = 0; i <= maxIterations; i++) {
    const completion = await chatCompletion(
      member.baseUrl,
      member.apiKey,
      member.model,
      messages,
      tools,
      {
        maxTokens: options?.maxTokens,
        temperature: options?.temperature,
        openrouterHeaders: member.openrouterHeaders,
      },
    );

    const hasToolCalls = completion.tool_calls && completion.tool_calls.length > 0;

    if (!hasToolCalls) {
      return { content: completion.content ?? "[Model produced no content]", messages };
    }

    if (i >= maxIterations) {
      messages.push({
        role: "user",
        content:
          "You have reached the maximum number of tool calls. Provide your final answer now based on the information gathered so far.",
      });
      const final = await chatCompletion(
        member.baseUrl,
        member.apiKey,
        member.model,
        messages,
        undefined,
        {
          maxTokens: options?.maxTokens,
          temperature: options?.temperature,
          openrouterHeaders: member.openrouterHeaders,
        },
      );
      return { content: final.content ?? "[Model produced no content]", messages };
    }

    messages.push({
      role: "assistant",
      content: completion.content ?? "",
      tool_calls: completion.tool_calls,
    });

    for (const tc of completion.tool_calls!) {
      let args: Record<string, string>;
      try {
        args = JSON.parse(tc.function.arguments) as Record<string, string>;
      } catch {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `Error: invalid JSON arguments: ${tc.function.arguments}`,
        });
        continue;
      }

      let result: string;
      if (tc.function.name === "web_search") {
        result = await webSearch(args.query ?? "", searchApiKey);
      } else if (tc.function.name === "web_fetch") {
        result = await webFetch(args.url ?? "", searchApiKey);
      } else {
        result = `Error: unknown tool "${tc.function.name}"`;
      }

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  return { content: "[Model produced no content]", messages };
}
