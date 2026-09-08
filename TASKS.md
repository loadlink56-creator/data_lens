# DATA LENS — Master Prompt Implementation Tracker

Source spec: `data-lens-advanced-master-implementation-prompt.md` (104 tasks).
This file is the resumable source of truth. Update it at the end of every
work session so a future session can pick up exactly where this one left off.

## Architecture reality check (read this first)

The spec is written for a full-stack production platform: backend framework,
database, ORM, job queue, auth, server-rendered PDF. The actual deliverable
is a **static client-side site** (HTML/CSS/vanilla JS + GSAP), no server.

Reconciliation:
- **Buildable honestly, client-side, now:** ingestion, schema/semantic typing,
  deep profiling, EDA (uni/bi/multivariate within reason), outliers,
  missingness structure, relationship discovery + graph, rules engine,
  quality/risk scoring, PII, ML readiness, comparison between two loaded
  datasets, insight/recommendation generation, a grounded Copilot (pattern
  Q&A over the real computed model, never invents facts), report export
  (HTML/JSON/CSV/Markdown + browser print-to-PDF), chart gallery, diagrams.
- **Persistence:** `localStorage`/IndexedDB stands in for a database —
  genuinely persists across reloads on one device, but is not multi-user
  and has no server-side durability.
- **Explicitly out of scope, flagged rather than faked:** authentication,
  server-side background job workers, true multi-user/versioned storage,
  network security hardening (upload limits etc. — irrelevant with no
  upload), SQL execution (Copilot can *generate* SQL text, never run it).
- **"Async pipeline"** = real non-blocking chunked work via
  `requestAnimationFrame`/`setTimeout`, with genuine PENDING/RUNNING/
  COMPLETE/WARNING/FAILED stage states — not a distributed queue.

## Status legend
`DONE` implemented + verified · `WIP` in progress · `PLANNED` not started ·
`OUT-OF-SCOPE` flagged, will not build (reason given)

---

## Session 1 (this session)

### Immediate user requests — DONE, verified
- [x] Task 66/68/78 — **persistent icon navbar inside Schema Analyser**
      (6 section tabs, hero-style active glow)
- [x] Task 79 — **lens-convergence entrance animation** on first open
- [x] **Session 2**: top nav rebuilt from a single lone "Schema Analyser"
      pill into a full 7-item pipeline bar — Schema Analyser, Column
      Profiler, Relationship Mapper, Statistics Lab, Chart Studio, Report
      Builder, AI Agent — matching the reference screenshot's pill style,
      active tab gets the amber gradient treatment used elsewhere.

### Session 2 — five workspaces built, all reading one shared analysis cache
Architecture: `assets/dl-report.js` computes `SchemaEngine.analyse(model)`
once and caches it (invalidated whenever the loaded data changes); every
workspace below reads the SAME object rather than recomputing — this is
literally Task 1/2's "one unified analytical engine, canonical dataset
model" principle, honestly implemented client-side.

- [x] Task 6-8, 9, 72 (partial) — **Column Profiler**: two-pane layout
      (searchable column list left, deep profile right), now with per-kind
      advanced profiling (numeric/categorical/text/temporal — see Session 12).
      Not yet built: per-column relationship/PII/rules sub-tabs (Task 72
      lists ten; four are live) and violin plots (skipped as redundant with
      box plot + KDE, which are both built).
- [x] Task 75 (honest scope) — **Relationship Mapper**: the existing node
      canvas already IS this — the nav item closes overlays, fits the view,
      and pulses the canvas rather than duplicating a second graph UI.
- [x] Task 20 (partial), 16 — **Statistics Lab**: descriptive statistics
      table for every numeric column; real Pearson correlation heatmap
      per sheet; group comparison (pick category + measure) with real
      per-group mean/median/sd, and for exactly 2 groups a Welch's-t
      statistic + Cohen's d + a normal-approximation p-value, explicitly
      labelled "approximate" per Task 92. Not yet built: Mann-Whitney,
      ANOVA/Kruskal-Wallis for 3+ groups (currently shows descriptive-only
      with an honest note), regression, chi-square, Spearman/Kendall.
- [x] Task 28/29/31 (partial) — **Chart Studio**: table/type/X/Y pickers,
      four real chart types (bar aggregate, line-by-category-mean, scatter
      with live Pearson r, histogram), "Why this chart?" caption computed
      from the actual result. Not yet built: box/violin/KDE, cross-filtering,
      save/export/fullscreen, the other ~30 chart types the spec lists.
