/* =====================================================================
   Data Lens — File Analyser
   Parses a CSV/Excel file in the browser, infers column types, looks for
   relationships, and draws every sheet as a node on a pan/zoom canvas.
   ===================================================================== */
(function () {
  'use strict';

  var $ = DL.$, $$ = DL.$$;

  /* ---------------------------------------------------------------
     elements
     --------------------------------------------------------------- */
  var dz = $('#dz'), fileInput = $('#fileInput'), pickBtn = $('#pickBtn'),
      dzErr = $('#dzErr'), dropStage = $('#faDrop'), work = $('#faWork'),
      prog = $('#prog'), progFill = $('#progFill'), progPct = $('#progPct'),
      progLabel = $('#progLabel'), progSteps = $('#progSteps'),
      canvas = $('#canvas'), world = $('#world'), edgesSvg = $('#edges'),
      sheetList = $('#sheetList'), fileNameEl = $('#fileName'),
      fileMetaEl = $('#fileMeta'), sideStats = $('#sideStats'),
      zLabel = $('#zLabel'), emptyNote = $('#emptyNote');

  var NODE_W = window.innerWidth < 820 ? 222 : 262;
  var HEAD_H = 33, ROW_H = 26;

  var model = null;          /* { files[], sheets[], rels[] } */
  var view  = { x: 60, y: 60, k: 1 };

  /* ===============================================================
     1. PARSING
     =============================================================== */

  /* RFC-4180-ish CSV reader: handles quoted fields, escaped quotes,
     embedded newlines, and picks the delimiter by counting candidates. */
  function sniffDelimiter(text) {
    var head = text.slice(0, 5000).split(/\r?\n/).slice(0, 5);
    var best = ',', bestScore = -1;
    [',', '\t', ';', '|'].forEach(function (d) {
      var counts = head.map(function (l) { return l.split(d).length; });
      var first = counts[0] || 0;
      if (first < 2) return;
      var consistent = counts.every(function (c) { return c === first; });
      var score = first * (consistent ? 2 : 1);
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }

  function parseCSV(text, delim) {
    var rows = [], row = [], field = '', i = 0, inQ = false;
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    while (i < text.length) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQ = true; i++; continue; }
      if (ch === delim) { row.push(field); field = ''; i++; continue; }
      if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = []; i++; continue;
      }
      field += ch; i++;
    }
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
    return rows;
  }

  function sheetFromRows(name, rows) {
    if (!rows.length) return null;
    var header = rows[0].map(function (h, i) {
      var v = String(h == null ? '' : h).trim();
      return v || ('column_' + (i + 1));
    });
    var body = rows.slice(1).filter(function (r) {
      return r.some(function (c) { return c != null && String(c).trim() !== ''; });
    });
    return { name: name, header: header, rows: body };
  }

  /* ===============================================================
     2. TYPE INFERENCE
     =============================================================== */
  var DATE_RE = [
    /^\d{4}-\d{1,2}-\d{1,2}([T ].*)?$/,
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
    /^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/
  ];
  var BOOLS = ['true', 'false', 'yes', 'no', 'y', 'n', '0', '1'];

  function cellKind(raw) {
    if (raw == null) return 'blank';
    var v = String(raw).trim();
    if (v === '') return 'blank';
    if (raw instanceof Date) return 'date';
    var num = v.replace(/[, ]/g, '').replace(/^[₹$€£]/, '').replace(/%$/, '');
    if (num !== '' && isFinite(num) && /^-?\d*\.?\d+(e-?\d+)?$/i.test(num)) {
      return num.indexOf('.') >= 0 ? 'decimal' : 'integer';
    }
    for (var i = 0; i < DATE_RE.length; i++) if (DATE_RE[i].test(v)) return 'date';
    if (BOOLS.indexOf(v.toLowerCase()) >= 0) return 'boolean';
    return 'text';
  }

  function profileColumn(name, values) {
    var counts = {}, blanks = 0, distinct = Object.create(null), nDistinct = 0;
    values.forEach(function (v) {
      var k = cellKind(v);
      if (k === 'blank') { blanks++; return; }
      counts[k] = (counts[k] || 0) + 1;
      var s = String(v).trim();
      if (!(s in distinct)) { distinct[s] = 1; nDistinct++; }
    });
    var filled = values.length - blanks;
    var winner = 'text', top = -1;
    Object.keys(counts).forEach(function (k) { if (counts[k] > top) { top = counts[k]; winner = k; } });

    /* integers and decimals in the same column resolve to decimal */
    if (counts.decimal && counts.integer) winner = 'decimal';
    /* a boolean-looking column of only 0/1 with two values is boolean, not integer */
    if (winner === 'integer' && nDistinct <= 2 && filled > 4) {
      var onlyBin = values.every(function (v) {
        var s = String(v).trim(); return s === '' || s === '0' || s === '1';
      });
      if (onlyBin) winner = 'boolean';
    }
    /* low-cardinality text behaves like a category */
    var isCategory = winner === 'text' && filled > 8 && nDistinct <= Math.max(2, filled * 0.12);

    return {
      name: name,
      type: isCategory ? 'category' : winner,
      distinct: nDistinct,
      blanks: blanks,
      filled: filled,
      unique: filled > 0 && nDistinct === filled,
      required: true,                       /* user-toggleable, required by default */
      inferredRequired: blanks === 0
    };
  }

  /* ===============================================================
     3. RELATIONSHIPS
     =============================================================== */
  function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

  /* group interchangeable inferred types */
  function family(t) {
    if (t === 'category' || t === 'text') return 'string';
    if (t === 'integer' || t === 'decimal') return 'number';
    return t;
  }

  /* "id" on its own says nothing about which table it belongs to, so two
     unrelated primary keys must not be treated as a match just because both
     are called id. Instead, qualify the generic name with the sheet name:
     orders.customer_id  ->  customers.id  is the pattern most files use. */
  var GENERIC = ['id', 'key', 'code', 'no', 'num', 'pk', 'index', 'rowid'];
  function stem(s) {
    var n = norm(s);
    return n.replace(/ies$/, 'y').replace(/s$/, '');
  }
  function namesRelated(ca, cb, sheetA, sheetB) {
    var na = norm(ca.name), nb = norm(cb.name);
    var ga = GENERIC.indexOf(na) >= 0, gb = GENERIC.indexOf(nb) >= 0;
    if (na === nb && !ga) return true;                       /* customer_id == customer_id */
    if (gb && na === stem(sheetB.name) + nb) return true;     /* orders.customer_id -> customers.id */
    if (ga && nb === stem(sheetA.name) + na) return true;
    if (!ga && !gb && na.length > 4 && nb.length > 4 &&
        (na.indexOf(nb) >= 0 || nb.indexOf(na) >= 0)) return true;
    return false;
  }

  function valueSet(sheet, ci, cap) {
    var set = Object.create(null), n = 0;
    for (var r = 0; r < sheet.rows.length && n < cap; r++) {
      var v = sheet.rows[r][ci];
      if (v == null) continue;
      var s = String(v).trim();
      if (s === '') continue;
      if (!(s in set)) { set[s] = 1; n++; }
    }
    return set;
  }

  function overlap(a, b) {
    var ka = Object.keys(a);
    if (!ka.length) return 0;
    var hit = 0;
    for (var i = 0; i < ka.length; i++) if (ka[i] in b) hit++;
    return hit / ka.length;
  }

  /* A determines B: every distinct A maps to exactly one B */
  function determines(sheet, ai, bi) {
    var map = Object.create(null), pairs = 0;
    var cap = Math.min(sheet.rows.length, 8000);
    for (var r = 0; r < cap; r++) {
      var a = sheet.rows[r][ai], b = sheet.rows[r][bi];
      if (a == null || b == null) continue;
      a = String(a).trim(); b = String(b).trim();
      if (a === '' || b === '') continue;
      if (a in map) { if (map[a] !== b) return 0; }
      else { map[a] = b; pairs++; }
    }
    return pairs >= 2 ? pairs : 0;
  }

  function numericValues(sheet, ci) {
    var out = [];
    for (var r = 0; r < sheet.rows.length; r++) {
      var v = sheet.rows[r][ci];
      if (v == null) continue;
      var n = parseFloat(String(v).replace(/[, ₹$€£%]/g, ''));
      out.push(isFinite(n) ? n : NaN);
    }
    return out;
  }

  function pearson(x, y) {
    var n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (var i = 0; i < x.length && i < y.length; i++) {
      var a = x[i], b = y[i];
      if (!isFinite(a) || !isFinite(b)) continue;
      n++; sx += a; sy += b; sxx += a * a; syy += b * b; sxy += a * b;
    }
    if (n < 8) return 0;
    var num = n * sxy - sx * sy;
    var den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
    return den === 0 ? 0 : num / den;
  }

  function findRelationships(sheets) {
    var rels = [];

    /* --- across sheets: shared keys --- */
    for (var i = 0; i < sheets.length; i++) {
      for (var j = i + 1; j < sheets.length; j++) {
        var A = sheets[i], B = sheets[j];
        var shared = [];
        A.cols.forEach(function (ca, ai) {
          B.cols.forEach(function (cb, bi) {
            if (ca.type === 'text' && ca.distinct > 400) return;

            var na = norm(ca.name), nb = norm(cb.name);

            /* --- 1. a genuine foreign key: the name points at a unique column --- */
            if (namesRelated(ca, cb, A, B) && (ca.unique || cb.unique)) {
              var sa = valueSet(A, ai, 2500), sb = valueSet(B, bi, 2500);
              var ab = overlap(sa, sb), ba = overlap(sb, sa);
              var child = null, parent = null, containment = 0;
              if (cb.unique && ab >= ba) { child = { s: i, c: ai }; parent = { s: j, c: bi }; containment = ab; }
              else if (ca.unique)        { child = { s: j, c: bi }; parent = { s: i, c: ai }; containment = ba; }
              if (child && containment >= 0.9) {
                rels.push({
                  kind: 'fk', from: child, to: parent,
                  label: Math.round(containment * 100) + '% matched', detail: '1:many'
                });
                return;
              }
            }

            /* --- 2. the same column present in both sheets ---
               Neither side needs to be a key. Two sheets that both carry
               `education` as a category are describing the same field, and
               that is worth drawing even though it is not a join key. */
            if (na !== nb) return;
            /* text and category are the same underlying kind — a 35-row sheet
               and a 32k-row sheet can infer them differently for one column */
            if (family(ca.type) !== family(cb.type)) return;
            var va = valueSet(A, ai, 1500), vb = valueSet(B, bi, 1500);
            var ov = Math.max(overlap(va, vb), overlap(vb, va));
            /* a matching name alone is weak evidence; require the values to
               actually correspond, otherwise every `id`/`name`/`date` column
               in the workbook links to every other one */
            if (ov < 0.5) return;
            shared.push({
              kind: 'shared', from: { s: i, c: ai }, to: { s: j, c: bi },
              label: Math.round(ov * 100) + '% shared values',
              detail: ca.type, w: ov
            });
          });
        });
        /* keep the strongest matches so two wide sheets do not build a wall */
        shared.sort(function (p2, q2) { return q2.w - p2.w; });
        /* every genuinely shared column gets an edge; the bundled label keeps
           the picture readable rather than a cap that hides real matches */
        shared.forEach(function (r) { rels.push(r); });
      }
    }

    /* --- inside one sheet: determinations and correlations --- */
    sheets.forEach(function (S, si) {
      var n = S.cols.length;
      var dets = [];
      for (var a = 0; a < n; a++) {
        for (var b = 0; b < n; b++) {
          if (a === b) continue;
          var ca = S.cols[a], cb = S.cols[b];
          /* A unique column determines every other column trivially — that is
             a property of being a key, not a relationship worth drawing. */
          if (ca.unique || cb.unique) continue;
          if (ca.distinct < 2 || ca.distinct > 30) continue;
          if (cb.distinct < 2 || cb.distinct > 30) continue;
          if (ca.distinct < cb.distinct) continue;
          if (ca.distinct === cb.distinct && a > b) continue;   /* one direction only */
          if (determines(S, a, b)) {
            dets.push({
              kind: 'det', from: { s: si, c: a }, to: { s: si, c: b },
              label: 'determines', detail: ca.name + ' -> ' + cb.name,
              w: ca.distinct
            });
          }
        }
      }
      dets.sort(function (p, q) { return q.w - p.w; });
      dets.slice(0, 3).forEach(function (d) { rels.push(d); });
      /* strong numeric correlation inside the sheet */
      var nums = [];
      S.cols.forEach(function (c, i) {
        if (c.type === 'integer' || c.type === 'decimal') nums.push(i);
      });
      var corrs = [];
      for (var p = 0; p < nums.length; p++) {
        for (var q = p + 1; q < nums.length; q++) {
          if (S.cols[nums[p]].unique || S.cols[nums[q]].unique) continue;  /* row ids are not signal */
          var r = pearson(numericValues(S, nums[p]), numericValues(S, nums[q]));
          if (Math.abs(r) >= 0.8) {
            corrs.push({
              kind: 'corr', from: { s: si, c: nums[p] }, to: { s: si, c: nums[q] },
              label: 'r = ' + r.toFixed(2), detail: 'correlation', w: Math.abs(r)
            });
          }
        }
      }
      corrs.sort(function (p2, q2) { return q2.w - p2.w; });
      corrs.slice(0, 3).forEach(function (c) { rels.push(c); });
    });

    /* keep it readable */
    return rels.slice(0, 240);
  }

  /* ===============================================================
     4. PROGRESS
     =============================================================== */
  function setStep(key, pct, label) {
    $$('span', progSteps).forEach(function (el) {
      var k = el.getAttribute('data-s');
      var order = ['read', 'parse', 'types', 'rels', 'layout'];
      var cur = order.indexOf(key), mine = order.indexOf(k);
      el.classList.toggle('done', mine < cur);
      el.classList.toggle('now', mine === cur);
    });
    progFill.style.width = pct + '%';
    progPct.textContent = Math.round(pct) + '%';
    if (label) progLabel.textContent = label;
  }
  function nextFrame() {
    return new Promise(function (res) { requestAnimationFrame(function () { setTimeout(res, 90); }); });
  }

  /* ===============================================================
     5. PIPELINE
     =============================================================== */
  function readFile(file, asBinary) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onerror = function () { rej(new Error('Could not read the file.')); };
      fr.onprogress = function (e) {
        if (e.lengthComputable) setStep('read', Math.min(18, (e.loaded / e.total) * 18));
      };
      fr.onload = function () { res(fr.result); };
      asBinary ? fr.readAsArrayBuffer(file) : fr.readAsText(file);
    });
  }

  async function handleFile(file) {
    dzErr.textContent = '';
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    var known = ['csv', 'tsv', 'txt', 'xlsx', 'xls', 'xlsm'];
    if (known.indexOf(ext) < 0) {
      dzErr.textContent = 'That file type is not supported yet — try .csv, .tsv, .xlsx or .xls.';
      return;
    }
    if (file.size > 60 * 1024 * 1024) {
      dzErr.textContent = 'That file is over 60 MB. Try a smaller extract for now.';
      return;
    }

    prog.classList.add('is-on');
    pickBtn.disabled = true;
    setStep('read', 4, 'Reading ' + file.name + '…');

    try {
      var sheets = [];
      var isExcel = ['xlsx', 'xls', 'xlsm'].indexOf(ext) >= 0;

      if (isExcel) {
        if (typeof XLSX === 'undefined') throw new Error('The Excel reader could not load. Check your connection.');
        var buf = await readFile(file, true);
        await nextFrame();
        setStep('parse', 30, 'Opening sheets…');
        var wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
        for (var si = 0; si < wb.SheetNames.length; si++) {
          var nm = wb.SheetNames[si];
          var rows = XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, blankrows: false, defval: null });
          var s = sheetFromRows(nm, rows);
          if (s && s.rows.length) sheets.push(s);
          setStep('parse', 30 + (si + 1) / wb.SheetNames.length * 18);
          await nextFrame();
        }
      } else {
        var text = await readFile(file, false);
        await nextFrame();
        setStep('parse', 34, 'Splitting rows…');
        var rows2 = parseCSV(text, sniffDelimiter(text));
        var s2 = sheetFromRows(file.name.replace(/\.[^.]+$/, ''), rows2);
        if (s2 && s2.rows.length) sheets.push(s2);
        setStep('parse', 48);
        await nextFrame();
      }

      if (!sheets.length) throw new Error('No readable rows were found in that file.');

      setStep('types', 56, 'Working out what each column holds…');
      await nextFrame();
      for (var k = 0; k < sheets.length; k++) {
        var S = sheets[k];
        S.cols = S.header.map(function (h, ci) {
          var vals = [];
          for (var r = 0; r < S.rows.length && r < 4000; r++) vals.push(S.rows[r][ci]);
          return profileColumn(h, vals);
        });
        setStep('types', 56 + (k + 1) / sheets.length * 16);
        await nextFrame();
      }

      setStep('rels', 76, 'Looking for relationships…');
      await nextFrame();

      setStep('layout', 92, 'Laying out the map…');
      await nextFrame();

      if (!model) model = { files: [], sheets: [], rels: [] };
      var fileIdx = model.files.length;
      model.files.push(file.name);
      (model.fileMeta = model.fileMeta || []).push({ name: file.name, size: file.size });
      sheets.forEach(function (sh) {
        sh.file = file.name;
        sh.fileIdx = fileIdx;
        /* two files can both contain a sheet called Sheet1 */
        sh.label = model.files.length > 1 ? (file.name.replace(/\.[^.]+$/, '') + ' · ' + sh.name) : sh.name;
        model.sheets.push(sh);
      });
      /* relationships are recomputed over everything, so a newly added file
         links straight into the sheets that were already on the canvas */
      model.rels = findRelationships(model.sheets);
      /* full layout for the first file, append-to-the-right for later ones */
      render(model.files.length > 1);

      setStep('layout', 100, 'Done');
      await nextFrame();
      prog.classList.remove('is-on');
      progFill.style.width = '0%';
      pickBtn.disabled = false;
      dropStage.style.display = 'none';
      work.classList.add('is-on');
      if (window.DLReport) window.DLReport.invalidate();
      if (DL.syncWorkspaceBar) DL.syncWorkspaceBar();
      requestAnimationFrame(function () { remeasure(); fit(); introduce(); });
      lastAdded = fileIdx;

    } catch (err) {
      prog.classList.remove('is-on');
      pickBtn.disabled = false;
      dzErr.textContent = err.message || 'Something went wrong reading that file.';
    }
  }

  /* ===============================================================
     6. RENDER
     =============================================================== */
  var HUES = ['#e8a94c', '#4fc9d6', '#8b7fd4', '#6ecfa0', '#e08a8a', '#d4b06a'];
  var FILE_HUES = ['#e8a94c', '#8b7fd4', '#4fc9d6', '#6ecfa0', '#e08a8a'];
  var groupLayer = null, selectedFile = -1;

  /* One translucent box per file so it is obvious which sheets came from
     where once several workbooks are on the canvas. */
  function buildGroups() {
    if (!groupLayer) return;
    groupLayer.innerHTML = model.files.map(function (f, fi) {
      return '<div class="group" data-f="' + fi + '">' +
               '<span class="group__t" data-f="' + fi + '" title="' + esc(f) + '">' + esc(f) + '</span>' +
             '</div>';
    }).join('');
    positionGroups();
    $$('.group__t', groupLayer).forEach(function (t) {
      var fi = +t.getAttribute('data-f');
      var gdrag = null;
      t.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
        t.setPointerCapture(e.pointerId);
        gdrag = {
          x: e.clientX, y: e.clientY, moved: false,
          start: model.sheets.filter(function (s) { return s.fileIdx === fi; })
            .map(function (s) { s._fresh = false; return { s: s, x: s.x, y: s.y }; })
        };
      });
      t.addEventListener('pointermove', function (e) {
        if (!gdrag) return;
        var dx = (e.clientX - gdrag.x) / view.k, dy = (e.clientY - gdrag.y) / view.k;
        if (!gdrag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        gdrag.moved = true;
        t.parentNode.classList.add('is-drag');
        gdrag.start.forEach(function (it) {
          it.s.x = it.x + dx; it.s.y = it.y + dy;
          it.s.el.style.left = it.s.x + 'px';
          it.s.el.style.top = it.s.y + 'px';
        });
        positionGroups();
        positionEdges();
      });
      ['pointerup', 'pointercancel'].forEach(function (ev) {
        t.addEventListener(ev, function () {
          if (!gdrag) return;
          t.parentNode.classList.remove('is-drag');
          /* a press that never moved is a click, so it selects instead */
          if (!gdrag.moved) selectFile(fi);
          else drawEdges();
          gdrag = null;
        });
      });
    });
  }

  /* Node height was being derived from a per-row constant, which ran ~43px
     short once padding and borders were counted — so boundaries clipped their
     own nodes. Read the real box instead, and the real row offsets with it. */
  function measureNodes() {
    model.sheets.forEach(function (s) {
      if (!s.el) return;
      s.w = s.el.offsetWidth;
      s.h = s.el.offsetHeight;
      s.rowY = $$('.col', s.el).map(function (c) { return c.offsetTop + c.offsetHeight / 2; });
    });
  }
  /* render() runs while the workspace is still display:none, where every
     offsetHeight reads 0 — so measure again once it is actually on screen */
  function remeasure() {
    if (!model) return;
    measureNodes();
    reflowVertical();
    drawEdges();
    positionGroups();
  }

  function nodeW(s) { return s.w || NODE_W; }
  function nodeH(s) { return s.h || (HEAD_H + s.cols.length * ROW_H); }
  function rowY(s, ci) {
    return (s.rowY && s.rowY[ci] != null) ? s.rowY[ci] : (HEAD_H + ci * ROW_H + ROW_H / 2);
  }

  var GROUP_PAD = 34;
  var LABEL_MARGIN = 66;  /* enough for a bracket's own label bubble, e.g. "determines" */

  /* A self-loop bracket bows outward by STUB + lane*LANE, and its label sits
     just past that. A fixed pad clipped both once more than one or two
     brackets stacked up — so the pad is now measured from what is actually
     on screen for this file: the deepest lane on whichever side it bows. */
  /* A single file's sheets can straddle the diagram's centre — one sheet
     bows left, another bows right — so reach has to be measured per side,
     not once for the whole file, or the side with fewer self-loops gets
     under-padded and its label spills past the boundary. */
  function selfLoopReach(fileIdx, wantsRight) {
    var meanX = model.sheets.reduce(function (a, n) { return a + n.x; }, 0) / model.sheets.length;
    var maxLane = -1;
    model.rels.forEach(function (r) {
      if (r.from.s !== r.to.s) return;
      var S = model.sheets[r.from.s];
      if (S.fileIdx !== fileIdx) return;
      if ((S.x >= meanX) !== wantsRight) return;
      maxLane = Math.max(maxLane, r._lane || 0);
    });
    if (maxLane < 0) return GROUP_PAD;
    return Math.max(GROUP_PAD, STUB + maxLane * LANE + LABEL_MARGIN);
  }

  /* how far above the topmost node any outer-bow edge for this file reaches */
  function bowReach(fileIdx) {
    var maxLane = -1;
    model.rels.forEach(function (r) {
      if (r.from.s === r.to.s || !r._bow) return;
      if (model.sheets[r.from.s].fileIdx !== fileIdx && model.sheets[r.to.s].fileIdx !== fileIdx) return;
      /* outerBowPath() spaces lanes using the GLOBAL _bowLane counter, not
         the per-sheet-pair _lane used for the diagonal fan. Reading _lane
         here silently under-measured the true bow depth on any file with
         more than one bow edge per pair — exactly the "edge above the
         boundary" bug: real reach was lane 3, this was computing lane 1. */
      maxLane = Math.max(maxLane, r._bowLane != null ? r._bowLane : 0);
    });
    if (maxLane < 0) return 0;
    return (56 + maxLane * 24) + 24 - GROUP_PAD;   /* 24 must match outerBowPath's own lane spacing */
  }

  function positionGroups() {
    if (!groupLayer) return;
    $$('.group', groupLayer).forEach(function (g) {
      var fi = +g.getAttribute('data-f');
      var mine = model.sheets.filter(function (s) { return s.fileIdx === fi; });
      if (!mine.length) { g.style.display = 'none'; return; }
      g.style.display = '';
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      mine.forEach(function (s) {
        minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
        maxX = Math.max(maxX, s.x + nodeW(s));
        maxY = Math.max(maxY, s.y + nodeH(s));
      });
      var padL = selfLoopReach(fi, false);
      var padR = selfLoopReach(fi, true);
      var padT = GROUP_PAD + Math.max(0, bowReach(fi));

      g.style.left   = (minX - padL) + 'px';
      g.style.top    = (minY - padT) + 'px';
      g.style.width  = (maxX - minX + padL + padR) + 'px';
      g.style.height = (maxY - minY + padT + GROUP_PAD) + 'px';
      g.style.setProperty('--gc', FILE_HUES[fi % FILE_HUES.length]);
      g.classList.toggle('is-sel', fi === selectedFile);
    });
  }

  function selectFile(fi) {
    selectedFile = (selectedFile === fi) ? -1 : fi;
    positionGroups();
    var btn = $('#newFile');
    if (btn) {
      btn.classList.toggle('is-armed', selectedFile >= 0);
      btn.title = selectedFile >= 0
        ? 'Remove ' + model.files[selectedFile]
        : 'Select a file boundary to remove it, or clear everything';
    }
  }

  /* ---------- remove one file ---------- */
  function removeFile(fi) {
    model.sheets = model.sheets.filter(function (s) { return s.fileIdx !== fi; });
    model.files.splice(fi, 1);
    model.sheets.forEach(function (s) { if (s.fileIdx > fi) s.fileIdx--; });
    selectedFile = -1;
    selected = -1;
    if (!model.sheets.length) { resetAll(); return; }
    model.rels = findRelationships(model.sheets);
    if (window.DLReport) window.DLReport.invalidate();
    if (DL.syncWorkspaceBar) DL.syncWorkspaceBar();
    render(true);
    fit();
  }

  function resetAll() {
    closeEdgePanel();
    if (window.DLReport) window.DLReport.invalidate();
    if (DL.syncWorkspaceBar) DL.syncWorkspaceBar();
    if (DL.closeAllWorkspaces) DL.closeAllWorkspaces(null);
    edgeRecs = [];
    work.classList.remove('is-on');
    dropStage.style.display = 'flex';
    fileInput.value = '';
    model = null; selected = -1; selectedFile = -1;
    dzErr.textContent = '';
  }

  function layout(preserve) {
    if (preserve) {
      var fresh = model.sheets.filter(function (s) { return s.x == null; });
      if (!fresh.length) return;
      var maxX = 0, minY = Infinity;
      model.sheets.forEach(function (s) {
        if (s.x == null) return;
        maxX = Math.max(maxX, s.x + NODE_W);
        minY = Math.min(minY, s.y);
      });
      if (!isFinite(minY)) minY = 0;
      var y = minY;
      fresh.forEach(function (s) {
        s.x = maxX + 130;
        s.y = y;
        s._fresh = true;
        y += HEAD_H + s.cols.length * ROW_H + 70;
      });
      return;
    }
    layoutAll();
  }

  /* Column assignment used to be a raw n%3 round-robin over sheets sorted
     by degree — it scattered directly-connected sheets into non-adjacent
     columns, forcing their edges to skip over whatever landed in between.
     This assigns columns by actual graph distance from the most-connected
     sheet (a BFS layering), so a sheet's neighbours land next to it far
     more often, and cross-sheet edges rarely need to jump a column. */
  function assignColumns() {
    var n = model.sheets.length;
    var adj = model.sheets.map(function () { return {}; });
    var deg = model.sheets.map(function () { return 0; });
    model.rels.forEach(function (r) {
      if (r.from.s === r.to.s) return;
      adj[r.from.s][r.to.s] = true; adj[r.to.s][r.from.s] = true;
      deg[r.from.s]++; deg[r.to.s]++;
    });
    var order = model.sheets.map(function (s, i) { return i; })
      .sort(function (a, b) { return deg[b] - deg[a]; });

    var col = new Array(n).fill(null);
    var root = order[0];
    col[root] = 0;
    var frontier = [root], seen = { }; seen[root] = true;
    while (frontier.length) {
      var next = [];
      frontier.forEach(function (u) {
        Object.keys(adj[u]).map(Number).sort(function (a, b) { return deg[b] - deg[a]; })
          .forEach(function (v) {
            if (seen[v]) return;
            seen[v] = true;
            col[v] = Math.max(-2, Math.min(2, col[u] + (v % 2 === 0 ? 1 : -1)));
            next.push(v);
          });
      });
      frontier = next;
    }
    /* anything unreached (no relationships at all) fills whichever side is lightest */
    order.forEach(function (i) {
      if (col[i] != null) return;
      var counts = {};
      col.forEach(function (c) { if (c != null) counts[c] = (counts[c] || 0) + 1; });
      var best = 0, bestN = Infinity;
      [-2, -1, 0, 1, 2].forEach(function (c) { var k = counts[c] || 0; if (k < bestN) { bestN = k; best = c; } });
      col[i] = best;
    });

    /* compact whichever column indices are actually used down to 0..k */
    var used = Array.from(new Set(col)).sort(function (a, b) { return a - b; });
    var reindex = {}; used.forEach(function (c, i) { reindex[c] = i; });
    return model.sheets.map(function (s, i) { return reindex[col[i]]; });
  }

  function layoutAll() {
    var COL_GAP = NODE_W + 230;
    var colOf = assignColumns();
    var numCols = Math.max.apply(null, colOf) + 1;
    var cols = []; for (var c = 0; c < numCols; c++) cols.push([]);
    colOf.forEach(function (c, i) { cols[c].push(i); });

    cols.forEach(function (colIdx, c) {
      var y = 0;
      colIdx.forEach(function (idx) {
        var s = model.sheets[idx];
        s.x = c * COL_GAP;
        s.y = y;
        s._fresh = true;                      /* eligible for post-measure reflow */
        y += HEAD_H + s.cols.length * ROW_H + 70;   /* first-pass estimate only */
      });
    });
    var maxH = 0;
    cols.forEach(function (colIdx) {
      var h = 0;
      colIdx.forEach(function (i) { h += HEAD_H + model.sheets[i].cols.length * ROW_H + 70; });
      maxH = Math.max(maxH, h);
    });
    cols.forEach(function (colIdx) {
      var h = 0;
      colIdx.forEach(function (i) { h += HEAD_H + model.sheets[i].cols.length * ROW_H + 70; });
      var off = (maxH - h) / 2;
      colIdx.forEach(function (i) { model.sheets[i].y += off; });
    });
  }

  /* The estimate above is only ever a first guess — real row height depends
     on font metrics this code shouldn't have to hardcode. Once the DOM has
     been measured for real, restack every freshly-placed column using the
     actual heights, so two nodes can never overlap regardless of how many
     columns or how long the names are. Sheets the user has dragged (not
     "_fresh") are left exactly where they were put. */
  function reflowVertical() {
    var byCol = {};
    model.sheets.forEach(function (s) {
      if (!s._fresh) return;
      (byCol[s.x] = byCol[s.x] || []).push(s);
    });
    Object.keys(byCol).forEach(function (x) {
      var col = byCol[x].sort(function (a, b) { return a.y - b.y; });
      var y = col[0].y;
      col.forEach(function (s) {
        s.y = y;
        if (s.el) { s.el.style.top = s.y + 'px'; }
        y += nodeH(s) + 70;
      });
    });
  }

  function render(preserve) {
    layout(preserve);
    world.innerHTML = '';
    DL.clear(edgesSvg);
    /* Layer order matters for hit testing: boundaries at the bottom, then the
       edges (so they stay clickable), then the nodes on top. The edges SVG
       therefore lives inside `world` and inherits its pan/zoom transform. */
    groupLayer = document.createElement('div');
    groupLayer.className = 'groups';
    world.appendChild(groupLayer);
    world.appendChild(edgesSvg);

    model.sheets.forEach(function (s, si) {
      s.color = HUES[si % HUES.length];
      var relCount = model.rels.filter(function (r) { return r.from.s === si || r.to.s === si; }).length;
      var n = document.createElement('div');
      n.className = 'node';
      n.setAttribute('data-s', si);
      n.style.left = s.x + 'px';
      n.style.top = s.y + 'px';
      n.innerHTML =
        '<div class="node__h"><i style="background:' + s.color + '"></i>' +
        '<b>' + esc(s.label || s.name) + '</b>' +
        (relCount ? '<em class="node__linkcount" title="' + relCount + ' relationship' + (relCount === 1 ? '' : 's') + ' touch this table">' + relCount + '</em>' : '') +
        '<s>' + s.rows.length.toLocaleString('en-US') + ' rows</s></div>' +
        s.cols.map(function (c, ci) {
          return '<div class="col" data-c="' + ci + '">' +
                   '<span class="col__n">' + esc(c.name) + '</span>' +
                   '<span class="col__t">' + c.type + '</span>' +
                   '<span class="col__req" data-req="1" role="button" tabindex="0" ' +
                     'title="Click to mark optional">req</span>' +
                 '</div>';
        }).join('');
      world.appendChild(n);
      s.el = n;
    });

    /* mark columns that take part in a relationship */
    model.rels.forEach(function (r) {
      [r.from, r.to].forEach(function (end) {
        var el = model.sheets[end.s].el.querySelector('[data-c="' + end.c + '"]');
        if (el) el.classList.add(r.kind === 'fk' ? 'is-key' : 'is-linked');
      });
    });

    measureNodes();
    reflowVertical();
    assignLanes();
    buildGroups();
    buildSidebar();
    drawEdges();
    positionGroups();   /* re-run once paths are known, so bow-reach padding is current, not stale */
    applyDisabledStates();   /* a sheet toggled off earlier stays off across re-renders */
    if (typeof kindHidden !== 'undefined') {
      $$('.edge[data-i]', edgesSvg).forEach(function (g) {
        var idx = +g.getAttribute('data-i'), r = model.rels[idx];
        if (r) g.classList.toggle('is-kindhidden', !!kindHidden[r.from.s === r.to.s ? 'inSheet' : r.kind]);
      });
    }
    emptyNote.style.display = model.rels.length ? 'none' : 'flex';
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function buildSidebar() {
    var nameTxt = model.files.length === 1 ? model.files[0] : model.files.length + ' files';
    fileNameEl.textContent = nameTxt;
    fileNameEl.title = model.files.join(', ');
    fileMetaEl.textContent = model.sheets.length + (model.sheets.length === 1 ? ' sheet' : ' sheets');

    var bar = $('#fileBar');
    if (bar) {
      bar.innerHTML = model.files.map(function (f, i) {
        var col = HUES[model.sheets.filter(function (s) { return s.fileIdx === i; })[0]
          ? model.sheets.indexOf(model.sheets.filter(function (s) { return s.fileIdx === i; })[0]) % HUES.length : 0];
        return '<span><i style="background:' + col + '"></i>' + esc(f) + '</span>';
      }).join('');
      bar.style.display = model.files.length > 1 ? 'flex' : 'none';
    }

    var html = '';
    model.files.forEach(function (f, fi) {
      if (model.files.length > 1) html += '<div class="sheetgroup">' + esc(f) + '</div>';
      model.sheets.forEach(function (s, i) {
        if (s.fileIdx !== fi) return;
        html += '<button class="sheetbtn' + (s.disabled ? ' is-disabled' : '') + '" data-s="' + i + '">' +
                  '<i style="background:' + s.color + '"></i>' +
                  '<span><b>' + esc(s.name) + '</b>' +
                  '<s>' + s.cols.length + ' cols · ' + s.rows.length.toLocaleString('en-US') + ' rows</s></span>' +
                  '<span class="sheet-eye" data-eye="' + i + '" title="' + (s.disabled ? 'Show this sheet' : 'Hide this sheet — greys it out on the canvas') + '">' +
                    '<svg viewBox="0 0 24 24" class="eye-on"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>' +
                    '<svg viewBox="0 0 24 24" class="eye-off"><path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M6.5 6.7C3.8 8.4 1.5 12 1.5 12s3.5 7 10.5 7c1.8 0 3.4-.4 4.7-1.1M17.6 17.6C20.3 15.9 22.5 12 22.5 12s-1-2-3-4"/></svg>' +
                  '</span>' +
                '</button>';
      });
    });
    sheetList.innerHTML = html;

    var totalRows = model.sheets.reduce(function (a, s) { return a + s.rows.length; }, 0);
    var totalCols = model.sheets.reduce(function (a, s) { return a + s.cols.length; }, 0);
    var cross = model.rels.filter(function (r) { return r.from.s !== r.to.s; }).length;
    sideStats.innerHTML =
      '<em>' + totalRows.toLocaleString('en-US') + '</em> rows · <em>' + totalCols + '</em> columns<br>' +
      '<em>' + cross + '</em> cross-sheet links<br>' +
      '<em>' + (model.rels.length - cross) + '</em> in-sheet links' +
      (model.files.length > 1
        ? '<br><em>' + model.rels.filter(function (r) {
            return model.sheets[r.from.s].fileIdx !== model.sheets[r.to.s].fileIdx;
          }).length + '</em> cross-<b>file</b> links' : '');

    $$('.sheetbtn', sheetList).forEach(function (b) {
      b.addEventListener('click', function (e) {
        if (e.target.closest('.sheet-eye')) return;
        selectSheet(+b.getAttribute('data-s'));
      });
    });
    $$('.sheet-eye', sheetList).forEach(function (eye) {
      eye.addEventListener('click', function (e) {
        e.stopPropagation();
        var i = +eye.getAttribute('data-eye');
        model.sheets[i].disabled = !model.sheets[i].disabled;
        applyDisabledStates();
      });
    });
  }

  /* Toggling a sheet off dims its node and every edge touching it, without
     removing anything — flip it back and the diagram is exactly as it was.
     This is what lets a user visually isolate the two or three sheets they
     actually care about in a busy multi-sheet workbook. */
  function applyDisabledStates() {
    model.sheets.forEach(function (s, i) {
      if (s.el) s.el.classList.toggle('is-disabled', !!s.disabled);
      var row = sheetList.querySelector('.sheetbtn[data-s="' + i + '"]');
      if (row) row.classList.toggle('is-disabled', !!s.disabled);
      var eye = sheetList.querySelector('.sheet-eye[data-eye="' + i + '"]');
      if (eye) eye.title = s.disabled ? 'Show this sheet' : 'Hide this sheet — greys it out on the canvas';
    });
    $$('.edge[data-i]', edgesSvg).forEach(function (g) {
      var a = +g.getAttribute('data-a'), b = +g.getAttribute('data-b');
      g.classList.toggle('is-dimmed', !!(model.sheets[a] && model.sheets[a].disabled) || !!(model.sheets[b] && model.sheets[b].disabled));
    });
  }

  /* ---------------- edges ---------------- */

  /* =====================================================================
     RELATIONSHIP BUNDLING
     Twenty separate lines between the same two tables cannot be made
     readable by spacing them — that was the mistake behind several
     rounds of gap-widening. Professional ER tools collapse them into a
     single connector labelled with the count, and only expand to
     column-level detail when you ask for it. Same approach here:

       default        one connector per TABLE PAIR, labelled "20 links"
       focused table  that table's pairs expand to per-column edges

     This removes the convergence problem at the source rather than
     trying to survive it.
     ===================================================================== */
  var expandedSheet = -1;

  function computeBundles() {
    var groups = {};
    model.rels.forEach(function (r) {
      r._bundleRep = false; r._bundleHidden = false; r._bundleCount = 0;
      if (r.from.s === r.to.s) return;              /* in-sheet edges never bundle */
      var k = Math.min(r.from.s, r.to.s) + '-' + Math.max(r.from.s, r.to.s);
      (groups[k] = groups[k] || []).push(r);
    });
    Object.keys(groups).forEach(function (k) {
      var members = groups[k];
      var parts = k.split('-').map(Number);
      var expanded = expandedSheet >= 0 &&
        (parts[0] === expandedSheet || parts[1] === expandedSheet);
      /* a pair with only 1-2 links is already legible — leave it detailed */
      if (expanded || members.length <= 2) return;
      members.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
      members[0]._bundleRep = true;
      members[0]._bundleCount = members.length;
      members[0]._bundleMembers = members;
      for (var i = 1; i < members.length; i++) members[i]._bundleHidden = true;
    });
  }

  function anchor(end, side, bundled) {
    var s = model.sheets[end.s];
    /* a bundled connector represents the whole table, so it leaves from the
       table's vertical centre — anchoring it to one arbitrary member's row
       would imply a column-level meaning it doesn't have. Every other
       anchor sits exactly on its row: that IS the dot's correct position,
       not an approximation of it. */
    var y = bundled ? (s.y + nodeH(s) / 2) : (s.y + rowY(s, end.c));
    return { x: side === 'l' ? s.x : s.x + nodeW(s), y: y };
  }

  /* When one column feeds several relationships at once (a single "Element"
     column shared with three other sheets, say), every one of those edges
     starts from the identical pixel — they sit fully coincident until they
     happen to diverge, reading as a single overlapping line. This fans
     them out by a few px right at the anchor so each is visible from the
     first pixel, without touching how the rest of the path is routed. */
  var edgeRecs = [];

  /* =====================================================================
     CONNECTOR DOTS — redesigned
     Badges used to search along the path for a spot that happened to be
     clear of node bodies and other badges — which is backwards. A
     connector dot's correct position isn't "wherever is free", it's
     exactly on the row it represents: that IS the anchor point already
     computed by anchor(). Placing it there directly means it can never
     wander onto a node's surface or need collision-avoidance, because
     every row has its own y position and rows are never on top of each
     other. The only real fan-out need is for the LINE, when several
     relationships share a pair of tables — and that now happens just
     past the dot, not at it.
     ===================================================================== */
  function placeBadge(g, x, y) {
    if (!g) return;
    g.setAttribute('transform', 'translate(' + x + ',' + y + ')');
  }


  function positionEdges() {
    edgeRecs.forEach(function (rec) {
      var d = pathFor(rec.rel);
      rec.base.setAttribute('d', d);
      rec.glow.setAttribute('d', d);
      rec.flow.setAttribute('d', d);
      rec.hit.setAttribute('d', d);
      rec.len = rec.base.getTotalLength();

      if (rec.badgeA) { var pA = rec.base.getPointAtLength(0); placeBadge(rec.badgeA, pA.x, pA.y); }
      if (rec.badgeB) { var pB = rec.base.getPointAtLength(rec.len); placeBadge(rec.badgeB, pB.x, pB.y); }

      if (rec.lab) {
        var mid = rec.base.getPointAtLength(rec.len * rec.t);
        rec.rect.setAttribute('x', mid.x - rec.w / 2);
        rec.rect.setAttribute('y', mid.y - 9);
        rec.text.setAttribute('x', mid.x);
        rec.text.setAttribute('y', mid.y + 3.4);
      }
    });
    sizeSvg();
  }

  /* ---------------------------------------------------------------
     Orthogonal routing, in the style ChartDB uses: leave the column
     horizontally, travel in a vertical channel, arrive horizontally.
     Corners are rounded so the run still reads as one line.
     --------------------------------------------------------------- */
  var STUB = 24, LANE = 15, CORNER = 8;
  /* 'straight' = direct run between the two rows; 'stepped' = orthogonal
     channels. Straight reads cleaner at a glance, so it is the default. */
  var edgeStyle = 'straight';

  function roundedOrtho(pts) {
    if (pts.length < 3) return 'M ' + pts[0].x + ' ' + pts[0].y + ' L ' + pts[1].x + ' ' + pts[1].y;
    var d = 'M ' + pts[0].x + ' ' + pts[0].y;
    for (var i = 1; i < pts.length - 1; i++) {
      var p = pts[i], prev = pts[i - 1], next = pts[i + 1];
      var d1 = Math.hypot(p.x - prev.x, p.y - prev.y);
      var d2 = Math.hypot(next.x - p.x, next.y - p.y);
      var rr = Math.min(CORNER, d1 / 2, d2 / 2);
      if (rr < 0.5) { d += ' L ' + p.x + ' ' + p.y; continue; }
      var a = { x: p.x + (prev.x - p.x) / d1 * rr, y: p.y + (prev.y - p.y) / d1 * rr };
      var b = { x: p.x + (next.x - p.x) / d2 * rr, y: p.y + (next.y - p.y) / d2 * rr };
      d += ' L ' + a.x + ' ' + a.y + ' Q ' + p.x + ' ' + p.y + ' ' + b.x + ' ' + b.y;
    }
    var last = pts[pts.length - 1];
    return d + ' L ' + last.x + ' ' + last.y;
  }

  /* Each edge gets its own vertical channel so parallel runs never sit on
     top of one another — this is what made the in-sheet links unreadable. */
  function assignLanes() {
    /* Same-sheet links used to get a lane in whatever order they were found,
       which let a short bracket and a long one share nearly the same channel
       and cross. Sorting by how far apart the two rows are and nesting the
       closest pairs innermost keeps every bracket clear of every other. */
    var bySheet = {};
    model.rels.forEach(function (r) {
      if (r.from.s !== r.to.s) return;
      (bySheet[r.from.s] = bySheet[r.from.s] || []).push(r);
    });
    Object.keys(bySheet).forEach(function (sid) {
      var list = bySheet[sid];
      list.sort(function (a, b) { return Math.abs(a.from.c - a.to.c) - Math.abs(b.from.c - b.to.c); });
      list.forEach(function (r, i) { r._lane = i; });
    });

    var perPair = {};
    model.rels.forEach(function (r) {
      if (r.from.s === r.to.s) return;
      var k = Math.min(r.from.s, r.to.s) + '-' + Math.max(r.from.s, r.to.s);
      perPair[k] = (perPair[k] || 0);
      r._lane = perPair[k]++;
    });
    /* how many edges connect this exact pair of sheets, so straight mode
       knows how wide a fan to spread them into (see pathFor) */
    var pairTotal = {};
    model.rels.forEach(function (r) {
      if (r.from.s === r.to.s) return;
      var k = Math.min(r.from.s, r.to.s) + '-' + Math.max(r.from.s, r.to.s);
      pairTotal[k] = (pairTotal[k] || 0) + 1;
    });
    model.rels.forEach(function (r) {
      if (r.from.s === r.to.s) return;
      var k = Math.min(r.from.s, r.to.s) + '-' + Math.max(r.from.s, r.to.s);
      r._pairTotal = pairTotal[k];
    });
  }

  /* Liang-Barsky segment/AABB clip test — used to detect whether a proposed
     edge path would visually cross through a node it does not connect to. */
  function segHitsRect(ax, ay, bx, by, r) {
    var dx = bx - ax, dy = by - ay, t0 = 0, t1 = 1;
    var p = [-dx, dx, -dy, dy], q = [ax - r.x1, r.x2 - ax, ay - r.y1, r.y2 - ay];
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return false; }
      else {
        var t = q[i] / p[i];
        if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
        else { if (t < t0) return false; if (t < t1) t1 = t; }
      }
    }
    return true;
  }
  function nodeRect(s) {
    var m = 3; /* small inset so an edge grazing a node's own border doesn't false-positive */
    return { x1: s.x + m, y1: s.y + m, x2: s.x + nodeW(s) - m, y2: s.y + nodeH(s) - m };
  }
  function pathHitsOtherNode(pts, excludeA, excludeB) {
    for (var i = 0; i < model.sheets.length; i++) {
      if (i === excludeA || i === excludeB) continue;
      var rect = nodeRect(model.sheets[i]);
      for (var k = 0; k < pts.length - 1; k++) {
        if (segHitsRect(pts[k].x, pts[k].y, pts[k + 1].x, pts[k + 1].y, rect)) return true;
      }
    }
    return false;
  }

  /* When a straight or gutter path would cut through a node it doesn't
     touch — the exact "edges crossing under nodes" complaint — this exits
     the source vertically, travels in a lane above every node on the
     canvas, then drops into the target. Nothing sits up there, so the
     crossing becomes structurally impossible rather than just unlikely. */
  /* Bow edges used to reuse the per-sheet-pair lane index, which resets to
     0 for every new pair — so bow edges from DIFFERENT pairs kept landing
     in the same one or two lanes and stacked on top of each other at the
     top of the diagram. This is the real cause of the near-horizontal
     "single line" cluster: it needs its own counter, shared across every
     bow edge regardless of which sheets it connects. */
  var bowLaneCounter = 0;
  function outerBowPath(r, a, b) {
    if (r._bowLane == null) r._bowLane = bowLaneCounter++;
    var topY = Math.min.apply(null, model.sheets.map(function (s) { return s.y; })) - 56 - r._bowLane * 24;
    return roundedOrtho([a, { x: a.x, y: topY }, { x: b.x, y: topY }, b]);
  }

  function pathFor(r) {
    var lane = r._lane || 0;

    /* --- inside one sheet: a bracket out to the side, in its own channel --- */
    if (r.from.s === r.to.s) {
      var me = model.sheets[r.from.s];
      var mean = model.sheets.reduce(function (a, n) { return a + n.x; }, 0) / model.sheets.length;
      var dir = me.x >= mean ? 1 : -1;
      var side = dir > 0 ? 'r' : 'l';
      var a1 = anchor(r.from, side), b1 = anchor(r.to, side);
      var channel = a1.x + dir * (STUB + lane * LANE);
      return roundedOrtho([a1, { x: channel, y: a1.y }, { x: channel, y: b1.y }, b1]);
    }

    /* --- between sheets --- */
    var fs = model.sheets[r.from.s], ts = model.sheets[r.to.s];
    var fromRight = fs.x + nodeW(fs) / 2 <= ts.x + nodeW(ts) / 2;
    var isBundle = !!r._bundleRep;
    var a = anchor(r.from, fromRight ? 'r' : 'l', isBundle);
    var b = anchor(r.to, fromRight ? 'l' : 'r', isBundle);

    /* A bundle is a single connector between two tables — it gets a clean
       direct run with no fan and no lane offset, because there is nothing
       parallel to it to be confused with. */
    if (isBundle) {
      var straight = [a, b];
      if (pathHitsOtherNode(straight, r.from.s, r.to.s)) {
        r._bow = true;
        return outerBowPath(r, a, b);
      }
      r._bow = false;
      return 'M ' + a.x + ' ' + a.y + ' L ' + b.x + ' ' + b.y;
    }

    var candidate, curveCtrl = null;
    if (edgeStyle === 'straight' || Math.abs(a.y - b.y) < 1.5) {
      /* A dead-straight line was fine for one edge between two sheets, but
         with several rows connecting the same pair the lines run almost
         exactly parallel and read as a single thick line — the "becoming
         one line" complaint. Bow each one gently off the straight path,
         spread by its lane, so a busy pair fans out instead of stacking. */
      if ((r._pairTotal || 1) > 1) {
        var total = r._pairTotal, laneIdx = r._lane || 0;
        /* 15px of separation measured fine in isolation but these diagrams
           get viewed fitted-to-screen — at ~58% zoom on a 6-sheet file that
           becomes ~9 screen px, which is what still read as one thick line.
           Scale the fan with how many edges share the pair so a busy pair
           opens up properly instead of staying cramped. */
        var spread = (laneIdx - (total - 1) / 2) * Math.max(26, Math.min(46, 320 / total));
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        var ddx = b.x - a.x, ddy = b.y - a.y;
        var dlen = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
        curveCtrl = { x: mx + (-ddy / dlen) * spread, y: my + (ddx / dlen) * spread };
        candidate = [a, curveCtrl, b];
      } else {
        candidate = [a, b];
      }
    } else {
      var gap = b.x - a.x;
      var mid = a.x + gap / 2 + (lane - 0.5) * LANE * (fromRight ? 1 : -1);
      var lo = Math.min(a.x, b.x) + STUB, hi = Math.max(a.x, b.x) - STUB;
      if (hi > lo) mid = Math.max(lo, Math.min(hi, mid));
      candidate = [a, { x: mid, y: a.y }, { x: mid, y: b.y }, b];
    }

    if (pathHitsOtherNode(candidate, r.from.s, r.to.s)) {
      r._bow = true;
      return outerBowPath(r, a, b);
    }
    r._bow = false;
    if (curveCtrl) return 'M ' + a.x + ' ' + a.y + ' Q ' + curveCtrl.x + ' ' + curveCtrl.y + ' ' + b.x + ' ' + b.y;
    return candidate.length === 2
      ? 'M ' + a.x + ' ' + a.y + ' L ' + b.x + ' ' + b.y
      : roundedOrtho(candidate);
  }

  function drawEdges() {
    computeBundles();       /* decide what collapses before anything is measured */
    assignLanes();
    bowLaneCounter = 0;
    /* _bowLane deliberately persists across positionEdges() calls during a
       drag, so a bow edge doesn't reshuffle lanes mid-gesture. A full
       drawEdges() pass is a clean rebuild though, and reusing stale lane
       numbers here is exactly what fragmented the count into 0,1,0,1,2
       instead of a proper 0,1,2,3,4 sequence — clear it so every full
       redraw recomputes lanes from scratch. */
    model.rels.forEach(function (r) { r._bowLane = null; });
    edgeRecs = [];
    DL.clear(edgesSvg);
    var placed = [];

    /* Two wide sheets can share a dozen columns. Labelling each one turns the
       gap into an unreadable stack, so a busy pair gets one bundled label
       and its individual edges stay label-free (their badges still say
       enough, and the click panel has the rest). */
    var pairCount = {};
    function pairKey(r) { return Math.min(r.from.s, r.to.s) + '-' + Math.max(r.from.s, r.to.s); }
    model.rels.forEach(function (r) {
      if (r.from.s === r.to.s) return;
      var k = pairKey(r);
      pairCount[k] = (pairCount[k] || 0) + 1;
    });
    var bundled = {};
    function overlapsPlaced(x, y, w) {
      return placed.some(function (p) {
        return Math.abs(p.x - x) < (p.w + w) / 2 + 6 && Math.abs(p.y - y) < 22;
      });
    }

    var KIND_COLOR = { fk: '#e8a94c', shared: '#8b7fd4', det: '#4fc9d6', corr: '#4fc9d6' };

    model.rels.forEach(function (r, i) {
      if (r._bundleHidden) return;      /* collapsed into its pair's connector */
      var sameSheet = r.from.s === r.to.s;
      var color = KIND_COLOR[r.kind] || '#4fc9d6';
      var d = pathFor(r);

      var g = DL.svg('g', {
        'class': 'edge' + (r._bundleRep ? ' is-bundle' : ''), 'data-i': i,
        'data-a': r.from.s, 'data-b': r.to.s, 'data-kind': r.kind
      }, edgesSvg);

      /* Base is the quiet ChartDB-style neutral line, always visible. Glow
         and flow are the coloured, animated layers reserved for hover and
         the selected edge, so the resting canvas stays calm even with
         dozens of links on screen. */
      var glow = DL.svg('path', { 'class': 'edge__glow', d: d, stroke: color }, g);
      var base = DL.svg('path', { 'class': 'edge__base', d: d }, g);
      var flow = DL.svg('path', { 'class': 'edge__flow', d: d, stroke: color }, g);
      /* an invisible fat stroke widens the thin edge into a clickable target */
      var hit = DL.svg('path', { 'class': 'edge__hit', d: d }, g);

      g.addEventListener('click', function (ev) { ev.stopPropagation(); openEdgePanel(r, g); });
      g.addEventListener('pointerenter', function () { g.classList.add('is-hover'); });
      g.addEventListener('pointerleave', function () { g.classList.remove('is-hover'); });

      var rec = { rel: r, base: base, glow: glow, flow: flow, hit: hit, len: base.getTotalLength() };

      /* Cardinality badges only where cardinality is real: a foreign key has
         a genuine "one" and "many" side. A shared column is symmetric, so it
         gets a plain coloured dot instead of asserting a direction that
         isn't there. In-sheet links skip badges entirely — with several of
         them nested close together, badges would be the clutter. */
      if (!sameSheet) {
        var gradId = r.kind === 'fk' ? 'gradFk' : (r.kind === 'shared' ? 'gradShared' : 'gradLink');
        var mkBadge = function (letter) {
          var bg = DL.svg('g', { 'class': 'edge__badge' + (letter ? '' : ' edge__badge--dot') }, g);
          /* halo (soft coloured glow, blurred) + ring (gradient-filled, crisp
             stroke) + letter — a small "aperture" that echoes the lens motif
             instead of a flat dark disc. */
          DL.svg('circle', { 'class': 'badge__halo', fill: color }, bg);
          DL.svg('circle', { 'class': 'badge__ring', fill: 'url(#' + gradId + ')', stroke: color }, bg);
          if (letter) { var t = DL.svg('text', {}, bg); t.textContent = letter; }
          return bg;
        };
        if (r.kind === 'fk') {
          rec.badgeA = mkBadge('N'); rec.badgeB = mkBadge('1');
        } else if (r.kind === 'shared') {
          /* the same data available for FK cardinality applies here — a
             shared column is worth labelling 1/N too when one side happens
             to be unique, not just when it was detected as a formal key */
          var ca = model.sheets[r.from.s].cols[r.from.c], cb = model.sheets[r.to.s].cols[r.to.c];
          if (ca.unique && !cb.unique) { rec.badgeA = mkBadge('1'); rec.badgeB = mkBadge('N'); }
          else if (cb.unique && !ca.unique) { rec.badgeA = mkBadge('N'); rec.badgeB = mkBadge('1'); }
          else if (ca.unique && cb.unique) { rec.badgeA = mkBadge('1'); rec.badgeB = mkBadge('1'); }
          else { rec.badgeA = mkBadge(null); rec.badgeB = mkBadge(null); }
        } else {
          rec.badgeA = mkBadge(null); rec.badgeB = mkBadge(null);
        }
        var startPt = base.getPointAtLength(0), endPt = base.getPointAtLength(rec.len);
        placeBadge(rec.badgeA, startPt.x, startPt.y);
        placeBadge(rec.badgeB, endPt.x, endPt.y);
      }

      edgeRecs.push(rec);

      /* label near the midpoint, slid along the path if it would collide.
         A bundle carries its own count label; the old "busy pair" deferred
         label is no longer needed for bundled pairs because there is only
         one connector to label now. */
      var busy = !sameSheet && !r._bundleRep && pairCount[pairKey(r)] > 3;
      if (busy) {
        var bk = pairKey(r);
        if (!bundled[bk]) bundled[bk] = { n: 0, x: 0, y: 0, fk: 0 };
        var bp = base.getPointAtLength(rec.len * 0.5);
        bundled[bk].n++; bundled[bk].x += bp.x; bundled[bk].y += bp.y;
        if (r.kind === 'fk') bundled[bk].fk++;
        return;
      }
      var text = r._bundleRep
        ? (r._bundleCount + ' linked columns')
        : r.label;
      var w = text.length * 5.6 + 14;
      var mid = null;
      [0.5, 0.38, 0.62, 0.28, 0.72].some(function (t) {
        var pt = base.getPointAtLength(rec.len * t);
        if (!overlapsPlaced(pt.x, pt.y, w)) { mid = { x: pt.x, y: pt.y, __t: t }; return true; }
        return false;
      });
      if (!mid) {
        var pm = base.getPointAtLength(rec.len * 0.5);
        mid = { x: pm.x, y: pm.y + 22, __t: 0.5 };
      }

      /* A self-loop's label can land close enough to the channel that its
         own width spills back over the node it left from. Clamp its near
         edge clear of that node regardless of which candidate point won. */
      if (sameSheet) {
        var S = model.sheets[r.from.s];
        var meanX = model.sheets.reduce(function (a, n) { return a + n.x; }, 0) / model.sheets.length;
        var bowsRight = S.x >= meanX;
        var nodeR = S.x + nodeW(S), nodeL = S.x;
        mid.x = bowsRight ? Math.max(mid.x, nodeR + 6 + w / 2) : Math.min(mid.x, nodeL - 6 - w / 2);
      }

      placed.push({ x: mid.x, y: mid.y, w: w });
      var lab = DL.svg('g', { 'class': 'edge__lab' }, g);
      var rect = DL.svg('rect', { x: mid.x - w / 2, y: mid.y - 9, width: w, height: 18, rx: 9 }, lab);
      var t2 = DL.svg('text', { x: mid.x, y: mid.y + 3.4, 'text-anchor': 'middle' }, lab);
      t2.textContent = text;
      rec.lab = lab; rec.rect = rect; rec.text = t2; rec.w = w;
      rec.t = mid.__t || 0.5;
    });

    /* one label per busy pair, at the centre of that bundle */
    Object.keys(bundled).forEach(function (k) {
      var bnd = bundled[k];
      var x = bnd.x / bnd.n, y = bnd.y / bnd.n;
      var txt = bnd.n + (bnd.fk ? ' links' : ' shared columns');
      var w = txt.length * 5.6 + 16;
      var g = DL.svg('g', { 'class': 'edge__lab edge__lab--bundle' }, edgesSvg);
      DL.svg('rect', { x: x - w / 2, y: y - 10, width: w, height: 20, rx: 10 }, g);
      var t3 = DL.svg('text', { x: x, y: y + 3.6, 'text-anchor': 'middle' }, g);
      t3.textContent = txt;
    });

    sizeSvg();
  }

  function sizeSvg() {
    var maxX = 0, maxY = 0;
    model.sheets.forEach(function (s) {
      maxX = Math.max(maxX, s.x + nodeW(s) + 220);
      maxY = Math.max(maxY, s.y + nodeH(s) + 220);
    });
    edgesSvg.setAttribute('width', maxX);
    edgesSvg.setAttribute('height', maxY);
    edgesSvg.style.width = maxX + 'px';
    edgesSvg.style.height = maxY + 'px';
  }

  /* ---------------- selection ---------------- */
  var selected = -1;
  function selectSheet(i) {
    selected = (selected === i) ? -1 : i;
    $$('.node', world).forEach(function (n, k) {
      n.classList.toggle('is-sel', k === selected);
      n.classList.toggle('is-dim', selected >= 0 && k !== selected && !linked(k, selected));
    });
    $$('.sheetbtn', sheetList).forEach(function (b, k) {
      b.classList.toggle('is-sel', k === selected);
    });
    $$('.edge[data-i]', edgesSvg).forEach(function (g) {
      var a = +g.getAttribute('data-a'), b = +g.getAttribute('data-b');
      g.classList.toggle('is-mute', selected >= 0 && a !== selected && b !== selected);
    });
    /* Selecting a table is exactly the moment its column-level detail
       becomes useful, so its bundles expand while everything else stays
       collapsed and quiet. */
    expandedSheet = selected;
    drawEdges();
    if (selected >= 0) focusFit(selected);
  }

  /* Premium touch #1: selecting a table doesn't just dim the rest — it
     smoothly reframes the view around that table and everything it
     directly connects to, so a "focus" click actually behaves like one
     instead of leaving you to pan and zoom manually afterward. */
  function focusFit(si) {
    var involved = [si];
    model.sheets.forEach(function (s, k) { if (k !== si && linked(k, si)) involved.push(k); });
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    involved.forEach(function (k) {
      var s = model.sheets[k];
      minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
      maxX = Math.max(maxX, s.x + nodeW(s)); maxY = Math.max(maxY, s.y + nodeH(s));
    });
    var r = canvas.getBoundingClientRect(), pad = 80;
    var k2 = Math.min((r.width - pad * 2) / (maxX - minX), (r.height - pad * 2) / (maxY - minY), 1.1);
    k2 = Math.max(0.25, k2);
    var tx = (r.width - (maxX - minX) * k2) / 2 - minX * k2;
    var ty = (r.height - (maxY - minY) * k2) / 2 - minY * k2;
    if (window.gsap && !DL.reduced) {
      gsap.to(view, { x: tx, y: ty, k: k2, duration: .55, ease: 'power2.out', onUpdate: applyView });
    } else { view.x = tx; view.y = ty; view.k = k2; applyView(); }
  }
  function linked(a, b) {
    return model.rels.some(function (r) {
      return (r.from.s === a && r.to.s === b) || (r.from.s === b && r.to.s === a);
    });
  }

  /* ===============================================================
     7. CANVAS: pan, zoom, node drag
     =============================================================== */
  function applyView() {
    world.style.transform =
      'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.k + ')';
    zLabel.textContent = Math.round(view.k * 100) + '%';
  }

  function zoomAt(cx, cy, factor) {
    var k2 = Math.min(2.4, Math.max(0.2, view.k * factor));
    var r = canvas.getBoundingClientRect();
    var px = cx - r.left, py = cy - r.top;
    view.x = px - (px - view.x) * (k2 / view.k);
    view.y = py - (py - view.y) * (k2 / view.k);
    view.k = k2;
    applyView();
  }

  function fit() {
    if (!model || !model.sheets.length) return;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    model.sheets.forEach(function (s) {
      minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
      maxX = Math.max(maxX, s.x + nodeW(s));
      maxY = Math.max(maxY, s.y + nodeH(s));
    });
    var maxReach = GROUP_PAD, maxBow = 0;
    model.files.forEach(function (fi2, idx) {
      maxReach = Math.max(maxReach, selfLoopReach(idx, true), selfLoopReach(idx, false));
      maxBow = Math.max(maxBow, bowReach(idx));
    });
    minX -= maxReach + 20; maxX += maxReach + 20;
    minY -= GROUP_PAD + 20 + Math.max(0, maxBow); maxY += GROUP_PAD + 20;
    var r = canvas.getBoundingClientRect(), pad = 40;
    var k = Math.min((r.width - pad * 2) / (maxX - minX), (r.height - pad * 2) / (maxY - minY), 1.15);
    view.k = Math.max(0.2, k);
    view.x = (r.width - (maxX - minX) * view.k) / 2 - minX * view.k;
    view.y = (r.height - (maxY - minY) * view.k) / 2 - minY * view.k;
    applyView();
  }

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.11 : 0.9);
  }, { passive: false });

  var pan = null;
  canvas.addEventListener('pointerdown', function (e) {
    /* the toolbar and legend sit inside the canvas; capturing the pointer for a
       pan here stopped their click events from ever firing */
    /* an edge must be excluded here too, or the pointer capture below
       redirects its eventual click to the canvas before the edge's own
       listener ever sees it — the actual cause of edge clicks doing nothing */
    if (e.target.closest('.node, .tools, .legend, .group__t, .edge')) return;
    pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, target: e.target, moved: false };
    canvas.classList.add('is-panning');
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!pan) return;
    if (Math.abs(e.clientX - pan.x) + Math.abs(e.clientY - pan.y) > 4) pan.moved = true;
    view.x = pan.vx + (e.clientX - pan.x);
    view.y = pan.vy + (e.clientY - pan.y);
    applyView();
  });
  ['pointerup', 'pointercancel'].forEach(function (ev) {
    canvas.addEventListener(ev, function () {
      /* the canvas captures the pointer to pan, so a click on a boundary never
         reaches it — resolve the tap here instead */
      if (pan && !pan.moved && pan.target) {
        var g = pan.target.closest && pan.target.closest('.group');
        if (g) selectFile(+g.getAttribute('data-f'));
        else if (!pan.target.closest || !pan.target.closest('.edge')) closeEdgePanel();
      }
      pan = null;
      canvas.classList.remove('is-panning');
    });
  });

  /* node dragging + column toggles */
  var drag = null;
  world.addEventListener('pointerdown', function (e) {
    var head = e.target.closest('.node__h');
    if (!head) return;
    var node = head.closest('.node');
    var si = +node.getAttribute('data-s');
    drag = { si: si, x: e.clientX, y: e.clientY, ox: model.sheets[si].x, oy: model.sheets[si].y, moved: false };
    /* once the user has hand-placed a node, auto-reflow must never move it again */
    model.sheets[si]._fresh = false;
    node.setPointerCapture(e.pointerId);
    e.stopPropagation();
  });
  world.addEventListener('pointermove', function (e) {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
    var s = model.sheets[drag.si];
    s.x = drag.ox + (e.clientX - drag.x) / view.k;
    s.y = drag.oy + (e.clientY - drag.y) / view.k;
    s.el.style.left = s.x + 'px';
    s.el.style.top = s.y + 'px';
    positionGroups();
    positionEdges();
  });
  var justDragged = false;
  ['pointerup', 'pointercancel'].forEach(function (ev) {
    world.addEventListener(ev, function () {
      if (drag) {
        justDragged = drag.moved;
        drag = null;
        drawEdges();
        setTimeout(function () { justDragged = false; }, 0);
      }
    });
  });

  world.addEventListener('click', function (e) {
    var req = e.target.closest('.col__req');
    if (req) {
      var on = req.getAttribute('data-req') === '1';
      req.setAttribute('data-req', on ? '0' : '1');
      req.textContent = on ? 'opt' : 'req';
      req.title = on ? 'Click to mark required' : 'Click to mark optional';
      var node = req.closest('.node'), col = req.closest('.col');
      model.sheets[+node.getAttribute('data-s')].cols[+col.getAttribute('data-c')].required = !on;
      if (window.gsap && !DL.reduced) {
        gsap.fromTo(req, { scale: .82 }, { scale: 1, duration: .32, ease: 'back.out(3)' });
      }
      return;
    }
    var node2 = e.target.closest('.node');
    /* Repositioning a node is not the same gesture as selecting it. Without
       this guard a drag also fired selectSheet(), which expanded that
       table's bundles as a side effect of simply moving it. */
    if (node2 && !justDragged) selectSheet(+node2.getAttribute('data-s'));
  });


  /* =================================================================
     Edge detail: why this link exists, in words rather than jargon
     ================================================================= */
  var panel = $('#edgePanel');

  function closeEdgePanel() {
    if (!panel) return;
    panel.classList.remove('is-on');
    $$('.edge', edgesSvg).forEach(function (g) { g.classList.remove('is-active'); });
  }

  function sampleShared(A, ai, B, bi, n) {
    var sa = valueSet(A, ai, 800), sb = valueSet(B, bi, 800), out = [];
    Object.keys(sa).some(function (k) {
      if (k in sb) out.push(k);
      return out.length >= n;
    });
    return out;
  }

  function samplePairs(S, ai, bi, n) {
    var seen = Object.create(null), out = [];
    for (var r = 0; r < S.rows.length && out.length < n; r++) {
      var a = S.rows[r][ai], b = S.rows[r][bi];
      if (a == null || b == null) continue;
      a = String(a).trim(); b = String(b).trim();
      if (!a || !b || (a in seen)) continue;
      seen[a] = 1;
      out.push(a + ' \u2192 ' + b);
    }
    return out;
  }

  var KIND_STYLE = {
    fk:     { label: 'key link',      col: '#e8a94c' },
    shared: { label: 'shared column', col: '#8b7fd4' },
    det:    { label: 'determines',    col: '#4fc9d6' },
    corr:   { label: 'correlation',   col: '#4fc9d6' }
  };

  function openEdgePanel(r, gEl) {
    if (!panel) return;
    $$('.edge', edgesSvg).forEach(function (g) { g.classList.remove('is-active'); });
    if (gEl) gEl.classList.add('is-active');

    var A = model.sheets[r.from.s], B = model.sheets[r.to.s];
    var ca = A.cols[r.from.c], cb = B.cols[r.to.c];
    var st = KIND_STYLE[r.kind] || KIND_STYLE.shared;
    /* both sides are often called the same thing, so qualify each with its
       sheet or the sentence reads "customer_id exists in customer_id" */
    var qualify = ca.name === cb.name && A !== B;
    var nameA = qualify ? A.name + '.' + ca.name : ca.name;
    var nameB = qualify ? B.name + '.' + cb.name : cb.name;

    var kindEl = $('#edgeKind');
    kindEl.textContent = st.label;
    kindEl.style.color = st.col;
    kindEl.style.borderColor = st.col + '66';

    $('#edgeTitle').innerHTML =
      esc(A.name) + ' \u00b7 <b style="color:' + st.col + '">' + esc(ca.name) + '</b>' +
      '<br><span style="color:#5b6180">' + (r.kind === 'corr' ? 'moves with' : 'links to') + '</span><br>' +
      esc(B.name) + ' \u00b7 <b style="color:' + st.col + '">' + esc(cb.name) + '</b>';

    var why = '', facts = [], ex = '';

    if (r.kind === 'fk') {
      var pct = parseInt(r.label, 10) || 100;
      why = 'Every value in ' + nameA + ' also exists in ' + nameB + ', and ' + nameB +
            ' never repeats a value \u2014 so it identifies exactly one row. That is what makes this ' +
            'a key you can safely join the two sheets on.';
      facts = [['values matched', pct + '%'], ['relationship', '1 to many'],
               ['distinct values', ca.distinct.toLocaleString('en-US')],
               ['rows this side', A.rows.length.toLocaleString('en-US')]];
      ex = pct < 100
        ? '<b>Worth checking:</b> ' + (100 - pct) + '% of ' + nameA +
          ' finds no match, so those rows would vanish in an inner join.'
        : '<b>Safe to join:</b> no orphan rows on either side.';
    } else if (r.kind === 'shared') {
      var pv = parseInt(r.label, 10) || 0;
      why = 'Both sheets carry a column called ' + ca.name + ' holding the same kind of value, and ' +
            pv + '% of those values appear in both. The two sheets are describing the same thing, ' +
            'so figures from one can be lined up against the other.';
      facts = [['values in both', pv + '%'], ['kind of value', ca.type],
               ['distinct here', ca.distinct.toLocaleString('en-US')],
               ['distinct there', cb.distinct.toLocaleString('en-US')]];
      var samp = sampleShared(A, r.from.c, B, r.to.c, 4);
      if (samp.length) ex = '<b>Values found in both:</b> ' + samp.map(esc).join(' \u00b7 ');
    } else if (r.kind === 'det') {
      why = 'Each value of ' + ca.name + ' always appears alongside the same ' + cb.name + '. ' +
            'Knowing one tells you the other, which usually means ' + cb.name +
            ' is a property of ' + ca.name + ' rather than separate information.';
      facts = [['distinct ' + ca.name, ca.distinct.toLocaleString('en-US')],
               ['distinct ' + cb.name, cb.distinct.toLocaleString('en-US')],
               ['holds for', 'every row checked'], ['kind of value', ca.type]];
      var pairs = samplePairs(A, r.from.c, r.to.c, 3);
      if (pairs.length) ex = '<b>For example:</b> ' + pairs.map(esc).join(' \u00b7 ');
    } else {
      var m = r.label.match(/-?\d*\.?\d+/);
      var rv = m ? parseFloat(m[0]) : 0;
      why = 'When ' + nameA + ' goes up, ' + nameB + (rv < 0 ? ' tends to go down' : ' tends to go up') +
            ' with it. This is an association, not proof that one causes the other \u2014 ' +
            'something else may be driving both.';
      facts = [['strength (r)', rv.toFixed(2)], ['direction', rv < 0 ? 'opposite' : 'same'],
               ['moves together', Math.round(rv * rv * 100) + '%'],
               ['rows compared', A.rows.length.toLocaleString('en-US')]];
      ex = '<b>Read as:</b> about ' + Math.round(rv * rv * 100) + '% of the variation in ' +
           nameB + ' tracks ' + nameA + '.';
    }

    $('#edgeWhy').textContent = why;
    $('#edgeFacts').innerHTML = facts.map(function (f) {
      return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>';
    }).join('');
    $('#edgeEx').innerHTML = ex;
    panel.classList.add('is-on');
  }

  /* ---------------- intro ---------------- */
  var lastAdded = -1;
  function introduce() {
    if (!window.gsap || DL.reduced) return;
    var targets = $$('.node', world).filter(function (n) {
      return lastAdded < 0 || model.sheets[+n.getAttribute('data-s')].fileIdx === lastAdded;
    });
    gsap.fromTo(targets.length ? targets : $$('.node', world),
      { opacity: 0, y: 22, scale: .96 },
      { opacity: 1, y: 0, scale: 1, duration: .55, stagger: .09, ease: 'power3.out' });
    gsap.fromTo($$('.edge[data-i]', edgesSvg),
      { opacity: 0 }, { opacity: 1, duration: .5, stagger: .07, delay: .35 });
  }

  /* ===============================================================
     8. WIRING
     =============================================================== */
  pickBtn.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  ['dragenter', 'dragover'].forEach(function (ev) {
    dropStage.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dropStage.addEventListener(ev, function (e) {
      e.preventDefault();
      if (ev === 'dragleave' && dropStage.contains(e.relatedTarget)) return;
      dz.classList.remove('is-over');
    });
  });
  dropStage.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  $('#zIn').addEventListener('click', function () {
    var r = canvas.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.2);
  });
  $('#zOut').addEventListener('click', function () {
    var r = canvas.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, 0.83);
  });
  $('#edgeClose').addEventListener('click', closeEdgePanel);
  var esBtn = $('#edgeStyleBtn');
  if (esBtn) {
    esBtn.addEventListener('click', function () {
      edgeStyle = edgeStyle === 'straight' ? 'stepped' : 'straight';
      esBtn.classList.toggle('is-on', edgeStyle === 'stepped');
      esBtn.title = edgeStyle === 'straight' ? 'Edges: straight (click for stepped)' : 'Edges: stepped (click for straight)';
      if (model) drawEdges();
    });
  }


  /* ---------------- relationship-kind filter (legend as toggle chips) ---------------- */
  var kindHidden = { fk: false, shared: false, inSheet: false };
  function kindBucket(r) { return r.from.s === r.to.s ? 'inSheet' : r.kind; }
  var legendEl = $('#legend');
  if (legendEl) {
    legendEl.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-kind]');
      if (!b) return;
      var k = b.getAttribute('data-kind');
      kindHidden[k] = !kindHidden[k];
      b.classList.toggle('is-off', kindHidden[k]);
      $$('.edge[data-i]', edgesSvg).forEach(function (g) {
        var idx = +g.getAttribute('data-i');
        var r = model.rels[idx];
        if (!r) return;
        g.classList.toggle('is-kindhidden', !!kindHidden[kindBucket(r)]);
      });
    });
  }

  /* ---------------- canvas search: find a table or column, then pan to it ---------------- */
  var searchInput = $('#canvasSearch'), searchCount = $('#canvasSearchCount');
  function runSearch(q) {
    $$('.node').forEach(function (n) { n.classList.remove('is-searchhit'); });
    $$('.col').forEach(function (c) { c.classList.remove('is-searchhit'); });
    if (!q) { if (searchCount) searchCount.textContent = ''; return; }
    var ql = q.toLowerCase(), hits = [], first = null;
    model.sheets.forEach(function (s, si) {
      var nameHit = (s.label || s.name).toLowerCase().indexOf(ql) >= 0;
      var colHits = [];
      s.cols.forEach(function (c, ci) { if (c.name.toLowerCase().indexOf(ql) >= 0) colHits.push(ci); });
      if (nameHit || colHits.length) {
        hits.push(si);
        if (s.el) {
          s.el.classList.add('is-searchhit');
          colHits.forEach(function (ci) {
            var row = s.el.querySelector('.col[data-c="' + ci + '"]');
            if (row) row.classList.add('is-searchhit');
          });
        }
        if (!first) first = si;
      }
    });
    if (searchCount) searchCount.textContent = hits.length ? (hits.length + (hits.length === 1 ? ' match' : ' matches')) : 'no matches';
    if (first != null) panToSheet(first);
  }
  function panToSheet(si) {
    var s = model.sheets[si];
    if (!s) return;
    var r = canvas.getBoundingClientRect();
    var cx = s.x + nodeW(s) / 2, cy = s.y + nodeH(s) / 2;
    var targetK = Math.max(view.k, 0.7);
    var doPan = function () {
      view.x = r.width / 2 - cx * view.k;
      view.y = r.height / 2 - cy * view.k;
      applyView();
    };
    if (window.gsap && !DL.reduced) {
      gsap.to(view, { k: targetK, duration: .5, ease: 'power2.out', onUpdate: doPan });
    } else { view.k = targetK; doPan(); }
  }
  if (searchInput) {
    var searchDebounce;
    searchInput.addEventListener('input', function () {
      clearTimeout(searchDebounce);
      var v = searchInput.value.trim();
      searchDebounce = setTimeout(function () { runSearch(v); }, 180);
    });
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { searchInput.value = ''; runSearch(''); searchInput.blur(); }
    });
  }

  $('#zFit').addEventListener('click', fit);
  zLabel.addEventListener('click', fit);

  /* Premium touch #3: export the whole diagram — nodes, boundaries, edges,
     badges, exactly as styled on screen — as a single PNG. Every stylesheet
     the page already loaded is embedded directly into the exported SVG so
     the image is self-contained and doesn't depend on the live page. */
