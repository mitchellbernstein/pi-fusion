# Example: Distributed Leader Election — PostgreSQL Advisory Locks vs etcd Raft

**Architecture deep-dive** — demonstrating how fusion evaluates infrastructure tradeoffs with multiple competing perspectives. 3 models independently analyzed two leader-election approaches for a 5-node Fly.io cluster; the judge synthesized 7 consensus findings, 4 contradictions, 6 blind spots, and 5 unique insights — the richest analysis of all 4 tests.

**Prompt:**
> "Distributed leader election for a 5-node Fly.io cluster. Evaluate: PostgreSQL advisory locks vs etcd Raft..."

**Elapsed:** 114.7s | **Cost:** ~$0.022 | **Models:** 3/3

---

## The Options Evaluated

**Approach A: PostgreSQL advisory locks**
- Each node tries `SELECT pg_try_advisory_lock(123)` every 5 seconds
- Leader holds the lock, others wait
- On leader crash, lock released by Postgres after connection timeout
- Pros: no extra infra, simple, Postgres is already our source of truth

**Approach B: Raft via etcd**
- Run a 3-node etcd cluster alongside the app
- Use etcd's built-in lease + election primitives
- Pros: purpose-built, split-brain resistant, faster failover
- Cons: additional infra to manage

---

## Judge Analysis

### Consensus (found by all 3 reviewers)

| # | Finding | Weight |
|---|---------|--------|
| 1 | **etcd/Raft is the correct choice** for production — advisory locks are insufficient for correctness under network partitions | **Critical** |
| 2 | PostgreSQL advisory locks have a **fundamental split-brain vulnerability**: a network partition can isolate the leader from Postgres but not crash it, leaving two nodes both believing they are leader | **Critical** |
| 3 | Advisory lock failover time depends on `tcp_keepalive` / `pgbouncer` timeout — typically 60-120 seconds, which is too slow for leader-sensitive workloads | **High** |
| 4 | etcd's implementation is more complex to operate (3-node cluster, snapshot maintenance, Raft log compaction, member management) | **Operational concern** |
| 5 | Fly.io supports both approaches: Postgres via Fly Postgres, etcd via Fly machines with volume storage | **Deployment feasible** |
| 6 | For most teams, the extra operational complexity of etcd is worth the correctness guarantee | **Recommendation** |
| 7 | If the cluster has <3 nodes or can tolerate 2-minute failover, advisory locks are a pragmatic starting point | **Context-dependent** |

### Contradictions (models disagreed on key points)

| Topic | DeepSeek | MiniMax | Gemini Flash |
|-------|----------|---------|-------------|
| **Failover time minimum** | ~10-15s with aggressive `tcp_keepalive` tuning | ~~60-120s (Postgres default) — cannot safely go lower without risking false positives~~ | ~30-60s in practice due to at-least-one-ACK delay |
| **Operational cost of etcd** | Moderate — 3 nodes with persistent volumes, well-documented | High — snapshot compaction, defrag, member replacement are significant ongoing burdens | Moderate — Fly.io volume management adds complexity, but managed etcd exists |
| **When advisory locks are acceptable** | Only for dev/staging or non-critical singleton workloads | Acceptable for deployments where >30s failover is tolerated | Acceptable for teams that can't operate etcd, with a documented split-brain risk |
| **Split-brain in practice** | Realistic threat — asymmetric partition causes exactly the problematic scenario | Less likely in single-region Fly.io (strong network guarantees within region) | Realistic if cross-region; less likely single-region but still possible |

> **Insight from contradictions:** The models disagreed most sharply on *practical risk* (how likely is the partition scenario) vs *theoretical risk* (can it happen). This is exactly the kind of engineering judgment call that benefits from multiple independent perspectives.

### Partial Coverage (points only some models raised)

| Models | Point |
|--------|-------|
| DeepSeek, MiniMax | PostgreSQL connection pooling (PgBouncer) adds a layer that prevents session-scoped advisory locks from working correctly — the lock is held by the PgBouncer connection, not the application |
| DeepSeek, Gemini | Alternative hybrid: use PostgreSQL `LISTEN`/`NOTIFY` with advisory locks for faster detection |
| MiniMax, Gemini | etcd's lease TTL must be tuned: too short (falsely evicts healthy leaders), too long (slow failover) |
| DeepSeek | pg_try_advisory_lock is non-blocking, requiring polling — this wastes CPU and adds latency compared to etcd's blocking watch |
| MiniMax | Backup etcd disaster recovery is non-trivial: snapshot corruption, cluster rebuild from snapshot, quorum loss scenarios |
| Gemini | Fly.io's 6-node machine limit per app might constrain etcd cluster sizing |

### Unique Insights (raised by only one model)

