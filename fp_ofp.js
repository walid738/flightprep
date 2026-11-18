/* fp_ofp.js - Flight Prep 3.2 (+ 3.7 Skybook reader): read a Lido OFP PDF or a flydubai Skybook briefing pack in the app and parse it.
   No network, no server: pdf.js turns the PDF into layout-preserving text, then the same rules the
   Python build chain used are applied here. Nothing is invented - a value the OFP does not have stays null.
   window.FPOfp = { pdfText(file, onprog), parse(text), hm, ddFromLido } */
(function () {
  var F = {};
  F.pdfjsUrl = './pdf.min.mjs';
  F.workerUrl = './pdf.worker.min.mjs';

  /* ---------------------------------------------------------------- 1. PDF -> text (layout) */
  F.pdfText = async function (data, onprog) {
    var pdfjs = await import(F.pdfjsUrl);
    if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = (typeof document !== 'undefined' ? new URL(F.workerUrl, document.baseURI).href : F.workerUrl);
    var buf = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
    var doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
    var n = doc.numPages, pages = [], i;
    for (i = 1; i <= n; i++) {
      var pg = await doc.getPage(i);
      var tc = await pg.getTextContent();
      pages.push(tc.items.filter(function (t) { return t.str && t.str.length; }).map(function (t) {
        return { x: t.transform[4], y: t.transform[5], s: t.str, w: t.width || 0 };
      }));
      if (pg.cleanup) pg.cleanup();
      if (onprog) onprog(i, n);
    }
    if (doc.destroy) try { await doc.destroy(); } catch (e) {}
    return F.layout(pages);
  };

  /* items (per page) -> text. The OFP body is monospace: the dominant character advance gives the
     column grid, so x/cw reproduces the printed columns (indentation included, which the NOTAM and
     weather sections need). A vertical gap bigger than a line and a half becomes a blank line. */
  F.layout = function (pages) {
    var cnt = {}, cw = 7.2, best = 0, x0 = 1e9, k, p, it, w;
    for (p = 0; p < pages.length; p++) for (var j = 0; j < pages[p].length; j++) {
      it = pages[p][j];
      if (!it.w || !it.s.trim()) continue;
      w = Math.round((it.w / it.s.length) * 10) / 10;
      cnt[w] = (cnt[w] || 0) + it.s.length;
    }
    for (k in cnt) if (cnt[k] > best) { best = cnt[k]; cw = parseFloat(k); }
    /* v3.5.1: the left margin is where most lines START, not the left-most item of the whole document - one stray item
       further left (a chart page, a stamp) used to push every line of the OFP to the right and the readers then found nothing */
    var starts = {}, bestN = 0, rowMin, rk;
    for (p = 0; p < pages.length; p++) {
      rowMin = {};
      for (j = 0; j < pages[p].length; j++) {
        it = pages[p][j]; if (!it.s.trim()) continue;
        rk = Math.round(it.y / 3) * 3;
        if (rowMin[rk] == null || it.x < rowMin[rk]) rowMin[rk] = it.x;
      }
      for (rk in rowMin) { k = Math.round(rowMin[rk]); starts[k] = (starts[k] || 0) + 1; }
    }
    for (k in starts) if (starts[k] > bestN || (starts[k] === bestN && parseFloat(k) < x0)) { bestN = starts[k]; x0 = parseFloat(k); }
    if (x0 > 1e8) x0 = 0;
    var out = [];
    for (p = 0; p < pages.length; p++) {
      var rows = {}, keys = [];
      for (j = 0; j < pages[p].length; j++) {
        it = pages[p][j];
        var key = Math.round(it.y / 3) * 3;
        if (!rows[key]) { rows[key] = []; keys.push(key); }
        rows[key].push(it);
      }
      keys.sort(function (a, b) { return b - a; });
      var prev = null;
      for (var q = 0; q < keys.length; q++) {
        var cells = rows[keys[q]].slice().sort(function (a, b) { return a.x - b.x; });
        if (prev !== null && prev - keys[q] > 18) out.push('');
        prev = keys[q];
        var line = '';
        for (var c = 0; c < cells.length; c++) {
          var col = Math.max(0, Math.round((cells[c].x - x0) / cw));
          if (col > line.length) line += new Array(col - line.length + 1).join(' ');
          line += cells[c].s;
        }
        out.push(line.replace(/\s+$/, ''));
      }
      out.push('');
    }
    var txt = out.join('\n');
    if (F.isSkybook && F.isSkybook(txt)) txt += RAWMARK + F.rawText(pages);   /* v3.7: Skybook packs also carry the content-order text */
    return txt;
  };

  /* ---------------------------------------------------------------- helpers */
  function hm(s) { return s ? parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(2), 10) : null; }
  F.hm = hm;
  function hmdot(h, m) { return parseInt(h, 10) * 60 + parseInt(m, 10); }
  function g(rx, s, f, grp) { var m = rx.exec(s); if (!m) return null; var v = m[grp || 1]; return f ? f(v) : v; }
  function num(v) { return v == null ? null : parseInt(v, 10); }
  function flt(v) { return v == null ? null : parseFloat(v); }
  var MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  var PAGE = /^\s*Page \d+ of \d+\s*$|^\s*[A-Z0-9]+\/\d{2}[A-Za-z]{3}\d{2}\/[A-Z]{3}-[A-Z]{3} .*OFP:.*$/;
  function ddLido(s) { // N0930.3 / E06921.3 -> degrees
    var h = s[0], v = s.slice(1), d = parseInt(v.slice(0, v.length - 4), 10), m = parseFloat(v.slice(v.length - 4));
    var x = d + m / 60; return (h === 'S' || h === 'W') ? -x : x;
  }
  F.ddFromLido = ddLido;

  /* ---------------------------------------------------------------- 2. parse */
  F.parse = function (text) {
    if (F.isSkybook(text)) return F.parseSkybook(text);   /* v3.7: flydubai Skybook OFP / briefing pack */
    var T = text.replace(/\r/g, ''), L = T.split('\n');
    var CL = L.filter(function (l) { return !PAGE.test(l); });   // page furniture removed
    var C = CL.join('\n');
    var O = { warn: [], note: [] };

    /* --- identity */
    O.hdr = g(/^\s*([A-Z0-9]+\/\d\d[A-Za-z]{3}\d\d\/[A-Z]{3}-[A-Z]{3} \S+ OFP:\S+)/m, T);
    var dm = /([A-Z0-9]+)\/(\d\d)([A-Za-z]{3})(\d\d)\/([A-Z]{3})-([A-Z]{3})/.exec(O.hdr || '');
    O.cs = dm ? dm[1] : g(/\(FPL-(\w+)-/, C);
    O.csEK = (O.cs || '').replace(/^FDB/, 'FZ').replace(/^UAE/, 'EK');   /* ICAO call-sign prefix -> flight-number prefix (FDB = flydubai) */
    if (dm) {
      O.day = parseInt(dm[2], 10); O.mon = MON[dm[3].toUpperCase()]; O.yr = 2000 + parseInt(dm[4], 10);
      O.date = O.yr + '-' + ('0' + O.mon).slice(-2) + '-' + ('0' + O.day).slice(-2);
    }
    O.flt = g(/^(EK\d+)\s+\d\d[A-Z]{3}\s+[A-Z]{4}\//m, C) || g(/^([A-Z]{2}\d+)\s+\d\d[A-Z]{3}\s+[A-Z]{4}\//m, C);
    O.dofs = g(/^[A-Z]{2}\d+\s+(\d\d[A-Z]{3})\s/m, C);
    var ad = /([A-Z]{4})\/([A-Z]{3})-([A-Z]{4})\/([A-Z]{3})/.exec(C);
    if (ad) { O.dep = ad[1]; O.dep_iata = ad[2]; O.dest = ad[3]; O.dest_iata = ad[4]; }
    O.type = g(/[A-Z]{4}\/[A-Z]{3}-[A-Z]{4}\/[A-Z]{3}\s+(\S+)/, C);
    O.reg = g(/REG\/(\w+)/, C);
    O.reg_d = O.reg ? O.reg.slice(0, 2) + '-' + O.reg.slice(2) : null;
    O.ofpno = g(/OFP:(\d+\/\d+\/\d+)/, C);
    O.sel = g(/SEL\/(\w+)/, C);
    O.std = O.dep ? g(new RegExp('-' + O.dep + '(\\d{4})'), C.replace(/\s+/g, ' '), hm) : null;
    if (O.std == null) O.std = g(/^\s*DEP\s+(\d{4})/m, C, hm) || g(/\bDEP\s+(\d{4})\s/, C, hm);
    O.sta = g(/\bARR\s+(\d{4})\s/, C, hm);
    O.plnd_fl = g(/PLND FL:\s*(.*)/, C);
    O.cid = g(/\bCID\s+(\d+)/, C, num);
    O.crz = g(/\bCRZ\s{2,}(\S+)/, C);
    O.crz_fl = g(/CRZ FL\/TEMP\s+(\S+)/, C);
    O.gnd_dist = g(/GND DIST\s+(\d+)/, C, num);
    O.air_dist = g(/AIR DIST\s+(\d+)/, C, num);
    O.wxprog = g(/WX PROG:\s*(\d+ - \d+)/, C);

    /* route string: the line(s) between ATC CLRNC and PLND FL (the label differs per station) */
    O.route = null;
    for (var i = 0; i < CL.length; i++) {
      if (/^E\/MFT\/R\s*:|^[A-Z0-9\/]{3,14}\s*:\s*[A-Z]{4}\/\S+\s/.test(CL[i])) {   // v3.6: any label ('E/MTT/R :', 'DXBSINPCI6:') in front of DEP/RWY
        var parts = [CL[i].replace(/^[^:]*:\s*/, '')];
        for (var j = i + 1; j < CL.length && j < i + 6; j++) {
          if (!CL[j].trim() || /^[A-Z][A-Z /-]*:/.test(CL[j])) break;
          parts.push(CL[j].trim());
        }
        O.route = parts.join(' ').replace(/\s+/g, ' ').trim(); break;
      }
    }

    /* --- fuel / weights */
    /* each entry: [key, regex, group of the tag (0 = none), group of the fuel in kg, group of the time HHMM (0 = none)] */
    var FU = [['trip', /^TRIP\s+(\w{4})\s+(\d+)\s+(\d{4})/m, 1, 2, 3], ['cont', /^CONT\s+(\S+)\s+(\d+)\s+(\d{4})/m, 1, 2, 3],
      ['altn', /^ALTN\s+(\w{4})\s+(\d+)\s+(\d{4})/m, 1, 2, 3], ['frsv', /^FRSV\s+(\d+)\s+(\d{4})/m, 0, 1, 2],
      ['addl', /^ADDNL\s*(\w*)\s+(\d+)\s+(\d{4})/m, 1, 2, 3], ['extra', /^EXTRA\s+(\w+)\s+(\d+)\s+(\d{4})/m, 1, 2, 3],
      ['tof', /^T\/O FUEL\s+(\d+)/m, 0, 1, 0], ['taxi', /^TAXI\s+(\d+)\s+(\d{4})/m, 0, 1, 2]];
    O.fuel = {};
    for (i = 0; i < FU.length; i++) {
      var m = FU[i][1].exec(C);
      if (!m) { O.fuel[FU[i][0]] = null; continue; }
      O.fuel[FU[i][0]] = { tag: FU[i][2] ? (m[FU[i][2]] || null) : null, kg: num(m[FU[i][3]]), min: FU[i][4] ? hm(m[FU[i][4]]) : null };
    }
    O.fuel.ramp = g(/^RAMP FUEL\s+([\d.]+)/m, C, flt);
    O.taxi_min = O.fuel.taxi ? O.fuel.taxi.min : null;
    O.trip_min = O.fuel.trip ? O.fuel.trip.min : null;
    O.to = (O.std != null && O.taxi_min != null) ? (O.std + O.taxi_min) % 1440 : O.std;
    O.eta = (O.to != null && O.trip_min != null) ? (O.to + O.trip_min) % 1440 : null;
    O.wts = {};
    ['EZFW', 'MZFW', 'ETOW', 'MTOW', 'ELWT', 'MLWT'].forEach(function (k) { O.wts[k] = g(new RegExp(k + '\\s+(\\d+)'), C, num); });
    O.dd_tow = g(/VALID FOR TAKEOFF WEIGHT UP TO (\d+)/, C, num);
    O.etops_min = g(/- ETOPS (\d+) MINS/, C) || g(/ETOPS\s+(\d{2,3})\s+MIN/, C);
    O.wx_perm = g(/WEATHER-PERMISSIBLE AIRPORTS (\S+)/, C);
    O.disp = (function () {
      var mm = /DISP:\s*(\S+)\s+TEL:\s*(\d[\d ]*\d)/.exec(C.replace(/\n/g, ' '));
      return mm ? { name: mm[1].charAt(0) + mm[1].slice(1).toLowerCase(), tel: mm[2].trim() } : null;
    })();
    O.impacts = [];
    var irx = /(ZFW CHANGE|FL CHANGE|SPD CHANGE)?\s+(UP|DN|CI)\s*([\d.]+\s*\w*)\s+(?:BURN\s+([PM])\s*(\d+)\s+TIME\s+([PM])\s*(\d{4})|NOT AVAILABLE)/g, im;
    while ((im = irx.exec(C))) O.impacts.push({ grp: im[1] || null, dir: im[2], amt: (im[3] || '').trim(), bs: im[4] || null, burn: num(im[5]), ts: im[6] || null, time: im[7] ? hm(im[7]) : null });
    O.statcont = [];
    var srx = /^CONT (\d+)\s+(\d+)\s+(\d{4})/gm;
    while ((im = srx.exec(C))) O.statcont.push({ pct: num(im[1]), kg: num(im[2]), min: hm(im[3]) });
    O.remarks = g(/DRIFTDOWN PROCEDURES ARE VALID[^\n]*\n([\s\S]*?)\nETOPS INFORMATION/, C);

    /* --- destination alternates */
    O.alts = [];
    var am = /DEST ALTN DIST[^\n]*\n([\s\S]*?)\n\s*\n/.exec(C);
    if (am) am[1].split('\n').forEach(function (l) {
      var a = /^(\w{4})\/(\w+)\s+(\d{4})\s+(\d{3})\s+(\d{3})\s+(\w+)\s+(\d{4})\s+(\d+)\s*(.*)$/.exec(l.trim());
      if (a) O.alts.push({ icao: a[1], rwy: a[2], nm: num(a[3]), trk: a[4], fl: a[5], comp: a[6], min: hm(a[7]), kg: num(a[8]), route: (a[9] || '').trim() });
      else if (O.alts.length && l.trim()) O.alts[O.alts.length - 1].route += ' ' + l.trim();
    });

    /* --- FPL block: FIR EETs, RALT, DOF */
    var flat = C.replace(/\s+/g, ' ');
    O.fir_eet = [];
    var eet = g(/EET\/(.*?)(?:SEL\/|REG\/|RALT\/|$)/, flat);
    if (eet) { var erx = /\b([A-Z]{4})(\d{4})\b/g; while ((im = erx.exec(eet))) O.fir_eet.push({ fir: im[1], min: hm(im[2]) }); }
    O.ralt = (g(/RALT\/([A-Z ]+?)\s+(?:RMK|DOF|SEL|REG|$)/, flat) || '').trim().split(/\s+/).filter(function (x) { return /^[A-Z]{4}$/.test(x); });

    /* --- ETOPS */
    O.etops_pts = [];
    var prx = /^(ENTRY\d|EXIT\d)\s+([NS]\d+\.\d)\s+([EW]\d+\.\d)\s+\S+\s+(\d)\.(\d\d)/gm;
    while ((im = prx.exec(C))) O.etops_pts.push({ id: im[1], min: hmdot(im[4], im[5]), lat: ddLido(im[2]), lon: ddLido(im[3]) });
    var prx2 = /^(ENTRY\d|EXIT\d)\s+(\d)\.(\d\d)\s+([NS]\d+\.\d)/gm;   // the critical-point table: time + latitude only
    while ((im = prx2.exec(C))) {
      var ex = O.etops_pts.filter(function (p) { return p.id === im[1]; })[0];
      if (!ex) O.etops_pts.push({ id: im[1], min: hmdot(im[2], im[3]), lat: ddLido(im[4]), lon: null });
      else if (ex.min == null) ex.min = hmdot(im[2], im[3]);
    }
    O.etops_apt = [];
    var arx = /^([A-Z]{4})\s+LAT\/LONG\s+ATD/gm; while ((im = arx.exec(C))) O.etops_apt.push(im[1]);
    O.etps = [];
    var trx = /^(ETP\d)\s+(\d)\.(\d\d)\s+([NS]\d+\.\d)\s+(\w{4})\s+(\d+)\s+(\d+)\s+(\d)\.(\d\d)\s+(\d+)\s+([\d.]+)\s+([\d.]+)/gm;
    while ((im = trx.exec(C))) O.etps.push({ id: im[1], min: hmdot(im[2], im[3]), lat: ddLido(im[4]), apt: im[5], mora: num(im[6]) * 100, fl: num(im[7]),
      div_min: hmdot(im[8], im[9]), crit: flt(im[11]), avail: flt(im[12]) });
    O.etops_wx = [];
    var wrx = /^([A-Z]{4})\/(\w+)\s+(\d{4})\s+(\d{4})\s+(\S+)\s+(\S+)\s+([\d.]+)\s*$/gm;
    while ((im = wrx.exec(C))) O.etops_wx.push({ icao: im[1], rwy: im[2], from: hm(im[3]), till: hm(im[4]), min: im[5], fc: im[6], xwc: flt(im[7]) });

    /* --- navlog: waypoint rows, MORA, min fuel, planned fuel, FIR boundaries, airway */
    var NAV = [], fir = null, firname = null, aw = null, inNav = false;
    for (i = 0; i < L.length; i++) {
      var l = L[i], st = l.trim();
      if (/^AWY\s+TRM\s+DIST|^WPT\s+ITT/.test(st)) inNav = true;
      var b = /^-{5,}\s*(.+?) FIR\/(\w{4})-{5,}/.exec(st);
      if (b) { fir = b[2]; firname = b[1].replace(/\w\S*/g, function (w) { return w.charAt(0) + w.slice(1).toLowerCase(); }); NAV.push({ t: 'FIR', fir: fir, name: firname }); continue; }
      if (/ROUTE TO DESTINATION ALTERNATE/.test(l)) break;
      if (!inNav) continue;
      if (!/\.{4}\s+\.{4}/.test(l)) {   // only the airway line of a navlog pair can set the airway
        var aM = /^([A-Z]{1,2}\d{2,4}|DCT|[A-Z]{2,7})\s{2,}[=+]?\s*\d{3}\s+\d{1,4}\s/.exec(l);
        if (aM && /^(DCT|[A-Z]{1,2}\d{1,4}|[A-Z]{4,7})$/.test(aM[1])) aw = aM[1];
        continue;
      }
      /* the waypoint line: '<WPT> ... <EET> .... .... <MINR>'. The cheap test above keeps this regex off
         every other line of the OFP (it backtracks badly on long NOTAM text). */
      var w2 = /^([A-Z0-9_-]{2,11}(?:\/\d\d\w?)?)\s+[+=]?\s*(?:\d{3})?\s+(\S*\/\S*)?\s+(\d+)?\s+(?:[PM]\d{3})?\s*(?:\d+)?\s+(\d{4})\s+\.{4}\s+\.{4}\s+([\d.]+)/.exec(l);
      if (w2) NAV.push({ t: 'WPT', wpt: w2[1], eet: hm(w2[4]), mora: w2[3] ? parseInt(w2[3], 10) * 100 : null, fplan: flt(w2[5]), fir: fir, firname: firname, aw: aw });
    }
    O.nav = NAV;
    O.toc_fl = [];
    var crx = /^\S+\s+\d{3}\s+\d{3}\s+\S+\s+(\d{3})\s+\d{3}/gm; while ((im = crx.exec(C))) O.toc_fl.push(im[1]);

    /* --- coordinates (wind chart blocks: names row, latitude row, longitude row) */
    O.coords = {};
    for (i = 0; i < L.length - 2; i++) {
      var la = [], lo = [], x;
      var lrx = /[NS]\d{4}\.\d/g, orx = /[EW]\d{5}\.\d/g;
      while ((x = lrx.exec(L[i + 1]))) la.push({ p: x.index, v: x[0] });
      while ((x = orx.exec(L[i + 2]))) lo.push({ p: x.index, v: x[0] });
      if (!la.length || la.length !== lo.length) continue;
      var nm = [], nrx = /\S+/g; while ((x = nrx.exec(L[i]))) nm.push({ p: x.index, v: x[0] });
      for (var q2 = 0; q2 < la.length; q2++) {
        var cand = nm.filter(function (n) { return Math.abs(n.p - la[q2].p) <= 3 && /^[A-Z][A-Z0-9]{1,6}$/.test(n.v); });
        var name = cand.length ? cand[0].v : null;
        if (!name) continue;
        if (!O.coords[name]) O.coords[name] = [Math.round(ddLido(la[q2].v) * 1e4) / 1e4, Math.round(ddLido(lo[q2].v) * 1e4) / 1e4];
      }
    }

    /* --- weather, NOTAMs, crew alert */
    var d0 = O.day || null, date0 = O.date ? Date.UTC(O.yr, O.mon - 1, O.day) : null;
    O.wx = weather(CL, d0);
    var chk = { read: 0 };
    O.notams = notams(CL, date0, chk);
    O.rnotams = rnotams(CL, date0, chk);
    /* v3.6: every NOTAM header line of the bulletin must have been taken by one of the two parsers - otherwise say so */
    O.ntcheck = { hdr: 0, read: chk.read, unknown: [] };
    sections(CL).forEach(function (S) {
      var n = 0; for (var q = S.start; q < S.end; q++) if (NOTAM_HDR.test(CL[q].trim())) n++;
      if (SECT[S.title] || AREA_SEC[S.title]) O.ntcheck.hdr += n; else if (n) O.ntcheck.unknown.push(S.title + ' (' + n + ')');
    });
    O.crew_alert = crewAlert(CL);
    O.sigmet = section(CL, /^SIGMETs:/, /^[A-Z][A-Za-z]+s:|^AIRPORTLIST|^DEPARTURE AIRPORT/);
    O.airmet = section(CL, /^AIRMETs:/, /^[A-Z][A-Za-z]+s:|^AIRPORTLIST|^DEPARTURE AIRPORT/);

    if (T.replace(/\s/g, '').length < 500) O.warn.push('This PDF has almost no text - it looks like a scan or a photo. The app can only read a Lido OFP PDF saved from the briefing system.');
    else if (!O.nav.filter(function (n) { return n.t === 'WPT'; }).length) O.warn.push('The navlog was not read (no waypoints found) - the flight cannot be built from this file. If it is a Lido OFP, send it to Claude: the reader needs fixing.');
    /* v3.5.1: say loudly what was not read instead of building a page with holes */
    if (!O.fuel || !O.fuel.trip) O.note.push('FUEL BLOCK NOT READ - no fuel figures on any page.');
    if (!O.wx || !O.wx.length) O.note.push('WEATHER SECTION NOT READ - no METAR / TAF from this OFP.');
    if (!O.flt) O.note.push('Flight number not read from the header.');
    if (!O.alts || !O.alts.length) O.note.push('No alternates read.');
    if (date0 != null && O.ntcheck.hdr !== O.ntcheck.read) O.note.push('NOTAM BULLETIN: ' + O.ntcheck.hdr + ' NOTAMs printed, ' + O.ntcheck.read + ' read - ' + Math.abs(O.ntcheck.hdr - O.ntcheck.read) + ' not filed under an airport or FIR. Read the bulletin in the OFP.');
    if (O.ntcheck.unknown.length) O.note.push('NOTAM section(s) the app does not know: ' + O.ntcheck.unknown.join(', ') + ' - read them in the OFP.');
    if (!O.route) O.note.push('ROUTE STRING NOT READ (the line after ATC CLRNC) - runway, SID and the route comparison are missing.');
    if (!O.fir_eet || !O.fir_eet.length) O.note.push('No FIR times (EET/) read from the flight plan - FIR boundaries follow the navlog lines and may be late.');
    if (!O.dep || !O.dest) O.warn.push('Departure / destination not found.');
    if (!O.date) O.note.push('No flight date in the header - NOTAM and TAF times cannot be placed on the timeline.');
    if (!O.coords || !Object.keys(O.coords).length) O.note.push('No wind-chart coordinates found - all map positions are estimated from the times.');
    return O;
  };

  function section(L, start, end) {
    var i = L.findIndex(function (l) { return start.test(l.trim()); });
    if (i < 0) return null;
    var out = [];
    for (var j = i + 1; j < L.length; j++) {
      var s = L[j].trim();
      if (end.test(s) && s) break;
      if (/^(No Wx data available|NIL|NO DATA( AVAILABLE)?)$/i.test(s)) continue;   // the empty-section filler
      out.push(L[j]);
    }
    var t = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return (!t || /^(No Wx data available|NIL|NO DATA)/i.test(t)) ? null : t;
  }

  /* ---- TAF decoding (same model as the Python chain: minutes from 00Z of the flight date) */
  function tmin(day, hh, mm, d0) { var dd = day - d0; if (dd < -15) dd += 30; return dd * 1440 + hh * 60 + mm; }
  function parseTaf(raw, d0) {
    var tk = raw.split(/\s+/), i = 0;
    if (!tk.length) return null;
    if (['FT', 'TAF', 'FC'].indexOf(tk[0]) >= 0) i = 1;
    if (i < tk.length && /^\d{6}Z?$/.test(tk[i])) i++;
    var m = i < tk.length ? /^(\d{2})(\d{2})\/(\d{2})(\d{2})$/.exec(tk[i]) : null;
    if (!m) return null;
    var va = tmin(+m[1], +m[2], 0, d0), vb = tmin(+m[3], +m[4], 0, d0); i++;
    var gs = [], cur = { t: 'BASE', a: va, b: vb, x: [] }, per, fm, kind, j;
    while (i < tk.length) {
      var t = tk[i];
      per = i + 1 < tk.length ? /^(\d{2})(\d{2})\/(\d{2})(\d{2})$/.exec(tk[i + 1]) : null;
      if ((t === 'BECMG' || t === 'TEMPO') && per) {
        gs.push(cur); cur = { t: t, a: tmin(+per[1], +per[2], 0, d0), b: tmin(+per[3], +per[4], 0, d0), x: [] }; i += 2; continue;
      }
      if (/^PROB\d0$/.test(t)) {
        kind = t; j = i + 1;
        if (j < tk.length && tk[j] === 'TEMPO') { kind += ' TEMPO'; j++; }
        per = j < tk.length ? /^(\d{2})(\d{2})\/(\d{2})(\d{2})$/.exec(tk[j]) : null;
        if (per) { gs.push(cur); cur = { t: kind, a: tmin(+per[1], +per[2], 0, d0), b: tmin(+per[3], +per[4], 0, d0), x: [] }; i = j + 1; continue; }
      }
      fm = /^FM(\d{2})(\d{2})(\d{2})$/.exec(t);
      if (fm) { gs.push(cur); cur = { t: 'FM', a: tmin(+fm[1], +fm[2], +fm[3], d0), b: vb, x: [] }; i++; continue; }
      cur.x.push(t); i++;
    }
    gs.push(cur);
    gs.forEach(function (x) { x.x = x.x.join(' '); });
    return { va: va, vb: vb, groups: gs };
  }

  var ROLE = { 'DEPARTURE AIRPORT:': 'DEP', 'DESTINATION AIRPORT:': 'DEST', 'DESTINATION ALTERNATE:': 'ALTN', 'Critical ETOPS Airports:': 'ETOPS', 'ENROUTE AIRPORT(S):': 'ENR' };
  function weather(L, d0) {
    var out = [], role = null, cur = null, buf = '', kind = null;
    var s = L.findIndex(function (l) { return l.trim() === 'DEPARTURE AIRPORT:'; });
    if (s < 0) return out;
    function flush() {
      if (cur && kind && buf) {
        var txt = buf.replace(/\s+/g, ' ').trim().replace(/=$/, '');
        if (kind === 'SA') cur.metar = txt;
        else { cur.taf = txt; var p = parseTaf(txt, d0); if (p) { cur.va = p.va; cur.vb = p.vb; cur.groups = p.groups; } }
      }
      buf = ''; kind = null;
    }
    for (var i = s; i < L.length; i++) {
      var l = L[i], st = l.trim();
      if (/^AIRPORTLIST ENDED/.test(st)) break;
      if (ROLE[st]) { flush(); role = ROLE[st]; continue; }
      var m = /^([A-Z]{4})\/([A-Z0-9]{3})\s+(.*)$/.exec(st);
      if (m && !/^\s\s/.test(l)) {
        flush();
        cur = { icao: m[1], iata: m[2], name: m[3].replace(/\w\S*/g, function (w) { return w.charAt(0) + w.slice(1).toLowerCase(); }), role: role };
        out.push(cur); continue;
      }
      if (/^(SA|FT|FC) /.test(st)) { flush(); kind = st.slice(0, 2); buf = st; continue; }
      if (kind && st) buf += ' ' + st;
      if (/=$/.test(st)) flush();
    }
    flush();
    return out;
  }

  var NOTAM_HDR = /^([A-Z0-9]{2,4}\d{1,4}\/\d{2})(?:\s+-\s+[A-Z ]+?)?\s+VALID:\s+(\d{10})\s+-\s+(\d{10}|UFN|PERM)(?:\s+(EST))?/;
  var SECT = { 'DEPARTURE AIRPORT': 'DEP', 'DESTINATION AIRPORT': 'DEST', 'DESTINATION ALTERNATE(S)': 'ALTN', 'ETOPS SUITABLE ENROUTE AIRPORT(S)': 'ETOPS', 'ENROUTE AIRPORT(S)': 'ENR',
    'ESCAPE AIRPORT(S)': 'ENR', 'FUEL ENROUTE AIRPORT': 'ENR', 'FUEL ENROUTE AIRPORT(S)': 'ENR' };   // v3.6: + escape and fuel en-route airports (shown with the en-route airports)
  function ruleNext(L, i) { for (var q = i + 1; q < L.length && q < i + 8; q++) if (L[q].trim()) return /^-{5,}$/.test(L[q].trim()); return false; }   // the next non-blank line is a rule of '-' (a page break may sit in between)
  function vmin(s, date0) {
    var y = 2000 + +s.slice(0, 2), mo = +s.slice(2, 4) - 1, d = +s.slice(4, 6), h = +s.slice(6, 8), mi = +s.slice(8, 10);
    return Math.round((Date.UTC(y, mo, d, h, mi) - date0) / 60000);
  }
  /* v3.6: the sections of the Lido NOTAM bulletin. A title stands between two rules of '='; when a page break falls inside the
     header, blank lines sit between the title and the closing rule (seen on a real OFP: DESTINATION AIRPORT was missed and its NOTAMs were
     filed under the departure). One walk finds every section, so the airport and the area parsers cannot disagree. */
  function sections(L) {
    var out = [];
    for (var i = 0; i < L.length; i++) {
      var st = L[i].trim();
      if (!/^={5,}/.test(st)) continue;
      if (/END OF LIDO-NOTAM-BULLETIN/.test(st)) { if (out.length && out[out.length - 1].end > i) out[out.length - 1].end = i; continue; }
      if (!/^={5,}$/.test(st)) continue;
      var j = i + 1; while (j < L.length && !L[j].trim()) j++;
      if (j >= L.length || j > i + 9 || /^={5,}/.test(L[j].trim())) continue;
      var k = j + 1; while (k < L.length && k < j + 9 && !L[k].trim()) k++;
      if (k < L.length && /^={5,}$/.test(L[k].trim())) {
        if (out.length && out[out.length - 1].end > i) out[out.length - 1].end = i;
        out.push({ title: L[j].trim(), start: k + 1, end: L.length }); i = k;
      }
    }
    return out;
  }
  function notams(L, date0, chk) {
    var out = [];
    if (date0 == null) return out;
    sections(L).forEach(function (S) {
      var role = SECT[S.title], apt = null, cat = '', cur = null;
      if (!role) return;
      for (var i = S.start; i < S.end; i++) {
        var l = L[i], st = l.trim();
        var m = /^([A-Z]{4})\s*\/([A-Z0-9]{3})\s+(.*?)(?:\s+- DETAILED INFO)?$/.exec(st);
        if (m && ruleNext(L, i)) { apt = m[1]; cur = null; continue; }
        var c = /^\++\s*([A-Z /]+?)\s*\++$/.exec(st);
        if (c) { cat = c[1].trim(); cur = null; continue; }
        var h = NOTAM_HDR.exec(st);
        if (h && apt) {
          cur = { icao: apt, role: role, id: h[1], cat: cat, a: vmin(h[2], date0), b: (h[3] === 'UFN' || h[3] === 'PERM') ? null : vmin(h[3], date0),
            bt: (h[3] === 'UFN' || h[3] === 'PERM') ? h[3] : '', est: !!h[4], x: [] };
          out.push(cur); if (chk) chk.read++; continue;
        }
        if (cur && st && !/^===/.test(st) && (/^\s\s/.test(l) || loose(st))) cur.x.push(st);
      }
    });
    return fin(out);
  }
  /* pasted text loses the indentation the Lido PDF has, so a NOTAM body line is also accepted when it is
     clearly not one of the structural lines (a new NOTAM, an airport, a category or a section rule). */
  function loose(st) {
    return !NOTAM_HDR.test(st) && !/^\++/.test(st) && !/^-{3,}|^={3,}/.test(st) &&
      !/^[A-Z]{4}\s*\/[A-Z0-9]{3}\s/.test(st) && !SECT[st] && !/^(ENROUTE AIRPORT\(S\)|AREA ENROUTE|EXTENDED AREA|CREW BULLETIN|CREW ALERT|Weather|AIRPORTLIST)/.test(st);
  }
  function fin(out) {
    out.forEach(function (n) {
      var x = n.x.join(' ').replace(/\s+/g, ' ').trim();
      if (x.indexOf(n.id) === 0) x = x.slice(n.id.length).trim();
      n.x = x;
    });
    return out.filter(function (n) { return n.x; });
  }
  /* v3.6: ALL area sections of the Lido NOTAM bulletin, not only 'AREA ENROUTE DEPARTURE - DESTINATION'. The FIRs next to the
     departure (Muscat, UAE) are printed under 'EXTENDED AREA AROUND DEPARTURE', and some blocks are named after a waypoint
     ('TARDI     TARDI') - both were skipped before. sec says which section, fir is the block code (FIR designator or waypoint). */
  var AREA_SEC = { 'EXTENDED AREA AROUND DEPARTURE': 'dep', 'AREA ENROUTE DEPARTURE - DESTINATION': 'enr', 'AREA ENROUTE DESTINATION - DESTINATION ALTERNATE(S)': 'altn',
    'EXTENDED AREA AROUND DESTINATION': 'dest', 'EXTENDED AREA AROUND DESTINATION ALTERNATE AIRPORT(S)': 'altn' };
  function rnotams(L, date0, chk) {
    var out = [], seen = {};
    if (date0 == null) return out;
    sections(L).forEach(function (S) {
      var sec = AREA_SEC[S.title], fir = null, name = '', cur = null;
      if (!sec) return;
      for (var i = S.start; i < S.end; i++) {
        var l = L[i], st = l.trim();
        if (st && !/^-{3,}$/.test(st) && !NOTAM_HDR.test(st) && ruleNext(L, i)) {
          /* block headers: 'OIIX      TEHRAN FIR', 'TARDI     TARDI', 'VAVIM/GESAXT636', 'D24 BARGAT AL HAGAT', 'WI A4078/26', 'R30/PEKANBARU' */
          var m = /^([A-Z0-9]{2,6})\s{2,}(\S.*)$/.exec(st);
          if (m) { fir = m[1]; name = m[2].replace(/\s+(FIR|UIR|FIR\/UIR)$/, ''); if (name === fir) name = ''; }
          else { fir = st.replace(/\s+/g, ' '); name = ''; }
          cur = null; continue;
        }
        var h = NOTAM_HDR.exec(st);
        if (h && fir) {
          var key = fir + ' ' + h[1];
          if (chk) chk.read++;
          if (seen[key]) { cur = null; if (seen[key].secs.indexOf(sec) < 0) seen[key].secs.push(sec); continue; }      // the same NOTAM printed again (FIR + UIR block, or another section)
          cur = { fir: fir, name: name, sec: sec, secs: [sec], id: h[1], a: vmin(h[2], date0), b: (h[3] === 'UFN' || h[3] === 'PERM') ? null : vmin(h[3], date0), bt: (h[3] === 'UFN' || h[3] === 'PERM') ? h[3] : '', x: [] };
          seen[key] = cur; out.push(cur); continue;
        }
        if (cur && st && !/^---/.test(st) && (/^\s\s/.test(l) || loose(st))) cur.x.push(st);
      }
    });
    out = fin(out);
    out.forEach(function (n) {
      /* v3.5.1: daily airspace reservations (AUP, TSA / TRA) are routine - they are not a 'conflict' because the word MILITARY is in them */
      n.kind = /AIRSPACE USE PLAN|\(AUP\)|\bTSA\/TRA\b/.test(n.x.slice(0, 160)) ? 'airspace' :
        (/SECURITY|CONFLICT|PROHIBITED|ARMED|MILITARY|HOSTIL|UNAUTHORI[SZ]ED FLIGHTS|SOMALILAND/.test(n.x) ? 'conflict' : (/GNSS|\bGPS\b/.test(n.x) ? 'gnss' : 'info'));
    });
    return out;
  }
  function crewAlert(L) {
    var s = L.findIndex(function (l) { return l.trim() === 'CREW ALERT'; });
    if (s < 0) return [];
    var out = [], cur = null;
    for (var i = s + 2; i < L.length; i++) {
      var st = L[i].trim();
      if (st === 'Weather' || /^LIDO\/WEATHER/.test(st)) break;
      var m = /^(CO\d+\/\d{2})\s+(.*)$/.exec(st);
      if (m) { cur = { id: m[1], title: m[2], x: [] }; out.push(cur); continue; }
      if (cur && st) cur.x.push(st);
    }
    out.forEach(function (c) { c.x = c.x.join(' '); });
    return out;
  }


  /* ================================================================ v3.7: Skybook (flydubai) briefing pack
     The flydubai OFP comes from Skybook as a boxed text plan ('OPERATIONAL FLIGHT PLAN PAGE x/n') inside a
     briefing pack (weather, NOTAMs, company notices, charts) that is laid out in two columns of cards.
     The OFP pages are read from the layout text. The weather cards carry no ICAO code, so they are read in the
     PDF's own content order and paired with the airport headers one by one - only when the counts agree.
     NOTAM and SIGMET lines carry their own code. Nothing is invented: what cannot be placed safely is left out
     and listed in the notes. */
  var SKY = /OPERATIONAL\s+FLIGHT\s+PLAN\s+PAGE\s+\d+\s*\/\s*\d+/;
  var RAWMARK = '\n\f<<SKYBOOK-RAW>>\n';
  F.isSkybook = function (t) { return SKY.test(t || ''); };
  /* content-order text of the pages (items joined in the order the PDF draws them, a new line when the baseline changes) */
  F.rawText = function (pages) {
    var out = [];
    pages.forEach(function (pg) {
      var line = '', y = null;
      pg.forEach(function (it) {
        if (y !== null && Math.abs(it.y - y) > 2) { out.push(line); line = ''; }
        line += (line && !/\s$/.test(line) && !/^\s/.test(it.s) ? ' ' : '') + it.s; y = it.y;
      });
      if (line) out.push(line);
      out.push('<<PAGE>>');
    });
    return out.join('\n').replace(/\uFB01/g, 'fi').replace(/\uFB02/g, 'fl');
  };
  function tok(s) { return s.trim().split(/\s+/); }
  function hmc(s) { var m = /(\d\d):(\d\d)/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; }
  function skyLL(s) { /* N25148 E055228 -> degrees (DDMM + tenths) */
    var m = /([NS])(\d{2})(\d{2})(\d)\s+([EW])(\d{3})(\d{2})(\d)/.exec(s); if (!m) return null;
    var la = +m[2] + (+m[3] + +m[4] / 10) / 60, lo = +m[6] + (+m[7] + +m[8] / 10) / 60;
    return [Math.round((m[1] === 'S' ? -la : la) * 1e4) / 1e4, Math.round((m[5] === 'W' ? -lo : lo) * 1e4) / 1e4];
  }
  var PREFIX = { FDB: 'FZ', UAE: 'EK' };

  F.parseSkybook = function (text) {
    var T = text.replace(/\r/g, ''), raw = '', ix = T.indexOf(RAWMARK);
    if (ix >= 0) { raw = T.slice(ix + RAWMARK.length); T = T.slice(0, ix); }
    var L = T.split('\n'), C = T, flat = T.replace(/\s+/g, ' ');
    var O = { warn: [], note: [], src: 'skybook', impacts: [], statcont: [], etops_pts: [], etops_apt: [], etps: [], etops_wx: [], crew_alert: [], ralt: [], toc_fl: [], airmet: null };
    /* the OFP pages: from the first 'PAGE 1/n' to the end of the last OFP page */
    var o0 = -1, o1 = L.length;
    for (var i = 0; i < L.length; i++) if (SKY.test(L[i])) { if (o0 < 0) o0 = i; o1 = i; }
    for (i = o1 + 1; i < L.length; i++) if (/^\s*Ref: OPS GEN\./.test(L[i]) || /^\s*\d+\/\d+\s*$/.test(L[i])) break;
    var OL = L.slice(Math.max(0, o0), i), OC = OL.join('\n'), OF = OC.replace(/\s+/g, ' ');

    /* --- identity */
    var fm = /^\s*([A-Z]{3})(\d{1,4}[A-Z]?)\s+DATE\s*:\s*(\d\d)([A-Z]{3})(\d\d)/m.exec(OC);
    if (fm) {
      O.flt = (PREFIX[fm[1]] || fm[1]) + fm[2];
      O.day = +fm[3]; O.mon = MON[fm[4]]; O.yr = 2000 + +fm[5];
      O.date = O.yr + '-' + ('0' + O.mon).slice(-2) + '-' + ('0' + O.day).slice(-2); O.dofs = fm[3] + fm[4];
    }
    O.cs = g(/CS\s*:\s*([A-Z0-9]+)/, OC);
    O.csEK = O.cs;   /* the ICAO call sign (often alphanumeric, e.g. FDB3VG) - it is not the flight number */
    var dl = /DATE\s*:\s*\S+\s+([A-Z]{4})\s*\/\s*([A-Z0-9]{3})\s+(\d{4})\s*\/\s*P/.exec(OC);
    if (dl) { O.dep = dl[1]; O.dep_iata = dl[2]; O.std = hm(dl[3]); }
    var al = /TYPE\s*:\s*(\S+)\s+([A-Z]{4})\s*\/\s*([A-Z0-9]{3})\s+(\d{4})\s*\/\s*P/.exec(OC);
    if (al) { O.type = al[1]; O.dest = al[2]; O.dest_iata = al[3]; O.sta = hm(al[4]); }
    var rg = /REG\s*:\s*([A-Z0-9]+)\s*\/\s*([A-Z]{4})/.exec(OC);
    if (rg) { O.reg = rg[1]; O.sel = rg[2]; O.reg_d = O.reg.slice(0, 2) + '-' + O.reg.slice(2); }
    var pid = g(/PLAN\s+ID\s*:?\s*(\d+)/, OC), rl = /RLSD\s+(\d\d[A-Z]{3}\d\d)\s+(\d{4})/.exec(OC);
    O.ofpno = 'plan ' + (pid || '?') + (rl ? ' RLSD ' + rl[1] + ' ' + rl[2] + 'Z' : '');
    O.ci = g(/^\s*CI\s+(\d+)/m, OC, num);
    O.eta_ofp = g(/ETA\s*:\s*\d\d[A-Z]{3}\s*\/\s*(\d{4})/, OC, hm);
    O.hdr = (O.flt || '') + ' ' + (O.dep || '') + '-' + (O.dest || '') + ' ' + (O.date || '') + ' Skybook OFP ' + O.ofpno;

    /* --- route string and planned levels (Skybook writes OMDBR30R ... OAKBR29) */
    O.route = null; O.plnd_fl = null;
    for (i = 0; i < OL.length; i++) if (/^\s*ROUTE TEXT\s*:/.test(OL[i])) {
      var parts = [];
      for (var j = i + 1; j < OL.length && j < i + 8; j++) {
        var s = OL[j].trim(); if (!s) continue;
        if (/^F\d{3}\b/.test(s)) { O.plnd_fl = s.replace(/\bF(\d{3})\b/g, '$1').replace(/\s+/g, ' '); break; }
        parts.push(s);
      }
      var rt = tok(parts.join(' '));
      if (rt.length) {
        rt[0] = rt[0].replace(/^([A-Z]{4})R(\d\d[LRC]?)$/, '$1/$2');
        rt[rt.length - 1] = rt[rt.length - 1].replace(/^([A-Z]{4})R(\d\d[LRC]?)$/, '$1/$2');
        O.route = rt.join(' ');
      }
      break;
    }
    O.crz_fl = O.plnd_fl ? (/^(\d{3})/.exec(O.plnd_fl) || [])[1] || null : null;
    O.crz = O.ci != null ? 'CI ' + O.ci : null;

    /* --- fuel and weights */
    function fl(rx) { var m = rx.exec(OC); return m ? { kg: num(m[1]), min: hmc(m[2]) } : null; }
    O.fuel = {};
    O.fuel.trip = fl(/TRIP FUEL\s+(\d+)\s+(\d\d:\d\d)/); if (O.fuel.trip) O.fuel.trip.tag = O.dest || null;
    var ct = /CONT\s*(%?\s*\d+%?)\s+(\d+)\s+(\d\d:\d\d)/.exec(OC);
    O.fuel.cont = ct ? { tag: ct[1].replace(/\s+/g, ''), kg: num(ct[2]), min: hmc(ct[3]) } : null;
    var an = /ALTN\s*\((\w{4})\)\s+(\d+)\s+(\d\d:\d\d)/.exec(OC);
    O.fuel.altn = an ? { tag: an[1], kg: num(an[2]), min: hmc(an[3]) } : null;
    O.fuel.frsv = fl(/FINAL RESERVE\s+(\d+)\s+(\d\d:\d\d)/);
    var ad = fl(/ADDITIONAL\s+(\d+)\s+(\d\d:\d\d)/), po = fl(/^\s*POLICY\s+(\d+)\s+(\d\d:\d\d)/m), cx = fl(/CMDR EXTRA\s+(\d+)\s+(\d\d:\d\d)/), tk = fl(/TANKER\/EXTRA\s+(\d+)\s+(\d\d:\d\d)/);
    O.fuel.addl = ad || po ? { tag: (po && po.kg ? 'INCL POLICY ' + po.kg : null), kg: (ad ? ad.kg : 0) + (po ? po.kg : 0), min: (ad ? ad.min || 0 : 0) + (po ? po.min || 0 : 0) } : null;
    O.fuel.extra = tk || cx ? { tag: 'EXTRA', kg: (tk ? tk.kg : 0) + (cx ? cx.kg : 0), min: (tk ? tk.min || 0 : 0) + (cx ? cx.min || 0 : 0) } : null;
    O.fuel.taxi = fl(/^\s*TAXI\s+(\d+)\s+(\d\d:\d\d)/m);
    O.fuel.req = fl(/REQUIRED FOB\s+(\d+)\s+(\d\d:\d\d)/);
    O.fuel.fob = fl(/TOTAL FOB\s+(\d+)\s+(\d\d:\d\d)/);
    O.fuel.tof = O.fuel.fob && O.fuel.taxi ? { tag: null, kg: O.fuel.fob.kg - O.fuel.taxi.kg, min: null } : null;
    O.fuel.ramp = O.fuel.fob ? O.fuel.fob.kg / 1000 : null;
    O.fuel.arr = g(/ARR FUEL\s*:\s*(\d+)/, OC, num);
    O.fuel.mindiv = g(/MIN\s+DIV\s*:\s*(\d+)/, OC, num);
    O.taxi_min = O.fuel.taxi ? O.fuel.taxi.min : null;
    O.trip_min = O.fuel.trip ? O.fuel.trip.min : null;
    O.to = (O.std != null && O.taxi_min != null) ? (O.std + O.taxi_min) % 1440 : O.std;
    O.eta = (O.to != null && O.trip_min != null) ? (O.to + O.trip_min) % 1440 : O.eta_ofp;
    O.wts = {
      EZFW: g(/EZFW\s*:\s*(\d+)/, OC, num), MZFW: g(/MZFW\s*:\s*(?:\(\w\))?\s*(\d+)/, OC, num), ETOW: g(/ETOW\s*:\s*(\d+)/, OC, num),
      MTOW: g(/MTOW\s*:\s*(?:\(\w\))?\s*(\d+)/, OC, num), ELWT: g(/ELDW\s*:\s*(\d+)/, OC, num), MLWT: g(/MLDW\s*:\s*(?:\(\w\))?\s*(\d+)/, OC, num)
    };
    O.payload = g(/PAYLOAD\s*:\s*(\d+)/, OC, num);
    var pen = [];
    var prx = /PER\s+1000\s+KGS\s+([+-]\d+)KGS|PER\s+10\s+KTS\s+([+-]\d+)KGS\s+(\d\d:\d\d)|CI\s*:\s*0 \(ZERO\)\s+([+-]\d+)KGS\s+(\d\d:\d\d)|\b(M[12])\s*:\s+([+-]\d+)KGS\s+(\d\d:\d\d)/g, pm;
    while ((pm = prx.exec(OC))) {
      if (pm[1]) pen.push({ grp: 'ZFW CHANGE', dir: 'UP', amt: '1000 KG', bs: pm[1][0] === '-' ? 'M' : 'P', burn: Math.abs(+pm[1]), ts: null, time: null });
      else if (pm[2]) pen.push({ grp: 'WIND', dir: 'DN', amt: '10 KT', bs: pm[2][0] === '-' ? 'M' : 'P', burn: Math.abs(+pm[2]), ts: 'P', time: hmc(pm[3]) });
      else if (pm[4]) pen.push({ grp: 'SPD CHANGE', dir: 'CI', amt: '0', bs: pm[4][0] === '-' ? 'M' : 'P', burn: Math.abs(+pm[4]), ts: 'P', time: hmc(pm[5]) });
      else if (pm[6]) pen.push({ grp: 'FL CHANGE', dir: 'DN', amt: (pm[6] === 'M1' ? '1' : '2') + ' FL (' + pm[6] + ')', bs: pm[7][0] === '-' ? 'M' : 'P', burn: Math.abs(+pm[7]), ts: 'P', time: hmc(pm[8]) });
    }
    O.impacts = pen;

    /* --- dispatcher (name under DISPATCHER:, telephone on the next line) */
    O.disp = null;
    for (i = 0; i < OL.length - 2; i++) if (/DISPATCHER\s*:/.test(OL[i])) {
      var nm = /([A-Z][A-Z .'-]+?)\s*$/.exec(OL[i + 1].split(/\s{3,}/).pop() || ''), tel = /(\d{8,})\s*$/.exec(OL[i + 2]);
      if (nm) O.disp = { name: nm[1].replace(/\w\S*/g, function (w) { return w.charAt(0) + w.slice(1).toLowerCase(); }), tel: tel ? tel[1] : '' };
      break;
    }

    /* --- alternates: the table next to the fuel block, and the alternate route section */
    O.alts = [];
    var arx = /\b([A-Z]{4})\(([A-Z])\)\s+(\d+)\s+(\d\d:\d\d)\s+(\d{3})\s+(\d+)/g, am;
    while ((am = arx.exec(OC))) if (!O.alts.some(function (a) { return a.icao === am[1]; })) O.alts.push({ icao: am[1], rwy: '', nm: num(am[3]), trk: '', fl: am[5], comp: '', min: hmc(am[4]), kg: num(am[6]), route: '' });
    for (i = 0; i < OL.length; i++) {
      var ars = /DEST\s+ALTERNATE\s+ROUTE\s+SECTION\s+([A-Z]{4})/.exec(OL[i]);
      if (!ars) continue;
      for (j = i + 1; j < OL.length && !OL[j].trim(); j++);
      var a0 = O.alts.filter(function (a) { return a.icao === ars[1]; })[0];
      if (a0 && j < OL.length) a0.route = OL[j].trim().replace(/\s+/g, ' ');
    }

    /* --- FPL: FIR EETs */
    O.fir_eet = [];
    var eet = g(/EET\/(.*?)(?:SEL\/|REG\/|RALT\/|CODE\/|OPR\/|RMK\/|\)|$)/, OF);
    if (eet) { var erx = /\b([A-Z]{4})(\d{4})\b/g, im; while ((im = erx.exec(eet))) O.fir_eet.push({ fir: im[1], min: hm(im[2]) }); }

    /* --- navlog. A row is three printed lines (airway/waypoint ... FOB, MOCA/name-or-FIR/REMD/TT/ACCT, lat-long/ACCD/VAR/REMT),
       but the PDF text sometimes splits or swaps them, so the row is read from all lines until the next row starts. */
    var NAV = [], coords = {}, inNav = false, row = null, done = false;
    var extraKg = ((O.fuel.extra && O.fuel.extra.kg) || 0) + ((O.fuel.cont && O.fuel.cont.kg) || 0);
    function isStart(st) {
      if (/[NS]\d{5}\s+[EW]\d{6}/.test(st)) return false;
      var t = tok(st); if (t.length < 3) return false;
      if (!/^\d{3,5}$/.test(t[t.length - 1])) return false;
      if (!(/^[A-Z][A-Z0-9]{1,7}$/.test(t[0]) || /^\d+FT$/.test(t[0]))) return false;
      if (/^(AWY|MOCA|CS|PLAN|CI|FUEL|FDB|T\/O|RVSM|LEFT|TRIP|CONT|ALTN|FINAL|REQUIRED|TOTAL|TANKER|POLICY|APU|TAXI|ADDITIONAL|CMDR|PER)$/.test(t[0])) return false;
      return /^[A-Z]/.test(t[1]);
    }
    function closeRow() {
      if (!row) return;
      var body = row.lines, nonc = body.filter(function (l) { return !/[NS]\d{5}\s+[EW]\d{6}/.test(l) && !/\b\d{2}[EW]\s+\d{4}\b/.test(l); });
      var acct = null, m;
      for (var q = 0; q < nonc.length && acct == null; q++) if ((m = /\b(\d{1,4})\s+(\d{3})\s+(\d{4})\b/.exec(nonc[q]))) acct = m[3];
      for (q = 0; q < nonc.length && acct == null; q++) if ((m = /\b(\d{1,4})\s+(\d{4})\b(?!\d)/.exec(nonc[q]))) acct = m[2];
      var mora = null, fir = null;
      for (q = 0; q < body.length; q++) {
        var bt = body[q].trim();
        if (mora == null && /^(\d{3})\b/.test(bt) && !/^\d+\s+\d{3}\s+\d{1,2}$/.test(bt) && !/[NS]\d{5}/.test(bt)) mora = parseInt(bt.slice(0, 3), 10) * 100;
        var fm2 = /^\d{3}\s+([A-Z][A-Z .]*?)\s+(?:UIR\s+)?FIR\b/.exec(bt); if (fm2) fir = fm2[1].replace(/\s+/g, ' ');
      }
      if (row.mocaft != null) mora = row.mocaft;
      var ll = null; for (q = 0; q < body.length && !ll; q++) ll = skyLL(body[q]);
      var w = { t: 'WPT', wpt: row.name, eet: acct ? hm(acct) : null, mora: mora, fplan: row.fob != null ? Math.round((row.fob - extraKg) / 100) / 10 : null,
        fir: null, firname: fir ? fir.replace(/\w\S*/g, function (x) { return x.charAt(0) + x.slice(1).toLowerCase(); }) : null, aw: row.aw, freq: row.freq, fl: row.fl, wind: row.wind, fob: row.fob };
      if (fir) NAV.push({ t: 'FIR', fir: null, name: w.firname, at: row.name });
      NAV.push(w);
      if (ll && !coords[row.name]) coords[row.name] = ll;
      row = null;
    }
    for (i = 0; i < OL.length && !done; i++) {
      var l = OL[i], st = l.trim();
      if (/^AWY\s+WPT\s+FRQ/.test(st)) { inNav = true; continue; }
      if (!inNav) continue;
      if (/^DEST\s+ATIS|DEST\s+ALTERNATE\s+ROUTE\s+SECTION/.test(st)) { closeRow(); done = true; break; }
      if (!st || /^(MOCA\s+NAME|LAT\/LONG|RVSM|LEFT\s+ALT)/.test(st) || SKY.test(st)) continue;
      if (isStart(st)) {
        closeRow();
        var t = tok(st), k = 1, nmp = [], aw = t[0], mocaft = null, freq = null;
        if (/^\d+FT$/.test(t[0])) { mocaft = null; aw = ''; }
        while (k < t.length && (!/^\d+$/.test(t[k]) || false) && !/^\d+$/.test(t[k]) && !/^\d{3}\/\d{3}$/.test(t[k])) {
          if (/^[A-Z]?\d{3,4}\.\d{1,2}$/.test(t[k])) freq = t[k].replace(/^[A-Z]/, ''); else nmp.push(t[k]);
          k++;
        }
        var fl2 = /\s(\d{3})\s+(\d{3}\/\d{3})\s/.exec(' ' + st + ' ');
        row = { aw: aw === 'DCT' || /^[A-Z]{1,2}\d{1,4}$|^[A-Z]{2,7}\d[A-Z]$|^DCT$/.test(aw) ? aw : aw, name: nmp.join(' '), freq: freq,
          fob: parseInt(t[t.length - 1], 10), fl: fl2 ? fl2[1] : (/\bCLB\b/.test(st) ? 'CLB' : ''), wind: fl2 ? fl2[2] : '', mocaft: mocaft, lines: [] };
        continue;
      }
      if (row) row.lines.push(st);
    }
    closeRow();
    O.nav = NAV;
    /* the FIR marker names come from the navlog; the codes from the FPL EET list in the same order (only when the counts agree) */
    var marks = NAV.filter(function (n) { return n.t === 'FIR'; });
    marks.forEach(function (n, x) { var e = O.fir_eet[x]; if (e && marks.length === O.fir_eet.length) n.fir = e.fir; });
    NAV = NAV.filter(function (n) { return n.t !== 'FIR' || n.fir; });
    O.nav = NAV;
    O.coords = coords;

    /* --- critical terrain scenario (T-points, escape aerodromes) and the OFP remarks */
    O.tpoints = [];
    var ct0 = -1; for (i = 0; i < OL.length; i++) if (/CRITICAL\s+TERRAIN\s+SCENARIO/.test(OL[i])) { ct0 = i; break; }
    var terr = '';
    if (ct0 >= 0) {
      var tl = [];
      for (i = ct0; i < OL.length; i++) { if (/UPPER\s+WIND\s+SUMMARY/.test(OL[i])) break; if (!SKY.test(OL[i])) tl.push(OL[i].replace(/\s{2,}/g, '  ').trimEnd()); }
      terr = tl.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      var tx = tl.join('\n'), trx = /^\s*(T\d)\s+(\d{3})NM\s+AFTER\s+(\S+)([\s\S]*?)(?=^\s*T\d\s+\d{3}NM|$(?![\s\S]))/gm, tm;
      while ((tm = trx.exec(tx))) {
        var blk = tm[4], tp = { id: tm[1], nm: +tm[2], after: tm[3] };
        if (/TERRAIN\s+NOT\s+CRITICAL/.test(blk)) tp.notcrit = true;
        var to2 = /CONT\s+TO\s+([A-Z]{4})/.exec(blk); if (to2) tp.apt = to2[1];
        var mt = /MAX\s+TERRAIN\s+(\d+)/.exec(blk); if (mt) tp.maxterr = +mt[1];
        var ar = new RegExp('^\\s*' + (tp.apt || 'XXXX') + '\\s+(\\d+)\\s+(\\d{3})\\s+(\\d{3}\\/\\d{3})\\s+([MP]\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d\\d)\\.(\\d\\d)\\s+(\\d{4}-\\d{4})', 'm').exec(blk);
        if (ar) { tp.gcd = +ar[1]; tp.fl = ar[2]; tp.minf = +ar[6]; tp.time = +ar[7] * 60 + +ar[8]; tp.wx = ar[9]; }
        var ms = /MSA\s+OUTSIDE\s+(\d+)NM\s+FROM\s+\w+\s+(FL\d+)\s*\/\s*WITHIN\s+\d+NM\s+FROM\s+\w+\s+(FL\d+)/.exec(blk.replace(/\s+/g, ' '));
        if (ms) tp.msa = ms[2] + ' outside ' + ms[1] + ' NM / ' + ms[3] + ' within';
        var tw = NAV.filter(function (n) { return n.t === 'WPT' && new RegExp('^TDP' + tm[1].slice(1) + '\\b').test(n.wpt); })[0];
        tp.eet = tw ? tw.eet : null;
        O.tpoints.push(tp);
      }
    }
    var rem = [];
    var ia = g(/^\s*(IA\s*:\s*\S+)/m, OC), ta = g(/^\s*(TA\s*:\s*\S+)/m, OC);
    if (ia) rem.push(ia.replace(/\s+/g, '')); if (ta) rem.push(ta.replace(/\s+/g, ''));
    var rte = g(/(RTE\s*:\s*\d+.*)$/m, OC); if (rte) rem.push(rte.replace(/\s+/g, ' ').trim());
    var cold = g(/(COLDEST\s+TEMP.*)$/m, OC); if (cold) rem.push(cold.replace(/\s+/g, ' ').trim());
    var xr = /EXTRA\s+FUEL\s+REASON\s*:\s*\d*\s*\n([^\n]*)/.exec(OC);
    if (xr) { var why = xr[1].replace(/^.*?\s{3,}(?=[A-Z])/, '').trim(); if (why && !/PER\s+1000/.test(why)) rem.push('Extra fuel reason: ' + why.replace(/\s+/g, ' ')); }
    if (/MEL\/CDL\s+PENALTIES\s*:\s*(\S+)/.test(OC)) rem.push('MEL/CDL penalties: ' + /MEL\/CDL\s+PENALTIES\s*:\s*(\S+)/.exec(OC)[1]);
    if (terr) rem.push('', terr);
    O.remarks = rem.join('\n') || null;

    /* --- the briefing part of the pack */
    var R = raw ? raw.split('\n').map(function (x) { return x.trim(); }) : [];
    var ROLE2 = { 'DEPARTURE': 'DEP', 'DESTINATION': 'DEST', 'DESTINATION ALTERNATES': 'ALTN', 'DESTINATION ALTERNATE': 'ALTN', 'EN-ROUTE ALTERNATES': 'ENR',
      'ENROUTE ALTERNATES': 'ENR', 'INTERMEDIATE ALTERNATES': 'ENR', 'TAKE-OFF ALTERNATES': 'ENR', 'TAKEOFF ALTERNATES': 'ENR', 'ESCAPE ALTERNATES': 'ENR' };
    var heads = [], role = null, firs = {}, last = null, ncard = 0;
    for (i = 0; i < R.length; i++) {
      var r = R[i];
      if (ROLE2[r]) { role = ROLE2[r]; continue; }
      var hd = /^([A-Z]{4}) \[([A-Z0-9]{3})\] (.+)$/.exec(r);
      if (hd) { last = { icao: hd[1], iata: hd[2], name: hd[3].replace(/\w\S*/g, function (w) { return w.charAt(0) + w.slice(1).toLowerCase(); }), role: role, line: i }; heads.push(last); continue; }
      var fh = /^([A-Z]{4}) ([A-Z][A-Z .'\-]+?) (FIR\/UIR|FIR\/ACC\/NOF|FIR|UIR)$/.exec(r);
      if (fh) { firs[fh[1]] = fh[2]; continue; }
      if (/^Airfield MET Information$/.test(r)) {
        ncard++;
        var card = { metar: null, taf: null, cut: false }, kind = null, buf = '';
        for (j = i + 1; j < R.length; j++) {
          var s2 = R[j];
          if (/^M:/.test(s2) || /^No METAR Available/.test(s2)) { if (kind) card[kind] = buf; kind = /^M:/.test(s2) ? 'metar' : null; buf = kind ? s2.slice(2) : ''; continue; }
          if (/^T:/.test(s2) || /^No TAF Available/.test(s2)) { if (kind) card[kind] = buf; kind = /^T:/.test(s2) ? 'taf' : null; buf = kind ? s2.slice(2) : ''; continue; }
          if (!kind || !s2 || s2 === '<<PAGE>>' || /^(Airfield |Ref: OPS GEN|En-Route Data|FIR |ICAO Class)/.test(s2) || /^[A-Z]{4} \[/.test(s2) || ROLE2[s2]) break;
          if (/=$/.test(buf)) break;
          buf += ' ' + s2;
        }
        if (kind) card[kind] = buf;
        ['metar', 'taf'].forEach(function (k2) {
          if (!card[k2]) return;
          var v = card[k2].replace(/\s+/g, ' ').trim();
          if (!/=$/.test(v)) { v += ' [cut at a page break - read the rest in the pack]'; card.cut = true; }
          card[k2] = v.replace(/=$/, '');
        });
        /* a weather card has no ICAO code: it is used only when it follows its airport header directly (content order of the PDF) */
        var gap = 0; for (var q4 = last ? last.line + 1 : i; q4 < i; q4++) if (R[q4] && R[q4] !== '<<PAGE>>') gap++;
        if (last && !last.card && gap === 0) last.card = card;
        i = j - 1;
      }
    }
    O.wx = [];
    heads.forEach(function (h) {
      if (!h.card) return;
      var w = { icao: h.icao, iata: h.iata, name: h.name, role: h.role || 'ENR' }, c2 = h.card;
      if (c2.metar) w.metar = c2.metar;
      if (c2.taf) { w.taf = c2.taf; var p = parseTaf('TAF ' + c2.taf.replace(/\s*\[cut.*$/, ''), O.day || null); if (p && O.day) { w.va = p.va; w.vb = p.vb; w.groups = p.groups; } }
      O.wx.push(w);
    });
    var unplaced = ncard - O.wx.length, cutn = heads.filter(function (h) { return h.card && h.card.cut; }).length;
    if (unplaced > 0) O.note.push(unplaced + ' weather card(s) in the pack could not be tied to an airport and were left out - read them in the pack.');
    if (cutn) O.note.push(cutn + ' METAR/TAF text(s) run over a page break in the pack - marked in the weather; read the rest in the pack.');
    if (O.dep && !heads.some(function (h) { return h.icao === O.dep && h.role === 'DEP'; })) heads.forEach(function (h) { if (h.icao === O.dep) h.role = 'DEP'; });

    /* SIGMETs: each SIGMET starts with its FIR code */
    var sg = [], cur = null;
    for (i = 0; i < R.length; i++) {
      var sm = /^([A-Z]{4}) SIGMET\s+\S+\s+VALID\s+\d{6}\/\d{6}/.exec(R[i]);
      if (sm) { cur = { fir: sm[1], t: R[i] }; sg.push(cur); if (/=$/.test(R[i])) cur = null; continue; }
      if (!cur) continue;
      if (!R[i] || R[i] === '<<PAGE>>' || /^(FIR |Airfield |[A-Z]{4}: |Ref: OPS GEN|En-Route Data|[A-Z]{4} SIGMET)/.test(R[i])) { cur.t += ' [cut - read the rest in the pack]'; cur = null; i--; continue; }
      cur.t += ' ' + R[i]; if (/=$/.test(R[i])) cur = null;
    }
    if (sg.length) {
      var byF = {};
      sg.forEach(function (x) { (byF[x.fir] = byF[x.fir] || []).push(x.t.replace(/=$/, '')); });
      O.sigmet = Object.keys(byF).map(function (f) {
        var nmf = firs[f] || ((new RegExp(f + ' ([A-Z ]+?) FIR')).exec(byF[f][0]) || [])[1] || f;
        return f + ' ' + nmf + ' FIR\n' + byF[f].join('\n');
      }).join('\n\n');
    } else O.sigmet = null;

    /* NOTAMs and company notices, read from the layout text split into its two columns */
    var aptSet = {}; heads.forEach(function (h) { aptSet[h.icao] = h.role || 'ENR'; });
    var BL = L.slice(i0brief(L, o1));
    var stream = columns(BL);
    var date0 = O.date ? Date.UTC(O.yr, O.mon - 1, O.day) : null;
    function dmy(s) { var m = /(\d\d)\/(\d\d)\/(\d{4})\s+(\d\d):(\d\d)/.exec(s); return m && date0 != null ? Math.round((Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]) - date0) / 60000) : null; }
    O.notams = []; O.rnotams = [];
    var seenN = {}, ncur = null, STOP = /^(Airfield (MET|NOTAM|Company|Chart)|FIR (SIGMET|ASHTAM|Notam|NOTAM|Company|Chart|INFORMATION)|ICAO Class|Ref: OPS GEN|En-Route Data|DEPARTURE$|DESTINATION|EN-ROUTE|INTERMEDIATE|No (NOTAM|Chart|SIGMET|ASHTAM))/;
    function endN() { if (ncur) { ncur.x = ncur.x.join(' ').replace(/\s+/g, ' ').trim(); ncur = null; } }
    for (i = 0; i < stream.length; i++) {
      var s3 = stream[i].trim();
      if (s3 === '<<COL>>' || !s3) { endN(); continue; }
      var nh = /^([A-Z]{4}):\s+([A-Z]\d{3,4}\/\d{2})\s+(.*)$/.exec(s3);
      var ch = /^([nN][0-9A-Z]{1,4}\/\d{2})\s+(\d\d\/\d\d\/\d{4}\s+\d\d:\d\d)\s+-\s+(UFN|PERM|\d\d\/\d\d\/\d{4}\s+\d\d:\d\d)/.exec(s3);
      if (nh || ch) {
        endN();
        if (nh) {
          var vline = '', q2;
          for (q2 = i + 1; q2 < stream.length && q2 < i + 3; q2++) if (/^Valid:/.test(stream[q2].trim())) { vline = stream[q2].trim(); break; }
          var va = /Valid:\s*(\d\d\/\d\d\/\d{4}\s+\d\d:\d\d)\s*-\s*(PERM|UFN|\d\d\/\d\d\/\d{4}\s+\d\d:\d\d)(\s*-\s*EST)?/.exec(vline);
          var key = nh[1] + ' ' + nh[2]; if (seenN[key]) { ncur = null; continue; }
          var rec = { id: nh[2], cat: nh[3].replace(/\s+/g, ' '), a: va ? dmy(va[1]) : null, b: va && !/PERM|UFN/.test(va[2]) ? dmy(va[2]) : null, bt: va && /PERM|UFN/.test(va[2]) ? va[2] : '', est: !!(va && va[3]), x: [] };
          if (aptSet[nh[1]] !== undefined) { rec.icao = nh[1]; rec.role = aptSet[nh[1]]; O.notams.push(rec); }
          else { rec.fir = nh[1]; rec.name = firs[nh[1]] || ''; rec.sec = 'enr'; rec.secs = ['enr']; O.rnotams.push(rec); }
          seenN[key] = rec; ncur = rec; if (va) i = q2; continue;
        }
        /* company notice: 'n388/26 28/09/2026 08:30 - UFN' then 'Targets: LTFM' */
        var tg = ''; for (q2 = i + 1; q2 < stream.length && q2 < i + 3; q2++) { var tq = /^Targets:\s*(.*)$/.exec(stream[q2].trim()); if (tq) { tg = tq[1]; break; } }
        var tgs = tg.split(/[\s,]+/).filter(function (z) { return /^[A-Z]{4}$/.test(z); });
        var k3 = ch[1] + ' ' + tgs.join(','); if (!tgs.length || seenN[k3]) { ncur = null; continue; }
        var crec = { id: ch[1], cat: 'COMPANY NOTICE', a: dmy(ch[2]), b: /UFN|PERM/.test(ch[3]) ? null : dmy(ch[3]), bt: /UFN|PERM/.test(ch[3]) ? ch[3] : '', est: false, x: [], company: true };
        if (aptSet[tgs[0]] !== undefined) { crec.icao = tgs[0]; crec.role = aptSet[tgs[0]]; O.notams.push(crec); }
        else { crec.fir = tgs[0]; crec.name = firs[tgs[0]] || ''; crec.sec = 'enr'; crec.secs = ['enr']; O.rnotams.push(crec); }
        seenN[k3] = crec; ncur = crec; i = q2; continue;
      }
      if (!ncur) continue;
      if (STOP.test(s3) || /^\d+\/\d+$/.test(s3)) { endN(); continue; }
      ncur.x.push(s3);
    }
    endN();
    O.notams = O.notams.filter(function (n) { return n.x || n.cat; }).map(function (n) { if (!n.x) n.x = n.cat; else n.x = n.cat + ' – ' + n.x; return n; });
    O.rnotams = O.rnotams.map(function (n) {
      n.x = n.x ? n.cat + ' – ' + n.x : n.cat;
      n.kind = /AIRSPACE USE PLAN|\(AUP\)|\bTSA\/TRA\b/.test(n.x.slice(0, 160)) ? 'airspace' :
        (/SECURITY|CONFLICT|PROHIBITED|ARMED|MILITARY|HOSTIL|MISSILE|ROCKET|UNAUTHORI[SZ]ED FLIGHTS/.test(n.x) ? 'conflict' : (/GNSS|\bGPS\b|SPOOF|JAMM/.test(n.x) ? 'gnss' : 'info'));
      return n;
    });
    /* count check against the pack summary '(OMDB: 16) (LTFM: 19) ...' and '(OMAE 15) (OOMM 11) ...' */
    var printed = 0, cm, crx2 = /\(([A-Z]{4}):?\s+(\d+)\)/g, sumtxt = (T.slice(0, 20000).split(/OPERATIONAL\s+FLIGHT\s+PLAN/)[0] || '');
    while ((cm = crx2.exec(sumtxt))) printed += +cm[2];
    var readN = O.notams.filter(function (n) { return !n.company; }).length + O.rnotams.filter(function (n) { return !n.company; }).length;
    O.ntcheck = { hdr: printed || readN, read: readN, unknown: [] };
    if (printed && readN < printed) O.note.push('NOTAMs: the pack summary lists ' + printed + ', the app read ' + readN + ' (some are split over pages in the pack) - read the NOTAM pages of the pack.');
    O.note.push('Skybook briefing pack: NOTAM text is read from a two-column layout - a NOTAM that continues on another page is shown only in part. The pack prevails.');

    /* --- checks */
    var nw = O.nav.filter(function (n) { return n.t === 'WPT'; }).length;
    if (!nw) O.warn.push('The Skybook navlog was not read (no waypoints found) - send the pack to Claude: the Skybook reader needs fixing.');
    if (!O.dep || !O.dest) O.warn.push('Departure / destination not found in the Skybook OFP header.');
    if (!O.fuel.trip) O.note.push('FUEL BLOCK NOT READ.');
    if (!O.route) O.note.push('ROUTE TEXT NOT READ.');
    if (!O.fir_eet.length) O.note.push('No FIR times (EET/) read from the filed flight plan.');
    if (nw && Object.keys(coords).length < nw * 0.8) O.note.push('Only ' + Object.keys(coords).length + ' of ' + nw + ' waypoints have OFP coordinates - the rest are estimated from the times.');
    var noe = O.nav.filter(function (n) { return n.t === 'WPT' && n.eet == null; }).length;
    if (noe) O.note.push(noe + ' navlog line(s) without a readable time.');
    return O;
  };
  function i0brief(L, o1) { /* the briefing part = everything after the OFP pages */
    for (var i = o1 + 1; i < L.length; i++) if (/^\s*\d+\/\d+\s*$/.test(L[i])) return i + 1;
    return o1 + 1;
  }
  /* split the layout lines of a two-column page into left then right, page by page */
  function columns(L) {
    var cnt = {}, best = 0, c = 0, k;
    L.forEach(function (l) {
      var m, rx = /\S\s{3,}(\S)/g;
      while ((m = rx.exec(l))) { var p = m.index + m[0].length - 1; if (p >= 50 && p <= 130) cnt[p] = (cnt[p] || 0) + 1; }
      var lead = /^(\s+)\S/.exec(l); if (lead && lead[1].length >= 50 && lead[1].length <= 130) cnt[lead[1].length] = (cnt[lead[1].length] || 0) + 1;
    });
    for (k in cnt) if (cnt[k] > best) { best = cnt[k]; c = +k; }
    var out = [], left = [], right = [];
    function flush() { out = out.concat(left, ['<<COL>>'], right, ['<<COL>>']); left = []; right = []; }
    L.forEach(function (l) {
      if (/^\s*\d+\/\d+\s*$/.test(l)) { flush(); return; }
      if (!c || l.length <= c) { left.push(l); return; }
      var lp = l.slice(0, c), rp = l.slice(c);
      if (!lp.trim()) { right.push(rp); return; }
      if (/\s\s$/.test(lp) || lp.slice(c - 2) === '  ') { left.push(lp.trimEnd()); right.push(rp); return; }
      left.push(l);   /* a left line that runs into the right column: kept whole (the right part may be lost) */
    });
    flush();
    return out;
  }

  if (typeof window !== 'undefined') window.FPOfp = F;
  if (typeof module !== 'undefined' && module.exports) module.exports = F;
})();
