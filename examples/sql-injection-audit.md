# Example: SQL Injection Audit — 4 Vectors, Why the "Protection" Fails

**Security audit** — demonstrating how fusion catches vulnerabilities a single model misses. 3 models independently audited an Express.js endpoint with a broken anti-injection middleware; the judge synthesized 6 consensus findings, 3 contradictions, 6 blind spots, and 4 unique insights.

**Prompt:**
> "Find EVERY SQL injection vector in this Express endpoint. The dev added 'protection middleware' — explain why it fails..."

**Elapsed:** 221.5s | **Cost:** ~$0.027 | **Models:** 3/3

---

## The Code Under Review

```javascript
app.get("/api/users/search", async (req, res) => {
  const { name, role, orderBy, limit } = req.query;
  
  let query = "SELECT id, name, email, role FROM users WHERE 1=1";
  if (name) query += " AND name LIKE '%" + name + "%'";
  if (role) query += " AND role = '" + role + "'";
  if (orderBy) query += " ORDER BY " + orderBy;
  query += " LIMIT " + (parseInt(limit) || 20);
  
  const users = await db.query(query);
  res.json(users);
});

// Protection middleware added "for security":
app.use((req, res, next) => {
  if (req.query) {
    for (const key of Object.keys(req.query)) {
      req.query[key] = req.query[key].replace(/'/g, "''");
    }
  }
  next();
});
```

---

## Judge Analysis

### Consensus (found by all 3 reviewers)

| # | Finding | Severity |
|---|---------|----------|
| 1 | All 4 query params (`name`, `role`, `orderBy`, `limit`) are concatenated into SQL without parameterized queries | **Critical** |
| 2 | **`orderBy` is the worst vector** — inserted without quotes, requiring zero middleware bypass | **Critical** |
| 3 | Single-quote-doubling middleware is a blacklist approach fundamentally insufficient to prevent SQL injection | **High** |
| 4 | `limit` is the safest param due to `parseInt` coercing to integer | **Medium** |
| 5 | Parameterized queries are the correct fix, not escaping | **Critical** |
| 6 | `name`, `role`, and `orderBy` are all exploitable | **Critical** |

### Contradictions (models disagreed on key points)

| Topic | DeepSeek | MiniMax | Gemini Flash |
|-------|----------|---------|-------------|
| **Does the middleware ever run?** | ❌ Never runs. Route defined before middleware; handler calls `res.json()` without `next()` | ❌ Never runs. Same reasoning | ⚠️ Incorrectly claims middleware *does* run but too late |
| **Can `' OR 1=1--` bypass the filter for name/role?** | ❌ No. After quote doubling, `OR 1=1` stays inside the string literal | ❌ No. Backslash escape (`\'`) is required to break out | ✅ Incorrectly claims simple `' OR 1=1--` works |

> **Critical finding from contradiction:** Gemini Flash was wrong about the middleware running order, but DeepSeek and MiniMax correctly identified the dead-code problem — this is exactly why multi-model deliberation catches security analysis errors.

### Partial Coverage (points only some models raised)

| Models | Point |
|--------|-------|
| DeepSeek, MiniMax | MySQL double-quote string delimiter bypass: MySQL in non-ANSI mode accepts `"` as string delimiter, enabling injection without any single quotes |
| DeepSeek, MiniMax | Time-based blind SQL injection via `SLEEP()` or `BENCHMARK()` for data exfiltration when output is not directly visible |
| DeepSeek, MiniMax | Stacked/multi-statement queries as a destructive exploit path |
| MiniMax | LIKE wildcard injection: `?name=%` matches all users — not SQLi but a logic bypass |
| DeepSeek | Parameter array bypass: `?role[]=admin` becomes an array, `.replace()` on array fails silently |
| DeepSeek | Blind data exfiltration via `CASE WHEN` in ORDER BY — zero special characters needed |

### Unique Insights (raised by only one model)

1. **DeepSeek**: `parseInt` hex edge case — `parseInt('0x10')` returns 16 (hex parsing). Not independently exploitable but a code smell.
2. **DeepSeek**: Middleware mutation of `req.query` is architecturally fragile — if any downstream code references the original values from `req.originalUrl` or `req.url`, protection is silently bypassed.
3. **MiniMax**: Backtick identifier quoting (` `` `) as a MySQL vector — the middleware only handles `'`, but MySQL also uses backticks, which `orderBy` can leverage.
4. **Gemini Flash**: RCE escalation scenario — in MySQL with `LOAD_FILE` and write privileges, injection could read/write files on the server.