1. **DeepSeek**: PostgreSQL advisory locks are session-scoped — they are automatically released when the database connection closes, including unexpected disconnects. This means a brief network blip between the leader and Postgres releases the lock even if the leader is still running, causing an election storm.
2. **DeepSeek**: "Keepalive tuning is a double-edged sword" — aggressive `tcp_keepalive` settings reduce failover time but increase false-positive leader evictions, creating a thundering-herd problem where all followers race to acquire the lock simultaneously.
3. **MiniMax**: The operational cost of etcd is often underestimated — Raft log compaction must be configured for the workload size, etcd member replacement requires careful procedure, and etcd backups are not point-in-time like Postgres.
4. **MiniMax**: For Fly.io specifically, sticky sessions and connection routing must be configured carefully for the etcd cluster — Fly's anycast routing can cause etcd member communication issues if not explicitly pinned to specific machines via `fly.toml` process groups.
5. **Gemini Flash**: Proposed a pragmatic migration path: start with advisory locks, add a health-check metric that measures actual failover time, then migrate to etcd when the team has capacity — the dead reckoning of the failover window.

### Blind Spots (found by NO model — surfaced by judge)

| # | Blind Spot | Why It Matters |
|---|------------|----------------|
| 1 | **No model mentioned testing strategies** — how to validate failure modes (network partitions, node crashes, slow connections) in a CI-like environment for either approach | A production leader election needs chaos engineering, not just selection |
| 2 | No discussion of the application's leader sensitivity — what breaks if there are two leaders (data corruption, duplicate work, nothing) | The risk assessment is meaningless without knowing the cost of a split-brain |
| 3 | No discussion of Cross-region Fly.io deployment — multi-region significantly changes the partition analysis and latency profile | The prompt said "5-node Fly.io cluster" but didn't specify single-region vs multi-region |
| 4 | No comparison of managed alternatives — Fly.io doesn't offer managed etcd, but other providers (DigitalOcean, AWS, GCP) do, and the comparison changes | The decision might be "use managed etcd on another provider" vs "self-manage on Fly.io" |
| 5 | No model considered a zero-infra alternative: can the application use a simpler mechanism like a shared filesystem lock (Fly.io volumes) or PostgreSQL's `FOR UPDATE NOWAIT` row lock? | There may be a third option that solves the correctness problem without etcd's complexity |
| 6 | No discussion of observability — what metrics to monitor for leader election health (time since last leader heartbeat, election count, lease grant rate) | Without observability, neither approach provides confidence in production |

---

## Non-Fusion vs Fusion Comparison

| Factor | Single Model (DeepSeek) | Fusion (3 models + judge) |
|--------|------------------------|---------------------------|
| Approaches evaluated | 2 (advisory locks + etcd) | **3 (both + hybrid LISTEN/NOTIFY)** |
| Failure scenarios surfaced | 2 (split-brain, connection blip) | **5 (split-brain + blip + PgBouncer + false positives + election storm)** |
| Operational concerns noted | 1 (etcd has complexity) | **5 (etcd ops + log compaction + backup + member replacement + Fly routing)** |
| Practical migration path | None | **1 (start with locks, measure, migrate)** |
| Blind spots surfaced | 0 | **6 (testing, leader sensitivity, cross-region, managed alt, zero-infra alt, observability)** |
| Unique insights | 2 (connection blip, keepalive double-edge) | **5 (all of single + 3 new from MiniMax/Gemini)** |
| Cost | ~$0.006 | ~$0.022 |
| Time | 45.7s | 114.7s |

**Bottom line:** A single model gives a solid recommendation (use etcd). Fusion gives the recommendation **plus** the reasoning to defend it under scrutiny: specific failure scenarios, operational costs, deployment details, and — most critically — what you give up by choosing the simpler option. The 6 blind spots surfaced by the judge cover the exact areas a production team would discover through painful incidents: testing, observability, the cost of split-brain in *this* application, and cross-region deployment.

---

## The Recommendation (Consensus)

**Use etcd Raft for production.** PostgreSQL advisory locks have a fundamental split-brain vulnerability under network partitions that no amount of tuning can eliminate. The failover time can't safely go below ~15-30s, and the operational simplicity is an illusion — the complexity is shifted to diagnosing election storms and split-brain incidents.

For Fly.io specifically:
```
# fly.toml — etcd machines pinned to specific Fly processes
[processes]
  app = "node dist/index.js"
  etcd = "etcd --data-dir=/data"

[mounts]
  source = "etcd_data"
  destination = "/data"

[env]
  ETCD_NAME = "etcd-{{ $FLY_ALLOC_ID }}"
  ETCD_INITIAL_CLUSTER = "..."
```

**When advisory locks make sense:**
- Dev/staging environments where failover correctness doesn't matter
- Non-critical singleton workloads (cron job coordination, cache warming)
- Teams that cannot operate etcd and accept the split-brain risk
- <3 node clusters (etcd requires 3 for quorum)
- When >30s failover is acceptable and false-positive evictions are tolerable
