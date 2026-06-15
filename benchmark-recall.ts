import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env" });
import { fusionCall } from "./src/engine.js";
import { chatCompletion } from "./src/clients.js";
import { resolveMember } from "./src/config.js";
import type { FusionConfig } from "./src/types.js";
import * as fs from "fs";

// ALL models via OpenRouter — exact same IDs
const OR_BASE = "https://openrouter.ai/api/v1";
const OR_KEY = process.env.OPENROUTER_API_KEY!;
const OR_HEADERS = { openrouterHeaders: true };

const PANEL_IDS = ["deepseek/deepseek-chat", "google/gemini-2.5-flash", "qwen/qwen3.6-flash"];
const JUDGE_ID = "deepseek/deepseek-chat";

// ============================================================
// TEST CASES WITH KNOWN GROUND TRUTH
// ============================================================
// Each test has: code/file to review, list of KNOWN real issues,
// and list of things that look like bugs but AREN'T (distractors)

const TESTS = [
  {
    id: "go-concurrency",
    title: "Go concurrency: 7 known bugs",
    prompt: `Review this Go connection pool for correctness bugs, race conditions, and resource leaks. List every bug you find concisely:

\`\`\`go
type ConnPool struct {
    mu    sync.Mutex
    conns []net.Conn
    max   int
}

func NewPool(max int) *ConnPool {
    return &ConnPool{max: max, conns: make([]net.Conn, 0, max)}
}

func (p *ConnPool) Get() (net.Conn, error) {
    p.mu.Lock()
    defer p.mu.Unlock()
    if len(p.conns) > 0 {
        c := p.conns[len(p.conns)-1]
        p.conns = p.conns[:len(p.conns)-1]
        return c, nil
    }
    if len(p.conns) < p.max {
        c, err := net.Dial("tcp", "localhost:5432")
        return c, err  // returns nil conn on error
    }
    return nil, fmt.Errorf("pool exhausted")
}

func (p *ConnPool) Put(c net.Conn) {
    p.mu.Lock()
    defer p.mu.Unlock()
    p.conns = append(p.conns, c)
}

func (p *ConnPool) Close() {
    for _, c := range p.conns {
        c.Close()
    }
}
\`\`\``,
    // GROUND TRUTH — every real bug in this code
    knownBugs: [
      "Get() returns nil conn on Dial error — caller will nil-pointer panic",
      "Get() check uses len(p.conns) < p.max but conns was already popped — should track active count separately",
      "Close() doesn't hold the mutex — races with Put()",
      "Close() iterates conns without mutex — races with concurrent Gets modifying slice",
      "No way to limit how many connections can be outstanding (max only bounds idle pool, not total)",
      "Pool never removes dead/broken connections from conns slice",
      "Put() doesn't check if conn is nil — a nil conn from a failed Get() corrupts the pool",
    ],
    distractors: [
      "sync.Mutex should be sync.RWMutex", // not a real bug for this use case
      "should use sync.Pool instead", // design preference, not a bug
    ]
  },
  {
    id: "js-security",
    title: "Node.js security: 6 known vulns",
    prompt: `Review this Express.js file upload endpoint for security vulnerabilities. List every vulnerability concisely:

\`\`\`javascript
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const { exec } = require("child_process");

const upload = multer({ dest: "/tmp/uploads/" });

app.post("/upload", upload.single("file"), async (req, res) => {
  const file = req.file;
  const targetPath = "/var/app/files/" + file.originalname;
  
  fs.renameSync(file.path, targetPath);
  
  if (req.query.thumbnail === "true") {
    exec("convert " + targetPath + " -resize 200x200 " + targetPath + "_thumb.jpg");
  }
  
  const metadata = JSON.parse(req.body.metadata || "{}");
  await db.query("INSERT INTO files (name, path, owner, tags) VALUES ('" 
    + file.originalname + "', '" + targetPath + "', '" 
    + req.user.id + "', '" + metadata.tags + "')");
  
  res.json({ path: "/files/" + file.originalname });
});
\`\`\``,
    knownBugs: [
      "Path traversal: file.originalname can contain ../ to write outside /var/app/files/",
      "Command injection in exec(): file.originalname injected into shell command — e.g. '; rm -rf /'",
      "SQL injection: metadata.tags interpolated directly into query string",
      "SQL injection: file.originalname and targetPath interpolated into query",
      "No authentication check on req.user — undefined user.id passes through silently",
      "JSON.parse on untrusted input with no try/catch — crashes server on malformed JSON",
    ],
    distractors: [
      "multer should use memoryStorage", // design preference
      "should use async fs.rename instead of renameSync", // style, not security
    ]
  },
  {
    id: "sql-schema",
    title: "SQL schema design: 5 known issues",
    prompt: `Review this PostgreSQL schema for a blog platform. Find design issues, missing constraints, and performance problems:

\`\`\`sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255),
    name TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE posts (
    id SERIAL PRIMARY KEY,
    author_id INTEGER,
    title TEXT,
    body TEXT,
    status VARCHAR(20) DEFAULT 'draft',
    published_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE comments (
    id SERIAL PRIMARY KEY,
    post_id INTEGER,
    user_id INTEGER,
    body TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_posts_author ON posts (author_id);
CREATE INDEX idx_comments_post ON comments (post_id);
CREATE INDEX idx_posts_status ON posts (status);
\`\`\``,
    knownBugs: [
      "users.email has no UNIQUE constraint — duplicate emails allowed",
      "No foreign keys on posts.author_id or comments.post_id/user_id — orphaned rows possible",
      "posts.status has no CHECK constraint — any string accepted, not just draft/published",
      "No index on posts.created_at — feed queries (ORDER BY created_at DESC) will seq scan",
      "No index on comments.created_at combined with post_id — post detail pages sort comments by time without index support",
    ],
    distractors: [
      "SERIAL should be BIGSERIAL", // scale concern, not a current bug
      "TEXT should be VARCHAR(n)", // style preference, Postgres treats them identically
    ]
  }
];

