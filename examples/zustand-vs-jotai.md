# Example: Zustand vs Jotai for Next.js 14 with RSC

**Full 3-model deliberation** — all panel models responded, judge synthesized structured analysis.

**Prompt:**
> "Is Zustand or Jotai better for a Next.js 14 app with React Server Components? Consider: bundle size, TypeScript DX, RSC compatibility, and ecosystem."

**Elapsed:** 137 seconds | **Cost:** ~$0.01

---

## Judge Analysis

### Consensus (8 points)

All three models independently agreed:

1. Neither Zustand nor Jotai can manage server-side state in React Server Components — both must be used exclusively in `'use client'` components
2. Module-level singleton stores in either library cause cross-request data leakage in SSR/RSC environments when not properly scoped
3. Both libraries require a Provider/Context pattern in Next.js App Router to scope state to individual requests
4. Zustand has a significantly larger ecosystem: higher weekly downloads (~35-37M vs ~3.7-4.4M), more GitHub stars (~58k vs ~21k)
5. Zustand has a smaller bundle size than Jotai (all models agree on this direction)
6. Jotai offers better automatic type inference and requires less boilerplate for derived/computed state
7. Jotai provides automatic fine-grained re-render optimization by atom subscription, while Zustand requires manual selector discipline
8. For a typical Next.js 14 app with RSC, Zustand is the "safer default" or most commonly recommended general-purpose pick

### Contradictions (3)

**1. RSC safety and compatibility winner**
- DeepSeek: Jotai is the clear winner — its Provider-first model makes cross-request contamination "much harder to accidentally introduce"
- MiniMax: Roughly tied. Jotai's useHydrateAtoms is "more powerful but has more ways to subtly desync"
- Kimi: No real winner. Both are unsafe as global server state and both work well on the client side with proper Provider setup.

**2. Bundle size significance**
- DeepSeek: Zustand ~486B–3KB, Jotai ~3.8–4KB. Meaningful difference.
- MiniMax: Zustand ~3KB, Jotai ~4KB. "Practically a tie" — 1KB difference is irrelevant.
- Kimi: Zustand ~1.1KB, Jotai ~2.9KB. Zustand is "meaningfully smaller."

**3. TypeScript DX winner**
- DeepSeek: Slight edge to Jotai, but Zustand's explicitness is a benefit for larger teams.
- MiniMax: No clear winner — different strengths for different team preferences.
- Kimi: Slight winner is Jotai for "pure type ergonomics."

### Blind Spots (8)

Key aspects NO model addressed:
- Tree-shaking behavior in detail
- Integration with Next.js-specific patterns (loading.tsx, error.tsx, parallel routes)
- Interaction with Next.js caching layers
- React Forget compiler impact on external state libraries
- Core Web Vitals impact beyond raw bundle size
- Bundle cost with popular middleware included
- Learning curve for teams from different backgrounds
- Interaction with Next.js 14's Partial Prerendering (PPR)

### Unique Insights (3)

- **DeepSeek**: Both libraries created by the same developer (Daishi Kato) — choice is architectural philosophy, not quality
- **MiniMax**: Recommends using both libraries together as a valid production pattern
- **Kimi**: Mentions jotai-ssr community package with streaming RSC hydration support
