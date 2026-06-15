import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env" });
import { fusionCall } from "./src/engine.js";
import { chatCompletion } from "./src/clients.js";
import { resolveMember } from "./src/config.js";
import type { FusionConfig } from "./src/types.js";
import * as fs from "fs";

// ALL models via OpenRouter — exact same IDs as OR Fusion uses
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OR_KEY = process.env.OPENROUTER_API_KEY!;

// Match EXACT model IDs available on OpenRouter
const PANEL_MODEL_IDS = [
  "deepseek/deepseek-chat",
  "google/gemini-2.5-flash", 
  "qwen/qwen-3-32b",
];
const JUDGE_MODEL_ID = "deepseek/deepseek-chat";

const fusionConfig: FusionConfig = {
  panel: PANEL_MODEL_IDS.map(model => ({
    model,
    baseUrl: OPENROUTER_BASE,
    apiKeyEnv: "OPENROUTER_API_KEY",
    openrouterHeaders: true,
  })),
  judge: {
    model: JUDGE_MODEL_ID,
    baseUrl: OPENROUTER_BASE,
    apiKeyEnv: "OPENROUTER_API_KEY",
    openrouterHeaders: true,
  },
  perModelTimeoutMs: 120_000,
  maxCompletionTokens: 8192,
  maxToolCalls: 2, // limit tool calls for cost control
};

// DeepSeek direct API member (for cost comparison)
const DEEPSEEK_DIRECT = resolveMember({ model: "deepseek-v4-pro", preset: "deepseek" as const });

