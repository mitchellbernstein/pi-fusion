# Example: CRDT vs OT — Collaborative Text Editor Architecture Decision

**Architecture deliberation** — proving fusion surfaces tradeoffs and blind spots that a single engineer would miss when choosing between two competing approaches. Two panel models (DeepSeek V4 Pro, MiniMax M3) independently evaluated CRDT (Yjs + WebSocket) vs OT (ShareDB + SSE) for a Google-Docs-like real-time collaborative editor. The judge synthesized **11 consensus points, 4 contradictions, 9 unique insights, and 10 blind spots**.

**Prompt:**
> "Evaluate both approaches for: scalability (100+ concurrent editors per doc), implementation complexity, conflict resolution correctness, deployment on Fly.io, and how to handle reconnection. Give a concrete recommendation with reasoning. Keep analysis focused and actionable."

**Elapsed:** 154.7s | **Cost:** ~$0.02 | **Models:** 2/3 (DeepSeek V4 Pro, MiniMax M3; moonshotai/kimi-k2.7-code timed out)

---

## The Decision

**Approach A (CRDT + WebSocket):**
- Yjs CRDT for conflict-free merging
- WebSocket server (ws library) colocated in Next.js API route
- Yjs awareness protocol for cursor presence
- PostgreSQL for document persistence with periodic snapshots
- Pros: offline support, no conflicts, mature ecosystem

**Approach B (OT + Server-Sent Events):**
- Operational Transformation (OT) with share.js
- SSE for real-time updates, POST for submitting operations
- PostgreSQL as source of truth, server transforms and broadcasts
- Pros: simpler mental model, server authority, easier to debug

---

## Judge Analysis

### Consensus (11 points — both models agreed)

1. **Approach A (Yjs CRDT + WebSocket) is the recommended architecture** over Approach B (OT + SSE)
2. **Next.js 14 App Router does not natively support WebSocket upgrades** in route handlers — requires a custom server or separate process
3. **SSE alone is insufficient** for collaborative editing — unidirectional + ordering ambiguity with POST hybrid
4. **CRDTs (Yjs/YATA) provide mathematically proven conflict-free convergence** with a simpler correctness model than OT
5. **OT transformation debugging is notoriously difficult** — subtle bugs only surface under high concurrency
6. **share.js ecosystem is essentially unmaintained** — Yjs is actively maintained and battle-tested (3.6M weekly npm downloads)
7. **Yjs includes built-in awareness protocol** for cursor presence and selection — OT/SSE requires building from scratch
8. **Fly.io supports long-lived WebSocket connections natively** — good deployment target for either approach
9. **Yjs handles reconnection transparently** with automatic state sync and offline edit buffering — superior to OT
10. **PostgreSQL for document persistence** with periodic snapshots is the right choice for either approach
11. **SSE+POST hybrid fights ShareDB's design** — ShareDB expects a bidirectional message channel (WebSocket)

### Contradictions (4 points of disagreement)

| Topic | DeepSeek V4 Pro Stance | MiniMax M3 Stance |
|-------|----------------------|-------------------|
| **WebSocket placement** | Colocate with Next.js in custom `server.js` — intercept upgrade requests at `/api/collaboration`, pass rest to Next.js | **Do NOT colocate** — App Router API routes don't hold long-lived connections reliably. Run as separate Fly app or `fly.process` |
| **SSE connection limit severity** | Focuses on architectural problems of SSE+POST hybrid (ordering hazards, overhead per keystroke) | Highlights **hard 6-connection-per-origin limit** under HTTP/1.1 as deal-breaker — HTTP/2 lifts it inconsistently |
| **Recommended WS server** | `y-websocket` reference server with LevelDB + HTTP callback for PostgreSQL snapshots | **Hocuspocus** — production-grade WS server with built-in auth hooks, persistence extensions, Redis support |
| **Implementation time** | No concrete estimates | **3-5 days** for Yjs prototype, **1-2 weeks** for OT with significant correctness risk |

### Unique Insights (9 points found by only one model)

