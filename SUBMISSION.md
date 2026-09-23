# Submission

Keep this tight. Bullet points are fine. We read this before we read your code,
and a clear account of your reasoning carries real weight — including where you
chose not to do something.

## Video walkthrough

Paste your Loom (or equivalent) link here. 5–10 minutes.

**Link:** https://drive.google.com/file/d/1ovlV9anTqDm3WXjXpmfmNXxP2IEwdB3l/view?usp=sharing

---

## How to run it

Anything we need to know beyond `npm install && npm run dev`.

- Nothing

## Time spent

Roughly, and how you split it.
16th Sep, 2026 - 1 hr
18th Sep, 2026 - 2 hrs
20th Sep, 2026 - 1 hr
21st Sep, 2026 - 2 hrs
22nd Sep, 2026 - 3 hrs
23rd Sep, 2026 - 2 hrs

---

## Baseline defects found

| # | Defect | Where | Fixed / left / out of scope |
| --- | --- | --- | --- |
| 1 | No request cancellation / race protection — a slow response for an earlier search query could overwrite a newer one | `useAssets.ts`, `client.ts` | Fixed |
| 2 | No debounce/throttle on search input — every keystroke fired a request, risking the rate limit | `useDebouncedValue.ts`, `useUrlQuery.ts` | Fixed |
| 3 | Query state (`q`, `status`, `sort`) lived only in React state, not the URL — reload/share lost the view | `useUrlQuery.ts` | Fixed |
| 4 | No de-duplication of identical concurrent GET requests | `client.ts` | Fixed |
| 5 | Errors flattened into an unstructured string (`"503: message"`), blocking structural retry logic later | `client.ts` | Fixed |
| 6 | Loading, empty, and error states were visually/structurally indistinguishable | `AssetGrid.tsx`, `App.tsx`, `styles.css` | Fixed |
| 7 | No pagination / infinite scroll — only a single page of results was ever fetched | `useAssets.ts` | Fixed |
| 8 | Every card re-rendered on any selection change — no per-card memoization | `AssetGrid.tsx` | Fixed |
| 9 | No virtualization — every asset in view got a DOM node | `AssetGrid.tsx` | Fixed |
| 10 | Thumbnails weren't lazy-loaded | `AssetGrid.tsx` | Fixed, then superseded — `loading="lazy"` was added, later deliberately removed since virtualization already means only on-screen rows ever mount |
| 11 | `applyBulkStatus` sent every selected id in a single request — failed outright above 50 selections (calibration example from the brief) | `useBulkStatusAction.ts` | Fixed |
| 12 | Bulk result handling was all-or-nothing — per-id outcomes (`BulkResult.results`) were fetched but never read | `useBulkStatusAction.ts` | Fixed |
| 13 | No optimistic update on bulk status change — grid didn't reflect a change until (if) a refetch happened | `useAssets.ts`, `useBulkStatusAction.ts` | Fixed |
| 14 | List was never told about single-asset saves — grid showed stale data after an edit in the detail panel | `App.tsx` (`handleSaved`) | Fixed |
| 15 | `409 version_conflict` on single-asset save wasn't handled specially — fell into the generic error path | `AssetDetail.tsx` | Fixed |
| 16 | No range selection — only single-item toggle existed, no shift-click extend or select-all-loaded | `useSelection.ts` | Fixed |
| 17 | No retry logic for transient failures (`503`, `429`, network error) — `ApiError.retryable`/`retryAfterSeconds` exist but nothing consumes them yet | `client.ts` | Knowingly left (planned for Task 4) |
| 18 | No offline detection — a dropped connection just looks like a wall of failed requests with no explanation | *(absent from codebase)* | Knowingly left (planned for Task 4) |
| 19 | No error boundary — a thrown render error would blank the whole page | *(absent from codebase)* | Knowingly left (planned for Task 4) |
| 20 | `useEffect` dependency is `JSON.stringify(query)`, recomputed every render — cheap today, but a smell that will compound as query state grows | `useAssets.ts` | Knowingly left |
| 21 | Grid cards aren't keyboard operable — no `tabIndex`, no key handlers | `AssetGrid.tsx` | Out of scope (planned for Task 5) |
| 22 | No roving tabindex / grid semantics (`role="grid"`, arrow-key nav) | `AssetGrid.tsx` | Out of scope (planned for Task 5) |
| 23 | Focus not managed when the detail panel opens/closes; no `Escape` handler | `App.tsx`, `AssetDetail.tsx` | Out of scope (planned for Task 5) |
| 24 | No live region for result counts, bulk outcomes, or errors | `App.tsx` | Out of scope (planned for Task 5) |
| 25 | Selection checkbox had no accessible name | `AssetGrid.tsx` | Fixed — picked up as a side effect of the shift-click wiring fix (`aria-label` added to the checkbox) |
| 26 | Thumbnail `alt=""` on a decorative image | `AssetGrid.tsx` | Not a defect — kept deliberately; the asset name is already shown as text, so an empty `alt` is the correct pattern, not an oversight |
| 27 | Status is carried by color alone in places (e.g. `.pill--archived` only changes text color) | `styles.css` | Out of scope (planned for Task 6) |
| 28 | `formatBytes` display precision is inconsistent right at unit boundaries (e.g. `10 KB` vs `10.0 MB`) | `format.ts` | Knowingly left — minor, cosmetic, low priority |