### Blind Spots (found by NO model — surfaced by judge)

| # | Blind Spot | Why It Matters |
|---|------------|----------------|
| 1 | Whether the database driver supports multiple statements — stacked queries only work if the driver allows them, and Node.js drivers often disable them by default | Affects whether `; DROP TABLE` is a realistic threat or just a theoretical concern |
| 2 | MySQL's `NO_BACKSLASH_ESCAPES` SQL mode — the backslash bypass depends on MySQL's default behavior; if this mode is enabled, the `\'` bypass fails | Changes the exploitation strategy per deployment |
| 3 | Encoding-based bypasses: URL double-encoding (`%2527` → `%27` → `'`), Unicode homoglyph attacks, charset smuggling | Attack surface outside the middleware's awareness |
| 4 | **Second-order injection**: middleware modifies `req.query` in-place, but downstream code accessing `req.originalUrl` or raw query strings bypasses sanitization | A critical architectural blind spot in the "modify in place" approach |
| 5 | Whether `db.query()` natively supports parameterized queries — the analysis assumes concatenation is the only path, but Node.js DB libraries often accept both | The fix might be one-line, not a rewrite |
| 6 | Express version-specific routing behavior and middleware ordering rules | Affects whether the dead-code problem reproduces |

---

## Non-Fusion vs Fusion Comparison

| Factor | Single Model (DeepSeek) | Fusion (3 models + judge) |
|--------|------------------------|---------------------------|
| Injection vectors found | 4 (all params) | **6 (all + 2 unique bypasses)** |
| Attack techniques surfaced | 3 (backslash, double-quote, stacked) | **7 (all of single + CASE WHEN, arrays, backtick, LOAD_FILE)** |
| Middleware flaws identified | 1 (never runs — dead code) | **4 (dead code + blacklist + order + 2nd-order injection)** |
| Blind spots surfaced | 0 | **6 (driver support, SQL modes, encoding bypasses, etc.)** |
| Fix strategies | 1 (parameterized queries) | **3 (param queries + whitelist orderBy + delete middleware)** |
| Cost | ~$0.004 | ~$0.027 |
| Time | 23.1s | 221.5s |

**Bottom line:** Both found the core issues, but fusion found 3× the attack surface and identified a critical error in Gemini Flash's analysis (incorrect middleware routing order) that a single-model review would have accepted. The judge also surfaced 6 blind spots about the database driver, SQL modes, and encoding attacks — exactly the kind of detail a production security audit requires.

---

## Worst Exploit (as ranked by DeepSeek)

**#1: `orderBy` — no bypass needed, full control over `ORDER BY` clause:**

```
GET /api/users/search?orderBy=(SELECT password FROM admins LIMIT 1)
```

Goes straight into `ORDER BY (SELECT password FROM admins LIMIT 1)`. The "protection" middleware never even sees a quote to operate on.

**#2: Backslash bypass on `name` / `role` (kills the blacklist filter):**

```
GET /api/users/search?role=\' OR 1=1 -- -
```

After middleware: `\\' OR 1=1 --` — the `\\` is a literal escaped backslash in MySQL, and `'` closes the string, executing `OR 1=1`.

---

## What Single Model Found

DeepSeek alone found all 4 injection vectors, the backslash and double-quote bypasses, the `CASE WHEN` blind exfiltration, and was correct about the middleware being dead code. It produced a usable security fix.

## What Fusion Added

1. **Wrong analysis by Gemini Flash caught by contradictory stances** — Gemini incorrectly claimed the middleware would run. The contradiction forced a re-examination that confirmed the dead-code issue.
2. **4 additional attack vectors** — `LOAD_FILE` RCE scenario, backtick identifier quoting, parameter array bypass, `parseInt` hex edge case.
3. **6 blind spots** — uncovered constraints (driver multi-statement, SQL modes, encoding bypasses) that inform which exploits are realistic.
4. **MiniMax's philosophical framing** — "doubling `'` is a syntactic escape, not a value sanitization" — a conceptual insight that helps developers understand *why* the approach is wrong, not just *what* is wrong.