- [x] Task 57-64 (partial) — **Report Builder**: 8-section checklist
      (cover/exec summary/overview/quality/schema/relationships/ML/
      recommendations) toggled live against the shared report, exports to
      real Markdown/JSON/HTML. Not yet built: drag-reorder, custom notes,
      logo/theme/typography choice, template save/reuse, PDF (browser
      print-to-PDF stands in — untested this session).
- [x] Task 56 — **AI Agent**: pattern-matched grounded Q&A, ~10 recognized
      intents (PII, quality issues, relationships, ML readiness, suspicious
      columns, orphan SQL generation, cleaning Python generation, health
      score, row/column counts), every answer pulls real numbers from the
      shared report. Verified: correctly says "insufficient evidence" for
      both an out-of-domain question and a real question with no supporting
      data (SQL request when zero orphans exist), rather than fabricating.

### Session 3 — Relationship Mapper canvas hardening
Stress-tested against a synthetic file matching a real reported case (6
sheets, up to 25 columns, long real-world column names). Every fix below
was verified by direct measurement/geometry check, not visual impression.

- [x] Boundary label overflow — long filenames now truncate with ellipsis
      + hover tooltip instead of bleeding out of the boundary box.
- [x] **Root-caused node overlap**: the layout estimate assumed 26px per
      row; real rendered rows are ~31px, so 20+ row sheets undercounted
      height by 100px+. Fixed with a genuine two-pass layout — estimate
      first (DOM doesn't exist yet), then a real reflow using measured
      heights once it does. User-dragged nodes are explicitly excluded
      from ever being auto-reflowed. Verified: 0 overlapping node pairs
      across 6 fixtures × 2 themes.
- [x] **Edges crossing through nodes**: replaced round-robin column
      assignment with a connectivity-aware BFS layering (linked sheets
      land in adjacent columns), and added a rigorous Liang-Barsky
      segment/AABB test — any edge whose path would cross a node it
      doesn't connect to reroutes through a dedicated lane above the
      whole diagram instead. Verified: 0 node-body crossings, computed
      in local SVG coordinate space (first attempt used mismatched
      coordinate spaces and gave a false pass — caught before reporting).
      Boundary sizing extended to contain the overhead lane so bow edges
      don't poke out of their file's box.
- [x] Sheet show/hide toggle — eye icon per sheet in the sidebar; hides
      (greys, doesn't remove) that node and every edge touching it,
      persists across drag/re-render.
- [x] 1/N cardinality badges extended from formal FK edges to
      "shared column" edges too, computed from each side's real
      uniqueness rather than left as unlabelled dots.
- [x] Canvas search (find a table/column, auto pan+zoom, match count) and
      clickable legend chips to isolate one relationship kind at a time.

### Session 4 — two more real overflow/overlap bugs, plus labelling
- [x] **A second overflow location found**: the sidebar's own filename
      header (`#fileName`, separate from the canvas boundary tab fixed
      last session) had no truncation — classic flexbox gotcha, the `b`
      element needed `min-width:0` to actually shrink below its content
      size. Fixed with ellipsis + hover tooltip; verified 0 overflow
      across 7 fixtures × 2 themes.
- [x] **Same-node edges visually merging**: when one column feeds several
      relationships at once (common in wide schema-documentation sheets),
      every edge left from the exact same pixel and stayed coincident
      until they happened to diverge. Added an anchor-fanning pass — any
      anchor shared by 2+ edges spreads them by a few px right at the
      source, capped so it never leaks into a neighbouring row. Verified
      on a real reproduction: three previously-identical Y=47 anchors now
      sit at 47/54/61.
- [x] Legend relabelled: "key link between sheets" → **Table relationship**,
      "same column in two sheets" → **Shared column**, "link inside one
      sheet" → **Column dependency** — each with a hover tooltip
      explaining the distinction in plain language.
- [x] 1/N cardinality badges — **already implemented and verified working**
      as of last session (40/40 edges on the stress file carry both
      badges); confirmed again this session rather than assumed. Bumped
      badge radius (8.5→9.5) and font-weight for legibility at the zoom
      levels real multi-sheet files get viewed at. In-sheet edges
      correctly have no badges by design (cardinality badges describe a
      relationship between two tables, not a same-sheet determination).

Regression: 0 console errors, 0 overflow across all pages × both themes;
full interaction battery (drag, edge-click panel, boundary remove,
workspace bar, search, kind filters) re-verified working together.

### Task 0 — Inspect existing project — DONE
Existing: static multi-page site (`index.html` + 8 workspace pages),
shared `assets/styles.css` + `site.js` (nav, theme, rail), `file-analyser.js`
(canvas engine: parse, type infer, relationships, drag/pan/zoom, boundaries),
`schema-engine.js` (profiling + relationship discovery), `schema-ui.js` +
`schema.css` (6-section Schema Analyser overlay + StaggeredMenu nav).
No backend, no build step, no tests, no persistence beyond theme.

### Engine work this session
- [ ] Task 8 — Advanced profiling depth (8A–8G: full numeric/categorical/
      text/date/boolean profile fields, distribution classification)
- [ ] Task 9 — Outlier engine (IQR, z-score, modified z-score/MAD)
- [ ] Task 46/47 — Quality score breakdown + Risk Center
- [ ] Task 48 — PII depth pass
- [ ] Task 49–51 — ML readiness score + leakage (have leakage; need score)
- [ ] Task 54/55 — Insight + recommendation engine
- [ ] Task 56 — Copilot (grounded Q&A over the computed model)

## Not started (planned order for future sessions)
1. Task 12–19 — Advanced EDA engine (univariate/bivariate/multivariate,
   correlation intelligence, temporal EDA, grouped EDA)
2. Task 28–33 — Visualization engine expansion + chart gallery + diagrams
3. Task 34–41 — Comparison + drift engine (two loaded datasets/snapshots)
4. Task 42–45 — Rule Studio (predefined + custom, no-code builder, chaining)
5. Task 52/53 — Data dictionary editing + schema contracts
6. Task 57–64 — Report Builder (drag-order sections, executive/technical/
   custom, HTML/JSON/CSV export, print-to-PDF)
7. Task 65–77 — App-wide IA + icon system + per-workspace layout pass
8. Task 80–86 — Cross-filtering, bookmarks, pin-to-report, saved analyses,
   sampling/caching
9. Task 87–92 — Security posture doc, error-message pass, provenance,
   no-fabrication audit
10. Task 93–101 — Test fixtures + verification passes (manual, via
    Playwright screenshots/assertions — no CI in a static site)
11. Task 102–104 — Final UX polish pass

## OUT-OF-SCOPE (flagged, will not build, with reason)
- Real authentication / multi-user accounts — no server to authenticate against
- Server-side background job workers — no server; using chunked client-side work instead
- True database persistence across devices/users — using localStorage/IndexedDB instead
- SQL execution from Copilot — Copilot generates SQL text only, never executes it
- Binary PDF generation without a server — using browser print-to-PDF instead

## Session 5 — edge fan-out, filename display, and three premium features
- [x] **Edges "becoming a single line"** — root-caused, not guessed: the
      default "straight" edge style computed lane assignments but never
      applied them, so multiple edges between the same sheet pair (common
      in wide documentation sheets) rendered as nearly-parallel straight
      lines with no separation, and their midpoint badges landed almost on
      top of each other too. Fixed by giving multi-edge pairs a gentle
      perpendicular bezier fan, spread by lane. Verified: minimum
      midpoint gap across all edges went from near-zero to ~20px on the
      busiest fixture; badge letters now individually readable per row
      even in a 20-edge cluster.
- [x] **Sidebar filename not fully visible** — the earlier ellipsis fix
      (session 4) stopped it overflowing but hid the tail of the name.
      Changed to wrap onto multiple lines instead of truncating, so the
      complete filename is always visible without needing hover.
- [x] 1/N badges — confirmed correct and legible (this was a duplicate
      report of session-4's already-fixed issue; re-verified, no new
      change needed beyond what shipped last session).
- [x] **Three premium features**, all genuinely new:
  1. **Focus + auto-fit** — selecting a table now smoothly reframes the
     view around it and everything it directly connects to, not just dims
     the rest.
  2. **Relationship-count badge** per node header — an amber pill showing
     how many relationships touch that table, so hub tables are visible
     at a glance without opening anything.
  3. **Diagram export** — a toolbar button serialises the live canvas
     (nodes, boundaries, edges, badges, labels) to a downloadable file.
     Two real bugs surfaced and were fixed during this, not glossed over:
     first attempt targeted PNG via canvas, which failed outright —
     Chromium deliberately taints any canvas drawn from an SVG containing
     `<foreignObject>`, blocking `toBlob()` regardless of same-origin
     content, so PNG-via-canvas was switched to direct SVG download,
     which is arguably the better format for a vector diagram anyway.
     Second bug: the exported SVG initially showed garbled, overlapping
     text — found to be a genuine duplicate-render (edgesSvg lives nested
     inside `world` for z-index reasons from an earlier session, so
     cloning both separately doubled every edge on top of itself) working
     together with a separate CSS-variable resolution bug (`file://`-
     loaded external stylesheets throw on `cssRules` access, silently
     dropping the `:root` variable definitions, so every `var(--text)`
     etc. resolved to nothing). Both fixed; verified by rendering the
     exported file standalone and confirming labels, badge letters, and
     theme colours all appear correctly, not just that a file downloads.

Regression: 0 console errors, 0 overflow across all pages × both themes ×
2 widths; export succeeds without throwing across 6 fixtures × both
themes; full interaction battery (drag, edge-click, boundary, workspace
bar, search, kind filter, eye toggle) re-verified working together.

## Session 6 — edge separation and badge occlusion (measured, not eyeballed)
- [x] **Edges still reading as one line** — session 5's fan bowed the
      MIDDLE of each curve but left all endpoints converging on nearly the
      same point at the node edge, which is exactly where the eye judges
      whether links are distinct. Fixed at the anchor instead: spacing
      widened from `min(7, 26/n)` to `max(6, min(11, 70/n))` px, tuned
      against the ~31px row pitch so each edge stays visually tied to its
      own row without bleeding into the next. Mid-curve fan also widened
      and made count-aware (`max(26, min(46, 320/n))`).
- [x] **1/N badges hidden under nodes** — measured 10 of 80 badges sitting
      inside node bodies. Root cause: `placeBadge` used a fixed 13px along
      the path, which was fine for straight horizontal exits but lands
      *inside* the node once edges leave on a fan curve. Rewrote placement
      to walk along the path until genuinely clear of every node box.
      Three follow-on cases surfaced and were each fixed by measurement
      rather than guesswork:
        1. 90px walk cap too short for a 262px-wide node → raised to
           `min(len*0.45, 420)`.
        2. Short edges fully spanned by node boxes have no clear point on
           the path at all → added a perpendicular nudge fallback that
           steps away from the line until it escapes.
        3. Endpoints swallowed by a node the path only exits on the FAR
           side → added a reverse-direction search before falling back.
      Verified 0 buried badges across all 6 fixtures × both themes, and
      still 0 after dragging a node.

Regression: 0 console errors, 0 overflow (9 pages × 2 themes × 2 widths);
0 buried badges and 0 node overlaps (6 fixtures × 2 themes); drag,
edge-click, workspace bar and SVG export all re-verified.

## Session 7 — outer-bow lane collision and badge-to-badge collision
Both issues from the annotated screenshot were measured precisely before
fixing, per the established practice this project uses.

- [x] **Top box: outer-bow edges converging into one line.** Measured
      ~12px screen gaps between 5 bow edges before fixing. Root cause:
      `outerBowPath()` reused the *per-sheet-pair* lane index, which resets
      to 0 for every new pair, so bow edges from DIFFERENT pairs kept
      landing in the same one or two lanes regardless of how many total
      bow edges existed. Added a dedicated global lane counter shared
      across every bow edge. First fix attempt only got lanes to
      `[0,1,0,1,2]` instead of a clean sequence — traced to `_bowLane`
      deliberately persisting across drag-time reposition calls (to avoid
      lane reshuffling mid-gesture), which meant a full redraw's counter
      reset didn't clear the stale per-edge values it was supposed to
      recompute. Fixed by explicitly clearing `_bowLane` on every full
      `drawEdges()` pass while still leaving it untouched during
      `positionEdges()` (drag). Verified: lanes now form a clean
      `[0,1,2,3,4]` sequence, screen-space gap 0px → 13.9px at fit-zoom.
- [x] **Bottom box: badges clustering/overlapping near a node edge.**
      Measured actual duplicate coordinates — some edges had both their
      own badges landing on the exact same point, and separately, badges
      from two unrelated edges landed 2.2px apart. Root cause: badge
      placement only checked "clear of node bodies," never "clear of
      other badges," so two independent searches could converge on the
      same spot. Added a global per-render collision list (`placedBadges`)
      that every badge placement checks against, with the same layered
      fallback strategy used for node-clearance (walk forward, walk
      backward, perpendicular nudge, then relax to node-clearance-only as
      an absolute floor so a badge is never sacrificed back into a node
      just to stay clear of another badge). Verified: 0 exact-duplicate
      badge positions, minimum gap 3.7px in the worst remaining case.
- [x] Re-verified 0 buried badges (the fix from session 6) still holds
      after adding the collision system on top of it.

Regression: 0 console errors, 0 overflow, 0 buried badges, 0 node
overlaps across 6 fixtures × 2 themes; badge clearance re-verified stable
after node drag; edge-click panel, workspace bar, and SVG export all
still function (one apparent edge-click failure during testing was
diagnosed as the drag target node being moved directly on top of that
edge's path — nodes correctly render above edges, so the node's content
wins the click, which is expected behavior, not a regression).

## Session 8 — edge system REDESIGN (not another patch)
Previous sessions kept treating the symptom — widening gaps, nudging
badges, adding fallbacks — while the underlying approach stayed wrong.
Measuring the actual density made the real problem obvious:

    20 edges between Infrastructure and Timetable
    30 edges touching a single node

Twenty separate lines between the same two tables cannot be made readable
by spacing them apart. No gap value fixes that. The design was wrong, not
the parameters.

- [x] **Relationship bundling (the actual fix).** Adopted the pattern
      professional ER tools use: by default draw ONE connector per TABLE
      PAIR, labelled with its link count ("20 linked columns"), anchored
      at each table's vertical centre. Column-level detail is not deleted,
      just deferred — clicking a table expands its pairs into per-column
      edges, and deselecting collapses them again. Pairs with only 1-2
      links are already legible and stay detailed, so simple files are
      unaffected.
      Result on the reported file: 40 tangled edges → 5 clean connectors.
      Verified across fixtures: simple files show 0 bundles (unchanged),
      only genuinely dense ones collapse.
- [x] This structurally eliminates the whole class of issues that had been
      individually chased for several sessions — converging lines,
      overlapping circular badges, unreadable 1/N labels, edges appearing
      to leave their box — because in the default view there is now at
      most one connector per table pair to collide with anything.
- [x] **Bug found while testing the redesign:** dragging a node also fired
      its click handler, so simply repositioning a table silently expanded
      its bundles mid-gesture. Drag and select are now distinct gestures
      (movement over a 4px threshold suppresses the click). Verified:
      drag leaves the view collapsed and unselected; a genuine click still
      expands.

Regression: 0 console errors, 0 overflow, 0 buried badges, 0 node
overlaps across 6 fixtures × 2 themes; bundle click opens the evidence
panel, eye toggle, and SVG export all still work.

## Session 9 — closed a real verification blind spot
The two screenshots in this report were identical (same filenames) to the
previous report's screenshots. Rather than assume the redesign had failed,
verified directly: the live build already showed the correct 5-connector
bundled state (confirmed by measurement and screenshot).

That check surfaced a genuine, separate problem worth fixing regardless:
**every "verified" claim across this entire project had been tested
against a local copy with `gsap`/`xlsx` script tags rewritten to local
vendored paths — never the actual shipped zip**, which still pointed at
`cdnjs.cloudflare.com`. My sandbox has no route to that domain, so the
literal file handed over had never once been end-to-end tested here. It
likely still worked for a user with normal internet access (their
screenshots showed real rendered data), but this was a blind spot in the
verification process itself, not just a theoretical risk.

- [x] Vendored `gsap.min.js` and `xlsx.full.min.js` directly into
      `assets/` in the actual source (not just the local test build), and
      repointed all 9 HTML pages at the local copies. The package is now
      fully self-contained — no external CDN dependency at all, works
      completely offline.
- [x] Verified the literal shipped zip end-to-end for the first time:
      fresh `unzip` into an untouched directory, loaded `file-analyser.html`
      directly, confirmed the bundled-edge rendering (5 connectors, 5
      bundles, 6 nodes) matches what was previously only checked in the
      local build. Re-ran the full site + fixture regression against this
      same fresh extraction: 0 console errors (one harmless 403 from the
      Google Fonts preconnect, which degrades to system fonts and isn't
      script-blocking), 0 overflow, all 6 fixtures render correctly.

This closes the gap between "verified" and "shipped" going forward —
every future regression pass should run against the actual zip contents,
not the sed-patched local copy.

## Session 10 — tested against the actual reported file, found the real bug
The user provided the literal file that had been producing the reported
issues (`20240426_railML2_4norISModel_v1.7.xlsx`) instead of a synthetic
approximation. Testing against it directly — rather than a fixture built
to resemble it — surfaced a genuine, precisely-locatable regression:

- [x] **Root cause found**: when the global bow-lane system was added
      (session 7, to fix bow edges converging into one line), the routing
      function (`outerBowPath`) was correctly updated to use the new
      `_bowLane` property, but the boundary-padding function (`bowReach`)
      was never updated to match — it was still reading the OLD per-pair
      `_lane` property. On a sheet pair with only one bow edge, `_lane`
      reads 0 regardless of how many bow edges exist GLOBALLY, so
      `bowReach` silently under-measured the true bow depth on any file
      with more than one bow edge overall. Measured directly on the real
      file: true bow depth was lane 3, `bowReach` was computing as if it
      were lane 1 — a 28px shortfall, which is exactly why edges rendered
      above the boundary. Fixed by pointing `bowReach` at the same
      `_bowLane` property `outerBowPath` actually uses.
- [x] **Badge visual clearance widened to match real rendered size, not an
      arbitrary threshold.** Two related fixes: `BADGE_MIN_GAP` raised
      from 17px to 30px (a lettered badge's halo renders at ~27px
      diameter — two centres 18px apart, which previously passed the old
      threshold, still had their blurred halos visibly overlapping).
      `pointInsideAnyNode`'s clearance inset raised from 2px to 15px (2px
      was enough to be technically outside a node but not enough to look
      it — the badge's own halo still read as sitting on the node's
      surface). This directly addresses "violet bubble appearing on
      node" and "N and 1 labels hiding."
- [x] The real file is now a permanent fixture (`samples/real_railml.xlsx`)
      in every future regression pass, specifically because it exposed a
      bug three rounds of testing against a synthetic approximation did
      not.

Verified against the real file with actual measurement, not visual
impression: 0 edges above boundary (previously 2 of 4 bow edges), 0
buried badges, minimum badge separation now 30px (previously 18px).
Full regression re-run across all 7 fixtures × 2 themes × 9 pages: 0
console errors, 0 overflow, 0 boundary violations, 0 buried badges, 0
node overlaps. Edge-click panel, drag, and SVG export re-verified
working on the real file specifically.

## Session 11 — actual redesign, not another parameter tweak
The user was right that the underlying approach was still wrong, even
after the session-10 fix. The badge system's fundamental design was
backwards: a connector dot was being placed wherever an escape-search
happened to find clear space, rather than at the position it actually
represents — the row it connects. That's why dots kept drifting onto
node surfaces or clustering: the search had no reason to know where a
"correct" answer even was.

- [x] **Removed the entire escape-search apparatus**: `placeBadge`'s
      multi-stage walk (forward, backward, perpendicular nudge, node-only
      relaxation), the `placedBadges` global collision list,
      `tooCloseToOtherBadge`, `candidateOk`, and `pointInsideAnyNode` are
      all deleted. None of it is needed once dots stop wandering.
- [x] **Removed anchor nudging** (`computeAnchorNudges`, `_fromNudge`,
      `_toNudge`) — these existed to fake apart multiple edges sharing one
      row, which is no longer necessary or correct: a shared row gets one
      dot, exactly as a real ER diagram shows one port serving several
      relationships.
- [x] **New rule, simple and correct**: a dot's position is exactly the
      path's own start or end point (`path.getPointAtLength(0)` /
      `getPointAtLength(len)`), which is already the true row anchor for
      every path this app generates — straight, bundled, curved-fan, or
      bow. No search, no collision list, no fallback tiers. A row's own y
      position already guarantees it can't coincide with a different
      row's dot.
      Multi-edge separation is still handled — by the existing curved-fan
      system for lines between the same table pair — but now the fan
      only affects the curve's middle, never the endpoint, so the dot
      stays exactly on its row while the lines diverge just past it.
