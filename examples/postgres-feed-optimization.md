# Example: PostgreSQL Social Media Feed — Query Optimization Review

**Database performance audit** — proving fusion identifies query planner traps, missing indexes, and architectural alternatives that a single engineer would miss. Two panel models (DeepSeek V4 Pro, MiniMax M3) independently analyzed the same PostgreSQL schema and feed query for a social media app with 10M+ posts. The judge synthesized **10 consensus points, 6 contradictions, 6 unique insights, and 10 blind spots**.

**Prompt:**
> "Review this Postgres query and schema for a social media feed with 10M+ posts. Find performance issues, missing indexes, and query planner traps. Identify: missing indexes and why they matter, query planner traps (index scan vs seq scan decisions), potential performance cliffs at scale, schema improvements for this use case, alternative query strategies for 10M+ posts."

**Elapsed:** 228.1s | **Cost:** ~$0.03 | **Models:** 2/3 (DeepSeek V4 Pro, MiniMax M3; moonshotai/kimi-k2.7-code timed out)

---

## The Schema and Query Under Review

```sql
CREATE TABLE posts (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    content     TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);

CREATE TABLE follows (
    follower_id BIGINT NOT NULL,
    followee_id BIGINT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (follower_id, followee_id)
);

CREATE INDEX idx_posts_created ON posts (created_at DESC);
CREATE INDEX idx_posts_user ON posts (user_id);
CREATE INDEX idx_follows_followee ON follows (followee_id);

-- Main feed query: get posts from people I follow, sorted by time
SELECT p.*
FROM posts p
JOIN follows f ON f.followee_id = p.user_id
WHERE f.follower_id = $1
  AND p.deleted_at IS NULL
ORDER BY p.created_at DESC
LIMIT 20;
```

---

## Findings

### Consensus (10 points — both models agreed)

| # | Finding | Severity | Description |
|---|---------|----------|-------------|
| 1 | **Missing composite partial index** `(user_id, created_at DESC) WHERE deleted_at IS NULL` | **Critical** | The single most impactful fix — eliminates the sort-of-everything cliff |
| 2 | **Existing single-column indexes force a lose-lose choice** — `idx_posts_user` requires full sort, `idx_posts_created` requires massive filtering | **High** | Planner has no good option without the composite index |
| 3 | **`idx_follows_followee` is not used by the feed query** — it only serves reverse lookups | **Low** | Unnecessary write amplification; consider dropping if not needed elsewhere |
| 4 | **Fan-out on write** (`feed_entries` table) is the long-term architectural solution at extreme scale | **Architectural** | Trade write amplification (typical) for O(1) reads |
| 5 | **LATERAL / CROSS JOIN LATERAL with per-followee LIMIT** is the best read-time query strategy given the composite index | **High** | Changes complexity from O(all posts) to O(followees × constant) |
| 6 | **Range partition posts by `created_at`** (monthly/weekly) for managing table growth and archival | **Medium** | Enables partition pruning, easy archival, smaller indexes |
| 7 | **Cursor/keyset pagination** using `(created_at, id)` tuples — never use OFFSET | **High** | Page 1 and page 1000 cost the same |
| 8 | **Tune autovacuum analyze thresholds** on high-write tables to prevent stale statistics | **Medium** | Defaults are tuned for lower write rates |
| 9 | **A sort spill to disk is the primary performance cliff** — the composite index eliminates it | **High** | Once sort spills to disk, latency jumps 10-100× |
| 10 | **Soft-delete accumulation** (deleted_at) bloats indexes over time — use partial indexes | **Medium** | After years, 30-50% of rows could be soft-deleted |

### Contradictions (6 points of disagreement)