// Hard coding tasks — build/fix/design, not just review
const TASKS = [
  {
    id: "rust-parser",
    name: "Write a Rust JSON parser",
    prompt: `Write a complete Rust function that parses a JSON string into a serde_json::Value WITHOUT using the serde_json library. Must handle: objects, arrays, strings, numbers, booleans, null, and nested structures. Include error handling with custom error types. Return ONLY the code, no explanation.`,
    qualityCheck: (output: string) => {
      const hasStruct = output.includes("struct") || output.includes("enum");
      const hasParse = output.includes("fn parse") || output.includes("fn from_str");
      const hasObject = output.includes('{') && output.includes('}');
      const hasString = output.includes('"') || output.includes("String");
      const hasError = output.includes("Error") || output.includes("Result");
      const hasNumber = output.includes("f64") || output.includes("i64") || output.includes("parse");
      const score = [hasStruct, hasParse, hasObject, hasString, hasError, hasNumber].filter(Boolean).length;
      return { score, maxScore: 6, details: { struct: hasStruct, parse_fn: hasParse, object: hasObject, string: hasString, error: hasError, number: hasNumber } };
    }
  },
  {
    id: "sql-schema",
    name: "Design a multi-tenant SaaS database schema",
    prompt: `Design a PostgreSQL schema for a multi-tenant SaaS app with: users, organizations (tenants), projects, and tasks. Requirements: row-level tenant isolation, soft deletes, timestamps, foreign keys, and indexes for the most common queries (tasks by project, users by org). Return ONLY the CREATE TABLE statements, no explanation.`,
    qualityCheck: (output: string) => {
      const hasUsers = output.includes("users") || output.includes("CREATE TABLE");
      const hasOrg = output.includes("organization") || output.includes("tenant");
      const hasProjects = output.includes("project");
      const hasTasks = output.includes("task");
      const hasFK = output.includes("REFERENCES") || output.includes("FOREIGN KEY");
      const hasIndex = output.includes("INDEX") || output.includes("CREATE INDEX");
      const hasTimestamp = output.includes("TIMESTAMP") || output.includes("created_at") || output.includes("updated_at");
      const hasSoftDelete = output.includes("deleted_at") || output.includes("is_deleted");
      const hasTenantCol = output.includes("org_id") || output.includes("tenant_id");
      const score = [hasUsers, hasOrg, hasProjects, hasTasks, hasFK, hasIndex, hasTimestamp, hasSoftDelete, hasTenantCol].filter(Boolean).length;
      return { score, maxScore: 9, details: { users: hasUsers, org: hasOrg, projects: hasProjects, tasks: hasTasks, fk: hasFK, index: hasIndex, timestamps: hasTimestamp, soft_delete: hasSoftDelete, tenant_col: hasTenantCol } };
    }
  },
  {
    id: "fix-go-race",
    name: "Fix a Go race condition",
    prompt: `This Go code has a race condition. Fix it and return ONLY the corrected code, no explanation:\n\n` + "```go\npackage main\n\nimport \"sync\"\n\ntype Cache struct {\n    data map[string]string\n}\n\nfunc (c *Cache) Get(key string) string {\n    return c.data[key]\n}\n\nfunc (c *Cache) Set(key, value string) {\n    c.data[key] = value\n}\n\nfunc main() {\n    c := &Cache{data: make(map[string]string)}\n    var wg sync.WaitGroup\n    for i := 0; i < 100; i++ {\n        wg.Add(2)\n        go func(n int) {\n            c.Set(\"key\", \"value\")\n            wg.Done()\n        }(i)\n        go func(n int) {\n            _ = c.Get(\"key\")\n            wg.Done()\n        }(i)\n    }\n    wg.Wait()\n}\n```",
    qualityCheck: (output: string) => {
      const hasMutex = output.includes("sync.Mutex") || output.includes("sync.RWMutex");
      const hasLock = output.includes("Lock()") || output.includes("RLock()");
      const hasUnlock = output.includes("Unlock()") || output.includes("RUnlock()");
      const hasStruct = output.includes("struct");
      const hasMap = output.includes("map[string]string");
      const hasCorrectGet = output.includes("c.mu") && output.includes("Get(");
      const hasCorrectSet = output.includes("c.mu") && output.includes("Set(");
      const score = [hasMutex, hasLock, hasUnlock, hasStruct, hasMap, hasCorrectGet || hasCorrectSet].filter(Boolean).length;
      return { score, maxScore: 6, details: { mutex: hasMutex, lock: hasLock, unlock: hasUnlock, struct: hasStruct, map_type: hasMap, correct_access: hasCorrectGet || hasCorrectSet } };
    }
  },
  {
    id: "react-form",
    name: "Build a React form with validation",
    prompt: `Write a complete React TypeScript component for an email signup form with: email field (with validation), password field (min 8 chars, with show/hide toggle), submit button (disabled while invalid or submitting), error display, and loading state. Use useState, no external libraries. Return ONLY the code, no explanation.`,
    qualityCheck: (output: string) => {
      const hasUseState = output.includes("useState");
      const hasEmail = output.includes("email") && (output.includes("type=\"email\"") || output.includes("@") || output.includes("validate"));
      const hasPassword = output.includes("password") && output.includes("type=");
      const hasValidation = output.includes("error") || output.includes("valid") || output.includes("check") || output.includes("validate");
      const hasSubmit = output.includes("submit") || output.includes("onSubmit") || output.includes("handleSubmit");
      const hasDisabled = output.includes("disabled");
      const hasLoading = output.includes("loading") || output.includes("submitting") || output.includes("isPending");
      const hasToggle = output.includes("show") || output.includes("toggle") || output.includes("visible") || output.includes("type=\"text\"");
      const score = [hasUseState, hasEmail, hasPassword, hasValidation, hasSubmit, hasDisabled, hasLoading, hasToggle].filter(Boolean).length;
      return { score, maxScore: 8, details: { useState: hasUseState, email: hasEmail, password: hasPassword, validation: hasValidation, submit: hasSubmit, disabled: hasDisabled, loading: hasLoading, toggle: hasToggle } };
    }
  }
];

async function runSingleModel(prompt: string): Promise<any> {
  const member = resolveMember({
    model: "deepseek/deepseek-chat",
    baseUrl: OPENROUTER_BASE,
    apiKeyEnv: "OPENROUTER_API_KEY",
    openrouterHeaders: true,
  });
  const start = Date.now();
  const result = await chatCompletion(
    member.baseUrl, member.apiKey, member.model,
    [{ role: "user", content: prompt }],
    undefined,
    { maxTokens: 4096, temperature: 0.3, timeoutMs: 90_000, openrouterHeaders: true }
  );
  return {
    time_s: ((Date.now() - start) / 1000).toFixed(1),
    content: result.content || "",
    tokens: result.usage,
    cost_est: (result.usage?.promptTokens || 0) * 0.0000005 + (result.usage?.completionTokens || 0) * 0.000002,
  };
}