| Insight | Model | Why It Matters |
|---------|-------|----------------|
| Names **specific production-scale Yjs users** (AFFiNE, Huly, Linear, Evernote) — cites 3.6M weekly downloads | DeepSeek | Evidence that Yjs scales beyond toy projects |
| **Vercel migration risk** — custom server approach means you cannot deploy on Vercel (serverless doesn't support long-lived connections) | DeepSeek | Strategic risk that affects hosting decisions |
| **BroadcastChannel for same-browser cross-tab sync** — reconnection is effectively instant | DeepSeek | Implementation detail most engineers would miss |
| **Dual persistence layer** — LevelDB for hot state, HTTP callbacks to PostgreSQL for durable snapshots | DeepSeek | Production architecture pattern |
| **Reference to "TP1 puzzle"** — canonical OT transformation bug that's notoriously hard to catch | MiniMax | Concrete technical depth on OT correctness argument |
| **Yjs document size growth warning** — recommends garbage collection (`gc: true`) + periodic compaction jobs | MiniMax | Operational concern that surfaces only after months of use |
| **Phased 4-step implementation roadmap** — Phase 1 (y-websocket + Tiptap) through Phase 4 (PostgreSQL snapshots for history) | MiniMax | Actionable migration path, not just theory |
| **Industry trajectory** — Google Docs used OT but industry (Figma, Apple Notes, Linear) has moved to CRDTs | MiniMax | Historical context that validates the recommendation |
| **Specific Fly.io configuration** — `sticky_sessions: false`, `http_checks` for WebSocket service | MiniMax | Production deployment details |

### Blind Spots (10 points NO model addressed — surfaced by judge)

- **Concrete hosting cost estimates** for Fly.io deployment of either approach
- **Integration with NextAuth.js** or other auth libraries for securing the collaborative editing session
- **Undo/redo implementation complexity** — notoriously hard in shared editing
- **Concrete PostgreSQL schema design** for document snapshots, versions, or operational history
- **Testing strategy** — how to simulate 100+ concurrent editors, validate conflict resolution, chaos-test reconnection
- **Very large document performance** (100K+ words) — both models focused on connection count, not document size
- **Document access control or permissions** model beyond brief auth hook mentions
- **Backup, disaster recovery, and point-in-time recovery** strategies
- **No actual code snippets** — both responses remained at architectural level
- **Operational overhead management** — monitoring, logging, health checks for WebSocket tier

---

## Concrete Recommendation

Both models independently recommended **Approach A (Yjs CRDT + WebSocket)**, with one critical architectural correction: **do not colocate the WebSocket server in Next.js API routes**. Run it as a separate process.

### Implementation Blueprint (synthesized from both models)

```
┌──────────┐   WebSocket    ┌──────────────────┐   HTTP Callback   ┌────────────┐
│  Client  │◄──────────────►│  Hocuspocus /      │──────────────────►│ PostgreSQL │
│  (Yjs +  │                │   y-websocket     │  (periodic       │ (snapshots)│
│  TipTap) │                │   (separate Fly   │   snapshots)     │            │
│           │                │    process)        │                   │            │
└──────────┘                └──────────────────┘                   └────────────┘
```

| Phase | What | Time |
|-------|------|------|
| 1 | y-websocket + Tiptap/ProseMirror, single Fly app | 3-5 days |
| 2 | Hocuspocus with auth hooks and PostgreSQL persistence | 1-2 weeks |
| 3 | Redis pub/sub for multi-region scaling | 2-3 weeks |
| 4 | PostgreSQL snapshots for history/recovery | 1 week |

### When Approach B makes sense

Only if you have a **hard compliance requirement** that every operation must be validated server-side before any client sees it, and concurrency stays under ~20-30 editors per document. Even then, Yjs can work with a custom provider — it just requires more work.

---

## Why Fusion Beat a Single Model

| Category | Single Model | Two Models (Fusion) |
|----------|-------------|-------------------|
| Consensus strength | One recommendation | **11 points** of independent agreement — high confidence |
| Risk discovery | Certain risks missed (e.g., SSE 6-connection limit) | **4 contradictions** surface competing tradeoffs |
| Production depth | One set of tool recommendations | **2 competing WS servers** + deployment patterns compared |
| Blind spots | N/A (model can't report own gaps) | **10 blind spots** — every one is actionable |
| Industry context | Siloed | **9 unique insights** connect theory to real-world patterns |
| Implementation timeline | None or vague | **3-5 days vs 1-2 weeks** — specific enough to estimate |

The key finding: both models agreed on the **direction** (Yjs), but disagreed on the **implementation** (colocated vs separate, y-websocket vs Hocuspocus). The contradictions reveal a genuine engineering tradeoff, not a mistake. Without fusion, you'd get one opinion and miss the other perspective entirely.
