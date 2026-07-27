# Fast Visual Difference Detector

Loads two screenshots, finds what changed, and draws a box around each difference on both
images. Everything runs in the browser; the comparison runs in a Web Worker so the page
stays responsive.

```bash
npm install
npm run dev            # http://localhost:4200
```

Load `samples/before.png` and `samples/after.png`, press **Compare**. See
[`samples/README.md`](samples/README.md) for what changed in that pair and why.

Built with Node 22. Also: `npm test` (236 specs) · `npm run build` · `npm run samples`
(redraws the samples and re-checks the claims about them) · `npm run measure` (the table
below).

---

## How the comparison works

Four stages, each cheaper than the next, so expensive work runs on as little of the image
as possible.

1. **Tile screen** — compared 8×8 pixels at a time as 32-bit words; a tile with no differing
   byte is skipped. On the sample pair this rejects **98.7%** of the image before any
   perceptual work happens.
2. **Per-pixel scoring** — surviving tiles get a weighted YIQ distance (brightness plus two
   colour terms). Each marked pixel is checked against its 3×3 neighbourhood **in both
   directions**: dismissed as anti-aliasing or a one-pixel shift only if *both* images can
   explain it. One-directional matching silently loses *added* elements.
3. **Grouping** — marked pixels accumulate into a 4×4 cell grid and join by connected
   components, bridging 8px gaps so a changed word becomes one region, not one per stroke.
4. **Merging** — regions within 16px merge, pad by 2px, sort largest-first and cap.
   Dimension mismatches are reported separately as amber bands.

**Why YIQ rather than brightness.** The sample pair's button goes from `rgb(37,99,235)` to
`rgb(13,145,66)` — two colours of almost identical brightness, 96.0 against 96.5 out of 255.
A brightness-only comparison scores it at **0.109** against a threshold of 163.4 — nothing
at all. Weighted YIQ scores it at **1532**, ten times the threshold. (`npm run measure`
prints all four figures.)

---

## Sensitivity

One slider, 1–10, default 6, which states what it means as you move it:

> Sensitivity 6/10 · detects brightness/colour steps of about 18/255 · min cluster 1 px

Both numbers come from the function the engine actually uses, so the display cannot drift
from what is applied. At the default the minimum cluster is **one pixel** — which is why
the 3×3 dot in the sample pair is found.

The checkbox beside it (*Ignore anti-aliasing & 1px shifts*) controls stage 2's suppression
and is on by default. Changing either setting marks the result stale rather than silently
recomputing.

---

## How processing time is measured

`// PERFORMANCE_TIMER_START` and `// PERFORMANCE_TIMER_END` sit in one method,
[`onCompare`](src/app/features/compare/compare-page.component.ts), with nothing between
them but the call chain. The end marker follows a double `requestAnimationFrame`, so it
fires once the frame containing the boxes has been composited — not a frame early.

**Decoding happens when you pick a file, not when you press Compare — and the app shows you
that number.** Decoding a PNG is the most expensive operation here. Doing it at file-pick
time is better for the user, who chose the files seconds earlier while the app sat idle, and
it removes the dominant cost from the measured window. So the results panel reports both:

> **Loaded:** before 1280×840 (6.1 ms) · after 1280×840 (5.6 ms) &nbsp; decode, at load —
> outside the measured comparison<br>
> **Compared:** 2 differences in 24 ms &nbsp; click to painted boxes

The headline is click-to-painted-boxes — the *larger* figure; the engine total sits beneath
it. The app's clock starts one statement before `PERFORMANCE_TIMER_START` and is read one
after `PERFORMANCE_TIMER_END`, so it can never report a shorter interval than the markers
bracket. **It remains advisory:** one run, one machine, one browser — not a benchmark.

---

## Measured results

From `npm run measure` (engine, Node) and `npm test` (click-to-paint, real browser and real
Worker). **Machine: Intel Core i7-13620H, 16 threads, Windows x64, Node 22.18, 16 GB.**
Engine figures are the median of 7 runs after 2 warm-ups.

