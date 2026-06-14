# Example: React Performance Bug Hunt — `React.memo` Failure with 10K Items

**Performance bug deep-dive** — demonstrating how fusion catches optimization issues a single model might miss. 3 models independently analyzed a React component rendering 10K items; the judge synthesized 3 consensus findings, 3 contradictions, 5 blind spots, and 3 unique insights.

**Prompt:**
> "Find the performance bug in this React component. It renders a list of 10,000 items and is slow despite using React.memo..."

**Elapsed:** 138.4s | **Cost:** ~$0.024 | **Models:** 3/3

---

## The Code Under Review

```tsx
const Item = React.memo(({ item, onSelect }: { item: ItemType; onSelect: (id: string) => void }) => {
  return <div onClick={() => onSelect(item.id)} className="item">{item.name}</div>;
});

function ItemList({ items, onSelect }: { items: ItemType[]; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const filtered = items
    .filter(i => i.name.includes(filter))
    .sort((a, b) => sortDir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));

  return (
    <div>
      <input value={filter} onChange={e => setFilter(e.target.value)} />
      <button onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}>Sort</button>
      {filtered.map(item => (
        <Item key={item.id} item={item} onSelect={onSelect} />
      ))}
    </div>
  );
}
```

---

## Judge Analysis

### Consensus (found by all 3 reviewers)

| # | Finding | Severity |
|---|---------|----------|
| 1 | **Unstable `onSelect` function reference** breaks `React.memo`'s shallow prop comparison — every parent render creates a new function, making all 10K Items re-render | **Critical** |
| 2 | `React.memo` uses referential equality (`===`) on props; a new `onSelect` reference on every render is detected as a changed prop, defeating memoization | **High** |
| 3 | Fix requires stabilizing `onSelect` with `useCallback` | **High** |

### Contradictions (models disagreed on strategy)

| Topic | DeepSeek stance | Gemini Flash stance |
|-------|----------------|---------------------|
| **Where to apply useCallback** | Stabilize `onSelect` in *parent* of ItemList with empty dependency array `[]` | Wrap `onSelect` *inside* `ItemList` itself with `useCallback` depending on `[onSelectProp]` |

### Partial Coverage (points only some models raised)

| Models | Point |
|--------|-------|
| DeepSeek, MiniMax | The `filter+sort` computation runs on every keystroke over 10K items and should be wrapped in `useMemo` |
| DeepSeek, MiniMax | Rendering 10K DOM nodes is inherently expensive; list virtualization (react-window, @tanstack/virtual) is necessary for real-world scale |
| MiniMax | The filter input should be debounced (e.g., via React 18's `useDeferredValue`) |

### Unique Insights (raised by only one model)

1. **DeepSeek**: The inline arrow function `() => onSelect(item.id)` inside `Item`'s `onClick` creates a new function on every Item render. While this doesn't break `React.memo` (it's not a prop), it adds allocation overhead for any Item that does re-render.
2. **MiniMax**: Even if `React.memo` works perfectly, `ItemList` still calls `React.createElement` for all 10K Items on every render — this is CPU-intensive work that memo on children cannot prevent.
3. **Gemini Flash**: The fix can be applied entirely *within* `ItemList` by wrapping the incoming `onSelect` prop in an internal `useCallback`, keeping the stabilization local to the component rather than requiring changes in the parent.

### Blind Spots (found by NO model — surfaced by judge)

| # | Blind Spot | Why It Matters |
|---|------------|----------------|
| 1 | `items` itself could be an unstable reference (new array each parent render), causing reconciliation churn even with stable `onSelect` | A subtle parent-side issue that can completely negate memo improvements |
| 2 | React 18's `useTransition` to mark filter/sort state updates as low-priority | Keeps UI responsive during 10K-item computations — no model mentioned it |
| 3 | Even with perfect memoization, 10K DOM nodes is the **fundamental bottleneck** | Memo prevents re-renders but doesn't reduce initial DOM size — virtualization is the real answer |
| 4 | Whether `key={item.id}` is optimal for 10K scale | Correct but worth questioning at this scale |
| 5 | `React.useRef` + forced update pattern as an alternative callback stabilization strategy | An alternative to `useCallback` that avoids dependency arrays entirely |

---

## Non-Fusion vs Fusion Comparison

| Factor | Single Model (DeepSeek) | Fusion (3 models + judge) |
|--------|------------------------|---------------------------|
| Performance issues found | 2 (unstable callback, inline onClick) | **6 (all of single + 2 partial + 1 unique)** |
| Fix strategies proposed | 1 (useCallback in parent) | **3 (useCallback in parent, in child, virtualization)** |
| Blind spots surfaced | 0 (can't self-report) | **5 (useTransition, DOM bottleneck, etc.)** |
| React 18-specific advice | None | **useDeferredValue, useTransition mentioned** |
| Time | 34.4s | 138.4s |
| Cost | ~$0.007 | ~$0.024 |

**Bottom line:** Single model found the main bug (unstable `onSelect`). Fusion found that **plus** identified the deeper issues: the 10K DOM rendering bottleneck, the need for virtualization, `useTransition` for low-priority updates, and 3 competing fix strategies. The extra $0.017 and 104s surfaced 5 blind spots that would otherwise have been discovered in production.

---

## Single Model Response (DeepSeek V4 Pro — 34.4s, ~$0.007)

Found the unstable `onSelect` reference and recommended `useCallback`. Also identified the `filter+sort` should be wrapped in `useMemo`. Missed the DOM node bottleneck entirely.

## What Fusion Added

1. **Blind spot #3 (10K DOM nodes is the bottleneck)** — this is the real-world performance issue at scale. Memo only prevents re-renders; 10K nodes still mount and block the main thread.
2. **Blind spot #2 (useTransition)** — React 18's concurrent features can mark the filter/sort update as low-priority, keeping the input responsive.
3. **Contradiction: where to apply useCallback** — the parent vs child debate is a real architectural choice. Fusing it gives the developer both perspectives.
4. **MiniMax's insight about `React.createElement` cost** — even with perfect memo, the framework spends CPU creating virtual DOM elements for all 10K items.
5. **3 competing fix strategies** — the developer can choose based on their specific constraints instead of following one model's recommendation blindly.
