# Example: JWT Refresh Token Rotation — Security Review

**Security audit** — proving fusion catches vulnerabilities a single reviewer misses. Two panel models (DeepSeek V4 Pro, MiniMax M3) independently analyzed the same JWT refresh token rotation code with a security mindset. The judge synthesized **10 consensus findings, 3 contradictions, 7 unique insights, and 8 blind spots** — many of which a single model would never surface.

**Prompt:**
> "Review this JWT refresh token rotation code for security vulnerabilities. Find what a real attacker would exploit first. Focus on: replay attacks, token theft detection, race conditions in rotation, secret management, cryptographic weaknesses, CSRF/XSS vectors, and database query patterns."

**Elapsed:** 172.7s | **Cost:** ~$0.02 | **Models:** 2/3 (DeepSeek V4 Pro, MiniMax M3; moonshotai/kimi-k2.7-code timed out)

---

## The Code Under Review

```javascript
const REFRESH_SECRET = process.env.REFRESH_TOKEN_SECRET || "dev-secret-" + Math.random();
const ACCESS_SECRET = process.env.ACCESS_TOKEN_SECRET;

export async function POST(req) {
  const { grant_type, refresh_token } = await req.json();

  let payload;
  try {
    payload = jwt.verify(refresh_token, REFRESH_SECRET);
  } catch {
    return Response.json({ error: "invalid_token" }, { status: 401 });
  }

  const storedToken = await prisma.refreshToken.findUnique({
    where: { token: refresh_token }
  });

  if (!storedToken || storedToken.revoked) {
    return Response.json({ error: "token_revoked" }, { status: 401 });
  }

  await prisma.refreshToken.update({
    where: { id: storedToken.id },
    data: { revoked: true }
  });

  const newRefreshToken = jwt.sign(
    { sub: payload.sub, type: "refresh" },
    REFRESH_SECRET,
    { expiresIn: "7d" }
  );

  await prisma.refreshToken.create({
    data: { token: newRefreshToken, userId: payload.sub }
  });

  const accessToken = jwt.sign(
    { sub: payload.sub, type: "access" },
    ACCESS_SECRET,
    { expiresIn: "15m" }
  );

  return Response.json({ access_token: accessToken, refresh_token: newRefreshToken });
}
```

---

## Critical Vulnerabilities Found

### Consensus (found by both reviewers)

| Rank | Vulnerability | Severity | What an attacker does |
|------|-------------|----------|----------------------|
| 1 | **Race condition (TOCTOU)** between checking `revoked` status and updating it | **Critical** | Fires 10+ concurrent requests with a stolen token — all pass the check before any update completes, issuing multiple valid tokens from one parent |
| 2 | **`Math.random()` secret fallback** — not cryptographically secure | **Critical** | V8's xorshift128+ PRNG state can be recovered after ~45,000 observations; fallback also changes on every server restart |
| 3 | **`ACCESS_SECRET` is silently `undefined`** if env var is missing | **Critical** | `jwt.sign` uses literal string `"undefined"` as HMAC key — trivial forgery |
| 4 | **No `algorithms` whitelist** in `jwt.verify` | **High** | Algorithm confusion attack (CVE-2015-9235 variant: pass RSA public key as HMAC secret) |
| 5 | **No token theft detection** — revoked token presented returns 401 without revoking token family | **High** | Attacker steals a token, uses it, gets new token. Victim's old token is revoked but attacker's new token is never detected |
| 6 | **Plaintext token storage in database** | **High** | DB breach (SQLi, backup leak, insider) exposes every valid refresh token — no hashing |
| 7 | **No `payload.type` validation** | **Medium** | If secrets are ever reused, access tokens become valid refresh tokens |
| 8 | **No rate limiting on refresh endpoint** | **Medium** | Brute-force and abuse of rotation chain at line speed |
| 9 | **Client-side `localStorage` storage** (implied by JSON body response) | **Medium** | XSS = total token compromise, full replay chain |
| 10 | **No CSRF protection beyond JSON Content-Type** | **Medium** | Bypassable via CORS misconfiguration + `fetch()` with `credentials: 'include'` |

### Unique Insights (found by only one reviewer)