async function runDeepSeekDirect(prompt: string): Promise<any> {
  const start = Date.now();
  const result = await chatCompletion(
    DEEPSEEK_DIRECT.baseUrl, DEEPSEEK_DIRECT.apiKey, DEEPSEEK_DIRECT.model,
    [{ role: "user", content: prompt }],
    undefined,
    { maxTokens: 4096, temperature: 0.3, timeoutMs: 90_000 }
  );
  return {
    time_s: ((Date.now() - start) / 1000).toFixed(1),
    content: result.content || "",
    tokens: result.usage,
    // DeepSeek direct: $0.50/1M prompt, $2.00/1M completion
    cost_direct: (result.usage?.promptTokens || 0) * 0.5 / 1_000_000 + (result.usage?.completionTokens || 0) * 2.0 / 1_000_000,
  };
}

async function runPiFusion(prompt: string): Promise<any> {
  const start = Date.now();
  const result = await fusionCall(prompt, fusionConfig);
  return {
    time_s: ((Date.now() - start) / 1000).toFixed(1),
    status: result.status,
    models: result.status === "ok" ? result.responses?.length || 0 : 0,
    failed: result.status === "ok" ? result.failed_models?.length || 0 : 0,
    analysis: result.status === "ok" && result.analysis ? result.analysis : null,
    responses: result.status === "ok" ? result.responses : [],
  };
}

async function runOrFusion(prompt: string): Promise<any> {
  const start = Date.now();
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OR_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost",
      "X-Title": "pi-fusion-benchmark",
    },
    body: JSON.stringify({
      model: "openrouter/fusion",
      messages: [{ role: "user", content: prompt }],
      plugins: [{
        id: "fusion",
        analysis_models: PANEL_MODEL_IDS,
        model: JUDGE_MODEL_ID,
      }],
    }),
  });
  const json = await res.json() as any;
  return {
    time_s: ((Date.now() - start) / 1000).toFixed(1),
    error: json.error,
    content: json.choices?.[0]?.message?.content || "",
    tokens: json.usage,
    cost: json.usage?.cost,
  };
}

