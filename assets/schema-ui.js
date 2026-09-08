/* =====================================================================
   Data Lens — Schema Analyser UI
   Sections navigated by a StaggeredMenu (reactbits.dev) ported from
   React/JSX to plain JS, keeping its GSAP choreography: pre-layers slide
   in staggered, then the panel, then item labels rise with a slight
   rotation while their numbering fades up.
   ===================================================================== */
(function () {
  'use strict';

  var $ = DL.$, $$ = DL.$$;
  var report = null, activeSection = 'overview', selectedTarget = null;

  var SECTIONS = [
    { id: 'overview',      label: 'Overview',      blurb: 'Health score, size, issues' },
    { id: 'columns',       label: 'Columns',       blurb: 'Types, semantics, cardinality' },
    { id: 'relationships', label: 'Relationships', blurb: 'Keys, FK graph, evidence' },
    { id: 'quality',       label: 'Quality',       blurb: 'Mismatch, anomalies, PII' },
    { id: 'ml',            label: 'ML Readiness',  blurb: 'Roles, target, leakage' },
    { id: 'docs',          label: 'Documentation', blurb: 'Data dictionary, export' }
  ];

  /* ---------------------------------------------------------------
     small format helpers
     --------------------------------------------------------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function num(n) { return (n || 0).toLocaleString('en-US'); }
  function pc(n) { return (Math.round(n * 1000) / 10) + '%'; }
  function bytes(b) {
    if (!b) return '—';
    var u = ['B', 'KB', 'MB', 'GB'], i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return (Math.round(b * 10) / 10) + ' ' + u[i];
  }
  function sevIcon(s) {
    return s === 'critical' ? '&#9679;' : (s === 'warning' ? '&#9679;' : '&#9679;');
  }

  /* ===============================================================
     STAGGERED MENU  (vanilla port)
     =============================================================== */
  function buildMenu() {
    var wrap = $('#smWrap');
    wrap.innerHTML =
      '<div class="sm-prelayers" aria-hidden="true">' +
        '<div class="sm-prelayer" style="background:var(--violet)"></div>' +
        '<div class="sm-prelayer" style="background:var(--amber)"></div>' +
      '</div>' +
      '<aside class="sm-panel" id="smPanel" aria-hidden="true">' +
        '<ul class="sm-list" data-numbering>' +
          SECTIONS.map(function (s, i) {
            return '<li class="sm-itemWrap">' +
                     '<button class="sm-item" data-sec="' + s.id + '" data-index="' + (i + 1) + '">' +
                       '<span class="sm-itemLabel">' + s.label + '</span>' +
                     '</button>' +
                     '<span class="sm-itemBlurb">' + s.blurb + '</span>' +
                   '</li>';
          }).join('') +
        '</ul>' +
        '<div class="sm-foot"><h3 class="sm-foot-title">Schema Analyser</h3>' +
          '<p id="smFootMeta"></p></div>' +
      '</aside>';

    var panel = $('#smPanel');
    var layers = $$('.sm-prelayer', wrap);
    var open = false, busy = false, tl = null;

    function labels() { return $$('.sm-itemLabel', panel); }
    function items() { return $$('.sm-item', panel); }
    function blurbs() { return $$('.sm-itemBlurb', panel); }

    function reset() {
      gsap.set([panel].concat(layers), { xPercent: 100 });
      gsap.set(labels(), { yPercent: 140, rotate: 8 });
      gsap.set(items(), { '--sm-num-opacity': 0 });
      gsap.set(blurbs(), { opacity: 0, y: 12 });
    }
    if (window.gsap) reset();

    function playOpen() {
      if (busy) return;
      busy = true;
      if (tl) tl.kill();
      gsap.set(labels(), { yPercent: 140, rotate: 8 });
      gsap.set(items(), { '--sm-num-opacity': 0 });
      gsap.set(blurbs(), { opacity: 0, y: 12 });

      tl = gsap.timeline({ onComplete: function () { busy = false; } });
      /* pre-layers first, staggered — the signature of this component */
      layers.forEach(function (el, i) {
        tl.fromTo(el, { xPercent: 100 }, { xPercent: 0, duration: 0.5, ease: 'power4.out' }, i * 0.07);
      });
      var panelAt = layers.length * 0.07 + 0.08;
      tl.fromTo(panel, { xPercent: 100 }, { xPercent: 0, duration: 0.65, ease: 'power4.out' }, panelAt);
      tl.to(labels(), {
        yPercent: 0, rotate: 0, duration: 1, ease: 'power4.out',
        stagger: { each: 0.1, from: 'start' }
      }, panelAt + 0.1);
      tl.to(items(), {
        duration: 0.6, ease: 'power2.out', '--sm-num-opacity': 1,
        stagger: { each: 0.08 }
      }, panelAt + 0.2);
      tl.to(blurbs(), {
        opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', stagger: { each: 0.08 }
      }, panelAt + 0.26);
    }

    function playClose() {
      if (tl) tl.kill();
      busy = true;
      gsap.to([panel].concat(layers), {
        xPercent: 100, duration: 0.32, ease: 'power3.in', overwrite: 'auto',
        onComplete: function () { reset(); busy = false; }
      });
    }

    function setOpen(v) {
      open = v;
      wrap.setAttribute('data-open', v ? 'true' : 'false');
      panel.setAttribute('aria-hidden', v ? 'false' : 'true');
      var btn = $('#smToggle');
      btn.setAttribute('aria-expanded', v);
      btn.classList.toggle('is-open', v);
      if (!window.gsap) { panel.style.transform = v ? 'none' : 'translateX(100%)'; return; }
      v ? playOpen() : playClose();
    }

    $('#smToggle').addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(!open);
    });
    document.addEventListener('click', function (e) {
      if (!open) return;
      if (panel.contains(e.target) || $('#smToggle').contains(e.target)) return;
      setOpen(false);
    });
    panel.addEventListener('click', function (e) {
      var b = e.target.closest('.sm-item');
      if (!b) return;
      show(b.getAttribute('data-sec'));
      setOpen(false);
    });

    return { setOpen: setOpen };
  }


  var SECTION_ICON = {
    overview: '<circle cx="12" cy="12" r="8.5"/><path d="M12 12 16 8.5" stroke-linecap="round"/>',
    columns: '<rect x="4" y="4" width="4.5" height="16" rx="1"/><rect x="10" y="4" width="4.5" height="16" rx="1"/><rect x="16" y="4" width="4.5" height="16" rx="1"/>',
    relationships: '<circle cx="6" cy="7" r="2.4"/><circle cx="18" cy="7" r="2.4"/><circle cx="12" cy="18" r="2.4"/><path d="M7.9 8.5 10.7 16M16.1 8.5 13.3 16M8.4 7h7.2"/>',
    quality: '<path d="M12 3 4 6.5v5c0 5 3.4 8.6 8 9.5 4.6-.9 8-4.5 8-9.5v-5z"/><path d="M9 12l2 2 4-4"/>',
    ml: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><circle cx="12" cy="11" r="2"/><path d="M6.6 7.2 10.6 10M17.4 7.2 13.4 10M12 13v3"/>',
    docs: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h6M9 16h6"/>'
  };

  function buildNavbar() {
    var bar = $('#saNavbar');
    if (!bar) return;
    bar.innerHTML = SECTIONS.map(function (s) {
      return '<button class="sa-navtab" data-sec="' + s.id + '" title="' + esc(s.blurb) + '">' +
        '<span class="sa-navtab__ic"><svg viewBox="0 0 24 24">' + SECTION_ICON[s.id] + '</svg></span>' +
        '<span>' + s.label + '</span></button>';
    }).join('');
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('.sa-navtab');
      if (b) show(b.getAttribute('data-sec'));
    });
  }

  /* ===============================================================
     SECTION RENDERERS
     =============================================================== */
  function scoreColor(s) {
    return s >= 80 ? 'var(--green)' : (s >= 60 ? 'var(--amber)' : 'var(--rose)');
  }

  function renderOverview() {
    var st = report.stats, h = report.health;
    var counts = { critical: 0, warning: 0, suggestion: 0 };
    report.issues.forEach(function (i) { counts[i.severity]++; });
    var circ = 2 * Math.PI * 52;

    return '' +
    '<div class="sa-grid sa-grid--hero">' +
      '<div class="sa-card sa-health">' +
        '<div class="sa-card__h">' + hh('Schema health') + '</div>' +
        '<div class="sa-health__ring">' +
          '<svg viewBox="0 0 130 130">' +
            '<circle cx="65" cy="65" r="52" class="sa-ring-bg"/>' +
            '<circle cx="65" cy="65" r="52" class="sa-ring-fg" stroke="' + scoreColor(h.overall) + '" ' +
              'stroke-dasharray="' + circ + '" stroke-dashoffset="' + circ * (1 - h.overall / 100) + '"/>' +
          '</svg>' +
          '<div class="sa-health__num"><b>' + h.overall + '</b><s>/ 100</s></div>' +
        '</div>' +
        '<div class="sa-health__bars">' +
          h.categories.map(function (c) {
            return '<div class="sa-bar"><span>' + c.name + '</span>' +
                   '<i><b style="width:' + c.score + '%;background:' + scoreColor(c.score) + '"></b></i>' +
                   '<em>' + c.score + '</em></div>';
          }).join('') +
        '</div>' +
      '</div>' +

      '<div class="sa-card">' +
        '<div class="sa-card__h">' + hh('Dataset') + '</div>' +
        '<div class="sa-stats">' +
          '<div><dt>Rows</dt><dd>' + num(st.rows) + '</dd></div>' +
          '<div><dt>Columns</dt><dd>' + num(st.columns) + '</dd></div>' +
          '<div><dt>Files</dt><dd>' + st.files + '</dd></div>' +
          '<div><dt>Sheets</dt><dd>' + st.sheets + '</dd></div>' +
          '<div><dt>Size</dt><dd>' + bytes(st.bytes) + '</dd></div>' +
          '<div><dt>Duplicate rows</dt><dd>' + pc(st.duplicateRowRatio) + '</dd></div>' +
          '<div><dt>Nullable cols</dt><dd>' + st.nullableCols + '</dd></div>' +
          '<div><dt>Unique cols</dt><dd>' + st.uniqueCols + '</dd></div>' +
        '</div>' +
        '<div class="sa-card__h" style="margin-top:1.1rem">' + hh('Type distribution') + '</div>' +
        '<div class="sa-types">' +
          Object.keys(st.typeDist).map(function (k) {
            var v = st.typeDist[k];
            return '<div class="sa-type"><span>' + k + '</span>' +
              '<i><b style="width:' + (st.columns ? v / st.columns * 100 : 0) + '%"></b></i><em>' + v + '</em></div>';
          }).join('') +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="sa-card" style="margin-top:1rem">' +
      '<div class="sa-card__h">' + hh('Issues') + ' ' +
        '<span class="sa-pills">' +
          '<i class="sev-critical">' + counts.critical + ' critical</i>' +
          '<i class="sev-warning">' + counts.warning + ' warning</i>' +
          '<i class="sev-suggestion">' + counts.suggestion + ' suggestions</i>' +
        '</span></div>' +
      (report.issues.length
        ? '<ul class="sa-issues">' + report.issues.slice(0, 40).map(function (i) {
            return '<li class="sev-' + i.severity + '"><span class="sa-dot">' + sevIcon(i.severity) + '</span>' +
                   '<div><b>' + esc(i.title) + '</b><p>' + esc(i.detail) + '</p></div></li>';
          }).join('') + '</ul>'
        : '<p class="sa-empty">No structural issues found.</p>') +
    '</div>';
  }

  function renderColumns() {
    return '' +
    '<div class="sa-card">' +
      '<div class="sa-card__h">Every column, typed in four layers' +
        '<span class="sa-hint">physical &rarr; statistical &rarr; semantic &rarr; role</span></div>' +
      '<div class="sa-tablewrap"><table class="sa-table">' +
        '<thead><tr><th>Column</th>' +
        '<th>Physical' + info(GLOSS.Physical) + '</th>' +
        '<th>Statistical' + info(GLOSS.Statistical) + '</th>' +
        '<th>Semantic' + info(GLOSS.Semantic) + '</th>' +
        '<th>Null %' + info(GLOSS['Null %']) + '</th>' +
        '<th>Unique %' + info(GLOSS['Unique %']) + '</th>' +
        '<th>Distinct' + info(GLOSS.Distinct) + '</th>' +
        '<th>Role' + info(GLOSS.Role) + '</th></tr></thead><tbody>' +
        report.allProfiles.map(function (p, i) {
          return '<tr data-col="' + i + '">' +
            '<td><span class="sa-tbl">' + esc(p.table) + '</span><b>' + esc(p.column) + '</b></td>' +
            '<td><span class="sa-chip t-' + p.physical + '">' + p.physical + '</span></td>' +
            '<td>' + p.statistical + '</td>' +
            '<td>' + (p.semantic ? '<span class="sa-chip sa-chip--sem">' + esc(p.semantic) + '</span>' : '<span class="sa-muted">—</span>') + '</td>' +
            '<td>' + pc(p.nullRatio) + '</td>' +
            '<td>' + pc(p.uniqueRatio) + '</td>' +
            '<td>' + num(p.distinct) + '</td>' +
            '<td><span class="sa-role r-' + p.role.replace(/[^a-z]/gi, '').toLowerCase() + '">' + p.role + '</span></td>' +
          '</tr>';
        }).join('') +
      '</tbody></table></div>' +
    '</div>' +
    '<div class="sa-card sa-detail" id="colDetail"><p class="sa-empty">Select a column to see its full profile.</p></div>';
  }

  function renderColumnDetail(p) {
    var d = $('#colDetail');
    d.innerHTML =
      '<div class="sa-card__h">' + esc(p.table) + ' &middot; <b>' + esc(p.column) + '</b></div>' +
      '<div class="sa-layers">' +
        '<div><dt>Physical' + info(GLOSS.Physical) + '</dt><dd>' + p.physical + '</dd></div>' +
        '<div class="sa-arrow">&darr;</div>' +
        '<div><dt>Statistical' + info(GLOSS.Statistical) + '</dt><dd>' + p.statistical + '</dd></div>' +
        '<div class="sa-arrow">&darr;</div>' +
        '<div><dt>Semantic' + info(GLOSS.Semantic) + '</dt><dd>' + (p.semantic || '—') +
          (p.semantic ? ' <s>' + pc(p.semanticConfidence) + ' via ' + p.semanticFrom + '</s>' : '') + '</dd></div>' +
        '<div class="sa-arrow">&darr;</div>' +
        '<div><dt>Role' + info(GLOSS.Role) + '</dt><dd>' + p.role + '</dd></div>' +
      '</div>' +
      (p.mismatch
        ? '<div class="sa-warn">Stored as <b>' + p.physical + '</b>, but ' + pc(p.mismatch.ratio) +
          ' of values convert to <b>' + p.mismatch.detected + '</b>. Recommended type: ' + p.mismatch.detected + '.</div>'
        : '') +
      (p.pii ? '<div class="sa-warn sa-warn--red">Potential PII (' + p.pii + '). Mask or exclude before modelling.</div>' : '') +
      '<div class="sa-stats sa-stats--tight">' +
        '<div><dt>Rows</dt><dd>' + num(p.rowCount) + '</dd></div>' +
        '<div><dt>Missing</dt><dd>' + num(p.nullCount) + ' (' + pc(p.nullRatio) + ')</dd></div>' +
        '<div><dt>Distinct</dt><dd>' + num(p.distinct) + '</dd></div>' +
        '<div><dt>Unique</dt><dd>' + pc(p.uniqueRatio) + '</dd></div>' +
        (p.numeric ? '<div><dt>Min / Max</dt><dd>' + p.numeric.min + ' / ' + p.numeric.max + '</dd></div>' +
                     '<div><dt>Mean</dt><dd>' + (Math.round(p.numeric.mean * 100) / 100) + '</dd></div>' : '') +
      '</div>' +
      (p.topValues.length
        ? '<div class="sa-card__h" style="margin-top:.9rem">Most frequent</div>' +
          '<div class="sa-freq">' + p.topValues.map(function (t) {
            return '<div><span>' + esc(t[0]).slice(0, 28) + '</span><i><b style="width:' +
              (t[1] / Math.max(1, p.rowCount - p.nullCount) * 100) + '%"></b></i><em>' + num(t[1]) + '</em></div>';
          }).join('') + '</div>'
        : '') +
      '<div class="sa-desc"><b>Inferred description</b> ' + esc(SchemaEngine.describe(p)) + '</div>';
    d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* a small styled tooltip — not a native title="", so it matches the rest
     of the interface — used everywhere a label needs a plain-word gloss */

  var GLOSS = {
    'Schema health': 'A single score from 0-100 summarising six checks: how well types match, how much is missing, how solid the keys are, how consistent the names are, whether references resolve, and overall structural soundness.',
    'Dataset': 'The raw shape of what was loaded — how much data there is and how it is spread across files and sheets.',
    'Type distribution': 'How many columns fall into each broad kind of value — numbers, categories, dates, free text, or true/false.',
    'Issues': 'Everything the analyser noticed that is worth a second look, ranked from most to least urgent.',
    'Physical': 'What the values literally are right now — text, integer, float, date, or boolean.',
    'Statistical': 'How the column behaves — a small fixed set of categories, a free-flowing number, a yes/no, or a date over time.',
    'Semantic': 'What the values actually represent in the real world — an email, a currency amount, a postal code — inferred from the values themselves, not just their type.',
    'Null %': 'The share of rows with no value in this column at all.',
    'Unique %': 'The share of values that appear only once. 100% means every value in the column is different.',
    'Distinct': 'How many different values appear in the column, counting each one only once.',
    'Role': 'What the column is likely for — a row identifier, a modelling feature, a date, sensitive personal data, and so on.',
    'Primary key candidates': 'Columns where every value is different and none are missing — the two properties a real identifier needs.',
    'Composite key candidates': 'Pairs of columns that are not unique on their own, but uniquely identify a row when taken together.',
    'Evidence': 'The individual signals that were combined to produce the confidence score for this relationship.',
    'Rules triggered': 'Pass/fail checks that either strengthen or weaken confidence in the relationship, independent of the weighted score.',
    'Validation': 'Whether the values on one side of the relationship actually find a match on the other side.',
    'Type mismatches': 'Columns stored as one type but whose values almost entirely convert cleanly to another — usually a sign the column should be retyped.',
    'Potential PII': 'Columns that may hold personal information about a real person and should usually be masked or removed before modelling.',
    'Constant & near-constant': 'Columns that hold only one value, or overwhelmingly one value — they carry little to no information for analysis.',
    'High cardinality': 'Columns where almost every value is unique — useful as an identifier, unhelpful as a category.',
    'Missingness': 'Which columns have gaps, and how large those gaps are.',
    'Missingness dependencies': 'Cases where values go missing together with a specific value in another column, rather than at random — a sign the gap has a structural cause.',
    'Naming conventions': 'The capitalisation and separator style used for column names, and how consistently it is applied.',
    'Column roles': 'A grouping of every column by what it is likely used for in analysis or modelling.',
    'Target & leakage': 'Columns that correlate suspiciously well with your chosen target — often because they were recorded after the outcome was already known.',
    'Data dictionary': 'A plain-language reference entry for every column, generated automatically from the data.'
  };
  function hh(title) { return title + (GLOSS[title] ? ' ' + info(GLOSS[title]) : ''); }

  function info(text) {
    return '<span class="sa-info" tabindex="0">i<s>' + esc(text) + '</s></span>';
  }

  function renderCanvasRels() {
    var rels = report.canvasRels || [];
    var shared = rels.filter(function (r) { return r.kind === 'shared'; });
    var inSheet = rels.filter(function (r) { return r.kind !== 'shared'; });
    if (!rels.length) return '';
    return '<div class="sa-grid sa-grid--2" style="margin-top:1rem">' +
      '<div class="sa-card">' +
        '<div class="sa-card__h">Shared columns across sheets ' +
          info('Two sheets carry a column with the same name and overlapping values — not necessarily a key, but the same field recorded twice.') +
          '<span class="sa-hint">' + shared.length + ' found</span></div>' +
        (shared.length ? '<ul class="sa-list">' + shared.map(function (r) {
          return '<li><b>' + esc(r.fromTable) + '.' + esc(r.fromCol) + '</b> <i class="sa-arrow-inline">&harr;</i> <b>' +
            esc(r.toTable) + '.' + esc(r.toCol) + '</b><s>' + esc(r.label) + '</s></li>';
        }).join('') + '</ul>' : '<p class="sa-empty">None found.</p>') +
      '</div>' +
      '<div class="sa-card">' +
        '<div class="sa-card__h">Relationships within a sheet ' +
          info('One column\'s value predicts another (a determination) or two numeric columns move together strongly (a correlation) — both inside the same sheet.') +
          '<span class="sa-hint">' + inSheet.length + ' found</span></div>' +
        (inSheet.length ? '<ul class="sa-list">' + inSheet.map(function (r) {
          return '<li><b>' + esc(r.fromTable) + '</b><s>' + esc(r.fromCol) + ' ' + esc(r.label) + ' ' + esc(r.toCol) + '</s></li>';
        }).join('') + '</ul>' : '<p class="sa-empty">None found.</p>') +
      '</div>' +
    '</div>';
  }

  function renderRelationships() {
    var pks = report.primaryKeys, rels = report.relationships;
    return '' +
    '<div class="sa-grid sa-grid--2">' +
      '<div class="sa-card">' +
        '<div class="sa-card__h">' + hh('Primary key candidates') + '</div>' +
        (pks.length ? '<ul class="sa-keys">' + pks.slice(0, 8).map(function (k) {
          return '<li><span class="sa-tick">&#10003;</span><div><b>' + esc(k.profile.table) + '.' + esc(k.profile.column) + '</b>' +
            '<s>Uniqueness 100% &middot; Nulls 0% &middot; ' + k.profile.physical +
            ' &middot; Confidence ' + pc(k.confidence) + '</s></div></li>';
        }).join('') + '</ul>' : '<p class="sa-empty">No single column is fully unique.</p>') +
        (report.suspiciousKeys.length
          ? '<div class="sa-warn" style="margin-top:.8rem">' + report.suspiciousKeys.map(function (s) {
              return esc(s.profile.column) + ' looks like an ID but has ' + pc(s.dupRate) + ' duplicates.';
            }).join('<br>') + '</div>' : '') +
        (report.composites.length
          ? '<div class="sa-card__h" style="margin-top:1rem">' + hh('Composite key candidates') + '</div>' +
            '<ul class="sa-keys">' + report.composites.map(function (c) {
              return c.keys.map(function (k) {
                return '<li><span class="sa-tick">&#10003;</span><div><b>' + esc(c.sheet.name) + ' (' +
                  k.cols.map(esc).join(' + ') + ')</b><s>Uniqueness ' + pc(k.uniqueness) + '</s></div></li>';
              }).join('');
            }).join('') + '</ul>' : '') +
      '</div>' +

      '<div class="sa-card">' +
        '<div class="sa-card__h">Foreign keys ' + info('Columns whose values point at a unique column in another table — the kind of relationship a database JOIN relies on.') +
          '<span class="sa-hint">' + rels.length + ' found</span></div>' +
        (rels.length ? '<ul class="sa-rels">' + rels.map(function (r, i) {
          return '<li data-rel="' + i + '">' +
            '<div class="sa-rel__top">' +
              '<span class="sa-rel__path">' + esc(r.from.table) + '.<b>' + esc(r.from.column) + '</b>' +
              ' <i>&rarr;</i> ' + esc(r.to.table) + '.<b>' + esc(r.to.column) + '</b></span>' +
              '<span class="sa-conf c-' + r.confidence.toLowerCase() + '">' + pc(r.score) + '</span>' +
            '</div>' +
            '<div class="sa-rel__meta">' + r.cardinality + ' &middot; ' + r.kind.toLowerCase() +
              ' &middot; <span class="sa-status">' + r.status.toLowerCase() + '</span>' +
              (r.orphanRate > 0 ? ' &middot; <span class="sa-orphan">' + pc(r.orphanRate) + ' orphans</span>' : '') +
            '</div>' +
          '</li>';
        }).join('') + '</ul>' : '<p class="sa-empty">No column is unique enough on the target side to act as a foreign key.</p>') +
      '</div>' +
    '</div>' +
    '<div class="sa-card sa-detail" id="relDetail"><p class="sa-empty">Select a relationship to see the evidence behind it.</p></div>' +
    renderCanvasRels();
  }

  function renderRelDetail(r) {
    var d = $('#relDetail');
    var ev = r.evidence;
    function bar(label, v) {
      return '<div class="sa-bar"><span>' + label + '</span><i><b style="width:' + (v * 100) + '%"></b></i><em>' + pc(v) + '</em></div>';
    }
    d.innerHTML =
      '<div class="sa-card__h">Relationship detail</div>' +
      '<div class="sa-rel__big">' + esc(r.from.table) + '.<b>' + esc(r.from.column) + '</b>' +
        '<div class="sa-rel__arrow">' + r.cardinality + '</div>' +
        esc(r.to.table) + '.<b>' + esc(r.to.column) + '</b></div>' +
      '<div class="sa-grid sa-grid--2">' +
        '<div><div class="sa-card__h">' + hh('Evidence') + '</div>' +
          bar('Value coverage', ev.coverage) +
          bar('Target uniqueness', ev.uniqueness) +
          bar('Type compatibility', ev.type) +
          bar('Name similarity', ev.name) +
          bar('Semantic similarity', ev.semantic) +
        '</div>' +
        '<div><div class="sa-card__h">' + hh('Rules triggered') + '</div>' +
          '<ul class="sa-rules">' + r.rules.map(function (ru) {
            return '<li class="' + (ru.pass ? 'ok' : 'no') + '">' + (ru.pass ? '&#10003;' : '&#10007;') +
              ' ' + ru.name + ' <s>' + ru.weight + '</s></li>';
          }).join('') + '</ul>' +
          '<div class="sa-card__h" style="margin-top:.9rem">' + hh('Validation') + '</div>' +
          '<p class="sa-valid">' +
            '<b>' + pc(r.health) + '</b> of values resolve to a real row.' +
            (r.orphanRate > 0
              ? ' <span class="sa-orphan">' + pc(r.orphanRate) + ' orphaned' +
                (r.orphanSamples.length ? ' (e.g. ' + r.orphanSamples.map(esc).join(', ') + ')' : '') + '.</span>'
              : ' No orphan values.') +
          '</p>' +
        '</div>' +
      '</div>' +
      '<p class="sa-note">Status: <b>' + r.status.toLowerCase() + '</b> — discovered from statistical evidence, ' +
      'not declared as a database constraint.</p>';
    d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderQuality() {
    var P = report.allProfiles;
    var mismatches = P.filter(function (p) { return p.mismatch; });
    var pii = P.filter(function (p) { return p.pii; });
    var constants = P.filter(function (p) { return p.distinct === 1; });
    var nearConst = P.filter(function (p) {
      return p.distinct > 1 && p.topValues.length &&
             p.topValues[0][1] / Math.max(1, p.rowCount - p.nullCount) >= 0.95;
    });
    var highCard = P.filter(function (p) { return p.uniqueRatio >= 0.85 && p.distinct > 20; });

    function block(title, rows, empty) {
      return '<div class="sa-card"><div class="sa-card__h">' + title + '</div>' +
        (rows.length ? '<ul class="sa-list">' + rows.join('') + '</ul>' : '<p class="sa-empty">' + empty + '</p>') + '</div>';
    }

    return '<div class="sa-grid sa-grid--2">' +
      block(hh('Type mismatches'), mismatches.map(function (p) {
        return '<li><b>' + esc(p.column) + '</b><s>' + p.physical + ' &rarr; ' + p.mismatch.detected +
          ' &middot; ' + pc(p.mismatch.ratio) + ' convertible</s></li>';
      }), 'Every column already holds its natural type.') +

      block(hh('Potential PII'), pii.map(function (p) {
        return '<li class="sev-critical"><b>' + esc(p.column) + '</b><s>' + p.pii +
          ' &middot; ' + pc(p.semanticConfidence) + ' confidence &middot; mask or exclude</s></li>';
      }), 'No personally identifiable columns detected.') +

      block(hh('Constant &amp; near-constant'.replace('&amp;','&')), constants.map(function (p) {
        return '<li><b>' + esc(p.column) + '</b><s>Constant — one value: "' +
          esc(p.topValues[0] ? p.topValues[0][0] : '') + '"</s></li>';
      }).concat(nearConst.map(function (p) {
        return '<li><b>' + esc(p.column) + '</b><s>Near-constant — ' +
          pc(p.topValues[0][1] / (p.rowCount - p.nullCount)) + ' share one value</s></li>';
      })), 'No columns are degenerate.') +

      block(hh('High cardinality'), highCard.map(function (p) {
        return '<li><b>' + esc(p.column) + '</b><s>' + pc(p.uniqueRatio) + ' unique &middot; ' +
          num(p.distinct) + ' values &middot; ' + p.role + '</s></li>';
      }), 'No extreme-cardinality columns.') +
    '</div>' +

    '<div class="sa-card" style="margin-top:1rem">' +
      '<div class="sa-card__h">' + hh('Missingness') + '</div>' +
      '<div class="sa-miss">' + P.filter(function (p) { return p.nullRatio > 0; })
        .sort(function (a, b) { return b.nullRatio - a.nullRatio; }).slice(0, 12)
        .map(function (p) {
          return '<div class="sa-bar"><span>' + esc(p.column) + '</span>' +
            '<i><b style="width:' + (p.nullRatio * 100) + '%;background:var(--rose)"></b></i>' +
            '<em>' + pc(p.nullRatio) + '</em></div>';
        }).join('') || '<p class="sa-empty">No missing values anywhere.</p>' +
      '</div>' +
      (report.missingnessDeps.length
        ? '<div class="sa-card__h" style="margin-top:1rem">' + hh('Missingness dependencies') + '</div>' +
          report.missingnessDeps.map(function (m) {
            return '<div class="sa-warn"><b>' + esc(m.target.column) + '</b> is missing in ' +
              pc(m.dep.rate) + ' of rows where <b>' + esc(m.dep.column) + '</b> = "' +
              esc(m.dep.value) + '". Missingness is structural, not random.</div>';
          }).join('')
        : '') +
    '</div>' +

    '<div class="sa-card" style="margin-top:1rem">' +
      '<div class="sa-card__h">' + hh('Naming conventions') + '</div>' +
      '<p class="sa-valid">Dominant convention: <b>' + report.naming.dominant + '</b> (' +
        pc(report.naming.consistency) + ' of columns).</p>' +
      (report.naming.consistency < 1
        ? '<div class="sa-tablewrap"><table class="sa-table"><thead><tr><th>Column</th><th>Style</th><th>Suggested</th></tr></thead><tbody>' +
          P.filter(function (p) { return p.naming !== report.naming.dominant; }).slice(0, 12).map(function (p) {
            return '<tr><td><b>' + esc(p.column) + '</b></td><td>' + p.naming + '</td>' +
              '<td><span class="sa-chip sa-chip--sem">' + esc(SchemaEngine.toSnake(p.column)) + '</span></td></tr>';
          }).join('') + '</tbody></table></div>'
        : '') +
    '</div>';
  }

  function renderML() {
    var P = report.allProfiles;
    var byRole = {};
    P.forEach(function (p) { (byRole[p.role] = byRole[p.role] || []).push(p); });
    var candidates = P.filter(function (p) {
      return p.statistical === 'binary' || (p.statistical === 'categorical' && p.distinct <= 10);
    });

    var leak = selectedTarget ? SchemaEngine.detectLeakage(report, selectedTarget) : [];

    return '<div class="sa-card">' +
      '<div class="sa-card__h">' + hh('Column roles') + '</div>' +
      '<div class="sa-roles">' + Object.keys(byRole).map(function (role) {
        return '<div class="sa-rolegroup"><h4>' + role + ' <s>' + byRole[role].length + '</s></h4>' +
          byRole[role].map(function (p) {
            return '<span class="sa-chip">' + esc(p.column) + '</span>';
          }).join('') + '</div>';
      }).join('') + '</div>' +
    '</div>' +

    '<div class="sa-card" style="margin-top:1rem">' +
      '<div class="sa-card__h">' + hh('Target & leakage') + '</div>' +
      '<p class="sa-valid">Choose the column you intend to predict, and Data Lens will look for columns that ' +
      'would not exist at prediction time.</p>' +
      '<select class="sa-select" id="targetSel">' +
        '<option value="">— no target selected —</option>' +
        candidates.map(function (p, i) {
          var key = P.indexOf(p);
          return '<option value="' + key + '"' + (selectedTarget === p ? ' selected' : '') + '>' +
            esc(p.table) + '.' + esc(p.column) + ' (' + p.distinct + ' values)</option>';
        }).join('') +
      '</select>' +
      (selectedTarget
        ? (leak.length
            ? '<ul class="sa-list" style="margin-top:.9rem">' + leak.map(function (l) {
                return '<li class="sev-critical"><b>' + esc(l.profile.column) + '</b><s>' + esc(l.reason) +
                  ' Association ' + pc(l.correlation) + '. Recommendation: exclude from training.</s></li>';
              }).join('') + '</ul>'
            : '<p class="sa-empty" style="margin-top:.9rem">No leakage suspects for this target.</p>')
        : '') +
    '</div>';
  }

  function renderDocs() {
    var dict = SchemaEngine.buildDictionary(report);
    return '<div class="sa-card">' +
      '<div class="sa-card__h">' + hh('Data dictionary') + '' +
        '<span class="sa-actions">' +
          '<button class="btn btn-ghost btn-sm" data-export="md">Markdown</button>' +
          '<button class="btn btn-ghost btn-sm" data-export="csv">CSV</button>' +
          '<button class="btn btn-primary btn-sm" data-export="json">JSON</button>' +
        '</span></div>' +
      '<p class="sa-note">Descriptions are inferred from the data, not ground truth — review before publishing.</p>' +
      '<div class="sa-tablewrap"><table class="sa-table">' +
        '<thead><tr><th>Column</th><th>Type</th><th>Role</th><th>Nullable</th><th>Unique</th><th>Range</th><th>Description</th></tr></thead><tbody>' +
        dict.map(function (d) {
          return '<tr><td><span class="sa-tbl">' + esc(d.table) + '</span><b>' + esc(d.column) + '</b></td>' +
            '<td><span class="sa-chip t-' + d.physical + '">' + d.physical + '</span></td>' +
            '<td>' + d.role + '</td><td>' + d.nullable + ' <s>' + d.nullPct + '</s></td>' +
            '<td>' + d.unique + '</td><td>' + esc(d.range) + '</td>' +
            '<td class="sa-descCell">' + esc(d.description) + '</td></tr>';
        }).join('') +
      '</tbody></table></div></div>';
  }

  /* ---------------------------------------------------------------
     export
     --------------------------------------------------------------- */
  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 100);
  }
  function doExport(kind) {
    var dict = SchemaEngine.buildDictionary(report);
    if (kind === 'json') {
      download('data-dictionary.json', JSON.stringify({
        health: report.health, stats: report.stats,
        columns: dict, relationships: report.relationships.map(function (r) {
          return { from: r.from.table + '.' + r.from.column, to: r.to.table + '.' + r.to.column,
                   score: r.score, cardinality: r.cardinality, orphanRate: r.orphanRate };
        }), issues: report.issues.map(function (i) { return { severity: i.severity, title: i.title, detail: i.detail }; })
      }, null, 2), 'application/json');
    } else if (kind === 'csv') {
      var head = ['table','column','physical','statistical','semantic','role','nullable','null_pct','unique','distinct','range','description'];
      var rows = dict.map(function (d) {
        return head.map(function (h) {
          var k = { null_pct: 'nullPct' }[h] || h;
          return '"' + String(d[k] == null ? '' : d[k]).replace(/"/g, '""') + '"';
        }).join(',');
      });
      download('data-dictionary.csv', head.join(',') + '\n' + rows.join('\n'), 'text/csv');
    } else {
      var md = '# Data dictionary\n\nSchema health: **' + report.health.overall + '/100**\n\n';
      report.sheets.forEach(function (s, si) {
        md += '## ' + (s.label || s.name) + '\n\n';
        report.profiles[si].forEach(function (p) {
          md += '### ' + p.column + '\n';
          md += '- Type: ' + p.physical + ' (' + p.statistical + (p.semantic ? ', ' + p.semantic : '') + ')\n';
          md += '- Role: ' + p.role + '\n';
          md += '- Nullable: ' + (p.nullRatio > 0 ? 'Yes (' + pc(p.nullRatio) + ')' : 'No') + '\n';
          md += '- Unique: ' + (p.isUnique ? 'Yes' : 'No') + '\n';
          md += '- ' + SchemaEngine.describe(p) + '\n\n';
        });
      });
      download('data-dictionary.md', md, 'text/markdown');
    }
  }

  /* ---------------------------------------------------------------
     section switching
     --------------------------------------------------------------- */
  var RENDER = {
    overview: renderOverview, columns: renderColumns, relationships: renderRelationships,
    quality: renderQuality, ml: renderML, docs: renderDocs
  };

  var SECTION_INTRO = {
    overview: 'A single glance at how sound this dataset is before you start.',
    columns: 'Every column, typed in four layers — from what it literally is, to what it\'s for.',
    relationships: 'How your tables connect, and how strong the evidence for each link is.',
    quality: 'Everything that could quietly break an analysis if it went unnoticed.',
    ml: 'What each column is good for, and what would leak the answer if you kept it in.',
    docs: 'A plain-language reference for every column, ready to hand to someone else.'
  };

  function show(id) {
    activeSection = id;
    var body = $('#saBody');
    body.setAttribute('data-section', id);
    var s = SECTIONS.filter(function (x) { return x.id === id; })[0];
    body.innerHTML =
      '<div class="sa-section-head"><span class="sa-eyebrow">Schema Analyser</span>' +
      '<h2 class="sa-section-title">' + s.label + '</h2>' +
      '<p class="sa-section-sub">' + SECTION_INTRO[id] + '</p></div>' +
      RENDER[id]();
    $('#saTitle').textContent = s.label;
    $('#saBlurb').textContent = s.blurb;
    $$('.sa-navtab', $('#saNavbar')).forEach(function (t) {
      t.classList.toggle('is-active', t.getAttribute('data-sec') === id);
    });
    if (window.gsap && !DL.reduced) {
      gsap.fromTo($$('.sa-card', body), { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: .5, stagger: .06, ease: 'power3.out' });
      gsap.fromTo($$('.sa-ring-fg', body), { strokeDashoffset: 327 },
        { strokeDashoffset: function (i, t) { return t.getAttribute('stroke-dashoffset'); },
          duration: 1.1, ease: 'power2.out' });
    }
    body.scrollTop = 0;
  }

  /* ---------------------------------------------------------------
     open / close
     --------------------------------------------------------------- */
  var menu = null;

  var hasIntroed = false;

  function playIntro() {
    if (hasIntroed || !window.gsap || DL.reduced) { hasIntroed = true; return; }
    hasIntroed = true;
    var layer = document.createElement('div');
    layer.className = 'sa-intro';
    layer.innerHTML =
      '<div class="sa-intro__ring"></div><div class="sa-intro__ring sa-intro__ring--2"></div>' +
      '<div class="sa-intro__core"></div><div class="sa-intro__label">reading structure&hellip;</div>';
    $('#schemaOverlay').appendChild(layer);
    var tl = gsap.timeline({ onComplete: function () { layer.remove(); } });
    tl.fromTo(layer, { opacity: 0 }, { opacity: 1, duration: .3 })
      .fromTo('.sa-intro__ring', { scale: .3, opacity: 0 },
        { scale: 1, opacity: 1, duration: .7, stagger: .12, ease: 'power3.out' }, .1)
      .fromTo('.sa-intro__core', { scale: 0, opacity: 0 },
        { scale: 1, opacity: 1, duration: .5, ease: 'back.out(2.4)' }, .3)
      .to('.sa-intro__label', { opacity: 1, duration: .3 }, .5)
      .to(layer, { opacity: 0, duration: .4, delay: .35 })
      .to('.sa-intro__core', { scale: 14, opacity: 0, duration: .55, ease: 'power2.in' }, '<');
  }

  function open() {
    var got = window.DLReport && window.DLReport.get();
    if (!got) return;
    var ov = $('#schemaOverlay');
    ov.classList.add('is-on');
    $('#saBody').innerHTML = '<div class="sa-loading">Analysing schema…</div>';
    document.body.style.overflow = 'hidden';
    playIntro();

    setTimeout(function () {
      var model = got.model;
      report = got.report;
      selectedTarget = null;
      if (!menu) { menu = buildMenu(); buildNavbar(); }
      $('#smFootMeta').textContent = model.files.join(' · ');
      $('#saFile').textContent = model.files.length === 1 ? model.files[0] : model.files.length + ' files';
      $('#saInfoStats').textContent = report.stats.files + (report.stats.files===1?' file':' files') +
        ' · ' + report.stats.sheets + (report.stats.sheets===1?' sheet':' sheets') +
        ' · ' + num(report.stats.columns) + ' columns';
      var hc = scoreColor(report.health.overall);
      $('#saInfoHealth').innerHTML = '<i style="background:' + hc + '"></i>health ' + report.health.overall + '/100';
      show('overview');
    }, 60);
  }

  function close() {
    $('#schemaOverlay').classList.remove('is-on');
    document.body.style.overflow = '';
    if (menu) menu.setOpen(false);
  }

  /* ---------------------------------------------------------------
     wiring
     --------------------------------------------------------------- */
  window.SchemaAnalyser = { open: open, close: close };

  function init() {
    var cl = $('#saClose');
    if (cl) cl.addEventListener('click', close);

    /* delegated interactions inside the report body */
    $('#saBody').addEventListener('click', function (e) {
      var row = e.target.closest('tr[data-col]');
      if (row) {
        $$('tr[data-col]', row.closest('table')).forEach(function (r) { r.classList.remove('is-active'); });
        row.classList.add('is-active');
        renderColumnDetail(report.allProfiles[+row.getAttribute('data-col')]);
        return;
      }
      var rel = e.target.closest('li[data-rel]');
      if (rel) {
        $$('li[data-rel]', rel.closest('ul')).forEach(function (r) { r.classList.remove('is-active'); });
        rel.classList.add('is-active');
        renderRelDetail(report.relationships[+rel.getAttribute('data-rel')]);
        return;
      }
      var ex = e.target.closest('[data-export]');
      if (ex) { doExport(ex.getAttribute('data-export')); return; }
    });
    $('#saBody').addEventListener('change', function (e) {
      if (e.target.id === 'targetSel') {
        var v = e.target.value;
        selectedTarget = v === '' ? null : report.allProfiles[+v];
        show('ml');
      }
    });
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
})();
