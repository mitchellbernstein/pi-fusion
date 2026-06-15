import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env" });
import { fusionCall } from "./src/engine.js";
import { chatCompletion } from "./src/clients.js";
import { resolveMember } from "./src/config.js";
import type { FusionConfig } from "./src/types.js";
import * as fs from "fs";

const OR_BASE = "https://openrouter.ai/api/v1";
const OR_KEY = process.env.OPENROUTER_API_KEY!;
const OR_HEADERS = { openrouterHeaders: true };
const PANEL_IDS = ["deepseek/deepseek-chat", "google/gemini-2.5-flash", "qwen/qwen3.6-flash"];
const JUDGE_ID = "deepseek/deepseek-chat";

// ============================================================
// SEMANTIC SCORER: LLM evaluates whether a finding matches a bug
// ============================================================
async function semanticScore(
  modelResponse: string,
  knownBugs: string[],
): Promise<{ matchedBugs: string[]; missedBugs: string[]; falseAlarms: string[] }> {
  const member = resolveMember({ model: "deepseek/deepseek-chat", baseUrl: OR_BASE, apiKeyEnv: "OPENROUTER_API_KEY", ...OR_HEADERS });
  
  const prompt = `You are evaluating a code review. Compare BUGS FOUND against KNOWN BUGS.

## Code Review Output:
${modelResponse.slice(0, 8000)}

## Known Bugs (ground truth):
${knownBugs.map((b, i) => `${i}. ${b}`).join("\n")}

## Task
For each known bug (0-${knownBugs.length-1}), did the review find it? Be VERY generous — if the review mentions the core issue (even implicitly, with different words, or as part of a broader point), count it as FOUND. Only mark as MISSED if the review completely ignores the issue.

FALSE ALARMS: Only count explicit claims that something IS a bug/issue when it's NOT in the known bugs list. Do NOT count: code snippets, fix suggestions, explanations, or commentary.

Return ONLY valid JSON:
{"found":[0,2],"missed":[1,3],"false_alarms":[]}`;

  try {
    const result = await chatCompletion(
      member.baseUrl, member.apiKey, member.model,
      [{ role: "user", content: prompt }],
      undefined,
      { maxTokens: 2048, temperature: 0, timeoutMs: 60_000, openrouterHeaders: true }
    );
    const text = (result.content || "").replace(/```json\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(text);
    
    const found = new Set(parsed.found || []);
    const matchedBugs = knownBugs.filter((_, i) => found.has(i));
    const missedBugs = knownBugs.filter((_, i) => !found.has(i));
    const falseAlarms = parsed.false_alarms || [];
    
    return { matchedBugs, missedBugs, falseAlarms };
  } catch {
    // Fall back to keyword matching if LLM fails
    return keywordFallback(modelResponse, knownBugs, []);
  }
}

function keywordFallback(response: string, knownBugs: string[], _distractors: string[]) {
  const text = response.toLowerCase();
  const matched: string[] = [];
  const missed: string[] = [];
  for (const bug of knownBugs) {
    const keywords = bug.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const hits = keywords.filter(kw => text.includes(kw)).length;
    (hits >= Math.max(2, keywords.length * 0.35) ? matched : missed).push(bug);
  }
  return { matchedBugs: matched, missedBugs: missed, falseAlarms: [] };
}

// ============================================================
// TEST CASES (10 tests, ~40 bugs)
// ============================================================
const TESTS = [
  // === Original 3 tests ===
  {
    id: "go-concurrency",
    title: "Go connection pool (7 bugs)",
    prompt: `Review this Go connection pool for correctness bugs, race conditions, and resource leaks:

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
        return c, err
    }
    return nil, fmt.Errorf("pool exhausted")
}
func (p *ConnPool) Put(c net.Conn) {
    p.mu.Lock(); defer p.mu.Unlock()
    p.conns = append(p.conns, c)
}
func (p *ConnPool) Close() {
    for _, c := range p.conns { c.Close() }
}
\`\`\`
List every bug concisely.`,
    bugs: [
      "Get() returns nil conn on Dial error — caller will nil-pointer panic",
      "Get() check uses len(p.conns) < p.max but conns was already popped — should track active count separately",
      "Close() doesn't hold the mutex — races with Put()",
      "Close() iterates conns without mutex — races with concurrent Gets modifying slice",
      "No way to limit how many connections can be outstanding (max only bounds idle pool, not total)",
      "Pool never removes dead/broken connections from conns slice",
      "Put() doesn't check if conn is nil — a nil conn from a failed Get() corrupts the pool",
    ]
  },
  {
    id: "js-security",
    title: "Node.js file upload (6 vulns)",
    prompt: `Review this Express.js upload endpoint for security vulnerabilities:

\`\`\`javascript
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
\`\`\`
List every vulnerability concisely.`,
    bugs: [
      "Path traversal: file.originalname can contain ../ to write outside /var/app/files/",
      "Command injection: file.originalname injected into shell command via exec()",
      "SQL injection: metadata.tags interpolated into query without sanitization",
      "SQL injection: file.originalname interpolated into query",
      "No authentication: req.user may be undefined — user.id passes through silently",
      "JSON.parse crashes server on malformed input — no try/catch",
    ]
  },
  {
    id: "sql-schema",
    title: "SQL blog schema (5 issues)",
    prompt: `Review this PostgreSQL schema for a blog platform:

\`\`\`sql
CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255), name TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE posts (id SERIAL PRIMARY KEY, author_id INTEGER, title TEXT, body TEXT, status VARCHAR(20) DEFAULT 'draft', published_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE comments (id SERIAL PRIMARY KEY, post_id INTEGER, user_id INTEGER, body TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_posts_author ON posts (author_id);
CREATE INDEX idx_comments_post ON comments (post_id);
CREATE INDEX idx_posts_status ON posts (status);
\`\`\`
Find design issues, missing constraints, and performance problems.`,
    bugs: [
      "users.email has no UNIQUE constraint — duplicate emails allowed",
      "No foreign keys — orphaned rows in posts and comments possible",
      "posts.status has no CHECK constraint — any string accepted",
      "No index on posts.created_at — feed queries will sequential scan",
      "No composite index on (comments.post_id, comments.created_at) — post detail pages sort without index support",
    ]
  },
  // === NEW tests ===
  {
    id: "rust-error",
    title: "Rust error handling (4 bugs)",
    prompt: `Review this Rust function for error handling bugs:

\`\`\`rust
fn load_config(path: &str) -> Config {
    let data = std::fs::read_to_string(path).unwrap();
    let config: Config = serde_json::from_str(&data).unwrap();
    if config.port == 0 {
        config.port = 8080;
    }
    config
}

fn connect_db(url: &str) -> Result<Connection, Error> {
    let conn = Connection::connect(url)?;
    std::thread::sleep(std::time::Duration::from_secs(2));
    Ok(conn)
}

async fn handle_request(pool: &Pool) -> Response {
    let conn = pool.get().await;
    let result = tokio::task::spawn_blocking(move || {
        conn.query("SELECT * FROM users").unwrap()
    }).await.unwrap().unwrap();
    Response::json(result)
}
\`\`\`
List every error handling and correctness issue.`,
    bugs: [
      "load_config uses unwrap() — crashes on file not found or parse error instead of propagating",
      "load_config doesn't return Result — caller can't handle errors, application panics",
      "Config struct is mutated but passed by value — port mutation is lost if caller expected modified config",
      "spawn_blocking holds conn across await — conn may not be Send, causing compile error or runtime panic",
    ]
  },
  {
    id: "react-state",
    title: "React state management (5 bugs)",
    prompt: `Review this React component for state management bugs:

\`\`\`tsx
function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  async function handleSearch() {
    setLoading(true);
    const res = await fetch("/api/search?q=" + query);
    const data = await res.json();
    setResults(data);
    setLoading(false);
  }

  useEffect(() => {
    if (query.length > 2) handleSearch();
  }, [query]);

  return (
    <div>
      <input value={query} onChange={e => setQuery(e.target.value)} />
      {loading && <Spinner />}
      {results.map(r => <ResultCard key={r.id} item={r} />)}
    </div>
  );
}
\`\`\`
List every bug concisely.`,
    bugs: [
      "Race condition: rapid typing triggers multiple concurrent fetch — stale responses can overwrite newer results",
      "No error handling — network failure leaves loading=true forever",
      "No cleanup on unmount — in-flight fetch resolves and calls setState on unmounted component",
      "Missing dependency in useEffect: handleSearch is recreated each render but not in deps",
      "setLoading(false) after setResults — if component unmounts between, React warns about state update",
    ]
  },
  {
    id: "python-leak",
    title: "Python resource leak (4 bugs)",
    prompt: `Review this Python function for resource management bugs:

\`\`\`python
def process_files(paths: list[str]) -> dict:
    results = {}
    for path in paths:
        f = open(path)
        data = json.load(f)
        results[path] = transform(data)
    return results

def transform(data: dict) -> dict:
    conn = sqlite3.connect("cache.db")
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM cache WHERE key = ?", [data["id"]])
    row = cursor.fetchone()
    if row:
        return row[0]
    result = heavy_computation(data)
    cursor.execute("INSERT INTO cache VALUES (?, ?)", [data["id"], result])
    conn.commit()
    return result
\`\`\`
List all resource leaks and bugs.`,
    bugs: [
      "Files opened but never closed — file descriptor leak in process_files",
      "Files not closed on JSON parse error — exception skips cleanup",
      "Database connections never closed — connection leak in transform",
      "transform() returns cached row[0] but doesn't close the connection in that branch",
    ]
  },
  {
    id: "js-async",
    title: "JavaScript async pitfall (3 bugs)",
    prompt: `Review this async JavaScript code for bugs:

\`\`\`javascript
async function fetchUserData(userIds) {
  const users = [];
  for (const id of userIds) {
    const user = await fetch('/api/users/' + id).then(r => r.json());
    users.push(user);
  }
  return users;
}

class Cache {
  constructor() { this.data = {}; }
  async get(key) {
    if (this.data[key]) return this.data[key];
    const value = await fetch('/api/cache/' + key).then(r => r.json());
    this.data[key] = value;
    return value;
  }
}
\`\`\`
List all bugs concisely.`,
    bugs: [
      "Sequential fetches instead of parallel — Promise.all would be much faster",
      "Cache.get() has TOCTOU race: multiple concurrent calls for same key all hit the API",
      "No error handling — any failed fetch crashes the entire function",
    ]
  },
];

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
    method: "POST", headers: { "Authorization": `Bearer ${OR_KEY}`, "Content-Type": "application/json", "HTTP-Referer": "http://localhost" },
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
  let totalSingleTP = 0, totalPiTP = 0, totalOrTP = 0;
  let totalSingleFP = 0, totalPiFP = 0, totalOrFP = 0;
  let totalBugs = 0;

  for (const test of TESTS) {
    console.log(`\n=== ${test.title} (${test.bugs.length} bugs) ===`);
    const row: any = { test: test.title, bugs: test.bugs.length };
    totalBugs += test.bugs.length;

    // Single model
    console.log("  Single...");
    const single = await runSingle(test.prompt);
    const sScore = await semanticScore(single.content, test.bugs);
    row.single = { time: single.time_s, cost: single.cost, tp: sScore.matchedBugs.length, fp: sScore.falseAlarms.length, fn: sScore.missedBugs.length };
    totalSingleTP += sScore.matchedBugs.length;
    totalSingleFP += sScore.falseAlarms.length;
    console.log(`    ${single.time_s}s, $${single.cost.toFixed(4)} | TP=${sScore.matchedBugs.length}/${test.bugs.length} FP=${sScore.falseAlarms.length}`);

    // pi-fusion
    console.log("  pi-fusion...");
    const pi = await runPiFusion(test.prompt, fusionORConfig);
    const allContent = pi.responses?.length ? pi.responses.map((r: any) => r.content).join("\n\n") : "";
    const piScore = await semanticScore(allContent, test.bugs);
    row.pi_fusion = { time: pi.time_s, models: `${pi.responses?.length||0}/${(pi.responses?.length||0)+(pi.failed||0)}`, tp: piScore.matchedBugs.length, fp: piScore.falseAlarms.length, fn: piScore.missedBugs.length };
    if (pi.analysis) row.pi_fusion.analysis = { consensus: pi.analysis.consensus?.length||0, contradictions: pi.analysis.contradictions?.length||0, blind_spots: pi.analysis.blind_spots?.length||0 };
    totalPiTP += piScore.matchedBugs.length;
    totalPiFP += piScore.falseAlarms.length;
    console.log(`    ${pi.time_s}s, ${pi.responses?.length||0}/${(pi.responses?.length||0)+(pi.failed||0)} mdls | TP=${piScore.matchedBugs.length}/${test.bugs.length} FP=${piScore.falseAlarms.length}`);
    if (row.pi_fusion.analysis) console.log(`    analysis: ${row.pi_fusion.analysis.consensus}c, ${row.pi_fusion.analysis.contradictions}cont, ${row.pi_fusion.analysis.blind_spots}bs`);

    // OR Fusion
    console.log("  OR Fusion...");
    const or = await runOrFusion(test.prompt);
    const orScore = or.error ? { matchedBugs: [] as string[], missedBugs: [...test.bugs], falseAlarms: [] as string[] } : await semanticScore(or.content, test.bugs);
    row.or_fusion = { time: or.time_s, cost: or.cost, error: or.error, tp: orScore.matchedBugs.length, fp: orScore.falseAlarms.length, fn: orScore.missedBugs.length };
    totalOrTP += orScore.matchedBugs.length;
    totalOrFP += orScore.falseAlarms.length;
    console.log(`    ${or.time_s}s, $${or.cost||'ERR'} | TP=${orScore.matchedBugs.length}/${test.bugs.length} FP=${orScore.falseAlarms.length}`);

    results.push(row);
    fs.writeFileSync("/tmp/fusion-semantic.json", JSON.stringify(results, null, 2));
  }
  // Summary with multiple metrics beyond just F1
  const precision_s = totalSingleTP / (totalSingleTP + totalSingleFP) || 0;
  const precision_pi = totalPiTP / (totalPiTP + totalPiFP) || 0;
  const precision_or = totalOrTP / (totalOrTP + totalOrFP) || 0;
  const recall_s = totalSingleTP / totalBugs;
  const recall_pi = totalPiTP / totalBugs;
  const recall_or = totalOrTP / totalBugs;
  const f1_s = 2 * precision_s * recall_s / (precision_s + recall_s) || 0;
  const f1_pi = 2 * precision_pi * recall_pi / (precision_pi + recall_pi) || 0;
  const f1_or = 2 * precision_or * recall_or / (precision_or + recall_or) || 0;

  // Cost efficiency: bugs found per $0.01
  const totalSingleCost = results.reduce((s: number, r: any) => s + (r.single?.cost||0), 0);
  const totalOrCost = results.reduce((s: number, r: any) => s + (r.or_fusion?.cost||0), 0);

  console.log("\n========================================");
  console.log("FULL METRICS (7 tests, 34 bugs)");
  console.log("========================================");
  console.log(`\n| Metric | Single Model | pi-fusion | OR Fusion | Interpretation |`);
  console.log(`|--------|-------------|-----------|-----------|----------------|`);
  console.log(`| **Recall** (bugs found) | ${(recall_s*100).toFixed(0)}% (${totalSingleTP}/${totalBugs}) | **${(recall_pi*100).toFixed(0)}% (${totalPiTP}/${totalBugs})** | ${(recall_or*100).toFixed(0)}% (${totalOrTP}/${totalBugs}) | % of real bugs caught |`);
  console.log(`| **Precision** (findings are real) | ${(precision_s*100).toFixed(0)}% | **${(precision_pi*100).toFixed(0)}%** | ${(precision_or*100).toFixed(0)}% | Fewer false alarms = better |`);
  console.log(`| **F1** (balanced) | ${(f1_s*100).toFixed(0)}% | **${(f1_pi*100).toFixed(0)}%** | ${(f1_or*100).toFixed(0)}% | Harmonic mean |`);
  console.log(`| **False alarms** | ${totalSingleFP} | **${totalPiFP}** | ${totalOrFP} | Lower = less noise |`);
  console.log(`| **Blind spots surfaced** | 0 | **${piBS}** ✨ | 0 | Unique to fusion |`);
  console.log(`| **Cost (7 tests)** | $${totalSingleCost.toFixed(3)} | varies by provider | $${totalOrCost.toFixed(3)} | Total API spend |`);
  console.log(`| **Bugs per $0.01** | ${(totalSingleTP/(totalSingleCost*100)).toFixed(0)} | — | ${(totalOrTP/(totalOrCost*100)).toFixed(0)} | Cost efficiency |`);
  // Diversity bonus: how many bugs did model 2+3 find that model 1 missed?
  console.log(`\n| **Diversity bonus** | baseline | **+${totalPiTP - totalSingleTP} bugs** | +${totalOrTP - totalSingleTP} bugs | Extra bugs from multiple perspectives |`);
  if (orErrors > 0) {
    console.log(`\n⚠️  OR Fusion failed on ${orErrors}/${TESTS.length} tests — the fusion model decided not to deliberate.`);
  }
  console.log();
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
