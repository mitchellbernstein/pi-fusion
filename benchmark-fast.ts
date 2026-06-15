import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env" });
import { fusionCall } from "./src/engine.js";

const OR_BASE = "https://openrouter.ai/api/v1";
const PANEL_IDS = ["deepseek/deepseek-chat", "google/gemini-2.5-flash", "qwen/qwen3.6-flash"];

const TESTS = [
  { name: "Go pool", bugs: ["nil conn","len check popped","close mutex","iterate no mutex","outstanding limit","dead connections","nil conn corrupt"] },
  { name: "Node upload", bugs: ["path traversal","command injection","sql injection tags","sql injection filename","undefined user","json parse crash"] },
  { name: "SQL schema", bugs: ["unique email","foreign key","check constraint","created_at index","composite comment index"] },
  { name: "Rust errors", bugs: ["unwrap crash","no result return","mutate by value","spawn blocking send"] },
  { name: "React state", bugs: ["concurrent fetch race","no error handling","no unmount cleanup","missing dep useeffect"] },
  { name: "Python leak", bugs: ["file never closed","exception skip close","db never closed","early return no close"] },
  { name: "JS async", bugs: ["sequential not parallel","toc tou race","no error handling"] },
];

const PROMPTS: Record<string, string> = {
  "Go pool": `Review this Go connection pool for correctness bugs:\n\`\`\`go\ntype ConnPool struct { mu sync.Mutex; conns []net.Conn; max int }\nfunc (p *ConnPool) Get() (net.Conn, error) { p.mu.Lock(); defer p.mu.Unlock(); if len(p.conns)>0 { c:=p.conns[len(p.conns)-1]; p.conns=p.conns[:len(p.conns)-1]; return c,nil }; if len(p.conns)<p.max { c,err:=net.Dial("tcp","localhost:5432"); return c,err }; return nil,fmt.Errorf("pool exhausted") }\nfunc (p *ConnPool) Put(c net.Conn) { p.mu.Lock(); defer p.mu.Unlock(); p.conns=append(p.conns,c) }\nfunc (p *ConnPool) Close() { for _,c:=range p.conns { c.Close() } }\n\`\`\`\nList every bug.`,
  "Node upload": `Review this Express endpoint for security:\n\`\`\`javascript\napp.post("/upload", upload.single("file"), async (req,res) => { const f=req.file; const p="/var/app/files/"+f.originalname; fs.renameSync(f.path,p); if(req.query.thumbnail==="true"){ exec("convert "+p+" -resize 200x200 "+p+"_thumb.jpg") }; const m=JSON.parse(req.body.metadata||"{}"); await db.query("INSERT INTO files VALUES('"+f.originalname+"','"+p+"','"+req.user.id+"','"+m.tags+"')"); res.json({path:"/files/"+f.originalname}) });\n\`\`\`\nList every vulnerability.`,
  "SQL schema": `Review this PostgreSQL schema:\n\`\`\`sql\nCREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255), name TEXT); CREATE TABLE posts (id SERIAL PRIMARY KEY, author_id INTEGER, title TEXT, body TEXT, status VARCHAR(20), created_at TIMESTAMP); CREATE TABLE comments (id SERIAL PRIMARY KEY, post_id INTEGER, user_id INTEGER, body TEXT, created_at TIMESTAMP); CREATE INDEX idx_posts_author ON posts(author_id); CREATE INDEX idx_comments_post ON comments(post_id);\n\`\`\`\nFind design issues.`,
  "Rust errors": `Review this Rust code:\n\`\`\`rust\nfn load_config(path: &str) -> Config { let data = std::fs::read_to_string(path).unwrap(); let config: Config = serde_json::from_str(&data).unwrap(); if config.port == 0 { config.port = 8080; } config }\nasync fn handle_request(pool: &Pool) -> Response { let conn = pool.get().await; let result = tokio::task::spawn_blocking(move || { conn.query("SELECT * FROM users").unwrap() }).await.unwrap().unwrap(); Response::json(result) }\n\`\`\`\nList error handling bugs.`,
  "React state": `Review this React component:\n\`\`\`tsx\nfunction SearchPage() { const [query,setQuery]=useState(""); const [results,setResults]=useState([]); const [loading,setLoading]=useState(false); async function handleSearch(){ setLoading(true); const res=await fetch("/api/search?q="+query); const data=await res.json(); setResults(data); setLoading(false) } useEffect(()=>{ if(query.length>2) handleSearch() },[query]); return (<div><input value={query} onChange={e=>setQuery(e.target.value)}/>{loading&&<Spinner/>}{results.map(r=><ResultCard key={r.id} item={r}/>)}</div>) }\n\`\`\`\nList bugs.`,
  "Python leak": `Review this Python code:\n\`\`\`python\ndef process_files(paths):\n    results = {}\n    for path in paths:\n        f = open(path)\n        data = json.load(f)\n        results[path] = transform(data)\n    return results\n\ndef transform(data):\n    conn = sqlite3.connect("cache.db")\n    cursor = conn.cursor()\n    cursor.execute("SELECT value FROM cache WHERE key = ?", [data["id"]])\n    row = cursor.fetchone()\n    if row: return row[0]\n    result = heavy_computation(data)\n    cursor.execute("INSERT INTO cache VALUES (?, ?)", [data["id"], result])\n    conn.commit()\n    return result\n\`\`\`\nList resource leaks.`,
  "JS async": `Review this JavaScript:\n\`\`\`javascript\nasync function fetchUserData(userIds) { const users=[]; for(const id of userIds){ const user=await fetch("/api/users/"+id).then(r=>r.json()); users.push(user) } return users }\nclass Cache { constructor(){this.data={}} async get(key){ if(this.data[key]) return this.data[key]; const value=await fetch("/api/cache/"+key).then(r=>r.json()); this.data[key]=value; return value } }\n\`\`\`\nList bugs.`,
};

