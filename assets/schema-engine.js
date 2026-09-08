/* =====================================================================
   Data Lens — Schema Analyser ENGINE
   Pure analysis, no DOM. Produces the report the UI renders.

   Layered typing, per the spec:
       Physical type  ->  Statistical type  ->  Semantic type  ->  Role
   ===================================================================== */
(function () {
  'use strict';

  var SE = window.SchemaEngine = {};

  /* ---------------------------------------------------------------
     helpers
     --------------------------------------------------------------- */
  function clean(v) { return v == null ? '' : String(v).trim(); }
  function pct(n) { return Math.round(n * 1000) / 10; }

  function nonBlank(values) {
    var out = [];
    for (var i = 0; i < values.length; i++) {
      var s = clean(values[i]);
      if (s !== '') out.push(s);
    }
    return out;
  }

  /* ---------------------------------------------------------------
     1. SEMANTIC TYPE DETECTION
     Beyond "string": email, phone, url, currency, uuid, ip, postal…
     --------------------------------------------------------------- */
  var PATTERNS = [
    { type: 'email',      icon: '@',  pii: 'Email',        re: /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i },
    { type: 'uuid',       icon: '#',  pii: null,           re: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i },
    { type: 'ip address', icon: '#',  pii: 'IP Address',   re: /^(\d{1,3}\.){3}\d{1,3}$/ },
    { type: 'url',        icon: '/',  pii: null,           re: /^(https?:\/\/|www\.)[^\s]+$/i },
    /* dates must be tested BEFORE phone: "2025-01-11" satisfies a loose
       phone pattern, which previously mislabelled every date column as PII */
    { type: 'timestamp',  icon: 'T',  pii: null,           re: /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/ },
    { type: 'date',       icon: 'D',  pii: null,           re: /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}-[A-Za-z]{3}-\d{2,4})$/ },
    { type: 'currency',   icon: '$',  pii: null,           re: /^[₹$€£¥]\s?-?[\d,]+(\.\d+)?$|^-?[\d,]+(\.\d+)?\s?(USD|EUR|GBP|INR)$/i },
    { type: 'percentage', icon: '%',  pii: null,           re: /^-?\d+(\.\d+)?\s?%$/ },
    { type: 'phone',      icon: '#',  pii: 'Phone',        re: /^[+(]?\d[\d\s().-]{7,17}$/, guard: 'phone' },
    { type: 'postal code',icon: '#',  pii: null,           re: /^\d{5,6}(-\d{4})?$/ }
  ];

  /* name-based hints, used when values alone are ambiguous */
  var NAME_HINTS = [
    { type: 'identifier', pii: null,          re: /(^|_)(id|key|code|no|num|uuid|guid)$|^id$/i },
    { type: 'full name',  pii: 'Name',        re: /(full_?name|^name$|first_?name|last_?name|surname)/i },
    { type: 'address',    pii: 'Address',     re: /(address|street|addr_?line)/i },
    { type: 'city',       pii: null,          re: /(^|_)city($|_)/i },
    { type: 'country',    pii: null,          re: /(^|_)country($|_)/i },
    { type: 'postal code',pii: null,          re: /(zip|postal|pincode)/i },
    { type: 'date of birth', pii: 'Date of Birth', re: /(dob|date_?of_?birth|birth_?date)/i },
    { type: 'phone',      pii: 'Phone',       re: /(phone|mobile|contact_?no|telephone)/i },
    { type: 'email',      pii: 'Email',       re: /(e_?mail)/i },
    { type: 'currency',   pii: null,          re: /(amount|price|revenue|salary|income|cost|total|spend|fee|balance)/i },
    { type: 'gov id',     pii: 'Government ID', re: /(ssn|aadhaar|pan_?no|passport|national_?id|tax_?id)/i },
    { type: 'financial',  pii: 'Financial ID', re: /(account_?(no|number)|iban|card_?number|routing)/i }
  ];

  function detectSemantic(name, values) {
    var vals = nonBlank(values).slice(0, 400);
    if (vals.length) {
      for (var i = 0; i < PATTERNS.length; i++) {
        var p = PATTERNS[i], hit = 0;
        for (var j = 0; j < vals.length; j++) {
          if (!p.re.test(vals[j])) continue;
          if (p.guard === 'phone') {
            var digits = vals[j].replace(/\D/g, '');
            if (digits.length < 10 || digits.length > 15) continue;
            if (dateLike(vals[j])) continue;
          }
          hit++;
        }
        var ratio = hit / vals.length;
        if (ratio >= 0.85) return { type: p.type, confidence: ratio, pii: p.pii, from: 'values' };
      }
    }
    for (var k = 0; k < NAME_HINTS.length; k++) {
      if (NAME_HINTS[k].re.test(name)) {
        return { type: NAME_HINTS[k].type, confidence: 0.72, pii: NAME_HINTS[k].pii, from: 'name' };
      }
    }
    return { type: null, confidence: 0, pii: null, from: null };
  }

  /* ---------------------------------------------------------------
     2. PHYSICAL + STATISTICAL TYPE, and type-mismatch detection
     --------------------------------------------------------------- */
  var NUM_RE = /^-?\d*\.?\d+(e-?\d+)?$/i;
  function numericLike(s) {
    var t = s.replace(/[,\s]/g, '').replace(/^[₹$€£¥]/, '').replace(/%$/, '');
    return t !== '' && NUM_RE.test(t);
  }
  function intLike(s) {
    var t = s.replace(/[,\s]/g, '').replace(/^[₹$€£¥]/, '');
    return /^-?\d+$/.test(t);
  }
  var BOOL_WORDS = ['true','false','yes','no','y','n','t','f'];
  function boolLike(s) { return BOOL_WORDS.indexOf(s.toLowerCase()) >= 0; }
  function dateLike(s) {
    return PATTERNS[7].re.test(s) || PATTERNS[8].re.test(s);
  }

  /* how convertible is this column to each candidate type? */
  function convertibility(values) {
    var vals = nonBlank(values);
    if (!vals.length) return { integer: 0, number: 0, date: 0, boolean: 0, n: 0 };
    var i = 0, num = 0, dt = 0, bl = 0;
    vals.forEach(function (s) {
      if (intLike(s)) i++;
      if (numericLike(s)) num++;
      if (dateLike(s)) dt++;
      if (boolLike(s)) bl++;
    });
    return {
      integer: i / vals.length, number: num / vals.length,
      date: dt / vals.length, boolean: bl / vals.length, n: vals.length
    };
  }

  /* the mixture of kinds present — powers "mixed types" anomalies */
  function kindMix(values) {
    var mix = { numeric: 0, text: 0, boolean: 0, date: 0, blank: 0 }, total = values.length || 1;
    values.forEach(function (v) {
      var s = clean(v);
      if (s === '') { mix.blank++; return; }
      if (numericLike(s)) mix.numeric++;
      else if (dateLike(s)) mix.date++;
      else if (boolLike(s)) mix.boolean++;
      else mix.text++;
    });
    Object.keys(mix).forEach(function (k) { mix[k] = mix[k] / total; });
    return mix;
  }

  /* ---------------------------------------------------------------
     3. NAMING CONVENTION ANALYSIS
     --------------------------------------------------------------- */
  function namingStyle(n) {
    if (/\s/.test(n)) return 'spaced';
    if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(n)) return 'snake_case';
    if (/^[A-Z0-9]+(_[A-Z0-9]+)+$/.test(n)) return 'UPPER_SNAKE';
    if (/^[a-z]+([A-Z][a-z0-9]*)+$/.test(n)) return 'camelCase';
    if (/^([A-Z][a-z0-9]*){2,}$/.test(n)) return 'PascalCase';
    if (/-/.test(n)) return 'kebab-case';
    if (/^[a-z0-9]+$/.test(n)) return 'lowercase';
    return 'other';
  }
  function toSnake(n) {
    return n.replace(/[\s-]+/g, '_')
            .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
            .replace(/__+/g, '_')
            .toLowerCase();
  }

  /* ---------------------------------------------------------------
     4. COLUMN PROFILE — the unit everything else builds on
     --------------------------------------------------------------- */
  SE.profileColumn = function (sheet, ci) {
    var name = sheet.cols[ci].name;
    var values = [];
    var CAP = 6000;
    for (var r = 0; r < sheet.rows.length && r < CAP; r++) values.push(sheet.rows[r][ci]);

    var total = values.length;
    var vals = nonBlank(values);
    var filled = vals.length;
    var nulls = total - filled;

    var distinct = Object.create(null), nDistinct = 0, freq = [];
    vals.forEach(function (s) {
      if (!(s in distinct)) { distinct[s] = 0; nDistinct++; }
      distinct[s]++;
    });
    Object.keys(distinct).forEach(function (k) { freq.push([k, distinct[k]]); });
    freq.sort(function (a, b) { return b[1] - a[1]; });

    var conv = convertibility(values);
    var mix = kindMix(values);
    var sem = detectSemantic(name, values);

    /* physical type: what the values literally are right now */
    var physical = 'string';
    if (conv.n) {
      if (conv.boolean >= 0.95 || (nDistinct <= 2 && conv.integer >= 0.95 &&
          vals.every(function (s) { return s === '0' || s === '1'; }))) physical = 'boolean';
      else if (conv.integer >= 0.95) physical = 'integer';
      else if (conv.number >= 0.95) physical = 'float';
      else if (conv.date >= 0.9) physical = 'datetime';
    }

    /* statistical type: how it behaves */
    var uniqueRatio = filled ? nDistinct / filled : 0;
    var statistical;
    if (physical === 'boolean' || nDistinct === 2) statistical = 'binary';
    else if (physical === 'datetime') statistical = 'temporal';
    else if (physical === 'integer' || physical === 'float') {
      statistical = (nDistinct <= Math.max(2, filled * 0.05) && nDistinct <= 25) ? 'discrete' : 'continuous numeric';
    } else {
      statistical = (nDistinct <= Math.max(2, filled * 0.12) || nDistinct <= 25) ? 'categorical' : 'text';
    }

    /* declared vs detected — a numeric column stored as text, a date as string… */
    var mismatch = null;
    if (physical === 'string') {
      if (conv.integer >= 0.9) mismatch = { detected: 'integer', ratio: conv.integer };
      else if (conv.number >= 0.9) mismatch = { detected: 'float', ratio: conv.number };
      else if (conv.date >= 0.9) mismatch = { detected: 'datetime', ratio: conv.date };
      else if (conv.boolean >= 0.9) mismatch = { detected: 'boolean', ratio: conv.boolean };
    }
    if (sem.type === 'currency' && physical !== 'float') {
      mismatch = mismatch || { detected: 'currency', ratio: sem.confidence };
    }

    var numeric = null;
    if (physical === 'integer' || physical === 'float') {
      var nums = [];
      vals.forEach(function (s) {
        var t = parseFloat(s.replace(/[,\s₹$€£¥%]/g, ''));
        if (isFinite(t)) nums.push(t);
      });
      if (nums.length) {
        nums.sort(function (a, b) { return a - b; });
        var sum = nums.reduce(function (a, b) { return a + b; }, 0);
        var zeros = nums.filter(function (v) { return v === 0; }).length;
        numeric = {
          min: nums[0], max: nums[nums.length - 1],
          mean: sum / nums.length,
          median: nums[Math.floor(nums.length / 2)],
          negatives: nums.filter(function (v) { return v < 0; }).length / nums.length,
          zeroRatio: zeros / nums.length
        };
      }
    }

    return {
      table: sheet.label || sheet.name,
      sheetName: sheet.name,
      column: name,
      index: ci,
      physical: physical,
      statistical: statistical,
      semantic: sem.type,
      semanticConfidence: sem.confidence,
      semanticFrom: sem.from,
      pii: sem.pii,
      rowCount: total,
      nullCount: nulls,
      nullRatio: total ? nulls / total : 0,
      distinct: nDistinct,
      uniqueRatio: uniqueRatio,
      isUnique: filled > 0 && nDistinct === filled,
      topValues: freq.slice(0, 5),
      mix: mix,
      conv: conv,
      mismatch: mismatch,
      numeric: numeric,
      naming: namingStyle(name),
      samples: vals.slice(0, 4)
    };
  };

  /* ---------------------------------------------------------------
     5. ML ROLE DETECTION
     --------------------------------------------------------------- */
  function detectRole(p) {
    if (p.pii) return 'PII';
    if (p.isUnique && (p.semantic === 'identifier' || /(^|_)id$/i.test(p.column) || p.semantic === 'uuid')) return 'Identifier';
    /* a continuous float being coincidentally unique is not a key — real key
       candidates are discrete integers, codes or strings */
    if (p.isUnique && p.nullRatio === 0 &&
        (p.physical === 'integer' || p.physical === 'string') &&
        p.statistical !== 'continuous numeric') return 'Candidate PK';
    if (p.statistical === 'temporal') return 'Temporal Feature';
    if (p.distinct === 1) return 'Constant';
    if (p.statistical === 'binary' && /(churn|target|label|fraud|is_|has_|flag|outcome|result|status)/i.test(p.column)) return 'Potential Target';
    if (p.statistical === 'text' && p.uniqueRatio > 0.8) return 'Text / High cardinality';
    if (p.statistical === 'categorical' || p.statistical === 'binary') return 'Categorical Feature';
    return 'Feature';
  }

  /* ---------------------------------------------------------------
     6. RELATIONSHIP DISCOVERY
     Evidence-weighted, exactly as the spec lays out:
       0.25 name + 0.20 type + 0.30 overlap + 0.15 uniqueness + 0.10 semantic
     plus a rules layer, cardinality inference and orphan validation.
     --------------------------------------------------------------- */
  var ABBREV = { cust: 'customer', qty: 'quantity', amt: 'amount', txn: 'transaction',
                 acct: 'account', prod: 'product', addr: 'address', dt: 'date',
                 num: 'number', no: 'number', desc: 'description', org: 'organisation' };

  function tokens(name) {
    return toSnake(name).split('_').filter(Boolean).map(function (t) { return ABBREV[t] || t; });
  }

  /* Jaro-Winkler, for near-miss names like cust_id vs customer_id */
  function jaro(a, b) {
    if (a === b) return 1;
    var m = 0, range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
    var aF = new Array(a.length).fill(false), bF = new Array(b.length).fill(false);
    for (var i = 0; i < a.length; i++) {
      var lo = Math.max(0, i - range), hi = Math.min(i + range + 1, b.length);
      for (var j = lo; j < hi; j++) {
        if (bF[j] || a[i] !== b[j]) continue;
        aF[i] = bF[j] = true; m++; break;
      }
    }
    if (!m) return 0;
    var k = 0, t = 0;
    for (var x = 0; x < a.length; x++) {
      if (!aF[x]) continue;
      while (!bF[k]) k++;
      if (a[x] !== b[k]) t++;
      k++;
    }
    t = t / 2;
    return (m / a.length + m / b.length + (m - t) / m) / 3;
  }
  function jaroWinkler(a, b) {
    var j = jaro(a, b), p = 0;
    while (p < 4 && a[p] === b[p]) p++;
    return j + p * 0.1 * (1 - j);
  }

  var GENERIC_TOKENS = ['id','key','code','no','number','pk','uuid','guid','ref'];
  function singular(t) { return t.replace(/ies$/, 'y').replace(/s$/, ''); }

  /* The discriminating part of a column name is what remains once the
     generic key suffix is removed. customer_id and item_id share "id" but
     describe different things — scoring on raw string similarity let every
     integer id column match every other, which is exactly the false-positive
     class this needs to reject. */
  function nameScore(colA, colB, tableA, tableB) {
    var a = toSnake(colA).replace(/_/g, ''), b = toSnake(colB).replace(/_/g, '');
    var ta = tokens(colA), tb = tokens(colB);
    var coreA = ta.filter(function (t) { return GENERIC_TOKENS.indexOf(t) < 0; }).map(singular);
    var coreB = tb.filter(function (t) { return GENERIC_TOKENS.indexOf(t) < 0; }).map(singular);
    var tblA = singular(toSnake(tableA).replace(/_/g, ''));
    var tblB = singular(toSnake(tableB).replace(/_/g, ''));

    /* an identical name only proves a match when it carries meaning:
       two tables both having a bare "id" says nothing about a relationship */
    if (a === b && (coreA.length || coreB.length)) return 1;

    /* both sides carry a meaningful stem — they have to agree */
    if (coreA.length && coreB.length) {
      var setB = {}; coreB.forEach(function (t) { setB[t] = 1; });
      var shared = coreA.filter(function (t) { return setB[t]; }).length;
      if (shared) return Math.min(1, 0.9 + 0.1 * (shared / Math.max(coreA.length, coreB.length)));
      var jw = jaroWinkler(coreA.join(''), coreB.join(''));
      return jw > 0.92 ? jw * 0.85 : jw * 0.45;   /* near-identical stems only */
    }

    /* one side is a bare key (customers.id) — qualify it with its table */
    if (!coreB.length && coreA.length) return coreA.join('') === tblB ? 0.96 : 0.2;
    if (!coreA.length && coreB.length) return coreB.join('') === tblA ? 0.96 : 0.2;

    /* both bare (id -> id): only credible if the tables themselves relate */
    return tblA === tblB ? 0.9 : 0.25;
  }

  /* type compatibility, mirroring the spec's table */
  function typeScore(a, b) {
    var fam = function (t) {
      if (t === 'integer' || t === 'float') return 'number';
      if (t === 'datetime') return 'date';
      if (t === 'boolean') return 'bool';
      return 'string';
    };
    var fa = fam(a), fb = fam(b);
    if (a === b) return 1;
    if (fa === fb) return 0.95;
    if ((fa === 'number' && fb === 'string') || (fa === 'string' && fb === 'number')) return 0.7;
    if ((fa === 'date' && fb === 'string') || (fa === 'string' && fb === 'date')) return 0.6;
    if (fa === 'bool' || fb === 'bool') return 0.2;
    return 0.3;
  }

  function valueSet(sheet, ci, cap) {
    var set = Object.create(null), n = 0;
    for (var r = 0; r < sheet.rows.length && n < cap; r++) {
      var s = clean(sheet.rows[r][ci]);
      if (s === '') continue;
      if (!(s in set)) { set[s] = 1; n++; }
    }
    return set;
  }
  function coverage(a, b) {
    var ka = Object.keys(a);
    if (!ka.length) return 0;
    var hit = 0;
    for (var i = 0; i < ka.length; i++) if (ka[i] in b) hit++;
    return hit / ka.length;
  }

  function semanticScore(pa, pb) {
    if (pa.semantic && pa.semantic === pb.semantic) return 1;
    if (pa.semantic === 'identifier' && pb.semantic === 'identifier') return 1;
    if (!pa.semantic && !pb.semantic) return 0.5;
    if (pa.statistical === pb.statistical) return 0.6;
    return 0.25;
  }

  SE.discoverRelationships = function (sheets, profiles, opts) {
    opts = opts || {};
    var MIN = opts.minScore || 0.55;
    var rels = [];

    for (var i = 0; i < sheets.length; i++) {
      for (var j = 0; j < sheets.length; j++) {
        if (i === j) continue;
        var A = sheets[i], B = sheets[j];
        for (var ai = 0; ai < A.cols.length; ai++) {
          for (var bi = 0; bi < B.cols.length; bi++) {
            var pa = profiles[i][ai], pb = profiles[j][bi];

            /* --- hard filters: kill obviously impossible pairs early --- */
            if (pb.distinct === 0 || pa.distinct === 0) continue;
            if (!pb.isUnique) continue;                 /* target must be a key */
            var ts = typeScore(pa.physical, pb.physical);
            if (ts < 0.5) continue;
            if (pa.statistical === 'text' && pa.uniqueRatio > 0.95 && pb.uniqueRatio > 0.95 &&
                pa.semantic !== pb.semantic) continue;

            var ns = nameScore(pa.column, pb.column, A.name, B.name);
            if (ns < 0.62) continue;                    /* names must genuinely agree */

            /* --- evidence --- */
            var sa = valueSet(A, ai, 3000), sb = valueSet(B, bi, 3000);
            var srcCoverage = coverage(sa, sb);          /* FK side contained in PK side */
            var tgtCoverage = coverage(sb, sa);
            if (srcCoverage < 0.5) continue;

            var uniq = (pb.uniqueRatio >= 0.99 ? 1 : pb.uniqueRatio) *
                       (pa.uniqueRatio < 0.95 ? 1 : 0.75);
            var sem = semanticScore(pa, pb);

            var score = 0.25 * ns + 0.20 * ts + 0.30 * srcCoverage + 0.15 * uniq + 0.10 * sem;

            /* --- rules layer (weights straight from the spec) --- */
            var rules = [
              { name: 'Exact value coverage', pass: srcCoverage >= 0.98, weight: 30 },
              { name: 'Target uniqueness',    pass: pb.uniqueRatio >= 0.99, weight: 20 },
              { name: 'Compatible types',     pass: ts >= 0.8, weight: 15 },
              { name: 'Name similarity',      pass: ns >= 0.8, weight: 15 },
              { name: 'Semantic similarity',  pass: sem >= 0.8, weight: 10 }
            ];
            var ruleHit = rules.reduce(function (t, r) { return t + (r.pass ? r.weight : 0); }, 0);
            /* rules can lift a borderline statistical match into confidence */
            score = Math.min(1, score * 0.75 + (ruleHit / 90) * 0.25);
            if (score < MIN) continue;

            /* --- cardinality --- */
            var cardinality = pa.isUnique ? 'One → One' : 'Many → One';

            /* --- validation: orphan rate --- */
            var orphans = Object.keys(sa).filter(function (k) { return !(k in sb); });
            var orphanRate = Object.keys(sa).length ? orphans.length / Object.keys(sa).length : 0;

            rels.push({
              fromSheet: i, fromCol: ai, toSheet: j, toCol: bi,
              from: pa, to: pb,
              score: score,
              confidence: score >= 0.85 ? 'HIGH' : (score >= 0.7 ? 'MEDIUM' : 'LOW'),
              cardinality: cardinality,
              kind: srcCoverage >= 0.98 ? 'EXACT FOREIGN KEY' : 'FUZZY FOREIGN KEY',
              status: 'INFERRED',
              evidence: {
                name: ns, type: ts, coverage: srcCoverage,
                targetCoverage: tgtCoverage, uniqueness: uniq, semantic: sem
              },
              rules: rules,
              orphanRate: orphanRate,
              orphanSamples: orphans.slice(0, 4),
              health: 1 - orphanRate
            });
          }
        }
      }
    }

    /* keep the best direction for each unordered column pair */
    var best = {};
    rels.forEach(function (r) {
      /* key on the unordered pair of endpoints, each endpoint kept intact —
         sorting a mixed array of indices and names collapsed distinct pairs
         onto the same key and swapped their endpoints */
      var e1 = r.fromSheet + ':' + r.fromCol, e2 = r.toSheet + ':' + r.toCol;
      var k = e1 < e2 ? e1 + '|' + e2 : e2 + '|' + e1;
      if (!best[k] || best[k].score < r.score) best[k] = r;
    });
    return Object.keys(best).map(function (k) { return best[k]; })
      .sort(function (a, b) { return b.score - a.score; });
  };

  /* composite key candidates — pairs that are unique together but not alone */
  SE.findCompositeKeys = function (sheet, profs) {
    var out = [], n = profs.length;
    var cand = [];
    for (var i = 0; i < n; i++) {
      var p = profs[i];
      if (p.isUnique) continue;
      if (p.distinct < 2) continue;
      if (p.uniqueRatio > 0.02 || p.statistical !== 'text') cand.push(i);
    }
    cand = cand.slice(0, 8);
    for (var a = 0; a < cand.length; a++) {
      for (var b = a + 1; b < cand.length; b++) {
        var seen = Object.create(null), dup = 0, rows = 0;
        for (var r = 0; r < sheet.rows.length && r < 4000; r++) {
          var k = clean(sheet.rows[r][cand[a]]) + '\u0001' + clean(sheet.rows[r][cand[b]]);
          rows++;
          if (seen[k]) dup++; else seen[k] = 1;
        }
        if (!rows) continue;
        var uniqueness = 1 - dup / rows;
        if (uniqueness >= 0.98) {
          out.push({ cols: [profs[cand[a]].column, profs[cand[b]].column], uniqueness: uniqueness });
        }
      }
    }
    return out.sort(function (x, y) { return y.uniqueness - x.uniqueness; }).slice(0, 4);
  };

  /* ---------------------------------------------------------------
     7. MISSINGNESS DEPENDENCY
     "income is missing in 81% of rows where employment_status = X"
     --------------------------------------------------------------- */
  SE.missingnessDependency = function (sheet, profs, targetIdx) {
    var best = null;
    for (var c = 0; c < profs.length; c++) {
      if (c === targetIdx) continue;
      var p = profs[c];
      if (p.statistical !== 'categorical' && p.statistical !== 'binary') continue;
      if (p.distinct > 12 || p.distinct < 2) continue;
      var groups = {};
      for (var r = 0; r < sheet.rows.length && r < 4000; r++) {
        var g = clean(sheet.rows[r][c]) || '(blank)';
        var missing = clean(sheet.rows[r][targetIdx]) === '';
        if (!groups[g]) groups[g] = { n: 0, miss: 0 };
        groups[g].n++;
        if (missing) groups[g].miss++;
      }
      Object.keys(groups).forEach(function (g) {
        var gr = groups[g];
        if (gr.n < 15) return;
        var rate = gr.miss / gr.n;
        if (rate >= 0.5 && (!best || rate > best.rate)) {
          best = { column: p.column, value: g, rate: rate, n: gr.n };
        }
      });
    }
    return best;
  };

  /* ---------------------------------------------------------------
     8. FULL REPORT
     --------------------------------------------------------------- */
  SE.analyse = function (model) {
    var sheets = model.sheets;
    var profiles = sheets.map(function (s) {
      return s.cols.map(function (c, ci) { return SE.profileColumn(s, ci); });
    });

    profiles.forEach(function (ps) { ps.forEach(function (p) { p.role = detectRole(p); }); });

    var rels = SE.discoverRelationships(sheets, profiles);
    /* a column that references another table is a foreign key, not a plain
       feature — worth naming explicitly now the evidence exists */
    rels.forEach(function (r) {
      var p = profiles[r.fromSheet][r.fromCol];
      if (p.role === 'Feature' || p.role === 'Categorical Feature') p.role = 'Foreign Key';
    });

    /* ---- aggregate counts ---- */
    var allProfiles = [];
    profiles.forEach(function (ps, si) { ps.forEach(function (p) { p.sheetIndex = si; allProfiles.push(p); }); });

    var totalRows = sheets.reduce(function (a, s) { return a + s.rows.length; }, 0);
    var totalCols = allProfiles.length;
    var bytes = (model.fileMeta || []).reduce(function (a, f) { return a + (f.size || 0); }, 0);

    var typeDist = { numeric: 0, categorical: 0, datetime: 0, text: 0, boolean: 0 };
    allProfiles.forEach(function (p) {
      if (p.physical === 'integer' || p.physical === 'float') typeDist.numeric++;
      else if (p.physical === 'datetime') typeDist.datetime++;
      else if (p.physical === 'boolean') typeDist.boolean++;
      else if (p.statistical === 'categorical' || p.statistical === 'binary') typeDist.categorical++;
      else typeDist.text++;
    });

    /* ---- duplicate rows per sheet ---- */
    var dupRows = 0, dupTotal = 0;
    sheets.forEach(function (s) {
      var seen = Object.create(null);
      for (var r = 0; r < s.rows.length && r < 5000; r++) {
        var k = s.rows[r].map(clean).join('\u0001');
        dupTotal++;
        if (seen[k]) dupRows++; else seen[k] = 1;
      }
    });

    /* ---- duplicate column names across the dataset ---- */
    /* a shared name across tables is how joins work — only flag repeats
       inside a single sheet, which genuinely breaks exports and queries */
    var nameCount = {};
    profiles.forEach(function (ps) {
      var seenHere = {};
      ps.forEach(function (p) {
        var k = toSnake(p.column);
        seenHere[k] = (seenHere[k] || 0) + 1;
        if (seenHere[k] > 1) nameCount[k] = (nameCount[k] || 1) + 1;
      });
    });

    /* ---- issues ---- */
    var issues = [];
    function issue(sev, title, detail, col) {
      issues.push({ severity: sev, title: title, detail: detail, column: col || null });
    }

    allProfiles.forEach(function (p) {
      if (p.mismatch) {
        issue('critical', 'Type mismatch: ' + p.column,
          'Stored as ' + p.physical + ' but ' + pct(p.mismatch.ratio) + '% of values convert to ' +
          p.mismatch.detected + '. Recommended type: ' + p.mismatch.detected + '.', p);
      }
      if (p.pii) {
        issue('critical', 'Potential PII: ' + p.column,
          p.pii + ' detected with ' + pct(p.semanticConfidence) + '% confidence. Mask or exclude from modelling.', p);
      }
      if (p.distinct === 1 && p.rowCount > 1) {
        issue('warning', 'Constant column: ' + p.column,
          'Only one value across every row (' + (p.topValues[0] ? p.topValues[0][0] : '—') + '). Carries no information.', p);
      } else if (p.topValues.length && p.topValues[0][1] / Math.max(1, p.rowCount - p.nullCount) >= 0.98 && p.distinct > 1) {
        issue('suggestion', 'Near-constant: ' + p.column,
          pct(p.topValues[0][1] / (p.rowCount - p.nullCount)) + '% of rows share one value. Likely a weak feature.', p);
      }
      if (p.nullRatio >= 0.5) {
        issue('warning', 'Mostly null: ' + p.column, pct(p.nullRatio) + '% of values are missing.', p);
      }
      if (p.mix.numeric > 0.05 && p.mix.text > 0.05) {
        issue('warning', 'Mixed types: ' + p.column,
          pct(p.mix.numeric) + '% numeric, ' + pct(p.mix.text) + '% text. Parsing will be unreliable.', p);
      }
      if (p.numeric && p.numeric.negatives > 0 && /(age|price|amount|qty|quantity|count|revenue|salary|income)/i.test(p.column)) {
        issue('warning', 'Negative values in ' + p.column,
          'Minimum is ' + p.numeric.min + ' in a field that is normally positive.', p);
      }
      if (p.numeric && p.numeric.zeroRatio >= 0.6) {
        issue('suggestion', 'Zero-inflated: ' + p.column, pct(p.numeric.zeroRatio) + '% of values are zero.', p);
      }
      if (/^(col|field|column|unnamed|var)\d*$/i.test(p.column)) {
        issue('suggestion', 'Generic name: ' + p.column, 'Uninformative column name.', p);
      }
      if (p.column.length > 40) {
        issue('suggestion', 'Very long name: ' + p.column.slice(0, 24) + '…', 'Names over 40 characters are hard to work with.', p);
      }
      if (/\s/.test(p.column) || /[^\w\s-]/.test(p.column)) {
        issue('warning', 'Unsafe characters: ' + p.column, 'Spaces or special characters complicate querying.', p);
      }
      /* unexpected categories: same value in different casings */
      if (p.statistical === 'categorical' && p.distinct > 1 && p.distinct <= 30) {
        var lower = {}, clash = [];
        p.topValues.forEach(function (tv) {
          var l = tv[0].toLowerCase();
          if (lower[l] && lower[l] !== tv[0]) clash.push(lower[l] + ' / ' + tv[0]);
          lower[l] = tv[0];
        });
        if (clash.length) {
          issue('warning', 'Inconsistent categories: ' + p.column,
            'Values differing only by case: ' + clash.join(', ') + '.', p);
        }
      }
    });

    Object.keys(nameCount).forEach(function (k) {
      if (nameCount[k] > 1) {
        issue('warning', 'Duplicate column name: ' + k,
          'Appears ' + nameCount[k] + ' times within one sheet — queries and exports become ambiguous.');
      }
    });

    rels.forEach(function (r) {
      if (r.orphanRate > 0.001) {
        issue('warning', 'Orphan references: ' + r.from.table + '.' + r.from.column,
          pct(r.orphanRate) + '% of values have no match in ' + r.to.table + '.' + r.to.column +
          ' — those rows would vanish in an inner join.');
      }
    });

    if (dupTotal && dupRows / dupTotal > 0.01) {
      issue('warning', 'Duplicate rows', pct(dupRows / dupTotal) + '% of rows are exact duplicates.');
    }

    /* ---- naming convention ---- */
    var styles = {};
    allProfiles.forEach(function (p) { styles[p.naming] = (styles[p.naming] || 0) + 1; });
    var domStyle = Object.keys(styles).sort(function (a, b) { return styles[b] - styles[a]; })[0];
    var namingConsistency = totalCols ? styles[domStyle] / totalCols : 1;
    if (namingConsistency < 0.9) {
      issue('suggestion', 'Inconsistent naming convention',
        'Mostly ' + domStyle + ' (' + pct(namingConsistency) + '%), with ' +
        (Object.keys(styles).length - 1) + ' other style(s) mixed in.');
    }

    /* ---- health score, by the six categories in the spec ---- */
    var mismatches = allProfiles.filter(function (p) { return p.mismatch; }).length;
    var avgNull = allProfiles.reduce(function (a, p) { return a + p.nullRatio; }, 0) / (totalCols || 1);
    var pkCount = allProfiles.filter(function (p) {
      return p.isUnique && p.nullRatio === 0 && p.statistical !== 'continuous numeric';
    }).length;
    var avgOrphan = rels.length ? rels.reduce(function (a, r) { return a + r.orphanRate; }, 0) / rels.length : 0;
    var anomalyCount = issues.filter(function (i) { return i.severity !== 'suggestion'; }).length;

    var categories = [
      { name: 'Type consistency',     score: Math.round(100 - (mismatches / (totalCols || 1)) * 260) },
      { name: 'Nullability',          score: Math.round(100 - avgNull * 190) },
      { name: 'Key integrity',        score: pkCount ? Math.round(70 + Math.min(30, pkCount * 12)) : 40 },
      { name: 'Naming conventions',   score: Math.round(namingConsistency * 100) },
      { name: 'Referential integrity',score: rels.length ? Math.round(100 - avgOrphan * 250) : 75 },
      { name: 'Schema consistency',   score: Math.round(100 - Math.min(45, anomalyCount * 6)) }
    ].map(function (c) { return { name: c.name, score: Math.max(0, Math.min(100, c.score)) }; });

    var overall = Math.round(categories.reduce(function (a, c) { return a + c.score; }, 0) / categories.length);

    /* ---- keys ---- */
    var pks = allProfiles.filter(function (p) {
        return p.isUnique && p.nullRatio === 0 &&
               (p.physical === 'integer' || p.physical === 'string') &&
               p.statistical !== 'continuous numeric';
      })
      .map(function (p) {
        var conf = 0.6 + (p.semantic === 'identifier' || /(^|_)id$/i.test(p.column) ? 0.25 : 0) +
                   (p.physical !== 'string' ? 0.1 : 0.05);
        return { profile: p, uniqueness: 1, nulls: 0, confidence: Math.min(0.99, conf) };
      })
      .sort(function (a, b) { return b.confidence - a.confidence; });

    /* near-miss keys worth flagging */
    var suspicious = allProfiles.filter(function (p) {
      return !p.isUnique && p.uniqueRatio >= 0.9 &&
             (p.semantic === 'identifier' || /(^|_)id$/i.test(p.column));
    }).map(function (p) { return { profile: p, dupRate: 1 - p.uniqueRatio }; });

    var composites = sheets.map(function (s, si) {
      return { sheet: s, index: si, keys: SE.findCompositeKeys(s, profiles[si]) };
    }).filter(function (c) { return c.keys.length; });

    /* ---- missingness dependencies ---- */
    var missDeps = [];
    profiles.forEach(function (ps, si) {
      ps.forEach(function (p) {
        if (p.nullRatio < 0.05 || p.nullRatio > 0.95) return;
        var dep = SE.missingnessDependency(sheets[si], ps, p.index);
        if (dep) missDeps.push({ target: p, dep: dep });
      });
    });

    return {
      sheets: sheets,
      profiles: profiles,
      allProfiles: allProfiles,
      relationships: rels,
      composites: composites,
      primaryKeys: pks,
      suspiciousKeys: suspicious,
      missingnessDeps: missDeps.slice(0, 6),
      issues: issues.sort(function (a, b) {
        var order = { critical: 0, warning: 1, suggestion: 2 };
        return order[a.severity] - order[b.severity];
      }),
      naming: { dominant: domStyle, consistency: namingConsistency, styles: styles },
      health: { overall: overall, categories: categories },
      stats: {
        files: model.files.length,
        sheets: sheets.length,
        rows: totalRows,
        columns: totalCols,
        bytes: bytes,
        typeDist: typeDist,
        nullableCols: allProfiles.filter(function (p) { return p.nullRatio > 0; }).length,
        uniqueCols: allProfiles.filter(function (p) { return p.isUnique; }).length,
        duplicateRowRatio: dupTotal ? dupRows / dupTotal : 0
      }
    };
  };

  /* ---------------------------------------------------------------
     9. LEAKAGE DETECTION (needs a chosen target)
     --------------------------------------------------------------- */
  SE.detectLeakage = function (report, targetProfile) {
    if (!targetProfile) return [];
    var si = targetProfile.sheetIndex;
    var sheet = report.sheets[si];
    var profs = report.profiles[si];
    var ti = targetProfile.index;
    var out = [];

    /* encode target to numbers so we can correlate anything against it */
    var tvals = [], map = {}, next = 0;
    for (var r = 0; r < sheet.rows.length && r < 4000; r++) {
      var s = clean(sheet.rows[r][ti]);
      if (!(s in map)) map[s] = next++;
      tvals.push(map[s]);
    }

    profs.forEach(function (p) {
      if (p.index === ti) return;
      if (p.role === 'Identifier' || p.role === 'Candidate PK') return;

      /* 1. suspicious naming: something recorded after the outcome */
      var nameFlag = /(result|outcome|investigation|cancel|churn_date|resolved|closed|final|post_|_after|status)/i.test(p.column);

      /* 2. statistical association with the target */
      var vals = [], seen = {}, nx = 0;
      for (var r2 = 0; r2 < sheet.rows.length && r2 < 4000; r2++) {
        var v = clean(sheet.rows[r2][p.index]);
        if (!(v in seen)) seen[v] = nx++;
        vals.push(seen[v]);
      }
      var n = Math.min(vals.length, tvals.length);
      var sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, cnt = 0;
      for (var k = 0; k < n; k++) {
        var x = vals[k], y = tvals[k];
        cnt++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      }
      var den = Math.sqrt((cnt * sxx - sx * sx) * (cnt * syy - sy * sy));
      var corr = den === 0 ? 0 : Math.abs((cnt * sxy - sx * sy) / den);

      /* 3. a column that maps one-to-one onto the target is a giveaway */
      var pairs = {}, conflict = 0, tot = 0;
      for (var m = 0; m < n; m++) {
        var key = vals[m];
        tot++;
        if (key in pairs) { if (pairs[key] !== tvals[m]) conflict++; }
        else pairs[key] = tvals[m];
      }
      var determinism = tot ? 1 - conflict / tot : 0;

      if (corr >= 0.85 || (determinism >= 0.995 && p.distinct > 1 && p.distinct <= 40) || (nameFlag && corr >= 0.5)) {
        out.push({
          profile: p,
          correlation: corr,
          determinism: determinism,
          nameFlag: nameFlag,
          reason: nameFlag
            ? 'Name suggests it is recorded after the outcome is known.'
            : (determinism >= 0.995
                ? 'Values map almost perfectly onto the target — knowing one gives the other.'
                : 'Very high association with the target.')
        });
      }
    });
    return out.sort(function (a, b) { return b.correlation - a.correlation; }).slice(0, 6);
  };

  /* ---------------------------------------------------------------
     10. DATA DICTIONARY EXPORT
     --------------------------------------------------------------- */
  SE.buildDictionary = function (report) {
    return report.allProfiles.map(function (p) {
      var desc = SE.describe(p);
      return {
        table: p.table, column: p.column,
        physical: p.physical, statistical: p.statistical,
        semantic: p.semantic || '—', role: p.role,
        nullable: p.nullRatio > 0 ? 'Yes' : 'No',
        nullPct: pct(p.nullRatio) + '%',
        unique: p.isUnique ? 'Yes' : 'No',
        distinct: p.distinct,
        range: p.numeric ? (p.numeric.min + ' – ' + p.numeric.max) : '—',
        description: desc
      };
    });
  };

  /* plain-language, clearly inferred rather than authoritative */
  SE.describe = function (p) {
    var bits = [];
    if (p.role === 'Candidate PK' || p.role === 'Identifier') {
      bits.push('Unique identifier for each row in ' + p.table + '.');
    } else if (p.semantic === 'currency') {
      bits.push('Monetary value' + (p.numeric ? ', ranging from ' + Math.round(p.numeric.min) + ' to ' + Math.round(p.numeric.max) : '') + '.');
    } else if (p.statistical === 'temporal') {
      bits.push('Date or timestamp field.');
    } else if (p.semantic) {
      bits.push(p.semantic.charAt(0).toUpperCase() + p.semantic.slice(1) + ' value.');
    } else if (p.statistical === 'binary') {
      bits.push('Binary field' + (p.topValues.length ? ' — most rows are "' + p.topValues[0][0] + '"' : '') + '.');
    } else if (p.statistical === 'categorical') {
      bits.push('Category with ' + p.distinct + ' distinct values' +
        (p.topValues.length ? ', most often "' + p.topValues[0][0] + '"' : '') + '.');
    } else if (p.numeric) {
      bits.push('Numeric measure between ' + Math.round(p.numeric.min) + ' and ' + Math.round(p.numeric.max) +
        ', averaging ' + Math.round(p.numeric.mean) + '.');
    } else {
      bits.push('Free text field.');
    }
    if (p.nullRatio > 0.01) bits.push(pct(p.nullRatio) + '% of rows are missing a value.');
    return bits.join(' ');
  };

  SE.pct = pct;
  SE.toSnake = toSnake;
})();