---

## Key decisions

For each significant choice: what you did, what you rejected, and why. Three to
six of these is about right.

**Data fetching and caching**
I didn't reach for TanStack Query or SWR. The API here is deliberately unreliable in specific, unusual ways (stale-cursor rejection, per-request rate limiting, retry-unsafe writes), so I wanted full control over exactly when a request fires, when it's cancelled, and when it's retried, rather than working around a caching library's own assumptions. All fetching goes through one small `client.ts` wrapper that adds typed errors, cancellation, and de-duplication of identical in-flight GETs. It's more code than pulling in a library.

**Stale response handling**
Every list fetch carries an `AbortController` plus a "generation" counter, so a slow response for an old query can never overwrite a newer one, even if it isn't cancelled in time. I also found and fixed a real bug here: React Strict Mode double-fires effects on mount, and my first attempt at de-duplicating identical requests let one of those two fake requests steal and cancel the other's real network call — leaving the page stuck loading forever. Took two wrong fixes before landing on one that's actually correct (verified against the live API, not just by reading the code).

**Virtualization approach**
Started with `@tanstack/react-virtual`, but it's list-oriented, so I had to hand-roll column counting and row-height math to make it work as a responsive grid. That hand-rolled layer turned out to be fragile and hard to test. Switched to `react-virtuoso`'s `VirtuosoGrid`, which is built specifically for this and handles the column/row logic itself. Costs more bundle size (68.8kB gzipped vs. the 48kB baseline), but it's less custom code and more likely to be correct.

**Optimistic updates and rollback**
`useAssets` exposes two functions: one applies a field change to selected items immediately, before the server responds; one replaces items with the server's real object, used to confirm a success (syncing the updated version number, so a later single-asset edit doesn't incorrectly conflict against a version that was never updated) and to revert a failure to its exact original snapshot. Selection supports click and shift-click range-select. Bulk requests are chunked to the API's 50-id cap and run with bounded concurrency (4 at a time), not all at once, and each chunk catches its own failure so one bad chunk doesn't take down others that would have succeeded. The two failure types get different treatment: legal_hold is permanent and never offered a retry; conflict (~7% random) is retried on request. Verified live against the real API, including a genuine legal-hold-tagged asset and a real two-tab 409 version_conflict.

**Retry and backoff policy**
Not built yet — this is Task 4. The groundwork is already in place, though: every error from the API carries a `retryable` flag and a parsed `retryAfterSeconds`, computed structurally from the HTTP status code, not from matching error message text. Nothing calls them yet.

**State placement and URL sync**
Search, status filters, and sort live in the URL, not just component state, so a reload or a shared link restores the same view. I used `history.replaceState` everywhere, never `pushState` — otherwise every debounced keystroke would add a new browser-history entry, and the back button would step through search history one character at a time instead of just leaving the app. Search input is debounced at 350ms before it touches the network or the URL, chosen because normal typing has shorter gaps than that, so it reads as "done typing," not laggy.

---

## Performance

Fill in real measurements, not estimates. Say which machine and browser.

| Metric | Before | After | How measured |
| --- | --- | --- | --- |
| Rendered DOM nodes at 5,000 rows loaded | 5000 | 24 | document.querySelectorAll('.card').length |
| Cards re-rendered when toggling one selection | - | None | React Profiler - FlameGraph: showed one AssetCard on click of the selection box of one card |
| Longest task during sustained scroll | Not measured | 52.07ms (one isolated task, flagged by DevTools as "Long task") | Chrome DevTools Performance tab(240 rows) |
| Requests fired while typing a 6-character query | 5 | 1 | The API calls made while typing |
| Production bundle, gzipped | 48 kB (baseline) | 70.2 kB (68.84 kB JS + 1.36 kB CSS) | `npm run build`, Vite's own build output |

What was the actual bottleneck, and how did you find it?

- One 52ms task was found via Chrome DevTools' Performance panel during active scrolling, exceeding the 50ms budget by a small margin. Given the task's own code only accounted for 63μs of the 52ms, the actual cost was almost certainly downstream browser work (layout/paint) triggered by the task, not application logic — consistent with a single virtualization row-measurement pass rather than a systemic issue. Not root-caused further given time constraints.

---

## Accessibility

- Keyboard model you implemented, in one paragraph.
- How you tested it, including any screen reader.
- Known gaps.

Not implemented. Deprioritized deliberately, per the brief's own suggested task order (0→1→2→3→4→5→6) and its explicit guidance that depth on fewer tasks beats shallow coverage of all seven — Tasks 0-3 took the full time budget to do properly, including finding and fixing several real bugs along the way (documented in Key Decisions).

