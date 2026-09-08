/* =====================================================================
   Data Lens — workspace bar
   The seven-stage pipeline as a persistent nav. Schema Analyser reuses
   its own existing overlay/open(); the rest are opened here and built
   by workspaces.js, all reading from the same window.DLReport cache.
   ===================================================================== */
(function () {
  'use strict';
  var $ = DL.$, $$ = DL.$$;

  var WORKSPACES = [
    { id: 'schema', label: 'Schema Analyser', icon: '<rect x="3" y="4" width="7" height="7" rx="1.3"/><rect x="14" y="4" width="7" height="7" rx="1.3"/><rect x="3" y="13" width="7" height="7" rx="1.3"/><rect x="14" y="13" width="7" height="7" rx="1.3"/>' },
    { id: 'profiler', label: 'Column Profiler', icon: '<path d="M4 20V10M10 20V4M16 20v-7M22 20v-3"/>' },
    { id: 'relmap', label: 'Relationship Mapper', icon: '<circle cx="6" cy="7" r="2.2"/><circle cx="18" cy="7" r="2.2"/><circle cx="12" cy="18" r="2.2"/><path d="M7.7 8.4 10.6 16M16.3 8.4 13.4 16M8.2 7h7.6"/>' },
    { id: 'stats', label: 'Statistics Lab', icon: '<path d="M6 3v18M6 3c4 0 4 6 8 6M6 21c4 0 4-6 8-6M18 3v18"/>' },
    { id: 'chart', label: 'Chart Studio', icon: '<path d="M4 19h16M8 19V9M13 19V5M18 19v-7"/>' },
    { id: 'report', label: 'Report Builder', icon: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h6M9 16h6"/>' },
    { id: 'ai', label: 'AI Agent', icon: '<path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z"/><circle cx="19" cy="5" r="1.3"/>' }
  ];

  var OVERLAY_ID = { schema: 'schemaOverlay', profiler: 'cpOverlay', stats: 'statOverlay',
    chart: 'chartOverlay', report: 'reportOverlay', ai: 'aiOverlay' };

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function closeAll(except) {
    Object.keys(OVERLAY_ID).forEach(function (k) {
      var id = OVERLAY_ID[k];
      if (id === except) return;
      var el = $('#' + id);
      if (el) el.classList.remove('is-on');
    });
    document.body.style.overflow = '';
  }
  DL.closeAllWorkspaces = closeAll;

  function setActive(id) {
    $$('.wstab', $('#wsBar')).forEach(function (t) {
      t.classList.toggle('is-active', t.getAttribute('data-ws') === id);
    });
  }
  DL.setActiveWorkspace = setActive;

  function build() {
    var bar = $('#wsBar');
    if (!bar) return;
    bar.innerHTML = WORKSPACES.map(function (w) {
      return '<button class="wstab" data-ws="' + w.id + '" title="' + esc(w.label) + '">' +
        '<svg viewBox="0 0 24 24">' + w.icon + '</svg><span>' + w.label + '</span></button>';
    }).join('');
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('.wstab');
      if (!b) return;
      openWorkspace(b.getAttribute('data-ws'));
    });

    /* every overlay's close button routes back here uniformly */
    $$('[data-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closeAll(null);
        setActive(null);
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var anyOpen = Object.keys(OVERLAY_ID).some(function (k) {
        var el = $('#' + OVERLAY_ID[k]); return el && el.classList.contains('is-on');
      });
      if (anyOpen) { closeAll(null); setActive(null); }
    });
  }

  function openWorkspace(id) {
    var got = window.DLReport && window.DLReport.get();
    if (!got) return;

    if (id === 'relmap') {
      /* the canvas itself already IS the relationship mapper — no separate
         UI to duplicate it, just bring it into full view */
      closeAll(null);
      setActive('relmap');
      if (window.DLFA && window.DLFA.fitView) window.DLFA.fitView();
      var canvas = $('#canvas');
      if (canvas) {
        canvas.classList.add('is-pulsing');
        setTimeout(function () { canvas.classList.remove('is-pulsing'); }, 900);
      }
      return;
    }

    closeAll(OVERLAY_ID[id]);
    setActive(id);
    var el = $('#' + OVERLAY_ID[id]);
    if (!el) return;
    el.classList.add('is-on');
    document.body.style.overflow = 'hidden';

    if (id === 'schema') { if (window.SchemaAnalyser) window.SchemaAnalyser.open(); return; }
    if (id === 'profiler' && window.DLWorkspaces) window.DLWorkspaces.openProfiler(got);
    if (id === 'stats' && window.DLWorkspaces) window.DLWorkspaces.openStats(got);
    if (id === 'chart' && window.DLWorkspaces) window.DLWorkspaces.openChart(got);
    if (id === 'report' && window.DLWorkspaces) window.DLWorkspaces.openReport(got);
    if (id === 'ai' && window.DLWorkspaces) window.DLWorkspaces.openAI(got);
  }
  DL.openWorkspace = openWorkspace;

  /* show/hide the whole bar in lockstep with the existing schemaBtn logic:
     any moment the workspace is live with data, the pipeline nav appears */
  function sync() {
    var got = window.DLReport && window.DLReport.get();
    var bar = $('#wsBar');
    if (bar) bar.style.display = got ? 'flex' : 'none';
  }
  DL.syncWorkspaceBar = sync;

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', build)
    : build();
})();
