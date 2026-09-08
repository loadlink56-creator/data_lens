/* =====================================================================
   Data Lens — shared analysis cache
   Every workspace (Schema Analyser, Column Profiler, Statistics Lab,
   Chart Studio, Report Builder, AI Agent) reads from the SAME computed
   report rather than re-running SchemaEngine per tab. This is the
   "canonical dataset model" the spec asks for — one source of truth,
   recomputed only when the loaded data actually changes.
   ===================================================================== */
(function () {
  'use strict';
  var cache = null, stamp = null;

  function fingerprint(model) {
    if (!model) return '';
    return model.files.join('|') + '::' +
      model.sheets.map(function (s) { return s.name + ':' + s.rows.length + ':' + s.cols.length; }).join(',');
  }

  window.DLReport = {
    get: function () {
      var model = window.DLFA && window.DLFA.getModel();
      if (!model || !model.sheets.length) return null;
      var fp = fingerprint(model);
      if (cache && stamp === fp) return { model: model, report: cache };
      var report = SchemaEngine.analyse(model);
      report.canvasRels = (model.rels || []).filter(function (r) { return r.kind !== 'fk'; })
        .map(function (r) {
          var A = model.sheets[r.from.s], B = model.sheets[r.to.s];
          return {
            kind: r.kind, sameSheet: r.from.s === r.to.s,
            fromTable: A.label || A.name, fromCol: A.cols[r.from.c].name,
            toTable: B.label || B.name, toCol: B.cols[r.to.c].name,
            label: r.label, detail: r.detail
          };
        });
      cache = report; stamp = fp;
      return { model: model, report: report };
    },
    invalidate: function () { cache = null; stamp = null; }
  };
})();
