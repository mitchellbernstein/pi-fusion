# Example: PostgreSQL vs MongoDB (Degraded Path)

**Degraded deliberation** — 2 of 3 models timed out. Engine correctly falls back: returns the single successful response directly without judge synthesis.

**Prompt:**
> "Evaluate whether PostgreSQL or MongoDB is better for a multi-tenant SaaS app with 1M+ users. Consider: operational complexity, cost at scale, schema flexibility, migration path, and vendor risk. Assume we deploy on Fly.io."

**Elapsed:** 108 seconds | **Cost:** ~$0.003 (degraded)

| Model | Status |
|-------|--------|
| deepseek-v4-pro | ✅ Responded |
| MiniMax-M3 | ❌ Timeout |
| moonshotai/kimi-k2.7-code | ❌ Timeout |

---

## DeepSeek V4 Pro Response Summary

**Verdict: PostgreSQL is the strongly recommended choice.**

Key findings from the single model:

| Dimension | PostgreSQL | MongoDB |
|-----------|-----------|---------|
| **Operational complexity** | Fly.io Managed Postgres — provision and go | Self-host on Fly Machines — build your own DBaaS |
| **Cost at scale** | $282–$962/mo for 1M+ users | MongoDB Atlas is 89% more expensive than Postgres RDS in real-world comparison |
| **Schema flexibility** | JSONB covers 95% of MongoDB's flexibility use cases | Only wins for deeply nested polymorphic blobs |
| **Migration path** | Battle-tested, provider-agnostic. Move anywhere with pg_dump | SSPL license, vendor gravity toward Atlas |
| **Vendor risk** | PostgreSQL License (true open source) — zero lock-in | SSPL (not open source by OSI) — MongoDB Inc. controls the project |

**Fly.io-specific:**
- Fly.io Managed Postgres: ✅ Automatic HA, backups, scaling, 24/7 support
- MongoDB on Fly.io: ❌ No managed offering — manual replica sets, backups, failover

**Recommendation:** PostgreSQL with Row-Level Security for tenant isolation, JSONB for flexible fields, Citus if you outgrow single instance.