function exportDiagramSvg() {
    /* A canvas drawn from an SVG containing a <foreignObject> is treated by
       every browser as tainted — toBlob()/toDataURL() throw regardless of
       same-origin content, by design, with no workaround. Downloading the
       SVG markup directly sidesteps canvas entirely and needs none of that:
       it's also a genuinely better export for a diagram — vector, crisp at
       any zoom, editable — not a fallback. */
    if (!model || !model.sheets.length) return;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    model.sheets.forEach(function (s) {
      minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
      maxX = Math.max(maxX, s.x + nodeW(s)); maxY = Math.max(maxY, s.y + nodeH(s));
    });
    var pad = 90;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    var w = maxX - minX, h = maxY - minY;

    /* Reading cssRules off an externally-linked stylesheet throws when the
       page is opened as a local file:// document — a real Chrome
       restriction, not something try/catch-and-retry works around. It was
       silently dropping the :root variable definitions specifically, which
       is why every var(--text)/var(--amber)/etc reference resolved to
       nothing in the first export. Resolving each variable's live computed
       value and writing it out explicitly sidesteps the whole problem. */
    var THEME_VARS = ['--bg', '--bg-2', '--panel', '--panel-2', '--amber', '--amber-soft',
      '--cyan', '--cyan-soft', '--violet', '--rose', '--green', '--text', '--muted', '--dim',
      '--line', '--line-2', '--bg-rgb', '--panel-rgb', '--fg-rgb', '--shadow', '--shadow-a'];
    var rootCs = getComputedStyle(document.documentElement);
    var css = ':root{' + THEME_VARS.map(function (v) {
      return v + ':' + (rootCs.getPropertyValue(v) || '').trim() + ';';
    }).join('') + '}\n';
    try {
      Array.from(document.styleSheets).forEach(function (sheet) {
        try {
          Array.from(sheet.cssRules).forEach(function (rule) { css += rule.cssText + '\n'; });
        } catch (e) { /* external file:// stylesheets — expected, vars already resolved above */ }
      });
    } catch (e) {}

    var bg = (getComputedStyle(document.body).getPropertyValue('--bg') || '#0a0d18').trim();
    var worldClone = world.cloneNode(true);
    /* edgesSvg lives nested inside world (moved there so edges stay above
       boundaries but clickable — see the z-index fix elsewhere); cloning
       both world AND edgesSvg separately would duplicate every edge and
       label on top of itself, which is exactly what read as garbled,
       crowded text in the first export attempt. Strip the nested copy so
       only the standalone edgesClone below renders the edges. */
    var nestedEdges = worldClone.querySelector('#edges, .edges');
    if (nestedEdges) nestedEdges.remove();
    var groupsClone = groupLayer ? groupLayer.cloneNode(true) : document.createElement('div');
    var edgesClone = edgesSvg.cloneNode(true);
    edgesClone.removeAttribute('style');

    var svgMarkup =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
      'width="' + w + '" height="' + h + '" viewBox="' + minX + ' ' + minY + ' ' + w + ' ' + h + '">' +
        '<defs><style><![CDATA[\n' + css.replace(/]]>/g, ']] >') + '\n]]></style></defs>' +
        '<rect x="' + minX + '" y="' + minY + '" width="' + w + '" height="' + h + '" fill="' + bg + '"/>' +
        '<foreignObject x="' + minX + '" y="' + minY + '" width="' + w + '" height="' + h + '">' +
          '<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:' + w + 'px;height:' + h + 'px">' +
            groupsClone.outerHTML + worldClone.outerHTML +
          '</div>' +
        '</foreignObject>' +
        edgesClone.innerHTML +
      '</svg>';

    var blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (model.files[0] || 'data-lens-diagram').replace(/\.[^.]+$/, '') + '-relationship-map.svg';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 150);
  }
  var exportBtn = $('#exportPng');
  if (exportBtn) exportBtn.addEventListener('click', exportDiagramSvg);

  $('#zTidy').addEventListener('click', function () {
    model.sheets.forEach(function (s) { s.x = null; s.y = null; });
    render(false);
    fit();
    introduce();
  });
  $('#newFile').addEventListener('click', function () {
    /* with a file boundary selected this removes just that file; with nothing
       selected it clears the canvas so a new file can be dropped */
    if (selectedFile >= 0) removeFile(selectedFile);
    else resetAll();
  });

  $('#addFile').addEventListener('click', function () {
    fileInput.value = '';
    fileInput.click();
  });

  /* dropping onto the canvas adds a file to what is already mapped */
  ['dragenter', 'dragover'].forEach(function (ev) {
    canvas.addEventListener(ev, function (e) { e.preventDefault(); canvas.style.outline = '2px dashed rgba(232,169,76,.5)'; });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    canvas.addEventListener(ev, function (e) { e.preventDefault(); canvas.style.outline = ''; });
  });
  canvas.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  /* the schema analyser reads the parsed model from here */
  window.DLFA = {
    getModel: function () { return model; },
    fitView: function () { fit(); },
    redraw: function () { if (model) { drawEdges(); } },
    setEdgeStyle: function (v) { edgeStyle = v; if (model) drawEdges(); },
    getEdgeStyle: function () { return edgeStyle; }
  };

  window.addEventListener('resize', function () { if (model) fit(); });
  applyView();
})();