async function main() {
  const config = {
    panel: PANEL_IDS.map(m => ({model:m, baseUrl:OR_BASE, apiKeyEnv:"OPENROUTER_API_KEY", openrouterHeaders:true})),
    judge: {model:"deepseek/deepseek-chat", baseUrl:OR_BASE, apiKeyEnv:"OPENROUTER_API_KEY", openrouterHeaders:true},
    perModelTimeoutMs: 120000, maxCompletionTokens: 8192, maxToolCalls: 2,
  };

  let totalTP = 0, totalFP = 0, totalBugs = 0, totalBS = 0;

  for (const test of TESTS) {
    const r = await fusionCall(PROMPTS[test.name], config);
    const text = (r.status === "ok" ? r.responses : []).map((x: any) => x.content).join("\n").toLowerCase();
    totalBugs += test.bugs.length;
    totalBS += (r.status === "ok" && r.analysis ? r.analysis.blind_spots?.length || 0 : 0);

    for (const bug of test.bugs) {
      const words = bug.split(/\s+/);
      if (words.some((w: string) => text.includes(w))) totalTP++;
    }
    const claimLines = text.split("\n").filter((l: string) => /^[*-]|^\d+\.|bug|issue|vuln|race|leak|crash|error|missing|no /i.test(l));
    totalFP += claimLines.filter((l: string) => !test.bugs.some((b: string) => b.split(/\s+/).some((w: string) => l.includes(w)))).length;
  }

  const recall = totalTP / totalBugs;
  const precision = totalTP / (totalTP + totalFP) || 0;
  const f1 = 2 * precision * recall / (precision + recall) || 0;

  console.log(`METRIC recall=${Math.round(recall * 100)}`);
  console.log(`METRIC false_alarms=${totalFP}`);
  console.log(`METRIC f1=${Math.round(f1 * 100)}`);
  console.log(`METRIC blind_spots=${totalBS}`);
  console.log(`METRIC bugs_found=${totalTP}`);
  console.log(`METRIC total_bugs=${totalBugs}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
