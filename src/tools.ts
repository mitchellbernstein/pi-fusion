import type { ToolDefinition } from "./types.js";

export async function webSearch(query: string, apiKey: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, numResults: 5, useAutoprompt: true, type: "auto" }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return `Search error: HTTP ${res.status}`;
    }
    const json = await res.json() as { results?: { title?: string; url?: string; text?: string }[] };
    const results = json.results ?? [];
    if (results.length === 0) return "No results found.";
    return results
      .map((r, i) => `${i + 1}. **${r.title ?? "Untitled"}**\n   URL: ${r.url ?? "N/A"}\n   ${(r.text ?? "").slice(0, 500)}`)
      .join("\n\n")
      .slice(0, 4000);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return "Search timed out (15s).";
    return "Search failed: network error";
  } finally {
    clearTimeout(timer);
  }
}

export async function webFetch(url: string, apiKey: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch("https://api.exa.ai/contents", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ urls: [url], text: true }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return `Fetch error: HTTP ${res.status}`;
    }
    const json = await res.json() as { results?: { text?: string }[] };
    const text = json.results?.[0]?.text;
    if (!text) return "No text content found at URL.";
    return text.slice(0, 8000);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return "Fetch timed out (15s).";
    return "Fetch failed: network error";
  } finally {
    clearTimeout(timer);
  }
}

export const WEB_SEARCH_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web for current information. Returns formatted search results with titles, URLs, and text excerpts.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
      },
      required: ["query"],
    },
  },
};

export const WEB_FETCH_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "web_fetch",
    description:
      "Fetch and extract the full text content of a web page. Use after web_search to read a specific result in detail.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch" },
      },
      required: ["url"],
    },
  },
};

export const PANEL_TOOLS = [WEB_SEARCH_TOOL, WEB_FETCH_TOOL];
