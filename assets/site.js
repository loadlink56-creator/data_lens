/* =====================================================================
   Data Lens — shared site behaviour
   ===================================================================== */
(function () {
  'use strict';

  var DL = window.DL = {};

  DL.getTheme = getTheme;
  DL.setTheme = setTheme;

  DL.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  DL.$  = function (s, r) { return (r || document).querySelector(s); };
  DL.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- section registry (single source of truth for nav) ---------- */
  DL.SECTIONS = [
    { n: '00', slug: 'file-analyser',       name: 'File Analyser',       blurb: 'Drop a file and map its sheets as a live node graph.' },
    { n: '01', slug: 'directory-analyser',  name: 'Directory Analyser',  blurb: 'Open a whole folder and see what is actually in it.' },
    { n: '02', slug: 'schema-analyser',     name: 'Schema Analyser',     blurb: 'Work out what every column holds, in every file.' },
    { n: '03', slug: 'column-profiler',     name: 'Column Profiler',     blurb: 'Distributions, missing values, and outliers per column.' },
    { n: '04', slug: 'relationship-mapper', name: 'Relationship Mapper', blurb: 'Shared keys and correlations across your files.' },
    { n: '05', slug: 'statistics-lab',      name: 'Statistics Lab',      blurb: 'Comparisons and tests, chosen for your data.' },
    { n: '06', slug: 'chart-studio',        name: 'Chart Studio',        blurb: 'The right chart for every column, picked for you.' },
    { n: '07', slug: 'report-builder',      name: 'Report Builder',      blurb: 'Every finding compiled into one shareable report.' }
  ];

  /* ---------- nav ---------- */
  function buildNav() {
    var panel = DL.$('#navPanel');
    if (!panel) return;
    var current = document.body.getAttribute('data-page') || '';
    panel.innerHTML = DL.SECTIONS.map(function (s) {
      return '<a class="nav__item' + (s.slug === current ? ' is-current' : '') + '" href="' + s.slug + '.html">' +
             '<i>' + s.n + '</i><span><b>' + s.name + '</b><s>' + s.blurb + '</s></span></a>';
    }).join('');

    var burger = DL.$('#navBurger');

    function setOpen(open) {
      panel.classList.toggle('is-open', open);
      if (burger) burger.setAttribute('aria-expanded', open);
    }
    function toggle(e) { e.stopPropagation(); setOpen(!panel.classList.contains('is-open')); }

    if (burger) burger.addEventListener('click', toggle);
    document.addEventListener('click', function (e) {
      if (!panel.contains(e.target) && e.target !== burger && !burger.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setOpen(false);
    });
  }

  /* ---------- footer section links ---------- */
  function buildFooter() {
    var ul = DL.$('#footSections');
    if (!ul) return;
    ul.innerHTML = DL.SECTIONS.map(function (s) {
      return '<li><a href="' + s.slug + '.html">' + s.name + '</a></li>';
    }).join('');
  }

  /* ---------- scroll reveals ---------- */
  function reveals() {
    var els = DL.$$('[data-reveal]');
    if (DL.reduced || !('IntersectionObserver' in window) || !window.gsap) {
      els.forEach(function (el) { el.style.opacity = 1; el.style.transform = 'none'; });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var sibs = Array.prototype.slice.call(e.target.parentNode.children);
        var i = Math.min(sibs.indexOf(e.target), 3);
        gsap.to(e.target, { opacity: 1, y: 0, duration: .8, ease: 'power3.out', delay: i * .09 });
        io.unobserve(e.target);
      });
    }, { threshold: .18 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------- run an animation only while it is on screen ---------- */
  DL.whenVisible = function (el, onEnter, onLeave) {
    if (!('IntersectionObserver' in window)) { onEnter(); return; }
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { e.isIntersecting ? onEnter() : (onLeave && onLeave()); });
    }, { threshold: .2 }).observe(el);
  };

  /* ---------- looping stage helper ----------
     Builds a GSAP timeline, plays it only while visible, wires the caption
     and the replay button, and rebuilds on resize.                        */
  DL.stage = function (opts) {
    var root = DL.$(opts.root);
    if (!root) return;
    var capEl = opts.caption ? DL.$(opts.caption) : null;
    var tl = null;

    function setCap(html) {
      if (!capEl) return;
      if (DL.reduced) { capEl.innerHTML = html; return; }
      gsap.to(capEl, {
        opacity: 0, y: -5, duration: .22,
        onComplete: function () {
          capEl.innerHTML = html;
          gsap.fromTo(capEl, { opacity: 0, y: 7 }, { opacity: 1, y: 0, duration: .4, ease: 'power2.out' });
        }
      });
    }

    function make() {
      if (tl) tl.kill();
      tl = gsap.timeline({ repeat: -1, repeatDelay: opts.repeatDelay || .7, paused: true });
      opts.build(tl, setCap, root);
      return tl;
    }

    if (DL.reduced || !window.gsap) {
      if (opts.still) opts.still(root, setCap);
      return;
    }

    make();
    DL.whenVisible(root, function () { tl && tl.play(); }, function () { tl && tl.pause(); });

    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { make(); tl.play(); }, 260);
    });

    if (opts.replay) {
      var rb = DL.$(opts.replay);
      if (rb) rb.addEventListener('click', function () { tl.restart(); tl.play(); });
    }
    return tl;
  };

  /* ---------- number count-up ---------- */
  DL.count = function (el, to, opts) {
    opts = opts || {};
    var o = { v: opts.from || 0 };
    var dec = opts.decimals || 0;
    return gsap.to(o, {
      v: to, duration: opts.duration || 1.1, ease: opts.ease || 'power2.out',
      onUpdate: function () {
        var n = dec ? o.v.toFixed(dec) : Math.round(o.v).toLocaleString('en-US');
        el.textContent = (opts.prefix || '') + n + (opts.suffix || '');
      }
    });
  };

  /* ---------- SVG helpers ---------- */
  var NS = 'http://www.w3.org/2000/svg';
  DL.svg = function (tag, attrs, parent) {
    var el = document.createElementNS(NS, tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  };
  DL.clear = function (el) { while (el.firstChild) el.removeChild(el.firstChild); };

  /* ---------- waitlist form ---------- */
  function waitlist() {
    DL.$$('[data-waitlist]').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var b = form.querySelector('button');
        b.textContent = "You're on the list \u2713";
        b.style.pointerEvents = 'none';
      });
    });
  }


  /* =====================================================================
     Line rail — LineSidebar from reactbits.dev, ported from React to
     plain JS. Same idea: one rAF loop eases each item's --effect toward
     its target so colour, shift and marker scale move in lockstep with
     no staggered CSS transitions.
     ===================================================================== */
  DL.RAIL_ITEMS = [
    { label: 'Overview',           hash: '#sections',  page: 'index.html' },
    { label: 'File analyser',      page: 'file-analyser.html' },
    { label: 'Directory analyser', page: 'directory-analyser.html' },
    { label: 'How it works',       hash: '#pipeline',  page: 'index.html' }
  ];

  var FALLOFF = {
    linear: function (p) { return p; },
    smooth: function (p) { return p * p * (3 - 2 * p); },
    sharp:  function (p) { return p * p * p; }
  };

  function buildRail() {
    if (window.innerWidth < 1280) return;          // below this the gutter is not reserved
    if (DL.$('.rail')) return;

    var home = document.body.getAttribute('data-page') === 'home';
    var page = (location.pathname.split('/').pop() || 'index.html');

    var nav = document.createElement('nav');
    nav.className = 'rail';
    nav.setAttribute('aria-label', 'Section rail');
    nav.innerHTML = '<ul class="rail__list">' + DL.RAIL_ITEMS.map(function (it, i) {
      var href = (home && it.hash) ? it.hash : (it.page + (it.hash || ''));
      return '<li class="rail__item" data-i="' + i + '">' +
               '<span class="rail__marker" aria-hidden="true"></span>' +
               '<a class="rail__link" href="' + href + '">' +
                 '<span class="rail__i">' + String(i + 1).padStart(2, '0') + '</span>' +
                 '<span class="rail__t">' + it.label + '</span>' +
               '</a>' +
             '</li>';
    }).join('') + '</ul>';
    document.body.appendChild(nav);

    var list  = DL.$('.rail__list', nav);
    var items = DL.$$('.rail__item', nav);
    var targets = items.map(function () { return 0; });
    var currents = items.map(function () { return 0; });
    var active = -1, raf = null, last = 0;
    var SMOOTHING = 130;

    function frame(now) {
      var dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      var k = 1 - Math.exp(-dt / (SMOOTHING / 1000));
      var moving = false;
      items.forEach(function (el, i) {
        /* the active section is shown by colour alone; only hover grows an item */
        var target = targets[i];
        var next = currents[i] + (target - currents[i]) * k;
        var settled = Math.abs(target - next) < 0.0015;
        currents[i] = settled ? target : next;
        el.style.setProperty('--effect', currents[i].toFixed(4));
        if (!settled) moving = true;
      });
      raf = moving ? requestAnimationFrame(frame) : null;
    }
    function start() {
      if (raf != null) cancelAnimationFrame(raf);
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }

    /* Proximity used to light up the neighbours of whatever the cursor was
       near. Only the item actually hovered should respond. */
    items.forEach(function (el, i) {
      el.addEventListener('pointerenter', function () {
        targets = targets.map(function () { return 0; });
        targets[i] = 1;
        start();
      });
    });
    list.addEventListener('pointerleave', function () {
      targets = targets.map(function () { return 0; });
      start();
    });

    function setActive(i) {
      if (i === active) return;
      active = i;
      items.forEach(function (el, k) {
        el.setAttribute('aria-current', k === i ? 'true' : 'false');
      });
      start();
    }

    /* on a section page the matching entry is simply the current file */
    if (!home) {
      DL.RAIL_ITEMS.forEach(function (it, i) { if (it.page === page) setActive(i); });
      return;
    }

    /* on the landing page, follow the scroll position */
    var spy = [
      { i: 0, el: DL.$('#sections') },
      { i: 3, el: DL.$('#pipeline') }
    ].filter(function (s) { return s.el; });

    var ticking = false;
    function scan() {
      ticking = false;
      var mid = window.innerHeight / 2, best = -1, bestD = Infinity;
      spy.forEach(function (s) {
        var r = s.el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) return;
        var d = Math.abs(r.top + r.height / 2 - mid);
        if (d < bestD) { bestD = d; best = s.i; }
      });
      setActive(best);
    }
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(scan);
    }, { passive: true });
    scan();
  }

  var railTimer;
  window.addEventListener('resize', function () {
    clearTimeout(railTimer);
    railTimer = setTimeout(function () {
      var existing = DL.$('.rail');
      if (window.innerWidth < 1280) { if (existing) existing.remove(); }
      else if (!existing) buildRail();
    }, 250);
  });


  /* =====================================================================
     Theme (light / dark)
     ===================================================================== */
  var THEME_KEY = 'dl-theme';

  function getTheme() {
    try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) { return 'dark'; }
  }
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
    document.dispatchEvent(new CustomEvent('dl-theme-change', { detail: { theme: t } }));
  }
  function toggleTheme() {
    setTheme(getTheme() === 'light' ? 'dark' : 'light');
  }

  function buildThemeToggle() {
    /* landing page only, sitting beside the burger */
    if (document.body.getAttribute('data-page') !== 'home') return;
    var burger = DL.$('.nav__burger');
    var host = burger ? burger.parentNode : DL.$('.nav__in');
    if (!host || DL.$('.theme-toggle')) return;
    var btn = document.createElement('button');
    btn.className = 'theme-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Toggle light and dark theme');
    btn.innerHTML =
      '<svg class="i-moon" viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/></svg>' +
      '<svg class="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/>' +
      '<path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1M18.4 18.4l-2.1-2.1M7.7 7.7 5.6 5.6"/></svg>';
    btn.addEventListener('click', toggleTheme);
    /* sits just before the burger on every page's trimmed nav */
    if (burger) host.insertBefore(btn, burger); else host.appendChild(btn);
  }

  /* ---------- boot ---------- */
  function boot() { buildNav(); buildFooter(); reveals(); waitlist(); buildRail(); buildThemeToggle(); }
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', boot)
    : boot();
})();
