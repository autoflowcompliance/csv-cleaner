/* CSV Cleaner core: pure functions, no network, no storage, no DOM.
 * A JavaScript port of tools/clean_csv.py (AIAgency). Same rules, same output; parity is tested in test_parity.js.
 * What it does (and only this): trims cells, lower-cases emails and flags bad ones, writes phones as +<country><number>
 * when the number is international or a region is chosen, writes dates as yyyy-mm-dd when unambiguous, removes empty
 * and exact-duplicate rows, and LISTS (never merges) rows that share a key but differ elsewhere.
 * Nothing leaves the browser: this file contains no fetch, XMLHttpRequest, WebSocket, sendBeacon, import() or storage call. */
(function (root) {
  "use strict";
  var CC = { AU: "61", NZ: "64", UK: "44", US: "1", CA: "1" };
  var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  var SCI_RE = /^[+-]?\d(?:\.\d+)?[eE]\+(?:1\d|[2-9]\d)$/; /* Excel shows long numbers like this and keeps only ~15 digits */
  var MONTHS = {}; "jan feb mar apr may jun jul aug sep oct nov dec".split(" ").forEach(function (m, i) { MONTHS[m] = i + 1; });
  var PHONE_COL = /phone|mobile|\btel|cell|fax/i, DATE_COL = /date|created|\bdue\b|issued|updated|birth|dob|timestamp|(?:^|[^a-z])time(?:$|[^a-z])|modified|changed|booked|booking|appointment|joined|sign[ _-]?up|expir|renew|opened|closed|placed|scheduled|published|shipped|delivered/i, EMAIL_COL = /e-?mail/i;

  function tidy(v) { return v.replace(/[\s ]+/g, " ").trim(); }

  /* Parse CSV text into an array of rows (arrays of strings). Quoted cells keep commas, quotes ("") and line breaks. */
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    var delim = detectDelimiter(text), rows = [], row = [], cell = "", q = false, i = 0, n = text.length, c;
    while (i < n) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } q = false; i++; continue; }
        cell += c; i++; continue;
      }
      if (c === '"') { q = true; i++; continue; }
      if (c === delim) { row.push(cell); cell = ""; i++; continue; }
      if (c === "\r" || c === "\n") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = ""; i++; continue;
      }
      cell += c; i++;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function detectDelimiter(text) {
    var first = "", q = false, i, c;
    for (i = 0; i < text.length && i < 4096; i++) { c = text[i]; if (c === '"') q = !q; if (!q && (c === "\n" || c === "\r")) break; first += c; }
    var best = ",", bestN = 0;
    [",", ";", "\t", "|"].forEach(function (d) { var k = first.split(d).length - 1; if (k > bestN) { best = d; bestN = k; } });
    return best;
  }
  function csvCell(v) { return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function toCSV(head, data) {
    return [head].concat(data).map(function (r) { return r.map(function (v) { return csvCell(String(v)); }).join(","); }).join("\r\n") + "\r\n";
  }

  function normPhone(v, region) {
    if (/(?:ext\.?|x|#)\s*\d+\s*$/i.test(v)) return [null, "has an extension; left as found"];
    var plus = v.indexOf("+") === 0 || v.indexOf("00") === 0, digits = v.replace(/\D/g, "");
    if (v.indexOf("00") === 0) digits = digits.slice(2);
    if (plus) return (digits.length >= 8 && digits.length <= 15) ? ["+" + digits, null] : [null, "international number with wrong length"];
    if (!region) return [null, "local number and no region given; left as found"];
    var cc = CC[region];
    if (cc === "1") {
      if (digits.length === 10) return ["+1" + digits, null];
      if (digits.length === 11 && digits[0] === "1") return ["+" + digits, null];
    } else {
      if (digits[0] === "0" && digits.length >= 8 && digits.length <= 11) return ["+" + cc + digits.slice(1), null];
      if (digits.indexOf(cc) === 0 && digits.length >= 10 && digits.length <= 13) return ["+" + digits, null];
    }
    return [null, "does not fit a " + region + " number; left as found"];
  }

  function leap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function make(y, m, d, note) {
    var dim = [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1 || d > dim[m - 1]) return [null, "not a real calendar date"];
    var p = function (x, k) { return String(x).padStart(k, "0"); };
    return [p(y, 4) + "-" + p(m, 2) + "-" + p(d, 2), note || null];
  }
  function year(s) {
    if (s.length === 4) return [parseInt(s, 10), null];
    var k = parseInt(s, 10);
    return [k <= 69 ? 2000 + k : 1900 + k, "2-digit year: 00-69 read as 20xx"];
  }
  var NOT_A_DATE = "unrecognised date format; left as found";
  function normDate(v, order) {
    var m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v))) return make(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(v))) {
      /* already ISO 8601 with a time: keep it exactly as found when it is real, flag it when it is not */
      if (+m[4] > 23 || +m[5] > 59 || (m[6] && +m[6] > 59)) return [null, "not a real time of day"];
      var dd = make(+m[1], +m[2], +m[3]);
      return dd[0] ? [v, null] : dd;
    }
    if ((m = /^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/.exec(v))) return make(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{1,2})[ \-]([A-Za-z]{3,9})\.?[ \-,]+(\d{2}|\d{4})$/.exec(v)) && MONTHS[m[2].slice(0, 3).toLowerCase()]) {
      var yn = year(m[3]); return make(yn[0], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1], yn[1]);
    }
    if ((m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(v)) && MONTHS[m[1].slice(0, 3).toLowerCase()]) {
      return make(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
    }
    if ((m = /^(\S+)[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/.exec(v)) && /^\d{1,2}[\/.\-]\d{1,2}[\/.\-](\d{2}|\d{4})$/.test(m[1])) { /* dd/mm/yyyy with a time: the date part follows the same rules */
      var dp = normDate(m[1], order);
      if (dp[0] === null) return dp;
      var hh = +m[2], mi = +m[3], se = m[4], ap = (m[5] || "").toLowerCase();
      if (mi > 59 || (se && +se > 59) || (ap && !(hh >= 1 && hh <= 12)) || (!ap && hh > 23)) return [null, "not a real time of day"];
      if (ap) hh = hh % 12 + (ap === "pm" ? 12 : 0);
      return [dp[0] + " " + String(hh).padStart(2, "0") + ":" + String(mi).padStart(2, "0") + (se ? ":" + se : ""), dp[1]];
    }
    if ((m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/.exec(v))) {
      var a = +m[1], b = +m[2], y2 = year(m[3]), kind;
      if (a > 12 && b <= 12) kind = "dmy"; else if (b > 12 && a <= 12) kind = "mdy"; else if (a === b) kind = "dmy"; else kind = order || null;
      if (!kind) return [null, "ambiguous day/month order; left as found (choose the date order)"];
      if (kind === "ymd") return [null, "date order ymd does not describe a dd/mm/yyyy value; left as found"];
      if (order && kind !== order && a !== b) return [null, "value only fits " + kind + " but the chosen date order is " + order + "; left as found"];
      return kind === "dmy" ? make(y2[0], b, a, y2[1]) : make(y2[0], a, b, y2[1]);
    }
    return [null, NOT_A_DATE];
  }

  /* Title lines above the real header (rows with at most one filled cell, while at least two rows below are wider) are not data. */
  function splitPreamble(rows) {
    var w = rows.slice(0, 40).map(function (r) { return r.filter(function (c) { return tidy(c) !== ""; }).length; }), k = 0, wide = 0, j;
    while (k < w.length && w[k] <= 1) k++;
    for (j = k; j < w.length; j++) if (w[j] >= 2) wide++;
    if (k === 0 || k >= w.length || wide < 2) return { rows: rows, pre: [] };
    return { rows: rows.slice(k), pre: rows.slice(0, k) };
  }

  /* opts: {region: AU|NZ|UK|US|CA|"", dateOrder: dmy|mdy|ymd|"", key: header name or ""} */
  function clean(rows, opts) {
    opts = opts || {};
    if (!rows.length) throw new Error("empty file");
    var sp = splitPreamble(rows), pre = sp.pre; rows = sp.rows;
    var header = rows[0].map(tidy), n = header.length, pcols = [], dcols = [], ecols = [];
    header.forEach(function (h, i) { if (PHONE_COL.test(h)) pcols.push(i); if (DATE_COL.test(h)) dcols.push(i); if (EMAIL_COL.test(h)) ecols.push(i); });
    var notread = []; /* header says date, but no cell in the column looks like a date: leave the column alone, say so once */
    dcols.slice().forEach(function (ci) {
      var vals = [];
      for (var q = 1; q < rows.length; q++) { var cv = ci < rows[q].length ? tidy(rows[q][ci]) : ""; if (cv) vals.push(cv); }
      if (vals.length && !vals.some(function (v) { return normDate(v, opts.dateOrder)[1] !== NOT_A_DATE; })) { dcols.splice(dcols.indexOf(ci), 1); notread.push([ci, vals.length, vals[0]]); }
    });
    var kcol = opts.key && header.indexOf(opts.key) >= 0 ? header.indexOf(opts.key) : (ecols.length ? ecols[0] : null);
    var changes = [], issues = [], out = [], seen = Object.create(null), bykey = Object.create(null);
    pre.forEach(function (pr, pi) { /* skipped title lines are listed, never dropped silently */
      var vals = pr.map(tidy).filter(Boolean);
      if (vals.length) issues.push([pi + 1, "*", "preamble_row_skipped: above the header, not cleaned", vals.join(" | ")]);
    });
    notread.forEach(function (nr) { issues.push([1 + pre.length, header[nr[0]], "date_column_not_read: the header looks like a date column but none of its " + nr[1] + " value(s) is in a date format this tool reads (yyyy-mm-dd, dd/mm/yyyy, 5 Mar 2024); column left as found", "first value: " + nr[2]]); });
    for (var r = 1; r < rows.length; r++) {
      var rn = r + 1 + pre.length, extra = rows[r].slice(n).map(tidy).filter(Boolean); /* cells past the header width: never dropped silently */
      if (extra.length) issues.push([rn, "*", "row_longer_than_header: " + extra.length + " extra cell(s) not in clean.csv", extra.join(" | ")]);
      var row = rows[r].slice(0, n); while (row.length < n) row.push("");
      var cells = [];
      for (var i = 0; i < n; i++) {
        var old = row[i], nw = tidy(old);
        if (nw !== old) changes.push([rn, header[i], "trim_whitespace", old, nw]);
        if (nw && SCI_RE.test(nw)) {
          issues.push([rn, header[i], "scientific_notation: Excel has probably already rounded this number; the original digits are not in this file (ask for the column exported as text)", nw]);
        } else if (nw && ecols.indexOf(i) >= 0) {
          var low = nw.toLowerCase();
          if (low !== nw) changes.push([rn, header[i], "lowercase_email", nw, low]);
          nw = low;
          if (!EMAIL_RE.test(nw)) issues.push([rn, header[i], "invalid_email", nw]);
        } else if (nw && pcols.indexOf(i) >= 0) {
          var pv = normPhone(nw, opts.region);
          if (pv[0] === null) issues.push([rn, header[i], "phone_not_changed: " + pv[1], nw]);
          else if (pv[0] !== nw) { changes.push([rn, header[i], "phone_to_international", nw, pv[0]]); nw = pv[0]; }
        } else if (nw && dcols.indexOf(i) >= 0) {
          var dv = normDate(nw, opts.dateOrder);
          if (dv[0] === null) issues.push([rn, header[i], "date_not_changed: " + dv[1], nw]);
          else { if (dv[0] !== nw) changes.push([rn, header[i], "date_to_iso" + (dv[1] ? " (" + dv[1] + ")" : ""), nw, dv[0]]); nw = dv[0]; }
        }
        cells.push(nw);
      }
      if (!cells.some(function (c) { return c; })) { changes.push([rn, "*", "remove_empty_row", "", ""]); continue; }
      var t = JSON.stringify(cells);
      if (t in seen) { changes.push([rn, "*", "remove_duplicate_row", "duplicate of source row " + seen[t], ""]); continue; }
      seen[t] = rn;
      if (kcol !== null && cells[kcol]) {
        if (cells[kcol] in bykey) issues.push([rn, header[kcol], "same_" + header[kcol] + "_as_row_" + bykey[cells[kcol]] + "_but_other_cells_differ (not merged)", cells[kcol]]);
        else bykey[cells[kcol]] = rn;
      }
      out.push([rn, cells]);
    }
    var first20 = out.slice(0, 20), lastSrc = first20.length ? first20[first20.length - 1][0] : 1;
    return {
      header: header, clean: out.map(function (o) { return o[1]; }), changes: changes, issues: issues,
      free20: first20.map(function (o) { return o[1]; }), free20changes: changes.filter(function (c) { return c[0] <= lastSrc; }),
      inRows: rows.length - 1, outRows: out.length
    };
  }

  var api = { parseCSV: parseCSV, toCSV: toCSV, clean: clean, normPhone: normPhone, normDate: normDate, CC: CC };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.CSVCleaner = api;
})(typeof window !== "undefined" ? window : this);