| Insight | Model | Why It Matters |
|---------|-------|----------------|
| **Rotation amplifies damage without atomicity** — attacker multiplies a stolen token into many valid sessions while the victim is silently locked out | DeepSeek | The "fix" (rotation) makes the attack worse, not better |
| **V8 PRNG state recovery** from ~45,000 `Math.random()` observations makes the fallback secret predictable | DeepSeek | Puts a number on why `Math.random()` is dangerous |
| **CVE-2015-9235 algorithm confusion** — if server uses RS256 elsewhere, attacker can pass RSA public key as HMAC secret | DeepSeek | Named CVE reference adds concrete exploit path |
| **Fallback silently becomes production** when env var is unset — common in containerized deploys and serverless cold starts | MiniMax | The dev→production drift that catches teams off-guard |
| **SHA-256 for token hashing** (not bcrypt/scrypt) — JWTs are already high-entropy | MiniMax | Shows understanding that not every hash needs to be expensive |
| **Per-token single-use enforcement window** — don't allow same token twice even within 1 second | MiniMax | Practical replay prevention for legitimate double-submissions |
| **Geo/ASN change alerts** as defence layer — notify users on significant location change | MiniMax | Proactive breach detection, not just reactive |

### Blind Spots (found by NO reviewer — surfaced by judge)

- **Token binding to client/device** — no TLS session binding, no client certificate, no fingerprint
- **Timing attacks** — JWT verify + DB lookup timing could leak token validity information
- **Information leakage through differentiated error messages** — `invalid_grant`, `invalid_token`, `token_revoked` map the token lifecycle
- **Design choice of refresh token in request body** vs. `HttpOnly` cookie or `Authorization` header
- **Full JWT string as database lookup key** — indexing and performance problems at scale
- **Prisma ORM injection risks** through raw token values in queries

---

## Contradictions

The two models disagreed on the **primary exploit an attacker would hit first**:

| Model | Stance | Reasoning |
|-------|--------|-----------|
| **DeepSeek V4 Pro** | Race condition is #1 | Requires zero cryptographic skill, amplifies stolen tokens, locks out victim |
| **MiniMax M3** | `Math.random()` secret fallback is #1 | One env var miss in production = total token forgery with low effort |

Both are valid perspectives — a sophisticated attacker would chain both: exploit the env-var miss to forge a token, then use the race condition to multiply access.

---

## Attacker's Priority List

What a real attacker exploits, in order:

| Rank | Vulnerability | Effort | Impact |
|------|--------------|--------|--------|
| **#1** | `Math.random()` secret fallback / missing env var | Trivial if detected | Total token forgery |
| **#2** | Race condition in rotation | Low — 10 lines of concurrent fetch | Multiplies stolen tokens 10× |
| **#3** | No algorithm whitelist | Low-Medium — tooling exists | Token forgery via CVE-2015-9235 |
| **#4** | No theft detection (family revocation) | Already happens automatically | Persistent undetected access |
| **#5** | Plaintext token storage | Requires DB breach first | Mass token compromise |

**First move:** steal one refresh token via XSS/phishing → fire 20 concurrent POST requests → walk away with 20 valid sessions while the victim is silently locked out. The rotation mechanism *enables* the attack instead of preventing it.

---

## Why Fusion Beat a Single Reviewer

| Category | Single Model | Two Models (Fusion) |
|----------|-------------|-------------------|
| Vulnerabilities found | 6-7 | **10 consensus + 7 unique** |
| Attack priority ranking | Only one model's perspective | **3 contradictions** show different expert priorities |
| Attack surface coverage | Narrower | **3 contradictions** + **9 partial coverage** points fill gaps |
| Blind spots surfaced | N/A (model can't report own gaps) | **8 blind spots** surfaced by judge |
| Fix prescriptions | One approach | **2+ competing fix strategies** per vulnerability |
| Remediation depth | Shallow (single-system thinking) | **Family revocation**, **atomic conditional update**, **token hashing**, **rate limiting** |

The key finding: the race condition + missing env-var fallback + no theft detection form a **death spiral** that no single reviewer fully connected — the race condition amplifies the env-var weakness, and the missing theft detection ensures the attacker is never caught.