// ============================================================
// EVALUATION: score a response against ground truth
// ============================================================
function scoreResponse(response: string, knownBugs: string[], distractors: string[]): {
  truePositives: number, falsePositives: number, falseNegatives: number,
  precision: number, recall: number, f1: number,
  matchedBugs: string[], missedBugs: string[], falseAlarms: string[]
} {
  const text = response.toLowerCase();
  const matchedBugs: string[] = [];
  const missedBugs: string[] = [];
  const falseAlarms: string[] = [];
  
  // Check each known bug — did the model mention it?
  // Use keyword matching (robust to phrasing differences)
  for (const bug of knownBugs) {
    const keywords = bug.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !["that", "this", "with", "from", "when", "will", "should", "could", "would", "after", "before", "during", "which"].includes(w));
    const matchCount = keywords.filter(kw => text.includes(kw)).length;
    if (matchCount >= Math.max(2, keywords.length * 0.35)) {
      matchedBugs.push(bug);
    } else {
      missedBugs.push(bug);
    }
  }
  
  // Check distractors — did the model flag things that aren't bugs?
  for (const distractor of distractors) {
    const keywords = distractor.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const matchCount = keywords.filter(kw => text.includes(kw)).length;
    if (matchCount >= Math.max(2, keywords.length * 0.35)) {
      falseAlarms.push(distractor);
    }
  }
  
  const tp = matchedBugs.length;
  const fp = falseAlarms.length;
  const fn = missedBugs.length;
  const precision = tp / (tp + fp) || 0;
  const recall = tp / (tp + fn) || 0;
  const f1 = 2 * (precision * recall) / (precision + recall) || 0;
  
  return { truePositives: tp, falsePositives: fp, falseNegatives: fn, precision, recall, f1, matchedBugs, missedBugs, falseAlarms };
}

// ============================================================
// RUNNERS
// ============================================================

async function runSingle(prompt: string) {
  const m = resolveMember({ model: "deepseek/deepseek-chat", baseUrl: OR_BASE, apiKeyEnv: "OPENROUTER_API_KEY", ...OR_HEADERS });
  const start = Date.now();
  const r = await chatCompletion(m.baseUrl, m.apiKey, m.model, [{ role: "user", content: prompt }], undefined, { maxTokens: 4096, temperature: 0.3, timeoutMs: 120_000, openrouterHeaders: true });
  return { time_s: ((Date.now()-start)/1000).toFixed(1), content: r.content || "", tokens: r.usage, cost: (r.usage?.promptTokens||0)*0.0000005 + (r.usage?.completionTokens||0)*0.000002 };
}