Known gaps, already listed in the defect inventory (#21-24): grid cards aren't keyboard-operable, no roving tabindex or grid semantics, no focus management on the detail panel (no focus-in on open, no focus-return on close, no Escape handler), no live region for result counts or bulk-action outcomes.

One incidental a11y fix did land: the selection checkbox gained an `aria-label` as a side effect of rewriting its click handling for shift-click support (defect #25) — not a deliberate accessibility pass, but worth noting since it's a real, if small, improvement.

If I had another day, this is where I'd go first — of everything left undone, keyboard/screen-reader support is the one the brief frames as non-negotiable ("one of the people in this brief is not optional"), and I'd want to be honest that I didn't get there.

---

## Interface decisions

Three or four sentences: what you were optimising for, and the decisions that
follow from it. Then briefly:

- **Visual system.** A stable placeholder icon replaces the browser's broken-image glyph for the ~4% of assets with no thumbnail, with layout space reserved so nothing shifts.
- **Status treatment.** Still colour-only in places (e.g. `.pill--archived`) — defect #27, left open. No progression treatment across draft → in review → approved → archived was designed.
- **States.** Loading, empty, and error are now visually distinct (defect #6) — error text uses the danger color and bold weight, loading is muted, empty is neutral. Bulk partial-failure results get a distinct warm background (`.notice--partial`) so a mixed-success result doesn't read as a plain success.
- **Contrast.** Not checked against WCAG AA — no tooling run, no manual audit.
- **Copy.** Not rewritten. Error messages are still the raw API text (e.g. "Search index is warming up.")

If continuing, I'd start from the four-state status progression and a real contrast check, since those are the two most visible, most-graded pieces I skipped entirely.

Screenshots in the repo are welcome — link them here.

---

## Trade-offs and cuts

What you deliberately did not do, and what you would do with another day.

**Deprioritized entirely:** Task 5 (keyboard/screen reader) and Task 6 (visual design), per the brief's own priority ordering — chose depth on Tasks 0-3 over shallow coverage of all seven.

**Partially scaffolded, not finished:** Task 4. Every `ApiError` already carries a structural `retryable` flag and parsed `retryAfterSeconds`, computed from the HTTP status code rather than string-matching — but nothing consumes them yet. No retry/backoff, no offline detection, no error boundary.

**Time spent on things that weren't strictly required, but were worth it:** a real React Strict Mode race condition in the request-deduplication layer took two wrong fixes before landing on a correct one, verified against the live API rather than assumed from reading the code. In hindsight, a separate, unrelated Chromium repaint bug in the card grid CSS ate more debugging time than its actual importance justified — a Task 6 polish item, not a Task 1-3 correctness issue — and I'd timebox that kind of investigation harder next time rather than chase it to full resolution before moving on.

**Testing gap, not a functionality gap:** virtualization-dependent behavior (bounded DOM node count while scrolling, true per-card re-render isolation, scroll position surviving panel toggle) couldn't be reliably automated — jsdom has no real layout engine, and I confirmed this by hitting `ResizeObserver`/`offsetWidth`/`requestAnimationFrame` gaps with two different virtualization libraries. Verified these manually in the browser instead, per the brief's own suggested method (React DevTools Profiler), rather than shipping a flaky or misleading automated test.

**With another day**, in order: keyboard navigation + roving tabindex (biggest single accessibility win for the least code), then retry/backoff + offline detection (Task 4's core), then a real visual pass on status progression and contrast (Task 6).

## Critique of the API

**Inconsistent optimistic-concurrency model between endpoints.** Single-asset `PATCH` requires a `version` and returns `409 version_conflict` on staleness. Bulk `POST /api/assets/bulk-status` takes no version at all, yet does bump the version server-side on success. This forced the client to manually resync each successfully-updated item's returned `asset` object after every bulk action — skip that, and a later single-asset edit on the same item would incorrectly 409 against a version the client never knew had changed. A bulk endpoint that optionally accepted per-id versions (or at minimum, always echoed the updated object either way) would make this contract self-describing instead of something the client has to know to defend against.

**Per-id bulk failures aren't self-describing as retryable or not.** `BulkResult.results` returns a failure `code` (`legal_hold`, `conflict`, `not_found`) but not whether retrying is worth attempting. The client has to hardcode that classification (`conflict` — transient, worth retrying; `legal_hold`/`not_found` — permanent, don't bother) from reading the docs rather than from the response itself. A `retryable: boolean` field alongside each failure would remove that guesswork and make the API's own intent explicit, rather than baking server-side knowledge into client-side logic that could silently drift if the server's behavior ever changes.

**The mock API's deployment shape works against the brief's own "deployed link" ask.** It's a stateful, long-running Node process with in-memory data — reasonable for local dev, but not serverless-friendly, which makes fully satisfying "a deployed link will be appreciated" harder than it needs to be for a frontend-focused assessment. A stateless or serverless-compatible reference backend (or at least documented deployment guidance) would remove an entire category of unrelated infrastructure work from a frontend assessment.

## Anything you would like us to look at

Code you are proud of, or a decision you are unsure about and want to discuss.
