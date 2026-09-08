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
  /* a small "at a glance" verdict badge — shape, outlier count, completeness… */
  function vtag(label, color) { return '<span class="sa-vtag sa-vtag--' + color + '"><i></i>' + esc(label) + '</span>'; }

  /* one shared floating tooltip for every chart — elements opt in with a
     [data-tip] attribute (HTML string) instead of the native, unstyleable
     <title> tooltip. Delegated on document so it survives every
     innerHTML re-render without re-attaching listeners per chart. */
  var tipInit = false;
  function ensureTooltip() {
    if (tipInit) return;
    tipInit = true;
    var el = document.createElement('div');
    el.className = 'ws-tooltip';
    document.body.appendChild(el);
    document.addEventListener('mousemove', function (e) {
      if (!el.classList.contains('is-on')) return;
      var vw = window.innerWidth, vh = window.innerHeight;
      var x = e.clientX + 16, y = e.clientY + 16;
      if (x + 230 > vw) x = e.clientX - 230;
      if (y + 80 > vh) y = e.clientY - 80;
      el.style.left = x + 'px'; el.style.top = y + 'px';
    });
    document.addEventListener('mouseover', function (e) {
      var t = e.target.closest && e.target.closest('[data-tip]');
      if (t) { el.innerHTML = t.getAttribute('data-tip'); el.classList.add('is-on'); }
    });
    document.addEventListener('mouseout', function (e) {
      var t = e.target.closest && e.target.closest('[data-tip]');
      if (t) el.classList.remove('is-on');
    });
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

  /* same as numericValues, but keeps the originating row number attached —
     needed so outliers can be shown "with receipts" instead of just counted */
  function numericRows(model, p) {
    var sheet = model.sheets[p.sheetIndex];
    var out = [];
    for (var r = 0; r < sheet.rows.length; r++) {
      var v = sheet.rows[r][p.index];
      if (v == null || String(v).trim() === '') continue;
      var n = parseFloat(String(v).replace(/[,\s₹$€£¥%]/g, ''));
      if (isFinite(n)) out.push({ row: r, v: n });
    }
    return out;
  }

  function stats(nums) {
    if (!nums.length) return null;
    var a = nums.slice().sort(function (x, y) { return x - y; });
    var n = a.length, sum = a.reduce(function (s, v) { return s + v; }, 0), mean = sum / n;
    var variance = a.reduce(function (s, v) { return s + (v - mean) * (v - mean); }, 0) / (n > 1 ? n - 1 : 1);
    var sd = Math.sqrt(variance);
    function pct(p) { var idx = (p / 100) * (n - 1); var lo = Math.floor(idx), hi = Math.ceil(idx); return a[lo] + (a[hi] - a[lo]) * (idx - lo); }
    var skew = sd ? (a.reduce(function (s, v) { return s + Math.pow((v - mean) / sd, 3); }, 0) / n) : 0;
    /* excess kurtosis (0 = normal-like tails, >0 heavy-tailed, <0 light-tailed) */
    var kurtosis = sd ? (a.reduce(function (s, v) { return s + Math.pow((v - mean) / sd, 4); }, 0) / n) - 3 : 0;
    var median = pct(50);
    /* median absolute deviation — a robust spread measure that outliers can't drag around */
    var absDevs = a.map(function (v) { return Math.abs(v - median); }).sort(function (x, y) { return x - y; });
    var mid = Math.floor(n / 2);
    var mad = n % 2 ? absDevs[mid] : (absDevs[mid - 1] + absDevs[mid]) / 2;
    /* mode — the most frequent exact value; only meaningful when values repeat */
    var freq = {}, modeVal = a[0], modeCount = 0;
    a.forEach(function (v) { freq[v] = (freq[v] || 0) + 1; if (freq[v] > modeCount) { modeCount = freq[v]; modeVal = v; } });
    return {
      n: n, mean: mean, median: median, sd: sd, variance: variance,
      min: a[0], max: a[n - 1], q1: pct(25), q3: pct(75), iqr: pct(75) - pct(25),
      p5: pct(5), p95: pct(95), skew: skew, kurtosis: kurtosis, mad: mad,
      mode: modeVal, modeCount: modeCount, modeMeaningful: modeCount > 1 && modeCount / n >= 0.01,
      cv: mean ? sd / Math.abs(mean) : 0
    };
  }

  /* outliers by three rules — IQR fence (1.5x), |z|>3, and the modified
     z-score (0.6745*(x-median)/MAD, |M|>3.5) — with the actual row +
     value that triggered each, and which rule(s) fired, as "receipts"
     rather than just a count. Modified z-score matters on its own: it's
     robust to the very outliers it's trying to catch (a tight cluster of
     extreme values inflates mean/sd enough to mask itself from plain
     z-score — median/MAD don't move nearly as much), so it can flag rows
     the other two rules miss. */
  function findOutliers(rows, st) {
    var lowIQR = st.q1 - 1.5 * st.iqr, highIQR = st.q3 + 1.5 * st.iqr;
    var all = [];
    rows.forEach(function (r) {
      var rules = [];
      if (r.v < lowIQR || r.v > highIQR) rules.push('IQR');
      if (st.sd && Math.abs((r.v - st.mean) / st.sd) > 3) rules.push('Z');
      if (st.mad && Math.abs(0.6745 * (r.v - st.median) / st.mad) > 3.5) rules.push('MAD');
      if (rules.length) all.push({ row: r.row, v: r.v, rules: rules });
    });
    all.sort(function (a, b) { return Math.abs(b.v - st.mean) - Math.abs(a.v - st.mean); });
    return {
      all: all,
      iqr: all.filter(function (r) { return r.rules.indexOf('IQR') >= 0; }),
      z: all.filter(function (r) { return r.rules.indexOf('Z') >= 0; }),
      mad: all.filter(function (r) { return r.rules.indexOf('MAD') >= 0; }),
      lowFence: lowIQR, highFence: highIQR
    };
  }

  /* Freedman–Diaconis bin width, so histogram shape isn't an artefact of a fixed bin count */
  function fdBins(st, n) {
    if (!st.iqr || n < 2) return 14;
    var h = 2 * st.iqr / Math.pow(n, 1 / 3);
    if (!h) return 14;
    var bins = Math.round((st.max - st.min) / h);
    return Math.max(6, Math.min(60, bins || 14));
  }

  function shapeVerdict(st) {
    var shape;
    if (st.skew > 1) shape = 'strongly right-skewed';
    else if (st.skew > 0.5) shape = 'right-skewed';
    else if (st.skew < -1) shape = 'strongly left-skewed';
    else if (st.skew < -0.5) shape = 'left-skewed';
    else shape = 'approximately symmetric';
    var tail = st.kurtosis > 1 ? ', heavy-tailed' : (st.kurtosis < -1 ? ', light-tailed' : '');
    return shape + tail;
  }

  /* Shannon entropy over a full frequency distribution, normalised to
     [0,1] against the max possible entropy for that many distinct values —
     a quick read on how "spread out" a categorical column really is */
  function entropyOf(freqPairs, n) {
    if (!n || !freqPairs.length) return { bits: 0, normalized: 0 };
    var h = 0;
    freqPairs.forEach(function (p) { var pr = p[1] / n; if (pr > 0) h -= pr * Math.log(pr) / Math.LN2; });
    var maxH = Math.log(freqPairs.length) / Math.LN2;
    return { bits: h, normalized: maxH ? h / maxH : 0 };
  }

  /* full frequency distribution — unlike SchemaEngine's profile (which only
     keeps the top 5 for its own lightweight purposes), the profiler needs
     the whole distribution for entropy and the Pareto view */
  function fullFreq(vals) {
    var f = {}, out = [];
    vals.forEach(function (v) { var k = String(v); f[k] = (f[k] || 0) + 1; });
    Object.keys(f).forEach(function (k) { out.push([k, f[k]]); });
    return out.sort(function (a, b) { return b[1] - a[1]; });
  }

  /* runs of 3+ consecutive missing rows — a broken export or a dropped
     page reads very differently from noise scattered evenly through the data */
  function missingRuns(model, p) {
    var sheet = model.sheets[p.sheetIndex];
    var runs = [], start = null;
    for (var r = 0; r < sheet.rows.length; r++) {
      var v = sheet.rows[r][p.index];
      var blank = (v == null || String(v).trim() === '');
      if (blank) { if (start === null) start = r; }
      else if (start !== null) { runs.push([start, r - 1]); start = null; }
    }
    if (start !== null) runs.push([start, sheet.rows.length - 1]);
    return runs.filter(function (r) { return r[1] - r[0] + 1 >= 3; })
      .sort(function (a, b) { return (b[1] - b[0]) - (a[1] - a[0]); });
  }

  /* character-class and word-count profile for free text — sampled, since
     scanning every character of a huge text column is the one loop here
     that's actually expensive per row */
  function textCharStats(vals) {
    var s = sampleForPerf(vals, 5000);
    var totalChars = 0, alpha = 0, digit = 0, space = 0, special = 0, words = 0, wsEdges = 0;
    s.data.forEach(function (v) {
      var str = String(v);
      totalChars += str.length;
      var trimmed = str.trim();
      words += trimmed === '' ? 0 : trimmed.split(/\s+/).length;
      if (str !== trimmed) wsEdges++;
      for (var i = 0; i < str.length; i++) {
        var c = str[i];
        if (/[a-zA-Z]/.test(c)) alpha++;
        else if (/[0-9]/.test(c)) digit++;
        else if (/\s/.test(c)) space++;
        else special++;
      }
    });
    var n = s.data.length || 1;
    return {
      sampled: s.sampled, sampleN: s.data.length, totalN: s.total,
      avgWords: round(words / n, 2),
      alphaRatio: totalChars ? alpha / totalChars : 0,
      digitRatio: totalChars ? digit / totalChars : 0,
      spaceRatio: totalChars ? space / totalChars : 0,
      specialRatio: totalChars ? special / totalChars : 0,
      leadTrailWS: wsEdges
    };
  }

  function parseDateSafe(s) {
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  /* date range, seasonality (day-of-week / month), and whether the column
     is already sorted in the sheet — a strong tell for a log or time index */
  function temporalStats(vals) {
    var s = sampleForPerf(vals, PROFILE_CAP);
    var parsed = s.data.map(parseDateSafe);
    var valid = parsed.filter(function (d) { return d; });
    if (!valid.length) return null;
    var monotonic = true, prev = null;
    parsed.forEach(function (d) { if (!d) return; if (prev && d < prev) monotonic = false; prev = d; });
    var sorted = valid.slice().sort(function (a, b) { return a - b; });
    var dow = [0, 0, 0, 0, 0, 0, 0];
    valid.forEach(function (d) { dow[d.getDay()]++; });
    var byMonth = {};
    valid.forEach(function (d) {
      var k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      byMonth[k] = (byMonth[k] || 0) + 1;
    });
    var months = Object.keys(byMonth).sort();
    return {
      min: sorted[0], max: sorted[sorted.length - 1], n: valid.length,
      dow: dow, monotonic: monotonic,
      monthly: months.map(function (k) { return [k, byMonth[k]]; })
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

  /* an evenly-strided sample, so a 300k-row column still profiles in
     one frame — every stat that touches raw values goes through this
     rather than each inventing its own cap */
  var PROFILE_CAP = 50000;
  function sampleForPerf(arr, cap) {
    cap = cap || PROFILE_CAP;
    if (arr.length <= cap) return { data: arr, sampled: false, total: arr.length };
    var step = arr.length / cap, out = [];
    for (var i = 0; i < cap; i++) out.push(arr[Math.floor(i * step)]);
    return { data: out, sampled: true, total: arr.length };
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

  /* standard normal kernel, used only by the KDE overlay below */
  function gaussianKernel(u) { return Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI); }

  /* shared y-axis gridlines + tick labels — 0 / half / max of whatever
     count scale a chart is using, drawn behind the marks */
  function yAxis(s, padL, padR, top, bottom, maxV, W) {
    [0, .5, 1].forEach(function (f) {
      var y = bottom - f * (bottom - top);
      s.appendChild(svg('line', { class: 'ws-axis', x1: padL, y1: y, x2: W - padR, y2: y }));
      var t = svg('text', { class: 'ws-axislabel', x: padL - 8, y: y + 3.5, 'text-anchor': 'end' });
      t.textContent = num(Math.round(f * maxV));
      s.appendChild(t);
    });
  }

  function histogramSvg(nums, bins, kde) {
    bins = bins || 14;
    var min = Math.min.apply(null, nums), max = Math.max.apply(null, nums);
    if (min === max) max = min + 1;
    var counts = new Array(bins).fill(0);
    nums.forEach(function (v) {
      var b = Math.min(bins - 1, Math.floor(((v - min) / (max - min)) * bins));
      counts[b]++;
    });
    var maxC = Math.max.apply(null, counts) || 1;
    var W = 560, H = 210, padL = 44, padR = 14, top = 14, bottom = H - 26, plotH = bottom - top;
    var bw = (W - padL - padR) / bins;
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%' });
    yAxis(s, padL, padR, top, bottom, maxC, W);

    counts.forEach(function (c, i) {
      var h = (c / maxC) * plotH;
      var lo2 = round(min + (i / bins) * (max - min), 1), hi2 = round(min + ((i + 1) / bins) * (max - min), 1);
      s.appendChild(svg('rect', {
        class: 'ws-bar', x: padL + i * bw + 1, y: bottom - h, width: Math.max(1, bw - 2), height: h, rx: 2,
        'data-tip': '<b>' + lo2 + '–' + hi2 + '</b><br>' + num(c) + ' value' + (c === 1 ? '' : 's')
      }));
    });

    /* KDE overlay — a smoothed density curve sharing this histogram's own
       coordinate mapping (scaled to the tallest bar's pixel height, not a
       second chart with its own axis), bandwidth via Silverman's rule */
    if (kde && kde.sd && kde.iqr && nums.length > 4) {
      var n = nums.length;
      var bw2 = 0.9 * Math.min(kde.sd, kde.iqr / 1.34) * Math.pow(n, -0.2);
      if (bw2 > 0) {
        var STEPS = 80, dens = [];
        for (var i = 0; i <= STEPS; i++) {
          var x = min + (i / STEPS) * (max - min), sum = 0;
          for (var j = 0; j < n; j++) sum += gaussianKernel((x - nums[j]) / bw2);
          dens.push(sum / (n * bw2));
        }
        var maxD = Math.max.apply(null, dens) || 1;
        var d = dens.map(function (v, k) {
          var x = padL + (k / STEPS) * (W - padL - padR), y = bottom - (v / maxD) * plotH;
          return (k === 0 ? 'M' : 'L') + x + ' ' + y;
        }).join(' ');
        s.appendChild(svg('path', { class: 'ws-line', d: d }));
      }
    }

    [min, (min + max) / 2, max].forEach(function (v, i) {
      var t = svg('text', { class: 'ws-axislabel', x: i === 0 ? padL : (i === 1 ? W / 2 : W - padR), y: bottom + 18, 'text-anchor': i === 0 ? 'start' : (i === 1 ? 'middle' : 'end') });
      t.textContent = round(v, 1);
      s.appendChild(t);
    });
    return s.outerHTML;
  }

  function barChartSvg(pairs) {
    var W = 560, H = 210, padL = 44, padR = 14, gap = 6, top = 14, bottom = H - 26, plotH = bottom - top;
    var maxV = Math.max.apply(null, pairs.map(function (p) { return p[1]; })) || 1;
    var bw = (W - padL - padR) / pairs.length - gap;
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%' });
    yAxis(s, padL, padR, top, bottom, maxV, W);
    pairs.forEach(function (p, i) {
      var h = (p[1] / maxV) * plotH;
      var x = padL + i * (bw + gap);
      s.appendChild(svg('rect', {
        class: 'ws-bar', x: x, y: bottom - h, width: bw, height: h, rx: 2,
        'data-tip': '<b>' + esc(String(p[0])) + '</b><br>' + num(p[1])
      }));
      var lab = svg('text', { class: 'ws-axislabel', x: x + bw / 2, y: bottom + 18, 'text-anchor': 'middle' });
      lab.textContent = String(p[0]).slice(0, 10);
      s.appendChild(lab);
    });
    return s.outerHTML;
  }

  /* box-and-whisker plot with outlier dots beyond the 1.5x IQR fence */
  function boxPlotSvg(st, outlierVals) {
    var W = 560, H = 90, pad = 34;
    var lo = Math.min(st.min, outlierVals.length ? Math.min.apply(null, outlierVals) : st.min);
    var hi = Math.max(st.max, outlierVals.length ? Math.max.apply(null, outlierVals) : st.max);
    if (lo === hi) hi = lo + 1;
    var x = function (v) { return pad + ((v - lo) / (hi - lo)) * (W - pad * 2); };
    var midY = H / 2;
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + (H + 24), width: '100%' });
    var whiskerLo = Math.max(st.min, st.q1 - 1.5 * st.iqr);
    var whiskerHi = Math.min(st.max, st.q3 + 1.5 * st.iqr);
    s.appendChild(svg('line', { class: 'ws-whisker', x1: x(whiskerLo), y1: midY, x2: x(st.q1), y2: midY }));
    s.appendChild(svg('line', { class: 'ws-whisker', x1: x(st.q3), y1: midY, x2: x(whiskerHi), y2: midY }));
    s.appendChild(svg('line', { class: 'ws-whisker', x1: x(whiskerLo), y1: midY - 9, x2: x(whiskerLo), y2: midY + 9 }));
    s.appendChild(svg('line', { class: 'ws-whisker', x1: x(whiskerHi), y1: midY - 9, x2: x(whiskerHi), y2: midY + 9 }));
    s.appendChild(svg('rect', {
      class: 'ws-box', x: x(st.q1), y: midY - 17, width: Math.max(1, x(st.q3) - x(st.q1)), height: 34, rx: 3,
      'data-tip': '<b>Q1–Q3</b><br>' + round(st.q1) + ' – ' + round(st.q3) + ' (IQR ' + round(st.iqr) + ')'
    }));
    s.appendChild(svg('line', {
      class: 'ws-median', x1: x(st.median), y1: midY - 17, x2: x(st.median), y2: midY + 17,
      'data-tip': '<b>Median</b><br>' + round(st.median)
    }));
    outlierVals.slice(0, 80).forEach(function (v) {
      s.appendChild(svg('circle', { class: 'ws-outlier', cx: x(v), cy: midY, r: 4, 'data-tip': '<b>Outlier</b><br>' + round(v) }));
    });
    [lo, (lo + hi) / 2, hi].forEach(function (v, i) {
      var t = svg('text', { class: 'ws-axislabel', x: i === 0 ? pad : (i === 1 ? W / 2 : W - pad), y: H + 16, 'text-anchor': i === 0 ? 'start' : (i === 1 ? 'middle' : 'end') });
      t.textContent = round(v, 1);
      s.appendChild(t);
    });
    return s.outerHTML;
  }

  /* Pareto chart — bars for each category plus a cumulative-% line, so an
     80/20 concentration (or its absence) is visible at a glance */
  function paretoSvg(pairs, totalN) {
    var W = 560, H = 210, padL = 44, padR = 14, gap = 6, top = 14, bottom = H - 26, plotH = bottom - top;
    var maxV = Math.max.apply(null, pairs.map(function (p) { return p[1]; })) || 1;
    var bw = (W - padL - padR) / pairs.length - gap;
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%' });
    yAxis(s, padL, padR, top, bottom, maxV, W);
    var cum = 0, pts = [];
    pairs.forEach(function (p, i) {
      var h = (p[1] / maxV) * plotH;
      var x = padL + i * (bw + gap);
      s.appendChild(svg('rect', {
        class: 'ws-bar', x: x, y: bottom - h, width: bw, height: h, rx: 2,
        'data-tip': '<b>' + esc(String(p[0])) + '</b><br>' + num(p[1]) + ' (' + pc(p[1] / totalN) + ')'
      }));
      var lab = svg('text', { class: 'ws-axislabel', x: x + bw / 2, y: bottom + 18, 'text-anchor': 'middle' });
      lab.textContent = String(p[0]).slice(0, 10);
      s.appendChild(lab);
      cum += p[1];
      pts.push([x + bw / 2, bottom - (cum / totalN) * plotH, cum]);
    });
    var d = pts.map(function (pt, i) { return (i === 0 ? 'M' : 'L') + pt[0] + ' ' + pt[1]; }).join(' ');
    s.appendChild(svg('path', { class: 'ws-line', d: d }));
    pts.forEach(function (pt) {
      s.appendChild(svg('circle', {
        class: 'ws-dot', cx: pt[0], cy: pt[1], r: 2.6,
        'data-tip': '<b>Cumulative</b><br>' + pc(pt[2] / totalN) + ' of values so far'
      }));
    });
    return s.outerHTML;
  }

  /* donut chart — for low-cardinality categorical/binary columns, where
     proportions read far better than a bar chart. Legend + hover tooltip
     carry the exact counts; the chart itself stays a clean shape. */
  var DONUT_COLORS = ['#e8a94c', '#4fc9d6', '#8b7fd4', '#6ecfa0', '#e08a8a', '#f2d478', '#7aa6e8'];
  function donutSvg(pairs, totalN) {
    var W = 220, H = 220, cx = W / 2, cy = H / 2, rOuter = 92, rInner = 56;
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', class: 'ws-donut' });
    var angle = -Math.PI / 2;
    pairs.forEach(function (p, i) {
      var frac = p[1] / totalN, sweep = frac * Math.PI * 2;
      var a0 = angle, a1 = angle + sweep;
      var large = sweep > Math.PI ? 1 : 0;
      var x0 = cx + rOuter * Math.cos(a0), y0 = cy + rOuter * Math.sin(a0);
      var x1 = cx + rOuter * Math.cos(a1), y1 = cy + rOuter * Math.sin(a1);
      var xi0 = cx + rInner * Math.cos(a1), yi0 = cy + rInner * Math.sin(a1);
      var xi1 = cx + rInner * Math.cos(a0), yi1 = cy + rInner * Math.sin(a0);
      var d = 'M' + x0 + ' ' + y0 + ' A' + rOuter + ' ' + rOuter + ' 0 ' + large + ' 1 ' + x1 + ' ' + y1 +
        ' L' + xi0 + ' ' + yi0 + ' A' + rInner + ' ' + rInner + ' 0 ' + large + ' 0 ' + xi1 + ' ' + yi1 + ' Z';
      s.appendChild(svg('path', {
        d: d, fill: DONUT_COLORS[i % DONUT_COLORS.length], 'data-i': i,
        'data-tip': '<b>' + esc(String(p[0])) + '</b><br>' + num(p[1]) + ' (' + pc(frac) + ')'
      }));
      angle = a1;
    });
    var t1 = svg('text', { x: cx, y: cy - 4, 'text-anchor': 'middle', 'font-size': 22 });
    t1.textContent = num(totalN);
    var t2 = svg('text', { class: 'ws-donut__sub', x: cx, y: cy + 15, 'text-anchor': 'middle' });
    t2.textContent = 'values';
    s.appendChild(t1); s.appendChild(t2);
    return s.outerHTML;
  }
  function donutLegend(pairs, totalN) {
    return '<div class="ws-donut-legend">' + pairs.map(function (p, i) {
      return '<div data-i="' + i + '"><i style="background:' + DONUT_COLORS[i % DONUT_COLORS.length] + '"></i>' +
        esc(String(p[0])) + '<b>' + pc(p[1] / totalN) + '</b></div>';
    }).join('') + '</div>';
  }

  /* linked hover between a donut's slices and its legend rows — hovering
     either highlights the matching pair and dims the rest. Delegated once
     on document so it survives every column re-render. */
  var donutHoverInit = false;
  function ensureDonutHover() {
    if (donutHoverInit) return;
    donutHoverInit = true;
    document.addEventListener('mouseover', function (e) {
      var el = e.target.closest && e.target.closest('.ws-donut path[data-i], .ws-donut-legend div[data-i]');
      if (!el) return;
      var wrap = el.closest('.cp-donutwrap');
      if (!wrap) return;
      var i = el.getAttribute('data-i');
      $$('[data-i]', wrap).forEach(function (t) {
        var match = t.getAttribute('data-i') === i;
        t.classList.toggle('is-focus', match);
        t.classList.toggle('is-dim', !match);
      });
    });
    document.addEventListener('mouseout', function (e) {
      var wrap = e.target.closest && e.target.closest('.cp-donutwrap');
      if (!wrap) return;
      var to = e.relatedTarget;
      if (to && wrap.contains(to)) return;
      $$('[data-i]', wrap).forEach(function (t) { t.classList.remove('is-focus', 'is-dim'); });
    });
  }

  var INSIGHT_ICONS = {
    good: '<path d="M20 6 9 17l-5-5"/>',
    bad: '<path d="M18 6 6 18M6 6l12 12"/>',
    warn: '<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>'
  };
  function insightRow(tone, html) {
    return '<div class="cp-insight cp-insight--' + tone + '"><i><svg viewBox="0 0 24 24">' + INSIGHT_ICONS[tone] + '</svg></i><p>' + html + '</p></div>';
  }

  /* four plain-language tabs — Descriptive Stats / Distribution Shape /
     Missing Values / Outliers — mirroring the categories the marketing
     page always showed as static chips. Delegated once so tab clicks
     just toggle visibility instead of re-rendering the whole profile. */
  var TAB_LABEL = { stats: 'Descriptive Stats', shape: 'Distribution Shape', missing: 'Missing Values', outliers: 'Outliers' };
  var tabsInit = false;
  function ensureTabs() {
    if (tabsInit) return;
    tabsInit = true;
    document.addEventListener('click', function (e) {
      var t = e.target.closest('.cp-tabs .ws-chip');
      if (!t) return;
      var host = t.closest('#cpBody');
      if (!host) return;
      var id = t.getAttribute('data-tab');
      cpState.activeTab = id;
      $$('.cp-tabs .ws-chip', host).forEach(function (b) { b.classList.toggle('is-active', b === t); });
      $$('.cp-tabpanel', host).forEach(function (pnl) { pnl.classList.toggle('is-active', pnl.getAttribute('data-panel') === id); });
    });
  }
  function tabSection(id, introHtml, bodyHtml) {
    return '<div class="cp-tabintro">' + introHtml + '</div>' + bodyHtml;
  }

  function selectColumn(idx) {
    ensureTooltip();
    ensureTabs();
    cpState.current = idx;
    $$('.ws-navitem', $('#cpNav')).forEach(function (b, i) { b.classList.toggle('is-active', i === idx); });
    var p = cpState.report.allProfiles[idx];
    var model = cpState.model;
    var body = $('#cpBody');
    var colName = esc(p.column);

    var kind = 'other';
    if (p.physical === 'integer' || p.physical === 'float') kind = 'numeric';
    else if (p.statistical === 'temporal') kind = 'temporal';
    else if (p.statistical === 'categorical' || p.statistical === 'binary') kind = 'categorical';
    else if (p.statistical === 'text') kind = 'text';

    var vals = colValues(model, p);
    var verdicts = [];
    var insights = [];
    function insight(tone, html) { insights.push(insightRow(tone, html)); }

    var statsHtml = '', shapeHtml = '', outliersHtml = '';

    if (kind === 'numeric') {
      var rowsAll = numericRows(model, p);
      var sampleR = sampleForPerf(rowsAll);
      var nums = sampleR.data.map(function (r) { return r.v; });
      var st = stats(nums);
      if (st) {
        var out = findOutliers(sampleR.data, st);
        var bins = fdBins(st, nums.length);

        verdicts.push(vtag(shapeVerdict(st), Math.abs(st.skew) > 0.5 ? 'amber' : 'green'));
        verdicts.push(vtag(out.all.length + ' outlier' + (out.all.length === 1 ? '' : 's'), out.all.length ? 'rose' : 'green'));
        verdicts.push(vtag(pc(1 - p.nullRatio) + ' complete', p.nullRatio > 0.05 ? 'amber' : 'green'));

        statsHtml = '<div class="sa-card"><div class="sa-card__h">Summary</div><dl class="sa-kv">' +
          [['Mean', round(st.mean)], ['Median', round(st.median)],
           ['Mode', st.modeMeaningful ? round(st.mode) + ' (×' + st.modeCount + ')' : '—'],
           ['Std dev', round(st.sd)], ['MAD', round(st.mad)], ['CV', round(st.cv, 3)],
           ['Min / Max', round(st.min) + ' / ' + round(st.max)], ['Q1 / Q3', round(st.q1) + ' / ' + round(st.q3)],
           ['IQR', round(st.iqr)], ['P5 / P95', round(st.p5) + ' / ' + round(st.p95)],
           ['Skewness', round(st.skew, 3)], ['Kurtosis (excess)', round(st.kurtosis, 3)]]
          .map(function (kv) { return '<div><dt>' + kv[0] + '</dt><dd>' + kv[1] + '</dd></div>'; }).join('') + '</dl>' +
          '<div class="sa-kv__tags">' + verdicts.join('') + '</div></div>';

        shapeHtml = '<div class="sa-card"><div class="sa-card__h">Distribution of ' + colName + ' <span class="sa-hint">' +
          num(st.n) + (sampleR.sampled ? ' of ' + num(sampleR.total) + ' — sampled' : ' values') + ' · ' + shapeVerdict(st) + '</span></div>' +
          '<div class="ws-chartarea ws-chartarea--cp">' + histogramSvg(nums, bins, { sd: st.sd, iqr: st.iqr }) + '</div>' +
          '<p class="sa-note" style="margin-top:.6rem">Bars = how many values fall in each range. The cyan line traces the overall shape.</p>' +
          '</div>' +
          '<div class="sa-card"><div class="sa-card__h">Box plot <span class="sa-hint">the middle 50% of values, and what falls outside it</span></div>' +
          '<div class="ws-chartarea ws-chartarea--flat ws-chartarea--cp">' + boxPlotSvg(st, out.all.map(function (r) { return r.v; })) + '</div></div>';

        var outIntro = '<p class="sa-note">An outlier is a value that doesn’t fit the normal pattern for ' + colName +
          ' — like one order being far larger than every other order. They aren’t automatically wrong, but they’re worth a second look. ' +
          'We flag a value when it’s caught by any of three independent checks: it falls well outside the typical range (IQR), it’s far from the average (z-score), or it’s far from the middle value in a way outliers can’t hide from (modified z-score).</p>';
        if (out.all.length) {
          outliersHtml = outIntro + '<div class="sa-card"><div class="sa-card__h">' + num(out.all.length) + ' outlier' + (out.all.length === 1 ? '' : 's') + ' found' +
            ' <span class="sa-hint">IQR: ' + out.iqr.length + ' · z-score: ' + out.z.length + ' · modified z-score: ' + out.mad.length + '</span></div>' +
            '<div class="sa-tablewrap"><table class="sa-table"><thead><tr><th>Row</th><th>Value</th><th>Where it falls</th><th>Flagged by</th></tr></thead><tbody>' +
            out.all.map(function (r) {
              var z = st.sd ? round((r.v - st.mean) / st.sd, 2) : 0;
              return '<tr><td><b>Row ' + (r.row + 2) + '</b></td><td>' + round(r.v) + '</td>' +
                '<td>' + (r.v < out.lowFence ? 'below the normal range (z=' + z + ')' : 'above the normal range (z=' + z + ')') + '</td>' +
                '<td>' + r.rules.join(', ') + '</td></tr>';
            }).join('') + '</tbody></table></div></div>';
        } else {
          outliersHtml = outIntro + '<div class="sa-card"><p class="sa-empty">No outliers found — every value in ' + colName + ' sits within the normal range on all three checks.</p></div>';
        }

        /* insights — plain-language reading of the same numbers above */
        if (Math.abs(st.skew) > 0.5) {
          insight('warn', 'Mean (<b>' + round(st.mean) + '</b>) sits ' + (st.mean > st.median ? 'above' : 'below') +
            ' the median (<b>' + round(st.median) + '</b>) — this column is ' + shapeVerdict(st) +
            ', so the median is the more representative "typical" value here.');
        } else {
          insight('good', 'Roughly symmetric — mean (' + round(st.mean) + ') and median (' + round(st.median) + ') are close, so either is a fair summary.');
        }
        if (out.all.length) {
          var worst = out.all[0];
          insight(out.all.length > nums.length * 0.05 ? 'bad' : 'warn',
            num(out.all.length) + ' outlier' + (out.all.length === 1 ? '' : 's') + ' detected — the most extreme is row ' +
            (worst.row + 2) + ' at <b>' + round(worst.v) + '</b>. Worth checking before averaging or modelling on this column.');
        } else {
          insight('good', 'No statistical outliers — every value sits within the expected IQR/z-score/MAD range.');
        }
        if (st.cv > 1) insight('info', 'High relative variability (CV = ' + round(st.cv, 2) + ') — values swing widely relative to their own average.');
        else if (st.mean && st.cv < 0.15) insight('info', 'Low variability (CV = ' + round(st.cv, 2) + ') — values cluster tightly around the mean.');
        insight(p.nullRatio > 0 ? (p.nullRatio > 0.2 ? 'bad' : 'warn') : 'good',
          p.nullRatio > 0 ? pc(p.nullRatio) + ' of values are missing.' : 'No missing values in this column.');
      }
    } else if (kind === 'temporal') {
      var tst = temporalStats(vals);
      if (tst) {
        var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        verdicts.push(vtag(tst.monotonic ? 'sorted ascending' : 'not sorted', tst.monotonic ? 'cyan' : 'amber'));
        verdicts.push(vtag(pc(1 - p.nullRatio) + ' complete', p.nullRatio > 0.05 ? 'amber' : 'green'));

        var dowPairs = tst.dow.map(function (c, i) { return [DOW[i], c]; });
        statsHtml = '<div class="sa-card"><div class="sa-card__h">Summary</div><dl class="sa-kv">' +
          [['Earliest', tst.min.toLocaleDateString()], ['Latest', tst.max.toLocaleDateString()],
           ['Span', num(Math.round((tst.max - tst.min) / 86400000)) + ' days'],
           ['Order', tst.monotonic ? 'sorted ascending' : 'not sorted']]
          .map(function (kv) { return '<div><dt>' + kv[0] + '</dt><dd>' + kv[1] + '</dd></div>'; }).join('') + '</dl>' +
          '<div class="sa-kv__tags">' + verdicts.join('') + '</div></div>';

        if (tst.monthly.length > 1) {
          shapeHtml += '<div class="sa-card"><div class="sa-card__h">' + colName + ' over time <span class="sa-hint">by month</span></div>' +
            '<div class="ws-chartarea ws-chartarea--cp">' + lineSvg(tst.monthly.slice(-24)) + '</div></div>';
        }
        shapeHtml += '<div class="sa-card"><div class="sa-card__h">Which day of the week</div>' +
          '<div class="ws-chartarea ws-chartarea--cp">' + barChartSvg(dowPairs) + '</div></div>';

        insight('info', 'Spans ' + num(Math.round((tst.max - tst.min) / 86400000)) + ' days, from ' +
          tst.min.toLocaleDateString() + ' to ' + tst.max.toLocaleDateString() + '.');
        insight('info', tst.monotonic
          ? 'Dates already appear in ascending row order — likely a timestamp or log column rather than a general date field.'
          : 'Dates are not in row order — this looks like a general date field, not a sorted log.');
        var topDow = dowPairs.slice().sort(function (a, b) { return b[1] - a[1]; })[0];
        if (topDow && tst.n > 10) {
          var topShare = topDow[1] / tst.n;
          if (topShare > 1 / 7 * 1.5) insight('warn', num(Math.round(topShare * 100)) + '% of dates fall on <b>' + topDow[0] +
            '</b> — worth checking whether that concentration is expected or a data artifact.');
        }
        insight(p.nullRatio > 0 ? 'warn' : 'good', p.nullRatio > 0 ? pc(p.nullRatio) + ' of values are missing.' : 'No missing values in this column.');
      }
    } else if (kind === 'categorical' || kind === 'text') {
      var freq = fullFreq(vals);
      var ent = entropyOf(freq, vals.length);
      var diversity = ent.normalized > 0.7 ? 'high' : (ent.normalized < 0.3 ? 'low' : 'moderate');
      var useDonut = kind === 'categorical' && freq.length <= 6;
      verdicts.push(vtag(num(p.distinct) + ' distinct', 'cyan'));
      verdicts.push(vtag(diversity + ' diversity', 'cyan'));
      verdicts.push(vtag(pc(1 - p.nullRatio) + ' complete', p.nullRatio > 0.05 ? 'amber' : 'green'));

      if (useDonut) ensureDonutHover();
      var topFreqEarly = freq[0], topPctEarly = topFreqEarly ? topFreqEarly[1] / vals.length : 0;

      statsHtml = '<div class="sa-card"><div class="sa-card__h">Summary</div><dl class="sa-kv">' +
        [['Distinct', num(p.distinct)], ['Top value', topFreqEarly ? esc(String(topFreqEarly[0])) + ' (' + pc(topPctEarly) + ')' : '—'],
         ['Entropy', round(ent.bits, 2) + ' bits'], ['Normalized', round(ent.normalized, 2)]]
        .map(function (kv) { return '<div><dt>' + kv[0] + '</dt><dd>' + kv[1] + '</dd></div>'; }).join('') + '</dl>' +
        '<div class="sa-kv__tags">' + verdicts.join('') + '</div></div>';

      if (freq.length > 8) {
        statsHtml += '<div class="sa-card"><div class="sa-card__h">Full frequency table <span class="sa-hint">' + freq.length + ' distinct values</span></div>' +
          '<div class="sa-tablewrap"><table class="sa-table"><thead><tr><th>Value</th><th>Count</th><th>%</th></tr></thead><tbody>' +
          freq.slice(0, 100).map(function (f) {
            return '<tr><td><b>' + esc(f[0]) + '</b></td><td>' + num(f[1]) + '</td><td>' + pc(f[1] / vals.length) + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          (freq.length > 100 ? '<p class="sa-note">+ ' + num(freq.length - 100) + ' more distinct values.</p>' : '') + '</div>';
      }

      shapeHtml = '<div class="sa-card"><div class="sa-card__h">' + (kind === 'categorical' ? 'How ' + colName + '’s values are split' : 'Most frequent values in ' + colName) +
        ' <span class="sa-hint">' + (useDonut ? 'hover a slice for detail' : (kind === 'categorical' ? 'bars = count, line = cumulative %' : 'most frequent')) + '</span></div>' +
        (useDonut
          ? '<div class="cp-donutwrap" style="display:flex;align-items:center;justify-content:center;gap:1.8rem;flex-wrap:wrap;padding:.6rem 0">' +
            '<div style="width:180px;flex:none">' + donutSvg(freq, vals.length) + '</div>' + donutLegend(freq, vals.length) + '</div>'
          : '<div class="ws-chartarea ws-chartarea--cp">' + (kind === 'categorical' ? paretoSvg(freq.slice(0, 14), vals.length) : barChartSvg(freq.slice(0, 8))) + '</div>') +
        '</div>';

      if (topPctEarly > 0.5) insight('warn', '"<b>' + esc(topFreqEarly[0]) + '</b>" alone accounts for ' + pc(topPctEarly) +
        ' of all rows — a dominant category that may carry little predictive signal as a feature.');
      else if (topFreqEarly) insight('good', 'No single value dominates — the top value ("' + esc(topFreqEarly[0]) + '") is only ' + pc(topPctEarly) + '.');
      insight('info', diversity.charAt(0).toUpperCase() + diversity.slice(1) + ' diversity (entropy ' + round(ent.bits, 2) + ' bits across ' + num(p.distinct) + ' distinct values).');
      if (kind === 'text' && p.uniqueRatio > 0.9) {
        insight('warn', 'Nearly every value is unique (' + num(p.distinct) + ' of ' + num(vals.length) + ') — this reads more like free text or an identifier than a category to group by.');
      }
      insight(p.nullRatio > 0 ? 'warn' : 'good', p.nullRatio > 0 ? pc(p.nullRatio) + ' of values are missing.' : 'No missing values in this column.');
    }

    if (p.physical === 'string') {
      var lens = vals.map(function (v) { return String(v).length; });
      var lst = stats(lens);
      var cst = textCharStats(vals);
      if (lst) {
        statsHtml += '<div class="sa-card"><div class="sa-card__h">Text profile' +
          (cst.sampled ? ' <span class="sa-hint">character stats sampled from ' + num(cst.sampleN) + ' of ' + num(cst.totalN) + '</span>' : '') +
          '</div><div class="sa-stats">' +
          [['Length min', lst.min], ['Length max', lst.max], ['Length mean', round(lst.mean, 1)], ['Length median', round(lst.median, 1)],
           ['Avg words', cst.avgWords], ['Alpha', pc(cst.alphaRatio)], ['Digit', pc(cst.digitRatio)], ['Special', pc(cst.specialRatio)]]
          .map(function (kv) { return '<div><dt>' + kv[0] + '</dt><dd>' + kv[1] + '</dd></div>'; }).join('') + '</div>' +
          (cst.leadTrailWS ? '<div class="sa-warn" style="margin-top:.8rem">' + num(cst.leadTrailWS) + ' sampled value(s) have leading or trailing whitespace.</div>' : '') +
          '</div>';
        if (cst.leadTrailWS) insight('warn', num(cst.leadTrailWS) + ' sampled value(s) have leading/trailing whitespace — likely to break exact-match joins or grouping until trimmed.');
      }
    }

    /* missingness structure — where the blanks fall, not just how many */
    var missingHtml;
    if (p.nullCount > 0) {
      var runs = missingRuns(model, p);
      var sheet = model.sheets[p.sheetIndex];
      var totalRows = sheet.rows.length || 1;
      var runHtml = runs.slice(0, 5).map(function (r) {
        return '<i style="left:' + pc(r[0] / totalRows) + ';width:' + pc(Math.max(0.003, (r[1] - r[0] + 1) / totalRows)) + '"></i>';
      }).join('');
      var dep = (p.nullRatio >= 0.05 && p.nullRatio <= 0.95)
        ? SchemaEngine.missingnessDependency(sheet, cpState.report.profiles[p.sheetIndex], p.index) : null;

      missingHtml = '<div class="sa-card"><div class="sa-card__h">' + num(p.nullCount) + ' missing value' + (p.nullCount === 1 ? '' : 's') +
        ' <span class="sa-hint">' + pc(p.nullRatio) + ' of all rows</span></div>' +
        (runs.length
          ? '<p class="sa-note">' + runs.length + ' block' + (runs.length === 1 ? '' : 's') + ' of 3+ consecutive missing rows — largest is rows ' +
            (runs[0][0] + 2) + '–' + (runs[0][1] + 2) + ' (' + num(runs[0][1] - runs[0][0] + 1) + ' rows). Reads like a broken export or an unfilled section, not random noise.</p>'
          : '<p class="sa-note">Missing values look scattered rather than blocked — consistent with random noise.</p>') +
        '<div class="ws-missmap">' + runHtml + '</div>' +
        (dep ? '<div class="sa-warn" style="margin-top:.8rem">Missing ' + pc(dep.rate) + ' of the time when <b>' +
          esc(dep.column) + '</b> = "' + esc(dep.value) + '" (n=' + num(dep.n) + ') — not missing at random.</div>' : '') +
        '</div>';

      if (runs.length) insight('bad', num(runs.length) + ' block' + (runs.length === 1 ? '' : 's') + ' of consecutive missing rows (largest: rows ' +
        (runs[0][0] + 2) + '–' + (runs[0][1] + 2) + ') — this pattern usually means a broken export or an unfilled section, not random gaps.');
      if (dep) insight('bad', 'Missing ' + pc(dep.rate) + ' of the time specifically when <b>' + esc(dep.column) + '</b> = "' + esc(dep.value) +
        '" — the gap correlates with another column, so it isn’t missing at random.');
    } else {
      missingHtml = '<div class="sa-card"><p class="sa-empty">Complete — ' + colName + ' has no missing values in any row.</p></div>';
    }

    if (p.mismatch) insight('warn', 'Stored as ' + p.physical + ', but ' + pc(p.mismatch.ratio) + ' of values convert cleanly to ' + p.mismatch.detected + ' — likely the intended type.');
    if (p.pii) insight('bad', 'Flagged as possible PII (' + p.pii + ') — mask or exclude before sharing or modelling.');

    /* assemble tabs — only offer what this column kind actually has */
    var tabs = [];
    if (statsHtml) tabs.push({ id: 'stats', body: tabSection('stats',
      '<p>The core numbers for <b>' + colName + '</b> — what you’d work out by hand, done for every value at once.</p>', statsHtml) });
    if (shapeHtml) tabs.push({ id: 'shape', body: tabSection('shape',
      '<p>' + (kind === 'numeric' ? 'How values in <b>' + colName + '</b> are spread out — where most values cluster, and where the unusual ones sit.'
        : kind === 'temporal' ? 'How dates in <b>' + colName + '</b> are distributed.'
        : 'How often each value appears in <b>' + colName + '</b>.') + '</p>', shapeHtml) });
    tabs.push({ id: 'missing', body: tabSection('missing',
      '<p>Missing values are rows where <b>' + colName + '</b> has no data at all. A few scattered blanks are usually harmless — a whole block of consecutive blanks often means something broke during export or entry.</p>', missingHtml) });
    if (outliersHtml) tabs.push({ id: 'outliers', body: outliersHtml });

    var activeTab = tabs.some(function (t) { return t.id === cpState.activeTab; }) ? cpState.activeTab : tabs[0].id;
    cpState.activeTab = activeTab;

    var tabBar = '<div class="ws-chips cp-tabs">' + tabs.map(function (t) {
      return '<span class="ws-chip' + (t.id === activeTab ? ' is-active' : '') + '" data-tab="' + t.id + '">' + TAB_LABEL[t.id] + '</span>';
    }).join('') + '</div>';
    var tabPanels = tabs.map(function (t) {
      return '<div class="cp-tabpanel' + (t.id === activeTab ? ' is-active' : '') + '" data-panel="' + t.id + '">' + t.body + '</div>';
    }).join('');

    var mainHtml =
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
      '</div>' + tabBar + tabPanels;

    body.innerHTML = '<div class="cp-layout"><div class="cp-main">' + mainHtml + '</div>' +
      '<aside class="cp-insights"><div class="cp-insights__h"><svg viewBox="0 0 24 24"><path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z"/></svg>Insights</div>' +
      (insights.length ? insights.join('') : '<p class="sa-empty">Nothing notable flagged for this column.</p>') +
      '</aside></div>';
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
    var W = 560, H = 220, padL = 44, padR = 14, top = 14, bottom = H - 26, plotH = bottom - top;
    var vals = pts.map(function (p) { return p[1]; });
    var minY = Math.min.apply(null, vals), maxY = Math.max.apply(null, vals);
    if (minY > 0) minY = 0;
    if (minY === maxY) maxY = minY + 1;
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%' });
    if (minY === 0) yAxis(s, padL, padR, top, bottom, maxY, W);
    var step = pts.length > 1 ? (W - padL - padR) / (pts.length - 1) : 0;
    var coords = pts.map(function (p, i) {
      return [padL + i * step, bottom - ((p[1] - minY) / (maxY - minY)) * plotH];
    });
    var d = coords.map(function (c, i) { return (i === 0 ? 'M' : 'L') + c[0] + ' ' + c[1]; }).join(' ');
    s.appendChild(svg('path', { class: 'ws-line', d: d }));
    if (pts.length <= 60) {
      coords.forEach(function (c, i) {
        s.appendChild(svg('circle', {
          class: 'ws-dot', cx: c[0], cy: c[1], r: 3.2,
          'data-tip': '<b>' + esc(String(pts[i][0])) + '</b><br>' + num(round(pts[i][1], 2))
        }));
      });
    }
    if (pts.length) {
      var t0 = svg('text', { class: 'ws-axislabel', x: padL, y: bottom + 18 }); t0.textContent = String(pts[0][0]).slice(0, 12);
      var t1 = svg('text', { class: 'ws-axislabel', x: W - padR, y: bottom + 18, 'text-anchor': 'end' }); t1.textContent = String(pts[pts.length - 1][0]).slice(0, 12);
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