async function runPiFusion(prompt: string, config: FusionConfig) {
  const start = Date.now();
  const r = await fusionCall(prompt, config);
  return { time_s: ((Date.now()-start)/1000).toFixed(1), status: r.status, responses: r.status==="ok"?r.responses:[], analysis: r.status==="ok"?r.analysis:null, failed: r.status==="ok"?r.failed_models?.length:0 };
}

async function runOrFusion(prompt: string) {
  const start = Date.now();
  const res = await fetch(`${OR_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${OR_KEY}`, "Content-Type": "application/json", "HTTP-Referer": "http://localhost" },
    body: JSON.stringify({ model: "openrouter/fusion", messages: [{ role: "user", content: prompt }], plugins: [{ id: "fusion", analysis_models: PANEL_IDS, model: JUDGE_ID }] }),
  });
  const json = await res.json() as any;
  return { time_s: ((Date.now()-start)/1000).toFixed(1), error: !!json.error, content: json.choices?.[0]?.message?.content || "", tokens: json.usage, cost: json.usage?.cost };
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const fusionORConfig: FusionConfig = {
    panel: PANEL_IDS.map(m => ({ model: m, baseUrl: OR_BASE, apiKeyEnv: "OPENROUTER_API_KEY", openrouterHeaders: true })),
    judge: { model: JUDGE_ID, baseUrl: OR_BASE, apiKeyEnv: "OPENROUTER_API_KEY", openrouterHeaders: true },
    perModelTimeoutMs: 120_000, maxCompletionTokens: 8192, maxToolCalls: 2,
  };

  const results: any[] = [];

  for (const test of TESTS) {
    console.log(`\n=== ${test.title} (${test.knownBugs.length} known bugs) ===`);
    const row: any = { test: test.title, knownBugs: test.knownBugs.length };

    // 1. Single model
    console.log("  Single model...");
    const single = await runSingle(test.prompt);
    const singleScore = scoreResponse(single.content, test.knownBugs, test.distractors);
    row.single = { ...single, ...singleScore };
    console.log(`    ${single.time_s}s, $${single.cost.toFixed(4)} | TP=${singleScore.truePositives} FP=${singleScore.falsePositives} FN=${singleScore.falseNegatives} | F1=${(singleScore.f1*100).toFixed(0)}%`);
    if (singleScore.missedBugs.length) console.log(`    MISSED: ${singleScore.missedBugs.map(b => b.slice(0,60)).join(" | ")}`);

    // 2. pi-fusion
    console.log("  pi-fusion...");
    const pi = await runPiFusion(test.prompt, fusionORConfig);
    let piScore = { truePositives: 0, falsePositives: 0, falseNegatives: test.knownBugs.length, precision: 0, recall: 0, f1: 0, matchedBugs: [] as string[], missedBugs: [...test.knownBugs], falseAlarms: [] as string[] };
    if (pi.responses?.length > 0) {
      // Use the FIRST panel response for scoring (matching how OR Fusion uses its panel)
      piScore = scoreResponse(pi.responses[0].content, test.knownBugs, test.distractors);
    }
    row.pi_fusion = { time: pi.time_s, models: `${pi.responses?.length||0}/${(pi.responses?.length||0)+(pi.failed||0)}`, ...piScore };
    if (pi.analysis) row.pi_fusion.analysis = { consensus: pi.analysis.consensus?.length||0, contradictions: pi.analysis.contradictions?.length||0, blind_spots: pi.analysis.blind_spots?.length||0 };
    console.log(`    ${pi.time_s}s, ${pi.responses?.length||0}/${(pi.responses?.length||0)+(pi.failed||0)} models | TP=${piScore.truePositives} FP=${piScore.falsePositives} FN=${piScore.falseNegatives} | F1=${(piScore.f1*100).toFixed(0)}%`);
    if (pi.analysis) console.log(`    analysis: ${pi.analysis.consensus?.length||0}c, ${pi.analysis.contradictions?.length||0}cont, ${pi.analysis.blind_spots?.length||0}bs`);
    
    // 3. OR Fusion
    console.log("  OR Fusion...");
    const or = await runOrFusion(test.prompt);
    const orScore = or.error ? { truePositives: 0, falsePositives: 0, falseNegatives: test.knownBugs.length, precision: 0, recall: 0, f1: 0, matchedBugs: [] as string[], missedBugs: [...test.knownBugs], falseAlarms: [] as string[] } : scoreResponse(or.content, test.knownBugs, test.distractors);
    row.or_fusion = { time: or.time_s, cost: or.cost, error: or.error, ...orScore };
    console.log(`    ${or.time_s}s, $${or.cost || 'ERR'} | TP=${orScore.truePositives} FP=${orScore.falsePositives} FN=${orScore.falseNegatives} | F1=${(orScore.f1*100).toFixed(0)}%`);
    if (or.error) console.log(`    ERROR: OR Fusion failed`);

    results.push(row);
    fs.writeFileSync("/tmp/fusion-recall.json", JSON.stringify(results, null, 2));
  }

  // SUMMARY
  console.log("\n\n========================================");
  console.log("RECALL BENCHMARK RESULTS");
  console.log("(Higher F1 = better at finding real bugs, avoiding false alarms)");
  console.log("========================================");
  console.log(`\n| Test | Single Model | pi-fusion | OR Fusion |`);
  console.log(`|------|-------------|-----------|-----------|`);
  for (const r of results) {
    const sf1 = (r.single.f1*100).toFixed(0);
    const pf1 = (r.pi_fusion.f1*100).toFixed(0);
    const of1 = (r.or_fusion.f1*100).toFixed(0);
    console.log(`| ${r.test} | F1=${sf1}% TP=${r.single.truePositives}/${r.knownBugs} FP=${r.single.falsePositives} $${r.single.cost?.toFixed(4)} | F1=${pf1}% TP=${r.pi_fusion.truePositives}/${r.knownBugs} FP=${r.pi_fusion.falsePositives} +${r.pi_fusion.analysis?.blind_spots||0}bs | F1=${of1}% TP=${r.or_fusion.truePositives}/${r.knownBugs} FP=${r.or_fusion.falsePositives} $${r.or_fusion.cost||'ERR'} |`);
  }

  // Aggregate stats
  const singleF1 = results.reduce((s,r) => s + r.single.f1, 0) / results.length;
  const piF1 = results.reduce((s,r) => s + r.pi_fusion.f1, 0) / results.length;
  const orF1 = results.reduce((s,r) => s + r.or_fusion.f1, 0) / results.length;
  const singleTP = results.reduce((s,r) => s + r.single.truePositives, 0);
  const piTP = results.reduce((s,r) => s + r.pi_fusion.truePositives, 0);
  const orTP = results.reduce((s,r) => s + r.or_fusion.truePositives, 0);
  const totalBugs = results.reduce((s,r) => s + r.knownBugs, 0);
  const singleFP = results.reduce((s,r) => s + r.single.falsePositives, 0);
  const piFP = results.reduce((s,r) => s + r.pi_fusion.falsePositives, 0);
  const orFP = results.reduce((s,r) => s + r.or_fusion.falsePositives, 0);
  const piBS = results.reduce((s,r) => s + (r.pi_fusion.analysis?.blind_spots||0), 0);
  const singleCost = results.reduce((s,r) => s + (r.single.cost||0), 0);
  const orCost = results.reduce((s,r) => s + (r.or_fusion.cost||0), 0);
  const orErrors = results.filter(r => r.or_fusion.error).length;

  console.log(`\n=== AGGREGATE ===`);
  console.log(`Total known bugs across tests: ${totalBugs}`);
  console.log(`| Metric | Single Model | pi-fusion | OR Fusion |`);
  console.log(`|--------|-------------|-----------|-----------|`);
  console.log(`| Avg F1 score | ${(singleF1*100).toFixed(0)}% | ${(piF1*100).toFixed(0)}% | ${(orF1*100).toFixed(0)}% |`);
  console.log(`| Total bugs found | ${singleTP}/${totalBugs} | ${piTP}/${totalBugs} | ${orTP}/${totalBugs} |`);
  console.log(`| False positives | ${singleFP} | ${piFP} | ${orFP} |`);
  console.log(`| Blind spots surfaced | 0 | ${piBS} | 0 |`);
  console.log(`| Failures | 0 | 0 | ${orErrors} |`);
  console.log(`| Total cost | $${singleCost.toFixed(4)} | varies | $${(orCost||0).toFixed(4)} |`);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