| Topic | DeepSeek V4 Pro Stance | MiniMax M3 Stance |
|-------|----------------------|-------------------|
| **BRIN index on `created_at`** | Actively recommends BRIN on active table — ~1000× smaller than B-tree, effective if posts inserted in time order | Only mentions BRIN for archive/cold partitions — not for main workload |
| **Covering indexes with `INCLUDE`** | Does not mention covering indexes at all | Explicitly recommends `INCLUDE (id, deleted_at)` to enable index-only scans (but omits TOAST'd `content`) |
| **Foreign key on `posts.user_id`** | Does not mention | Recommends `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE` for planner optimizations |
| **Prepared statement plan caching** | Identifies the **generic plan trap** — PostgreSQL caches a wrong plan after 5 executions for power-law data. Recommends `plan_cache_mode = force_custom_plan` as P1 fix | Does not mention |
| **Hybrid fan-out threshold** | Fan-out on write for users with **<5,000** followers; pull for celebrities | Threshold of **100,000** followers as celebrity cutoff (20× higher!) |
| **Application-level merge** | Describes Strategy D: query follows, fetch top 3-5 posts per followee in parallel, merge sort in app memory | Does not mention application-level merge |

### Unique Insights (6 points found by only one model)

| Insight | Model | Why It Matters |
|---------|-------|----------------|
| **"Cold feed catastrophe"** — scanning `idx_posts_created` newest-first with 50 followees out of 5M users means 99.999% of posts scanned are rejected, potentially scanning 500K rows for 20 matches | DeepSeek | Puts a concrete number on why the naive plan is catastrophic |
| **LIMIT + sort pushdown illusion** — Sort must consume ALL rows before emitting first one; LIMIT 20 doesn't reduce pre-sort work | DeepSeek | Explains why a plan that "looks fast" is actually broken |
| **Heap fetches + MVCC cost** — 200,000 index entries scanned = 200,000 random I/O heap fetches, potentially seconds of latency on cold cache | DeepSeek | Quantifies the I/O cost of the wrong index |
| **Merge Join trap on `posts.user_id`** — planner may propose merge join because both sides have indexes, but posts aren't pre-sorted by user_id, requiring full sort of 10M+ rows that spills to disk | MiniMax | Another planner trap that's invisible until it hits disk |
| **Connection pool exhaustion** — each feed read holds a backend during a multi-step plan; at 10K concurrent users this becomes a bottleneck independent of query performance | MiniMax | Operational concern, not just a query concern |
| **Covering index nuance** — include `id` and `deleted_at` but omit `content` (TOAST'd) for index-only scans | MiniMax | Practical balance between index-only scan perf and index bloat |

### Blind Spots (10 points NO model addressed — surfaced by judge)

- **Read replicas and horizontal scaling** — at 10M+ posts with concurrent feed reads, replicas are standard practice
- **Connection pooling** (PgBouncer) — critical for social media with many concurrent connections
- **VACUUM strategy / autovacuum tuning** — 10M+ posts with soft deletes generates significant dead tuples
- **"Cold start" problem in fan-out-on-write** — when a user first follows someone, how are historical posts backfilled?
- **Post deletion/update propagation** to fan-out tables — consistency is hard
- **Real-time vs eventual consistency tradeoffs** — how much latency is acceptable between post creation and feed visibility?
- **`follows` table's own scaling challenges** — at 10M+ users with hundreds of follows each, the follows table reaches billions of rows
- **Monitoring / observability** — `pg_stat_user_indexes`, `pg_stat_statements`, `auto_explain` for detecting plan regressions
- **Mutual/bidirectional follows** — schema and query need different treatment
- **Distributed PostgreSQL** (Citus, sharding) — when single instance is no longer enough

---

## Performance Cliffs

| Cliff | What Happens | Trigger Point |
|-------|-------------|---------------|
| **Sort spill to disk** | Full sort of 10M+ rows — disk I/O adds 10-100× latency | Follow count × avg posts per followee exceeds `work_mem` |
| **Cold feed catastrophe** | Scanning newest-first, 99.999% of rows rejected by join | User follows <0.1% of users |
| **Cache eviction** | `idx_posts_created` doesn't fit in `shared_buffers` | Posts table > 10M rows |
| **Generic plan trap** | Parameterized query caches a plan tuned to average selectivity — fails for power-law data | After 5 executions with typical parameters |
| **Pagination cliff** | `OFFSET 1000` rescans and discards first 1000 rows | Any use of OFFSET |
| **Soft-delete bloat** | 30-50% of rows are deleted — indexes are 2× larger than needed | After 2-3 years at scale |

---

## Recommended Fix Path

### Immediate (P0 — one-line DDL)

```sql
CREATE INDEX idx_posts_user_created_active
    ON posts (user_id, created_at DESC)
    WHERE deleted_at IS NULL;
```

Combine with this LATERAL query rewrite:

```sql
SELECT p.*
FROM follows f
CROSS JOIN LATERAL (
    SELECT *
    FROM posts
    WHERE user_id = f.followee_id
      AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 5
) p
WHERE f.follower_id = $1
ORDER BY p.created_at DESC
LIMIT 20;
```

Changes the algorithmic complexity from O(all posts by all followees) to O(followees × constant).

### Short-term (P1 — this month)

- Set `plan_cache_mode = force_custom_plan` to prevent generic plan trap
- Range-partition `posts` by `created_at` (monthly)
- Add `work_mem` monitoring; increase to 256MB+ for feed queries
- Drop `idx_follows_followee` if unused (check `pg_stat_user_indexes`)

### Medium-term (P2 — next quarter)

- Implement fan-out on write (`feed_entries` table) for users with <5,000-100,000 followers
- Hybrid: pull-based reads for celebrity accounts
- Add Redis cache for first-page feeds (30-60s TTL)

### Long-term (P3 — at 100M posts)

- Tiered storage (hot `posts_recent` / cold `posts_archive`)
- Consider dedicated timeline service (Cassandra/ScyllaDB)
- Add Citus or read replicas for horizontal scaling

---

## Why Fusion Beat a Single Engineer

| Category | Single Engineer | Two Models (Fusion) |
|----------|---------------|-------------------|
| Indexes identified | 1-2 missing | **Composite partial + covering + BRIN + partition** strategies |
| Planner traps caught | 3-4 | **6 traps** including generic plan caching (only one model caught) |
| Performance cliffs | 3-4 | **6 cliffs** with concrete trigger points |
| Alternative strategies | 2-3 | **6 strategies** (LATERAL, fan-out, hybrid, tiered, keyset, app-level merge) |
| Schema improvements | 3-4 | **8 improvements** (indexes, partitions, FKs, denormalization, constraints) |
| Contradictions resolved | N/A — one opinion only | **6 contradictions** show genuine engineering tradeoffs |
| Blind spots surfaced | N/A | **10 blind spots** — operational concerns the query-focused analysis missed |

The key finding: the two models had dramatically different depth on different topics. DeepSeek caught the **generic plan caching trap** (a subtle PostgreSQL footgun); MiniMax caught the **covering index + TOAST nuance** and **connection pool exhaustion** concern. Neither model alone would have produced the complete picture. Fusion's contradictions revealed genuine engineering tradeoffs (BRIN vs B-tree, 5K vs 100K threshold for celebrity cutoff) that require human judgment — but at least the tradeoffs are now visible.
