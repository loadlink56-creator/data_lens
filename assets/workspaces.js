/* =====================================================================
   Data Lens — Column Profiler / Statistics Lab / Chart Studio /
   Report Builder / AI Agent
   Every function here receives {model, report} from window.DLReport —
   no workspace recomputes analysis; they only render it differently.
   ===================================================================== */
(function () {
  'use strict';
  var $ = DL.$, $$ = DL.$$;
  var W = window.DLWorkspaces = {};

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function num(n) { return (n == null ? 0 : n).toLocaleString('en-US'); }
  function pc(n) { return (Math.round((n || 0) * 1000) / 10) + '%'; }
  function round(n, d) { d = d || 2; var m = Math.pow(10, d); return Math.round((n || 0) * m) / m; }
  function svg(tag, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  /* pull real values straight from the parsed sheet for a profile */
  function colValues(model, p) {
    var sheet = model.sheets[p.sheetIndex];
    var out = [];
    for (var r = 0; r < sheet.rows.length; r++) {
      var v = sheet.rows[r][p.index];
      if (v != null && String(v).trim() !== '') out.push(v);
    }
    return out;
  }
  function numericValues(model, p) {
    return colValues(model, p).map(function (v) {
      return parseFloat(String(v).replace(/[,\s₹$€£¥%]/g, ''));
    }).filter(function (n) { return isFinite(n); });
  }

  function stats(nums) {
    if (!nums.length) return null;
    var a = nums.slice().sort(function (x, y) { return x - y; });
    var n = a.length, sum = a.reduce(function (s, v) { return s + v; }, 0), mean = sum / n;
    var variance = a.reduce(function (s, v) { return s + (v - mean) * (v - mean); }, 0) / (n > 1 ? n - 1 : 1);
    var sd = Math.sqrt(variance);
    function pct(p) { var idx = (p / 100) * (n - 1); var lo = Math.floor(idx), hi = Math.ceil(idx); return a[lo] + (a[hi] - a[lo]) * (idx - lo); }
    var skew = sd ? (a.reduce(function (s, v) { return s + Math.pow((v - mean) / sd, 3); }, 0) / n) : 0;
    return {
      n: n, mean: mean, median: pct(50), sd: sd, variance: variance,
      min: a[0], max: a[n - 1], q1: pct(25), q3: pct(75), iqr: pct(75) - pct(25),
      p5: pct(5), p95: pct(95), skew: skew,
      cv: mean ? sd / Math.abs(mean) : 0
    };
  }

  /* normal-CDF approximation (Abramowitz & Stegun), used only to give an
     approximate two-tailed p-value — always labelled as approximate */
  function normalCdf(z) {
    var t = 1 / (1 + 0.2316419 * Math.abs(z));
    var d = 0.3989423 * Math.exp(-z * z / 2);
    var p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }

  function pearson(xs, ys) {
    var n = Math.min(xs.length, ys.length), sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, cnt = 0;
    for (var i = 0; i < n; i++) {
      var x = xs[i], y = ys[i];
      if (!isFinite(x) || !isFinite(y)) continue;
      cnt++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    }
    if (cnt < 3) return null;
    var den = Math.sqrt((cnt * sxx - sx * sx) * (cnt * syy - sy * sy));
    return den === 0 ? 0 : (cnt * sxy - sx * sy) / den;
  }

  function heatColor(r) {
    var a = Math.abs(r);
    if (r >= 0) return 'rgba(232,169,76,' + (0.15 + a * 0.75) + ')';
    return 'rgba(79,201,214,' + (0.15 + a * 0.75) + ')';
  }

  /* =================================================================
     COLUMN PROFILER
     ================================================================= */
  var cpState = { model: null, report: null, current: null };

  W.openProfiler = function (got) {
    cpState.model = got.model; cpState.report = got.report;
    $('#cpFile').textContent = got.model.files.length === 1 ? got.model.files[0] : got.model.files.length + ' files';
    var nav = $('#cpNav');
    var bySheet = {};
    got.report.allProfiles.forEach(function (p) { (bySheet[p.table] = bySheet[p.table] || []).push(p); });
    nav.innerHTML = '<input class="ws-search" id="cpSearch" placeholder="Search columns…">' +
      Object.keys(bySheet).map(function (t) {
        return '<div class="ws-navgroup">' + esc(t) + '</div>' +
          bySheet[t].map(function (p) {
            var idx = got.report.allProfiles.indexOf(p);
            return '<button class="ws-navitem" data-p="' + idx + '"><b>' + esc(p.column) + '</b>' +
              '<s>' + p.physical + ' · ' + p.role + '</s></button>';
          }).join('');
      }).join('');
    nav.addEventListener('click', function (e) {
      var b = e.target.closest('.ws-navitem');
      if (b) selectColumn(+b.getAttribute('data-p'));
    });
    $('#cpSearch').addEventListener('input', function () {
      var q = this.value.toLowerCase();
      $$('.ws-navitem', nav).forEach(function (b) {
        b.style.display = b.textContent.toLowerCase().indexOf(q) >= 0 ? '' : 'none';
      });
    });
    selectColumn(0);
  };

  function histogramSvg(nums, bins) {
    bins = bins || 14;
    var min = Math.min.apply(null, nums), max = Math.max.apply(null, nums);
    if (min === max) max = min + 1;
    var width = bins, counts = new Array(bins).fill(0);
    nums.forEach(function (v) {
      var b = Math.min(bins - 1, Math.floor(((v - min) / (max - min)) * bins));
      counts[b]++;
    });
    var maxC = Math.max.apply(null, counts) || 1;
    var W = 560, H = 160, pad = 4, bw = (W - pad * 2) / bins;
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + (H + 26), width: '100%' });
    counts.forEach(function (c, i) {
      var h = (c / maxC) * H;
      var bar = svg('rect', {
        class: 'ws-bar', x: pad + i * bw + 1, y: H - h, width: Math.max(1, bw - 2), height: h, rx: 2
      });
      var t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      t.textContent = round(min + (i / bins) * (max - min), 1) + '–' + round(min + ((i + 1) / bins) * (max - min), 1) + ': ' + c;
      bar.appendChild(t);
      s.appendChild(bar);
    });
    [min, (min + max) / 2, max].forEach(function (v, i) {
      var t = svg('text', { class: 'ws-axislabel', x: i === 0 ? pad : (i === 1 ? W / 2 : W - pad), y: H + 16, 'text-anchor': i === 0 ? 'start' : (i === 1 ? 'middle' : 'end') });
      t.textContent = round(v, 1);
      s.appendChild(t);
    });
    return s.outerHTML;
  }

  function barChartSvg(pairs) {
    var W = 560, H = 190, pad = 4, gap = 6;
    var maxV = Math.max.apply(null, pairs.map(function (p) { return p[1]; })) || 1;
    var bw = (W - pad * 2) / pairs.length - gap;
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + (H + 30), width: '100%' });
    pairs.forEach(function (p, i) {
      var h = (p[1] / maxV) * H;
      var x = pad + i * (bw + gap);
      s.appendChild(svg('rect', { class: 'ws-bar', x: x, y: H - h, width: bw, height: h, rx: 2 }));
      var lab = svg('text', { class: 'ws-axislabel', x: x + bw / 2, y: H + 16, 'text-anchor': 'middle' });
      lab.textContent = String(p[0]).slice(0, 10);
      s.appendChild(lab);
      var val = svg('text', { class: 'ws-axislabel', x: x + bw / 2, y: H - h - 4, 'text-anchor': 'middle', fill: 'var(--text)' });
      val.textContent = num(p[1]);
      s.appendChild(val);
    });
    return s.outerHTML;
  }

  function selectColumn(idx) {
    cpState.current = idx;
    $$('.ws-navitem', $('#cpNav')).forEach(function (b, i) { b.classList.toggle('is-active', i === idx); });
    var p = cpState.report.allProfiles[idx];
    var model = cpState.model;
    var body = $('#cpBody');

    var chart = '';
    if (p.physical === 'integer' || p.physical === 'float') {
      var nums = numericValues(model, p);
      var st = stats(nums);
      if (st) {
        chart = '<div class="sa-card"><div class="sa-card__h">Distribution <span class="sa-hint">' + num(st.n) + ' values</span></div>' +
          '<div class="ws-chartarea" style="min-height:220px">' + histogramSvg(nums) + '</div></div>' +
          '<div class="sa-card"><div class="sa-card__h">Numeric summary</div><div class="sa-stats">' +
          [['Mean', round(st.mean)], ['Median', round(st.median)], ['Std dev', round(st.sd)], ['CV', round(st.cv, 3)],
           ['Min', round(st.min)], ['Max', round(st.max)], ['Q1', round(st.q1)], ['Q3', round(st.q3)],
           ['IQR', round(st.iqr)], ['P5', round(st.p5)], ['P95', round(st.p95)], ['Skewness', round(st.skew, 3)]]
          .map(function (kv) { return '<div><dt>' + kv[0] + '</dt><dd>' + kv[1] + '</dd></div>'; }).join('') + '</div></div>';
      }
    } else if (p.topValues.length) {
      chart = '<div class="sa-card"><div class="sa-card__h">Top values</div>' +
        '<div class="ws-chartarea" style="min-height:220px">' + barChartSvg(p.topValues.slice(0, 8)) + '</div></div>';
    }

    var vals = colValues(model, p);
    var textStats = '';
    if (p.physical === 'string') {
      var lens = vals.map(function (v) { return String(v).length; });
      var lst = stats(lens);
      if (lst) {
        textStats = '<div class="sa-card"><div class="sa-card__h">Text length</div><div class="sa-stats">' +
          [['Min', lst.min], ['Max', lst.max], ['Mean', round(lst.mean, 1)], ['Median', round(lst.median, 1)]]
          .map(function (kv) { return '<div><dt>' + kv[0] + '</dt><dd>' + kv[1] + '</dd></div>'; }).join('') + '</div></div>';
      }
    }

    body.innerHTML =
      '<div class="sa-section-head"><span class="sa-eyebrow">Column Profiler</span>' +
      '<h2 class="sa-section-title">' + esc(p.table) + '.' + esc(p.column) + '</h2>' +
      '<p class="sa-section-sub">' + esc(SchemaEngine.describe(p)) + '</p></div>' +
      '<div class="sa-card"><div class="sa-layers">' +
        '<div><dt>Physical</dt><dd>' + p.physical + '</dd></div><div class="sa-arrow">&darr;</div>' +
        '<div><dt>Statistical</dt><dd>' + p.statistical + '</dd></div><div class="sa-arrow">&darr;</div>' +
        '<div><dt>Semantic</dt><dd>' + (p.semantic || '—') + '</dd></div><div class="sa-arrow">&darr;</div>' +
        '<div><dt>Role</dt><dd>' + p.role + '</dd></div>' +
      '</div>' +
      '<div class="sa-stats sa-stats--tight" style="margin-top:1rem">' +
        '<div><dt>Rows</dt><dd>' + num(p.rowCount) + '</dd></div>' +
        '<div><dt>Missing</dt><dd>' + pc(p.nullRatio) + '</dd></div>' +
        '<div><dt>Distinct</dt><dd>' + num(p.distinct) + '</dd></div>' +
      '</div>' +
      (p.mismatch ? '<div class="sa-warn">Convertible to <b>' + p.mismatch.detected + '</b> (' + pc(p.mismatch.ratio) + ' of values).</div>' : '') +
      (p.pii ? '<div class="sa-warn sa-warn--red">Potential PII: ' + p.pii + '.</div>' : '') +
      '</div>' + chart + textStats;
  }

  /* =================================================================
     STATISTICS LAB
     ================================================================= */
  W.openStats = function (got) {
    var model = got.model, report = got.report;
    var body = $('#statBody');
    $('#statFile').textContent = model.files.length === 1 ? model.files[0] : model.files.length + ' files';

    var numericBySheet = model.sheets.map(function (s, si) {
      return report.profiles[si].filter(function (p) { return p.physical === 'integer' || p.physical === 'float'; });
    });

    var descRows = '';
    model.sheets.forEach(function (s, si) {
      numericBySheet[si].forEach(function (p) {
        var st = stats(numericValues(model, p));
        if (!st) return;
        descRows += '<tr><td><span class="sa-tbl">' + esc(s.label || s.name) + '</span><b>' + esc(p.column) + '</b></td>' +
          '<td>' + num(st.n) + '</td><td>' + round(st.mean) + '</td><td>' + round(st.median) + '</td>' +
          '<td>' + round(st.sd) + '</td><td>' + round(st.min) + '</td><td>' + round(st.max) + '</td>' +
          '<td>' + round(st.q1) + '</td><td>' + round(st.q3) + '</td><td>' + round(st.skew, 2) + '</td></tr>';
      });
    });

    var corrBlocks = model.sheets.map(function (s, si) {
      var cols = numericBySheet[si];
      if (cols.length < 2) return '';
      var vals = cols.map(function (p) { return numericValues(model, p); });
      var minLen = Math.min.apply(null, vals.map(function (v) { return v.length; }));
      var head = '<tr><th></th>' + cols.map(function (p) { return '<th>' + esc(p.column.slice(0, 8)) + '</th>'; }).join('') + '</tr>';
      var rows = cols.map(function (p, i) {
        return '<tr><td class="rowhead">' + esc(p.column) + '</td>' + cols.map(function (q, j) {
          var r = i === j ? 1 : pearson(vals[i].slice(0, minLen), vals[j].slice(0, minLen));
          return '<td style="background:' + heatColor(r || 0) + '">' + (r == null ? '—' : round(r, 2)) + '</td>';
        }).join('') + '</tr>';
      }).join('');
      return '<div class="sa-card"><div class="sa-card__h">' + esc(s.label || s.name) + ' — correlation matrix' +
        '<span class="sa-hint">Pearson</span></div>' +
        '<div class="sa-tablewrap" style="max-height:none"><table class="ws-heat">' + head + rows + '</table></div></div>';
    }).join('');

    body.innerHTML =
      '<div class="sa-section-head"><span class="sa-eyebrow">Statistics Lab</span>' +
      '<h2 class="sa-section-title">Descriptive statistics &amp; correlation</h2>' +
      '<p class="sa-section-sub">Every numeric column, summarised, plus how strongly numeric columns move together within each sheet.</p></div>' +
      '<div class="sa-card"><div class="sa-card__h">Descriptive statistics</div>' +
      '<div class="sa-tablewrap"><table class="sa-table"><thead><tr><th>Column</th><th>N</th><th>Mean</th><th>Median</th>' +
      '<th>Std dev</th><th>Min</th><th>Max</th><th>Q1</th><th>Q3</th><th>Skew</th></tr></thead><tbody>' + descRows + '</tbody></table></div></div>' +
      (corrBlocks || '<div class="sa-card"><p class="sa-empty">No sheet has two or more numeric columns to correlate.</p></div>') +
      '<div class="sa-card" id="statGroupCard"><div class="sa-card__h">Compare groups</div><div id="statGroupBody"></div></div>';

    buildGroupCompare(model, report);
  };

  function buildGroupCompare(model, report) {
    var host = $('#statGroupBody');
    var options = [];
    model.sheets.forEach(function (s, si) {
      report.profiles[si].forEach(function (p) {
        if (p.statistical === 'categorical' && p.distinct >= 2 && p.distinct <= 8) options.push({ si: si, p: p, kind: 'g' });
      });
    });
    if (!options.length) { host.innerHTML = '<p class="sa-empty">No suitable low-cardinality category found to group by.</p>'; return; }

    function render(gi) {
      var g = options[gi], sheet = model.sheets[g.si];
      var numCols = report.profiles[g.si].filter(function (p) { return p.physical === 'integer' || p.physical === 'float'; });
      var numSel = '<select class="ws-field-inline" id="statNumSel">' + numCols.map(function (p, i) {
        return '<option value="' + i + '">' + esc(p.column) + '</option>';
      }).join('') + '</select>';

      host.innerHTML =
        '<div class="ws-field"><label>Group by</label><div class="ws-chips" id="statGroupChips">' +
        options.map(function (o, i) { return '<span class="ws-chip' + (i === gi ? ' is-active' : '') + '" data-gi="' + i + '">' +
          esc(sheet.label || sheet.name) + '.' + esc(o.p.column) + '</span>'; }).join('') + '</div></div>' +
        (numCols.length ? '<div class="ws-field"><label>Measure</label>' + numSel + '</div><div id="statGroupResult"></div>'
          : '<p class="sa-empty">This sheet has no numeric column to measure.</p>');

      $$('#statGroupChips .ws-chip', host).forEach(function (c) { c.addEventListener('click', function () { render(+c.getAttribute('data-gi')); }); });
      if (numCols.length) {
        var sel = $('#statNumSel', host);
        sel.addEventListener('change', function () { renderResult(g, numCols[+sel.value]); });
        renderResult(g, numCols[0]);
      }
    }

    function renderResult(g, measureP) {
      var sheet = model.sheets[g.si];
      var groups = {};
      for (var r = 0; r < sheet.rows.length; r++) {
        var key = String(sheet.rows[r][g.p.index] == null ? '' : sheet.rows[r][g.p.index]).trim();
        var v = parseFloat(String(sheet.rows[r][measureP.index]).replace(/[,\s₹$€£¥%]/g, ''));
        if (!key || !isFinite(v)) continue;
        (groups[key] = groups[key] || []).push(v);
      }
      var keys = Object.keys(groups);
      var rows = keys.map(function (k) { var st = stats(groups[k]); return { k: k, st: st }; }).filter(function (x) { return x.st; });

      var out = '<div class="sa-tablewrap" style="max-height:none"><table class="sa-table"><thead><tr><th>Group</th><th>N</th><th>Mean</th><th>Median</th><th>Std dev</th></tr></thead><tbody>' +
        rows.map(function (x) { return '<tr><td><b>' + esc(x.k) + '</b></td><td>' + num(x.st.n) + '</td><td>' + round(x.st.mean) + '</td><td>' + round(x.st.median) + '</td><td>' + round(x.st.sd) + '</td></tr>'; }).join('') +
        '</tbody></table></div>';

      if (rows.length === 2) {
        var a = rows[0].st, b = rows[1].st;
        var se = Math.sqrt((a.variance / a.n) + (b.variance / b.n));
        var t = se ? (a.mean - b.mean) / se : 0;
        var pooledSd = Math.sqrt((a.variance + b.variance) / 2);
        var d = pooledSd ? (a.mean - b.mean) / pooledSd : 0;
        var p = se ? 2 * (1 - normalCdf(Math.abs(t))) : 1;
        out += '<div class="sa-warn" style="margin-top:.8rem">' +
          '<b style="font-family:var(--mono);font-size:.7rem;color:var(--cyan-soft);display:block;margin-bottom:.3rem">WELCH\u2019S T-TEST (APPROXIMATE)</b>' +
          '"' + esc(rows[0].k) + '" vs "' + esc(rows[1].k) + '" on ' + esc(measureP.column) + ': t = ' + round(t, 2) +
          ', Cohen\u2019s d = ' + round(d, 2) + ', approximate two-tailed p \u2248 ' + round(p, 3) +
          ' (normal approximation — treat as indicative, not exact, for small n).</div>';
      } else if (rows.length > 2) {
        out += '<p class="sa-note">' + rows.length + ' groups found — showing descriptive comparison only; a formal ANOVA is not computed here.</p>';
      }
      $('#statGroupResult').innerHTML = out;
    }

    render(0);
  }

  /* =================================================================
     CHART STUDIO
     ================================================================= */
  W.openChart = function (got) {
    var model = got.model, report = got.report;
    $('#chartFile').textContent = model.files.length === 1 ? model.files[0] : model.files.length + ' files';
    var cfg = $('#chartConfig');
    var sheetOpts = model.sheets.map(function (s, i) { return '<option value="' + i + '">' + esc(s.label || s.name) + '</option>'; }).join('');

    cfg.innerHTML =
      '<div class="ws-field"><label>Table</label><select class="ws-field-sel" id="chSheet">' + sheetOpts + '</select></div>' +
      '<div class="ws-field"><label>Chart type</label><div class="ws-chips" id="chType">' +
        ['bar', 'line', 'scatter', 'histogram'].map(function (t, i) { return '<span class="ws-chip' + (i === 0 ? ' is-active' : '') + '" data-t="' + t + '">' + t + '</span>'; }).join('') +
      '</div></div>' +
      '<div class="ws-field"><label id="chXLabel">X axis</label><select class="ws-field-sel" id="chX"></select></div>' +
      '<div class="ws-field" id="chYWrap"><label id="chYLabel">Y axis</label><select class="ws-field-sel" id="chY"></select></div>' +
      '<div class="sa-note" id="chWhy"></div>';

    ['#chSheet', '#chType .ws-chip', '#chX', '#chY'].forEach(function () {});
    $('#chSheet').addEventListener('change', populateColumns);
    $('#chType').addEventListener('click', function (e) {
      var c = e.target.closest('.ws-chip'); if (!c) return;
      $$('.ws-chip', $('#chType')).forEach(function (x) { x.classList.remove('is-active'); });
      c.classList.add('is-active');
      populateColumns();
    });

    function chartType() { return $('#chType .ws-chip.is-active').getAttribute('data-t'); }

    function populateColumns() {
      var si = +$('#chSheet').value || 0;
      var profs = report.profiles[si];
      var t = chartType();
      var numericOnly = profs.filter(function (p) { return p.physical === 'integer' || p.physical === 'float'; });
      var catOnly = profs.filter(function (p) { return p.statistical === 'categorical' || p.statistical === 'binary' || p.statistical === 'temporal'; });

      var xOpts = t === 'histogram' || t === 'scatter' ? numericOnly : (t === 'bar' ? catOnly.concat(numericOnly.length ? [] : []) : profs);
      if (t === 'bar' && !xOpts.length) xOpts = profs;
      $('#chX').innerHTML = xOpts.map(function (p) { return '<option value="' + p.index + '">' + esc(p.column) + '</option>'; }).join('');
      $('#chYWrap').style.display = (t === 'histogram') ? 'none' : '';
      $('#chY').innerHTML = numericOnly.map(function (p) { return '<option value="' + p.index + '">' + esc(p.column) + '</option>'; }).join('');
      /* default X/Y to two DIFFERENT columns where possible — matching the
         same column against itself is a trivial, meaningless first chart */
      if ((t === 'scatter' || t === 'line') && numericOnly.length > 1) {
        var xFirst = xOpts[0], yPick = numericOnly.filter(function (p) { return p.index !== xFirst.index; })[0];
        if (yPick) $('#chY').value = yPick.index;
      }
      draw();
    }
    $('#chSheet').addEventListener('change', draw);
    ['#chX', '#chY'].forEach(function (id) { $(id).addEventListener('change', draw); });
    $('#chType').addEventListener('click', draw);

    function draw() {
      var si = +$('#chSheet').value || 0, sheet = model.sheets[si];
      var t = chartType();
      var xi = +$('#chX').value, yi = +$('#chY').value;
      var xp = report.profiles[si][xi], yp = report.profiles[si][yi];
      var area = $('#chartBody');
      var why = '';
      var html = '';

      if (t === 'histogram') {
        var nums = numericValues(model, xp);
        html = histogramSvg(nums, 16);
        why = 'Histogram of ' + esc(xp.column) + ' — shows how ' + num(nums.length) + ' values are spread across the range.';
      } else if (t === 'bar') {
        var groups = {};
        for (var r = 0; r < sheet.rows.length; r++) {
          var k = String(sheet.rows[r][xi] == null ? '' : sheet.rows[r][xi]).trim();
          if (!k) continue;
          var v = 1;
          if (yp) { var yv = parseFloat(String(sheet.rows[r][yi]).replace(/[,\s]/g, '')); if (isFinite(yv)) v = yv; else continue; }
          groups[k] = (groups[k] || 0) + v;
        }
        var pairs = Object.keys(groups).map(function (k) { return [k, groups[k]]; })
          .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 14);
        html = barChartSvg(pairs);
        why = yp ? ('Sum of ' + esc(yp.column) + ' by ' + esc(xp.column) + '.') : ('Row count by ' + esc(xp.column) + '.');
      } else if (t === 'scatter') {
        var xs = [], ys = [];
        for (var r2 = 0; r2 < sheet.rows.length; r2++) {
          var xv = parseFloat(String(sheet.rows[r2][xi]).replace(/[,\s]/g, ''));
          var yv2 = parseFloat(String(sheet.rows[r2][yi]).replace(/[,\s]/g, ''));
          if (isFinite(xv) && isFinite(yv2)) { xs.push(xv); ys.push(yv2); }
        }
        html = scatterSvg(xs, ys);
        var r3 = pearson(xs, ys);
        why = num(xs.length) + ' points. Pearson r = ' + (r3 == null ? '—' : round(r3, 2)) + ' between ' + esc(xp.column) + ' and ' + esc(yp.column) + '.';
      } else if (t === 'line') {
        var seen = {};
        for (var r4 = 0; r4 < sheet.rows.length; r4++) {
          var k4 = String(sheet.rows[r4][xi] == null ? '' : sheet.rows[r4][xi]).trim();
          var v4 = parseFloat(String(sheet.rows[r4][yi]).replace(/[,\s]/g, ''));
          if (!k4 || !isFinite(v4)) continue;
          (seen[k4] = seen[k4] || []).push(v4);
        }
        var pts = Object.keys(seen).sort().map(function (k) { var a = seen[k]; return [k, a.reduce(function (s, v) { return s + v; }, 0) / a.length]; });
        html = lineSvg(pts);
        why = 'Mean of ' + esc(yp.column) + ' at each value of ' + esc(xp.column) + ', in sorted order.';
      }
      area.innerHTML = html;
      $('#chWhy').innerHTML = '<b style="color:var(--cyan-soft)">Why this chart?</b> ' + why;
    }

    $('#chSheet').innerHTML = sheetOpts;
    populateColumns();
  };

  function scatterSvg(xs, ys) {
    var W = 560, H = 340, pad = 30;
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    if (minX === maxX) maxX++; if (minY === maxY) maxY++;
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%' });
    s.appendChild(svg('line', { class: 'ws-axis', x1: pad, y1: H - pad, x2: W - 10, y2: H - pad }));
    s.appendChild(svg('line', { class: 'ws-axis', x1: pad, y1: 10, x2: pad, y2: H - pad }));
    var cap = Math.min(xs.length, 1200);
    for (var i = 0; i < cap; i++) {
      var cx = pad + ((xs[i] - minX) / (maxX - minX)) * (W - pad - 15);
      var cy = (H - pad) - ((ys[i] - minY) / (maxY - minY)) * (H - pad - 15);
      s.appendChild(svg('circle', { class: 'ws-dot', cx: cx, cy: cy, r: 2.6 }));
    }
    return s.outerHTML;
  }
  function lineSvg(pts) {
    var W = 560, H = 300, pad = 30;
    var vals = pts.map(function (p) { return p[1]; });
    var minY = Math.min.apply(null, vals), maxY = Math.max.apply(null, vals);
    if (minY === maxY) maxY++;
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + (H + 24), width: '100%' });
    var step = pts.length > 1 ? (W - pad * 2) / (pts.length - 1) : 0;
    var d = pts.map(function (p, i) {
      var x = pad + i * step, y = (H - 10) - ((p[1] - minY) / (maxY - minY)) * (H - 20);
      return (i === 0 ? 'M' : 'L') + x + ' ' + y;
    }).join(' ');
    s.appendChild(svg('path', { class: 'ws-line', d: d }));
    if (pts.length) {
      var t0 = svg('text', { class: 'ws-axislabel', x: pad, y: H + 16 }); t0.textContent = String(pts[0][0]).slice(0, 12);
      var t1 = svg('text', { class: 'ws-axislabel', x: W - pad, y: H + 16, 'text-anchor': 'end' }); t1.textContent = String(pts[pts.length - 1][0]).slice(0, 12);
      s.appendChild(t0); s.appendChild(t1);
    }
    return s.outerHTML;
  }

  /* =================================================================
     REPORT BUILDER
     ================================================================= */
  var SECTION_DEFS = [
    { id: 'cover', label: 'Cover' },
    { id: 'exec', label: 'Executive Summary' },
    { id: 'overview', label: 'Dataset Overview' },
    { id: 'quality', label: 'Data Quality' },
    { id: 'schema', label: 'Schema' },
    { id: 'relationships', label: 'Relationships' },
    { id: 'ml', label: 'ML Readiness' },
    { id: 'recommend', label: 'Recommendations' }
  ];

  W.openReport = function (got) {
    var model = got.model, report = got.report;
    $('#reportFile').textContent = model.files.length === 1 ? model.files[0] : model.files.length + ' files';
    var outline = $('#reportOutline');
    outline.innerHTML = '<div class="ws-navgroup">Sections</div>' +
      SECTION_DEFS.map(function (s) {
        return '<label class="ws-outline-item"><input type="checkbox" data-sec="' + s.id + '" checked> ' + s.label + '</label>';
      }).join('') +
      '<div class="ws-navgroup">Export</div>' +
      '<button class="btn btn-ghost btn-sm" style="width:100%;margin-bottom:.4rem" data-exp="md">Markdown</button>' +
      '<button class="btn btn-ghost btn-sm" style="width:100%;margin-bottom:.4rem" data-exp="json">JSON</button>' +
      '<button class="btn btn-primary btn-sm" style="width:100%" data-exp="html">HTML</button>';

    outline.addEventListener('change', function () { renderReport(model, report); });
    outline.addEventListener('click', function (e) {
      var b = e.target.closest('[data-exp]');
      if (b) exportReport(model, report, b.getAttribute('data-exp'));
    });
    renderReport(model, report);
  };

  function activeSections(outline) {
    var out = {};
    $$('input[data-sec]', outline).forEach(function (cb) { out[cb.getAttribute('data-sec')] = cb.checked; });
    return out;
  }

  function reportFindings(report) {
    var f = [];
    f.push('Overall schema health is ' + report.health.overall + ' / 100.');
    var crit = report.issues.filter(function (i) { return i.severity === 'critical'; }).length;
    if (crit) f.push(crit + ' critical issue' + (crit > 1 ? 's' : '') + (crit ? ' need attention before analysis.' : ''));
    var fk = report.relationships.length;
    if (fk) f.push(fk + ' foreign-key relationship' + (fk > 1 ? 's' : '') + ' inferred across the loaded tables.');
    var pii = report.allProfiles.filter(function (p) { return p.pii; }).length;
    if (pii) f.push(pii + ' column' + (pii > 1 ? 's' : '') + ' flagged as possible PII.');
    var orphanRel = report.relationships.filter(function (r) { return r.orphanRate > 0.01; });
    orphanRel.forEach(function (r) { f.push(SchemaEngine.pct(r.orphanRate) + '% of ' + r.from.table + '.' + r.from.column + ' values have no match in ' + r.to.table + '.' + r.to.column + '.'); });
    var mism = report.allProfiles.filter(function (p) { return p.mismatch; }).length;
    if (mism) f.push(mism + ' column' + (mism > 1 ? 's' : '') + ' stored in a type that does not match their values.');
    return f;
  }

  function renderReport(model, report) {
    var sec = activeSections($('#reportOutline'));
    var body = $('#reportBody'), html = '<div class="ws-report-page">';

    if (sec.cover) {
      html += '<div class="ws-report-cover"><h1>Data Analysis Report</h1>' +
        '<s>' + esc(model.files.join(', ')) + '<br>Generated ' + new Date().toLocaleString() + '<br>Schema health: ' + report.health.overall + ' / 100</s></div>';
    }
    if (sec.exec) {
      html += '<h2>Executive Summary</h2>' + reportFindings(report).map(function (f, i) {
        return '<div class="ws-finding"><b>' + String(i + 1).padStart(2, '0') + '</b>' + esc(f) + '</div>';
      }).join('');
    }
    if (sec.overview) {
      html += '<h2>Dataset Overview</h2><div class="sa-stats">' +
        [['Rows', num(report.stats.rows)], ['Columns', num(report.stats.columns)], ['Files', report.stats.files], ['Sheets', report.stats.sheets]]
        .map(function (kv) { return '<div><dt>' + kv[0] + '</dt><dd>' + kv[1] + '</dd></div>'; }).join('') + '</div>';
    }
    if (sec.quality) {
      html += '<h2>Data Quality</h2>' + report.issues.slice(0, 20).map(function (i) {
        return '<div class="ws-finding"><b style="color:' + (i.severity === 'critical' ? 'var(--rose)' : i.severity === 'warning' ? 'var(--amber)' : 'var(--cyan)') + '">' + i.severity.toUpperCase() + '</b>' + esc(i.title) + ' — ' + esc(i.detail) + '</div>';
      }).join('') || '<p class="sa-empty">No issues found.</p>';
    }
    if (sec.schema) {
      html += '<h2>Schema</h2><div class="sa-tablewrap" style="max-height:none"><table class="sa-table"><thead><tr><th>Column</th><th>Type</th><th>Role</th><th>Null %</th></tr></thead><tbody>' +
        report.allProfiles.map(function (p) { return '<tr><td><span class="sa-tbl">' + esc(p.table) + '</span><b>' + esc(p.column) + '</b></td><td>' + p.physical + '</td><td>' + p.role + '</td><td>' + pc(p.nullRatio) + '</td></tr>'; }).join('') +
        '</tbody></table></div>';
    }
    if (sec.relationships) {
      html += '<h2>Relationships</h2>' + (report.relationships.length ? report.relationships.map(function (r) {
        return '<div class="ws-finding"><b>' + r.confidence + '</b>' + esc(r.from.table) + '.' + esc(r.from.column) + ' \u2192 ' + esc(r.to.table) + '.' + esc(r.to.column) + ' (' + r.cardinality + ', ' + pc(r.score) + ' confidence)</div>';
      }).join('') : '<p class="sa-empty">No foreign-key relationships were found.</p>');
    }
    if (sec.ml) {
      var roles = {};
      report.allProfiles.forEach(function (p) { roles[p.role] = (roles[p.role] || 0) + 1; });
      html += '<h2>ML Readiness</h2><p>' + Object.keys(roles).map(function (r) { return roles[r] + ' ' + r; }).join(', ') + '.</p>';
    }
    if (sec.recommend) {
      html += '<h2>Recommendations</h2>' + report.issues.filter(function (i) { return i.severity !== 'suggestion'; }).slice(0, 8).map(function (i, idx) {
        return '<div class="ws-finding"><b>' + String(idx + 1).padStart(2, '0') + '</b>Address: ' + esc(i.title) + '</div>';
      }).join('') || '<p class="sa-empty">No urgent actions identified.</p>';
    }
    html += '</div>';
    body.innerHTML = html;
  }

  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 100);
  }

  function exportReport(model, report, kind) {
    var sec = activeSections($('#reportOutline'));
    if (kind === 'json') {
      download('data-lens-report.json', JSON.stringify({
        generated: new Date().toISOString(), files: model.files, health: report.health,
        stats: report.stats, findings: reportFindings(report),
        issues: sec.quality ? report.issues : undefined,
        relationships: sec.relationships ? report.relationships.map(function (r) { return { from: r.from.table + '.' + r.from.column, to: r.to.table + '.' + r.to.column, confidence: r.confidence, score: r.score }; }) : undefined
      }, null, 2), 'application/json');
    } else if (kind === 'html') {
      download('data-lens-report.html', '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Data Analysis Report</title>' +
        '<style>body{font-family:sans-serif;max-width:760px;margin:40px auto;color:#1a1a1a}h1,h2{font-family:Georgia,serif}' +
        '.f{padding:8px 0;border-bottom:1px solid #eee}</style></head><body>' + $('#reportBody').innerHTML.replace(/class="ws-finding"/g, 'class="f"') + '</body></html>',
        'text/html');
    } else {
      var md = '# Data Analysis Report\n\n' + model.files.join(', ') + ' — Generated ' + new Date().toLocaleString() + '\n\n';
      if (sec.exec) { md += '## Executive Summary\n\n' + reportFindings(report).map(function (f) { return '- ' + f; }).join('\n') + '\n\n'; }
      if (sec.schema) { md += '## Schema\n\n' + report.allProfiles.map(function (p) { return '- **' + p.table + '.' + p.column + '** — ' + p.physical + ', ' + p.role; }).join('\n') + '\n\n'; }
      if (sec.relationships) { md += '## Relationships\n\n' + report.relationships.map(function (r) { return '- ' + r.from.table + '.' + r.from.column + ' \u2192 ' + r.to.table + '.' + r.to.column + ' (' + r.cardinality + ', ' + pc(r.score) + ')'; }).join('\n') + '\n\n'; }
      download('data-lens-report.md', md, 'text/markdown');
    }
  }

  /* =================================================================
     AI AGENT — grounded Q&A over the real computed report
     ================================================================= */
  var aiState = { model: null, report: null };

  W.openAI = function (got) {
    aiState.model = got.model; aiState.report = got.report;
    $('#aiFile').textContent = got.model.files.length === 1 ? got.model.files[0] : got.model.files.length + ' files';
    if (!$('#aiLog').childElementCount) {
      addMsg('ai', 'Ask me about the dataset you\u2019ve loaded. I only answer from what Data Lens has actually computed — if I don\u2019t have evidence, I\u2019ll say so.');
    }
    var suggestions = ['Which columns contain PII?', 'What are the biggest data quality issues?', 'Show me the strongest relationships', 'Is this dataset ready for machine learning?', 'Generate SQL to find orphan references'];
    $('#aiSuggest').innerHTML = suggestions.map(function (s) { return '<span class="ws-chip" data-q="' + esc(s) + '">' + esc(s) + '</span>'; }).join('');
    $('#aiSuggest').onclick = function (e) { var c = e.target.closest('.ws-chip'); if (c) ask(c.getAttribute('data-q')); };
    $('#aiForm').onsubmit = function (e) { e.preventDefault(); var v = $('#aiInput').value.trim(); if (v) { ask(v); $('#aiInput').value = ''; } };
  };

  function addMsg(who, html) {
    var log = $('#aiLog');
    var div = document.createElement('div');
    div.className = 'ws-msg ws-msg--' + (who === 'user' ? 'user' : 'ai');
    div.innerHTML = '<span class="ws-msg__ic"><svg viewBox="0 0 24 24">' +
      (who === 'user' ? '<circle cx="12" cy="8" r="3.4"/><path d="M5 20c1.5-4 5-6 7-6s5.5 2 7 6"/>' : '<path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z"/>') +
      '</svg></span><span class="ws-msg__bubble">' + html + '</span>';
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function ask(q) {
    addMsg('user', esc(q));
    var report = aiState.report, model = aiState.model;
    var a = answer(q.toLowerCase(), report, model);
    setTimeout(function () { addMsg('ai', a); }, 260);
  }

  function answer(q, report, model) {
    function has(re) { return re.test(q); }

    if (has(/pii|personal|privacy|sensitive/)) {
      var pii = report.allProfiles.filter(function (p) { return p.pii; });
      if (!pii.length) return 'No columns were flagged as likely PII in this dataset.';
      return 'These columns are flagged as possible PII:<ul>' + pii.map(function (p) {
        return '<li><code>' + esc(p.table + '.' + p.column) + '</code> — ' + esc(p.pii) + ' (' + pc(p.semanticConfidence) + ' confidence)</li>';
      }).join('') + '</ul>Recommendation: mask or exclude these before sharing or modelling.';
    }

    if (has(/quality issue|data.?quality|biggest.*issue|what.*wrong/)) {
      var top = report.issues.slice(0, 6);
      if (!top.length) return 'No structural data-quality issues were found. Schema health is ' + report.health.overall + '/100.';
      return 'The most significant issues (' + report.issues.length + ' total):<ul>' + top.map(function (i) {
        return '<li><b>' + i.severity.toUpperCase() + '</b> — ' + esc(i.title) + ': ' + esc(i.detail) + '</li>';
      }).join('') + '</ul>';
    }

    if (has(/strongest relationship|which tables.*related|how.*related|foreign key/)) {
      if (!report.relationships.length) return 'Insufficient evidence to determine this — no column pair met the confidence threshold for a foreign-key relationship.';
      return 'Strongest inferred relationships:<ul>' + report.relationships.slice(0, 6).map(function (r) {
        return '<li><code>' + esc(r.from.table + '.' + r.from.column) + ' \u2192 ' + esc(r.to.table + '.' + r.to.column) + '</code> — ' + r.cardinality + ', ' + pc(r.score) + ' confidence (' + r.confidence + ')</li>';
      }).join('') + '</ul>';
    }

    if (has(/ready for machine learning|ml.?ready|machine learning/)) {
      var piiN = report.allProfiles.filter(function (p) { return p.pii; }).length;
      var idN = report.allProfiles.filter(function (p) { return p.role === 'Identifier'; }).length;
      var mismN = report.allProfiles.filter(function (p) { return p.mismatch; }).length;
      var concerns = [];
      if (piiN) concerns.push(piiN + ' PII column(s) to exclude or mask');
      if (mismN) concerns.push(mismN + ' type mismatch(es) to fix first');
      var verdict = concerns.length ? 'Usable with preparation' : 'Broadly usable as-is';
      return '<b>' + verdict + '.</b> Schema health is ' + report.health.overall + '/100. ' +
        (concerns.length ? 'Before training: ' + concerns.join(', ') + '.' : 'No blocking issues were found in the computed analysis.') +
        ' ' + idN + ' identifier column(s) should typically be excluded as features.';
    }

    if (has(/suspicious column|which columns.*suspicious/)) {
      var susp = report.allProfiles.filter(function (p) { return p.mismatch || p.pii || p.distinct === 1; });
      if (!susp.length) return 'No columns triggered a suspicion flag (type mismatch, PII, or constant value).';
      return 'Flagged as worth a closer look:<ul>' + susp.slice(0, 8).map(function (p) {
        var why = p.pii ? 'possible PII' : (p.mismatch ? 'type mismatch' : 'constant value');
        return '<li><code>' + esc(p.table + '.' + p.column) + '</code> — ' + why + '</li>';
      }).join('') + '</ul>';
    }

    if (has(/orphan|sql/)) {
      var withOrphan = report.relationships.filter(function (r) { return r.orphanRate > 0; });
      if (!withOrphan.length) return 'No relationship in this dataset currently shows orphaned references — insufficient evidence of an orphan problem to generate a query against.';
      var r = withOrphan[0];
      var sql = 'SELECT c.' + r.from.column + '\nFROM ' + r.from.table + ' c\nLEFT JOIN ' + r.to.table + ' p\n  ON c.' + r.from.column + ' = p.' + r.to.column + '\nWHERE p.' + r.to.column + ' IS NULL;';
      return 'Based on <code>' + esc(r.from.table + '.' + r.from.column) + ' \u2192 ' + esc(r.to.table + '.' + r.to.column) + '</code> (' + pc(r.orphanRate) + ' orphan rate):<pre>' + esc(sql) + '</pre>';
    }

    if (has(/clean|python|pandas/)) {
      var textCol = report.allProfiles.filter(function (p) { return p.physical === 'string'; })[0];
      var colName = textCol ? textCol.column : 'column_name';
      var py = 'import pandas as pd\n\ndf["' + colName + '"] = (\n    df["' + colName + '"]\n    .astype(str)\n    .str.strip()\n    .str.lower()\n)\ndf = df.drop_duplicates()';
      return 'A general cleaning pattern for a text column' + (textCol ? ' (using <code>' + esc(colName) + '</code> from your data)' : '') + ':<pre>' + esc(py) + '</pre>';
    }

    if (has(/health|score|overall/)) {
      return 'Overall schema health is <b>' + report.health.overall + ' / 100</b>. Breakdown: ' +
        report.health.categories.map(function (c) { return c.name + ' ' + c.score; }).join(', ') + '.';
    }

    if (has(/how many|rows|columns|size/)) {
      return 'This dataset has ' + num(report.stats.rows) + ' rows across ' + num(report.stats.columns) + ' columns, ' +
        report.stats.sheets + ' sheet(s) in ' + report.stats.files + ' file(s).';
    }

    return 'Insufficient evidence to determine this from the current analysis. Try asking about relationships, data quality, PII, ML readiness, or the dataset\u2019s size.';
  }
})();