| case | MP | tiles kept | changed px | boxes | engine |
|---|---|---|---|---|---|
| identical images | 1.08 | 0.0% | 0 | 0 | 2.1 ms |
| one digit changed | 1.08 | 0.1% | 281 | 1 | 1.7 ms |
| one word changed (4 glyphs) | 1.08 | 0.4% | 1 427 | 1 | 2.1 ms |
| the sample pair | 1.08 | 1.3% | 11 099 | 4 | 3.6 ms |
| 2× capture, 2560×1680 | 4.30 | 1.2% | 44 543 | 4 | 13.3 ms |
| 3× capture, 3840×2520 | 9.68 | 1.2% | 100 323 | 4 | 29.3 ms |
| every pixel changed | 1.08 | 100% | 1 075 200 | 1 | 65.9 ms |

In-browser at 1280×840: engine **7.5 ms**, **click-to-paint 19–24 ms** across runs, decode
**5.6–6.1 ms** per image at load, 177 of 16 800 tiles reaching stage 2.

**Suppression against real rendered text** — 26 lines of anti-aliased text compared with the
same text re-rendered at an offset:

| offset | suppression off | suppression on |
|---|---|---|
| none | 0 changed px | 0 changed px |
| **1 pixel** | 79 716 changed px, 1 box | **0 changed px, 0 boxes** |
| 0.3 pixel | 53 612 changed px, 1 box | 38 584 changed px, 1 box |

A one-pixel reflow of a page of text moves nearly eighty thousand pixels; with suppression
on the app reports none of them. A *subpixel* re-render is not handled — see below.

---

## Known limitations

- **Sub-pixel re-rendering causes false positives.** Suppression seeks a *matching* pixel in
  the 3×3 neighbourhood: a whole-pixel shift puts an exact match one cell across, a
  fractional shift blends every pixel so none exists. Captures at different DPI scaling or
  font hinting will report text as changed — 38 584 pixels survived a 0.3px offset above.
- **One-pixel translations are suppressed by default** — the feature working as designed.
  To catch a one-pixel nudge, turn the checkbox off.
- **No global alignment.** Pixel (x, y) is compared with pixel (x, y); a shifted or scaled
  pair reads as changed nearly everywhere. Past 25% changed pixels the engine stops
  refining, says so, and returns coarse boxes rather than a wall of them.
- **Different sizes are compared top-left anchored.** Only the overlap is compared, the rest
  marked with amber bands. If the true relationship is centred, that is the wrong
  intersection.
- **No cancellation.** The worker owns the pixel buffers, so terminating it would destroy
  them; Compare is disabled while a run is in flight instead.
- **Memory is not reclaimed** — the worker holds both images until a slot is replaced, about
  610 MB for a pair of 80 MP images. Above 80 MP the app warns and proceeds.
- **Box accuracy is not scored against ground truth.** No IoU measure; geometry is asserted
  against hand-computed expectations for synthetic cases only.
- **What was measured is narrower than the general claim** — every pair above is drawn
  programmatically or rendered by one browser on one machine. No real screenshot, no JPEG,
  no second machine.
- **No end-to-end test drives a real mouse.** The integration test uses real files, the real
  service and a real Worker, but calls component methods rather than clicking.

---

## Why there is no backend

The brief measures the interval from clicking Compare to the boxes appearing. Uploading two
images puts the network on that critical path and makes the measured number mostly transfer
time. Running in the browser removes it, and a Web Worker (27 lines, mostly comment) keeps the UI
responsive.

The engine is isolated in [`src/app/core/diff/`](src/app/core/diff/): pure functions over
`{width, height, data}`, importing nothing from Angular, the DOM or the worker API. Moving
it behind a Java service would be a transcription of those files plus one changed method in
`diff.service.ts`; no component would change. The build confirms the separation — the engine
appears in the worker chunk and in no other bundle. Production build: 571 kB raw,
**125 kB transferred**.

---

## AI tools used

Claude (Anthropic) was used as a pair-programming assistant throughout: architecture,
implementation, tests, the tuning pass and this document. Work ran task by task against a
written backlog, each task reviewed against its acceptance criteria before the next began.

Two findings here came from that loop rather than the original design, and both changed the
code: the merge distance was raised from 8px to 16px after measurement showed one changed
digit reported as four marks on any 2× capture, and the sub-pixel limitation was found by
writing a test that asserted suppression would handle it, then watching it fail.