async function main() {
  const results: any[] = [];
  
  for (const task of TASKS) {
    console.log(`\n=== ${task.name} ===`);
    const row: any = { task: task.name, prompt_len: task.prompt.length };
    
    // 1. Single model via OpenRouter (deepseek-chat)
    console.log("  Single (OR)...");
    const single = await runSingleModel(task.prompt);
    const singleQuality = task.qualityCheck(single.content);
    row.single_or = { time: single.time_s, tokens: single.tokens, quality: singleQuality, cost: single.cost_est };
    console.log(`    ${single.time_s}s, ${singleQuality.score}/${singleQuality.maxScore} quality, ~$${single.cost_est.toFixed(4)}`);
    
    // 2. Single model via DeepSeek direct API
    console.log("  DeepSeek direct...");
    const ds = await runDeepSeekDirect(task.prompt);
    const dsQuality = task.qualityCheck(ds.content);
    row.deepseek_direct = { time: ds.time_s, tokens: ds.tokens, quality: dsQuality, cost: ds.cost_direct };
    console.log(`    ${ds.time_s}s, ${dsQuality.score}/${dsQuality.maxScore} quality, $${ds.cost_direct.toFixed(5)}`);
    
    // 3. pi-fusion (all models via OpenRouter, matched IDs)
    console.log("  pi-fusion (OR)...");
    const pi = await runPiFusion(task.prompt);
    let piQuality = { score: 0, maxScore: singleQuality.maxScore, details: {} };
    if (pi.responses?.length > 0) {
      // Use the first (judge's preferred) response for quality check
      piQuality = task.qualityCheck(pi.responses[0].content);
    }
    row.pi_fusion = { time: pi.time_s, models: `${pi.models}/${pi.models + pi.failed}`, quality: piQuality };
    console.log(`    ${pi.time_s}s, ${pi.models}/${pi.models+pi.failed} models, ${piQuality.score}/${piQuality.maxScore} quality`);
    if (pi.analysis) {
      row.pi_fusion.analysis = {
        consensus: pi.analysis.consensus?.length || 0,
        contradictions: pi.analysis.contradictions?.length || 0,
        blind_spots: pi.analysis.blind_spots?.length || 0,
      };
      console.log(`    analysis: ${row.pi_fusion.analysis.consensus}c, ${row.pi_fusion.analysis.contradictions}cont, ${row.pi_fusion.analysis.blind_spots}bs`);
    }
    
    // 4. OpenRouter Fusion (same matched models)
    console.log("  OR Fusion...");
    const or = await runOrFusion(task.prompt);
    const orQuality = or.error ? { score: 0, maxScore: singleQuality.maxScore, details: {}, error: or.error.message } : task.qualityCheck(or.content);
    row.or_fusion = { time: or.time_s, tokens: or.tokens, cost: or.cost, quality: orQuality };
    if (or.error) {
      console.log(`    ERROR: ${or.error.message}`);
    } else {
      console.log(`    ${or.time_s}s, $${or.cost}, ${orQuality.score}/${orQuality.maxScore} quality`);
    }
    
    results.push(row);
    
    // Save incremental results
    fs.writeFileSync("/tmp/fusion-benchmark.json", JSON.stringify(results, null, 2));
  }
  
  // Final summary
  console.log("\n\n========================================");
  console.log("FINAL RESULTS");
  console.log("========================================");
  console.log(`\n| Task | Single (OR) | DeepSeek Direct | pi-fusion (OR) | OR Fusion |`);
  console.log(`|------|-------------|-----------------|----------------|-----------|`);
  for (const r of results) {
    const sq = r.single_or?.quality?.score || 0;
    const sqm = r.single_or?.quality?.maxScore || 0;
    const dq = r.deepseek_direct?.quality?.score || 0;
    const pq = r.pi_fusion?.quality?.score || 0;
    const oq = r.or_fusion?.quality?.score || 0;
    const sc = r.single_or?.cost || 0;
    const dc = r.deepseek_direct?.cost || 0;
    const oc = r.or_fusion?.cost || 0;
    console.log(`| ${r.task} | ${sq}/${sqm} $${sc.toFixed(4)} ${r.single_or?.time}s | ${dq}/${sqm} $${dc.toFixed(5)} ${r.deepseek_direct?.time}s | ${pq}/${sqm} ${r.pi_fusion?.time}s ${r.pi_fusion?.models}mdl | ${oq}/${sqm} $${oc || 'ERR'} ${r.or_fusion?.time}s |`);
  }
  
  // Quality stats
  const singleAvg = results.reduce((s, r) => s + (r.single_or?.quality?.score||0) / (r.single_or?.quality?.maxScore||1), 0) / results.length;
  const dsAvg = results.reduce((s, r) => s + (r.deepseek_direct?.quality?.score||0) / (r.deepseek_direct?.quality?.maxScore||1), 0) / results.length;
  const piAvg = results.reduce((s, r) => s + (r.pi_fusion?.quality?.score||0) / (r.pi_fusion?.quality?.maxScore||1), 0) / results.length;
  const orAvg = results.reduce((s, r) => s + (r.or_fusion?.quality?.score||0) / (r.or_fusion?.quality?.maxScore||1), 0) / results.length;
  console.log(`\nAvg quality: Single(OR)=${(singleAvg*100).toFixed(0)}%, DeepSeek(direct)=${(dsAvg*100).toFixed(0)}%, pi-fusion(OR)=${(piAvg*100).toFixed(0)}%, OR Fusion=${(orAvg*100).toFixed(0)}%`);
  
  const singleCost = results.reduce((s, r) => s + (r.single_or?.cost||0), 0);
  const dsCost = results.reduce((s, r) => s + (r.deepseek_direct?.cost||0), 0);
  const orCost = results.reduce((s, r) => s + (r.or_fusion?.cost||0), 0);
  console.log(`Total cost (4 tasks): Single(OR)=$${singleCost.toFixed(4)}, DeepSeek(direct)=$${dsCost.toFixed(5)}, OR Fusion=$${orCost.toFixed(4)}`);
  console.log(`Cost per task: Single(OR)=$${(singleCost/results.length).toFixed(4)}, DeepSeek(direct)=$${(dsCost/results.length).toFixed(5)}, OR Fusion=$${(orCost/results.length).toFixed(4)}`);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
