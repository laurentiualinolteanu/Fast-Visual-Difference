# Sample image pair

Load `before.png` as the **before** image and `after.png` as the **after** image, then
press Compare. At the default sensitivity the app finds **four** differences.

Both images are 1280×840 and about 15 KB each.

## What changed, and why each one is here

| # | Difference | Where | Detected as |
|---|---|---|---|
| 1 | The **EXPORT** button changes colour, blue → green | bottom left of the content area | `204×60` box, 10381 changed pixels |
| 2 | The **BILLING** nav row is removed | sidebar | `86×18` box, 428 changed pixels |
| 3 | **SESSIONS** reads `1284` → `1384` | middle metric card | `29×39` box, 281 changed pixels |
| 4 | A **3×3 notification dot** appears | top right of the header | `7×7` box, 9 changed pixels |

Each is a different kind of change on purpose — a large recolour, a deletion, a
single-character edit, and something almost too small to see. Two of them are doing more
work than they look:

**The button recolour is nearly invisible to brightness.** The two colours were chosen to
have almost the same relative luma — `rgb(37, 99, 235)` measures 96.0 and
`rgb(13, 145, 66)` measures 96.5 out of 255, a difference of **0.56**. A comparison that
comes down to brightness, which a greyscale diff is, would score this at **0.109** against
a detection threshold of 163.4 and report nothing at all. The full weighted-YIQ metric
scores it at **1532**, nearly ten times the threshold. This one difference is the evidence
for choosing a perceptual colour distance over a luminance one.

**The notification dot is three pixels across.** Detecting it is the design's headline
claim; the minimum cluster size at the default sensitivity is one pixel, which is why it
survives filtering. It is also why the overlay enlarges boxes below ten screen pixels — at
the size these images are displayed the box would otherwise be smaller than its own
outline.

Everything else in the two images is byte-identical, so a false positive anywhere is a
real defect rather than noise to be explained away.

## Provenance

These are not screenshots. `generate.ts` draws them from rectangles and a 5×7 bitmap font
defined in the same file, and encodes the PNGs with `node:zlib` — no image library, no
external assets, and nothing copied from a copyrighted source.

```
npm run samples
```

Rewrites both PNGs, runs the pair through the real diff engine, prints what it found, and
then **checks the claims on this page**: four differences, none of them overlapping, at
least one under ten pixels, and no warnings. If an edit to the scene breaks any of those,
the command fails and says which one — so this page cannot quietly come to describe images
that no longer exist.

The numbers in the table are transcribed from that output by hand. The checks are what
keep them honest.
