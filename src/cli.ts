#!/usr/bin/env node
import { config as dotenvConfig } from "dotenv";
import { join } from "node:path";
import { homedir } from "node:os";

// Load .env before anything else
dotenvConfig({ path: join(process.cwd(), ".env") });
dotenvConfig({ path: join(homedir(), "Documents", "GitHub", "fusion-local", ".env") });

import { fusionCall } from "./engine.js";
import { loadConfig } from "./config.js";

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}

async function main() {
  const prompt = process.argv.slice(2).join(" ") || (await readStdin());
  if (!prompt.trim()) {
    console.error("Usage: npx tsx src/cli.ts 'your prompt'");
    console.error("   or: echo 'your prompt' | npx tsx src/cli.ts");
    process.exit(1);
  }

  const config = loadConfig();
  const start = Date.now();
  const result = await fusionCall(prompt, config);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(JSON.stringify({ ...result, elapsed_seconds: elapsed }, null, 2));
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      status: "error",
      error: err.message,
      failure_reason: "unexpected_error",
    }),
  );
  process.exit(1);
});