- [x] Verified this looks and behaves correctly, not just "renders without
      error": dots visibly align with their exact row across multiple
      fixtures (screenshot-checked against real DOM coordinates, not
      estimated crops), bundled table-level connectors correctly show no
      per-row dots (by design — they represent the whole table via a
      centre anchor), and dragging a node keeps every dot locked to its
      row throughout.

Regression: 0 console errors, 0 overflow, 0 node overlaps, 0 boundary
violations across all 7 fixtures × 2 themes × 9 pages. Drag, bundle
expand/collapse, edge-click panel, and SVG export all re-verified.

## Session 12 — Column Profiler advanced profiling depth (Task 8/9)

Closes most of Task 8 (8A–8G advanced profiling depth) and all of Task 9
(outlier engine), both listed unchecked since Session 1. Everything stays
in `assets/workspaces.js` (lazy, per-column compute, matching the existing
architecture split — `schema-engine.js` stays untouched, since it runs on
every column on every file load and needs to stay cheap).

- [x] **Task 9 — Outlier engine, all three rules (IQR, z-score, modified
      z-score/MAD)**. `findOutliers()` now flags each row by whichever
      rule(s) actually caught it, shown in the Outliers card ("caught by
      IQR + MAD", etc.) instead of a single undifferentiated list.
      Verified the third rule adds real, non-redundant coverage rather
      than just checkbox completeness: built a synthetic masking case (40
      values tightly clustered ~100, 5 extreme values ~500) where the
      extreme values inflate mean/sd enough that plain z-score misses
      them entirely (z≈2.8, under the |z|>3 threshold — 0 of 5 caught),
      while IQR and modified z-score both correctly flag them. Confirmed
      in the live UI, not just computed offline.
- [x] **Task 8 (partial) — numeric**: mode, MAD, excess kurtosis added to
      the existing mean/median/sd/CV/quartiles/P5/P95/skewness; Freedman–
      Diaconis histogram bins (was a fixed 14); a real box-and-whisker
      plot; a Gaussian KDE density curve overlaid on the histogram
      (Silverman's-rule bandwidth) — closes the "Not yet built: KDE" note.
      Violin plot intentionally skipped — redundant with box + KDE
      together, which already show quartiles and shape.
- [x] **Task 8 (partial) — categorical/text**: full frequency distribution
      with cumulative-% Pareto chart (previously top-5 only), Shannon
      entropy/diversity score, word-count and character-class (alpha/
      digit/space/special) stats, leading/trailing-whitespace flag.
- [x] **Task 8 (partial) — date/temporal**: previously fell into the
      generic "top values" bucket like any other string column. Now: date
      range, a monthly timeline histogram, day-of-week distribution, and a
      sorted/not-sorted check (a strong tell for a log or time index).
- [x] **Missingness structure**: detects runs of 3+ consecutive missing
      rows (a broken export reads very differently from scattered noise)
      and wires the existing `SchemaEngine.missingnessDependency` — real,
      previously computed only at the aggregate report level — into the
      per-column view ("missing 65% of the time when status = X").
- [x] **Distribution shape verdict + summary tags**: skew/kurtosis-based
      shape label ("right-skewed, heavy-tailed", etc.) and a row of at-a-
      glance badges (shape/outlier-count/diversity/completeness) at the
      top of every profile.
- [ ] Not built this session: Task 8's boolean-specific profile (booleans
      currently render via the categorical/binary path, which is adequate
      but not dedicated); Task 72's per-column relationship/PII/rules
      sub-tabs (out of scope by design — TASKS.md itself doesn't enumerate
      what the ten sub-tabs are, and it's a different kind of work, tabbed
      sub-navigation rather than deeper stats).

Regression: scripted sweep opened every column of all 14 files in
`samples/` (up to 79 columns each, including the two railML stress
fixtures) via headless Chromium — 0 console/page errors. Numeric, box
plot, KDE, categorical Pareto, temporal timeline, and missingness-block
paths each individually verified against real data (`bank_wide.xlsx`'s
`pdays` — a real dataset with a 999 sentinel value, correctly surfaced as
225 outliers and the column's mode) and a purpose-built synthetic fixture
for the missingness/temporal/masking-effect cases.

## Session 13 — Column Profiler UI pass: real chart variety, interactivity, insights rail

User feedback: every column rendered as a bar chart, charts were too
large, and nothing was interactive. Also pointed at the marketing page's
static demo (`column-profiler.html`) — chart card beside a row-per-stat
summary card — as the layout to actually build. All changes stay in
`assets/workspaces.js` + `assets/schema.css`, same lazy per-column
architecture as Session 12.

- [x] **Real chart-type variety**: donut chart for low-cardinality
      categorical/binary columns (≤6 distinct) instead of a bar — reads
      far better as proportions. Higher-cardinality categorical/text stays
      Pareto bar+cumulative-line. Temporal timeline switched from bars to
      a line chart (reused `lineSvg` from Chart Studio rather than writing
      a new one) — the correct convention for a time series and visibly
      distinct from the histogram/Pareto bars elsewhere on the same page.
- [x] **Real interactivity**: replaced the native, unstyleable `<title>`
      tooltip with one shared floating tooltip, delegated on `document` so
      it survives every column re-render — every chart element (histogram
      bins, box/whisker/outliers, Pareto bars + cumulative dots, donut
      slices, timeline points) now shows exact figures on hover, styled to
      match the rest of the app. Added linked hover between a donut's
      slices and its legend rows (hover either, the matching pair
      highlights and the rest dim) and a subtle fade-in on cards/insights
      when switching columns.
- [x] **Sizing fix**: charts were stretching to the full panel width in a
      wide overlay, just getting taller for no informational gain. Capped
      at 480px/200px via a new `.ws-chartarea--cp` class.
- [x] **Layout**: adopted the marketing page's own `.prof` pattern (chart
      card beside a compact summary card) — a new `.cp-split` grid pairs
      Distribution/Value-distribution/Timeline with a `.sa-kv` row-per-stat
      Summary card carrying the same verdict-tag pills at its bottom,
      replacing the previous full-width-stacked-cards layout.
- [x] **Insights side panel** (`.cp-insights`, sticky right rail): explains
      the selected column in plain language, grounded in the exact numbers
      already on screen — skew direction and what it implies for mean vs.
      median, the single worst outlier's row/value, CV-based variability
      reads, dominant-category/near-unique flags, missingness-block and
      missingness-dependency callouts, day-of-week concentration for dates.
      Never a separate fabricated commentary layer — every sentence cites
      a value the cards above it already computed.
- [x] **Bug fix, found in passing**: `SchemaEngine.describe()` had no
      branch for `statistical === 'binary'`, so boolean columns described
      themselves as "Free text field." — jarringly wrong right above a
      correctly-rendered true/false donut. Added the missing branch.

Regression: full sweep re-run after every change (all 14 sample files,
every column, headless Chromium) — 0 console/page errors throughout.
Visually verified: linked donut hover (slice + legend highlight together,
rest dim), tooltip content and hover-brighten state, chart-beside-summary
layout on numeric/categorical/temporal, and the Pareto path still renders
correctly for a constructed 10-category fixture (donut is capped at 6).

## Session 14 — chart axes, real tabs, full outlier detail (matching the
## marketing page's actual layout, not just its visual style)

User feedback after seeing Session 13 live: charts still looked wrong
(no visible axis numbers), the marketing page's four categories
("descriptive stats / distribution shape / missing values / outliers")
were never actually built as navigable sections, and outliers needed
full detail rather than a capped list wedged under the chart. Re-read
`column-profiler.html`'s own demo script directly rather than going from
memory — confirmed the reference draws real y-axis gridlines with tick
numbers (0/half/max) that the live histogram never had (x-axis only),
and that the four category labels are static `.chip` elements in the
marketing page, never wired to real content — exactly what this session
had to build for real.

- [x] **Y-axis gridlines + tick labels**, missing entirely until now, on
      every count-based chart (`histogramSvg`, `barChartSvg`, `paretoSvg`,
      `lineSvg` when it doesn't need negative range) via one shared
      `yAxis()` helper. `.ws-axislabel` bumped 9px dim → 11px muted for
      actual legibility, not just presence.
- [x] **Real tabs**, replacing the marketing page's decorative chip row
      with working navigation: Descriptive Stats / Distribution Shape /
      Missing Values / Outliers, built per column kind (categorical and
      temporal columns don't get an Outliers tab — it doesn't apply to
      them). Delegated click handler (`ensureTabs`) toggles panel
      visibility only, no re-render, so switching tabs is instant and
      doesn't recompute the already-rendered charts. Each tab opens with
      a one-sentence plain-language intro naming what it shows and why,
      aimed at a reader with no statistics background.
- [x] **Outliers is now a full detail view**, not a 12-row cap glued below
      the histogram: every flagged row in a proper table (Row, Value,
      Where it falls, Flagged by), an explanatory intro paragraph, and a
      genuine "no outliers found" positive state when the column is
      clean — verified against `bank_wide.xlsx`'s `pdays` (225 real
      outliers, full scrollable table, not truncated).
- [x] **Named charts**: "Distribution of revenue", "How region's values
      are split", etc., replacing generic card headers like "Distribution".
- [x] Chart-beside-summary (`.cp-split`, Session 13) removed — now that
      stats and shape are separate tabs, pairing them side by side no
      longer made sense; charts get the full tab width instead
      (`.ws-chartarea--cp` max-width raised 480px → 620px to use it).

Regression: full sweep re-run (all 14 sample files, every column, AND
every tab click within each column) via headless Chromium — 0
console/page errors. Visually verified: y-axis numbers legible on
histogram/box-plot/donut/Pareto/timeline, tab switching on numeric/
categorical/temporal columns, full 225-row outlier table on real data,
and the "no missing values" / "no outliers found" positive states.
