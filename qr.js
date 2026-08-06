/* =====================================================================
   qr.js — tiny self-contained QR code generator (byte mode, EC level M)
   No CDN, no dependencies. Works offline / behind school firewalls.
   Usage:  QR.render(containerEl, "https://...", sizePx)
   Supports QR versions 1-10 (up to 213 bytes) — plenty for a join URL.
   ===================================================================== */
(function (global) {
  'use strict';

  /* ---------- Galois field GF(256) ---------- */
  var EXP = new Array(256), LOG = new Array(256);
  (function () {
    for (var i = 0; i < 8; i++) EXP[i] = 1 << i;
    for (i = 8; i < 256; i++) EXP[i] = EXP[i - 4] ^ EXP[i - 5] ^ EXP[i - 6] ^ EXP[i - 8];
    for (i = 0; i < 255; i++) LOG[EXP[i]] = i;
  })();
  function gexp(n) { while (n < 0) n += 255; while (n >= 256) n -= 255; return EXP[n]; }
  function glog(n) { return LOG[n]; }

  function polyMul(a, b) {
    var out = new Array(a.length + b.length - 1).fill(0);
    for (var i = 0; i < a.length; i++)
      for (var j = 0; j < b.length; j++)
        out[i + j] ^= gexp(glog(a[i]) + glog(b[j]));
    return out;
  }
  function polyMod(data, gen) {
    var res = data.slice();
    for (var i = 0; i < data.length - gen.length + 1; i++) {
      if (res[i] === 0) continue;
      var factor = glog(res[i]);
      for (var j = 0; j < gen.length; j++) res[i + j] ^= gexp(glog(gen[j]) + factor);
    }
    return res.slice(res.length - gen.length + 1);
  }
  function rsGenerator(n) {
    var g = [1];
    for (var i = 0; i < n; i++) g = polyMul(g, [1, gexp(i)]);
    return g;
  }

  /* ---------- Version tables (EC level M only) ---------- */
  // [ blocks..., each triplet = count, totalBytes, dataBytes ]
  var RS_M = {
    1: [1, 26, 16], 2: [1, 44, 28], 3: [1, 70, 44], 4: [2, 50, 32], 5: [2, 67, 43],
    6: [4, 43, 27], 7: [4, 49, 31], 8: [2, 60, 38, 2, 61, 39],
    9: [3, 58, 36, 2, 59, 37], 10: [4, 69, 43, 1, 70, 44]
  };
  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

  function rsBlocks(ver) {
    var t = RS_M[ver], list = [];
    for (var i = 0; i < t.length; i += 3)
      for (var c = 0; c < t[i]; c++) list.push({ total: t[i + 1], data: t[i + 2] });
    return list;
  }
  function dataCapacity(ver) {
    return rsBlocks(ver).reduce(function (s, b) { return s + b.data; }, 0);
  }

  /* ---------- BCH for format / version info ---------- */
  function bchDigit(d) { var n = 0; while (d !== 0) { n++; d >>>= 1; } return n; }
  function fmtBits(maskNo) {
    // EC level M => 0b00 ; data = (ecBits << 3) | maskNo
    var d = (0 << 3) | maskNo, dd = d << 10;
    while (bchDigit(dd) - bchDigit(0x537) >= 0) dd ^= (0x537 << (bchDigit(dd) - bchDigit(0x537)));
    return ((d << 10) | dd) ^ 0x5412;
  }
  function verBits(ver) {
    var dd = ver << 12;
    while (bchDigit(dd) - bchDigit(0x1f25) >= 0) dd ^= (0x1f25 << (bchDigit(dd) - bchDigit(0x1f25)));
    return (ver << 12) | dd;
  }

  /* ---------- Mask functions ---------- */
  var MASKS = [
    function (i, j) { return (i + j) % 2 === 0; },
    function (i) { return i % 2 === 0; },
    function (i, j) { return j % 3 === 0; },
    function (i, j) { return (i + j) % 3 === 0; },
    function (i, j) { return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0; },
    function (i, j) { return (i * j) % 2 + (i * j) % 3 === 0; },
    function (i, j) { return ((i * j) % 2 + (i * j) % 3) % 2 === 0; },
    function (i, j) { return ((i * j) % 3 + (i + j) % 2) % 2 === 0; }
  ];

  /* ---------- Bit buffer ---------- */
  function BitBuf() { this.buf = []; this.len = 0; }
  BitBuf.prototype.put = function (num, bits) {
    for (var i = 0; i < bits; i++) this.putBit(((num >>> (bits - i - 1)) & 1) === 1);
  };
  BitBuf.prototype.putBit = function (b) {
    var idx = Math.floor(this.len / 8);
    if (this.buf.length <= idx) this.buf.push(0);
    if (b) this.buf[idx] |= (0x80 >>> (this.len % 8));
    this.len++;
  };

  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
      else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    }
    return out;
  }

  /* ---------- Build the matrix ---------- */
  function build(text) {
    var bytes = utf8Bytes(text), ver = 1;
    while (ver <= 10) {
      var lenBits = ver < 10 ? 8 : 16;
      if (dataCapacity(ver) * 8 >= 4 + lenBits + bytes.length * 8) break;
      ver++;
    }
    if (ver > 10) throw new Error('QR: data too long');

    var bb = new BitBuf();
    bb.put(4, 4);                                  // byte mode
    bb.put(bytes.length, ver < 10 ? 8 : 16);
    for (var i = 0; i < bytes.length; i++) bb.put(bytes[i], 8);

    var cap = dataCapacity(ver) * 8;
    for (i = 0; i < 4 && bb.len < cap; i++) bb.putBit(false);   // terminator
    while (bb.len % 8 !== 0) bb.putBit(false);
    var pad = [0xEC, 0x11], p = 0;
    while (bb.buf.length < dataCapacity(ver)) bb.buf.push(pad[p++ % 2]);

    // interleave data + ec
    var blocks = rsBlocks(ver), off = 0, dParts = [], eParts = [], maxD = 0, maxE = 0;
    blocks.forEach(function (b) {
      var d = bb.buf.slice(off, off + b.data); off += b.data;
      var ecLen = b.total - b.data;
      var padded = d.concat(new Array(ecLen).fill(0));
      var ec = polyMod(padded, rsGenerator(ecLen));
      dParts.push(d); eParts.push(ec);
      maxD = Math.max(maxD, d.length); maxE = Math.max(maxE, ec.length);
    });
    var payload = [];
    for (i = 0; i < maxD; i++) dParts.forEach(function (d) { if (i < d.length) payload.push(d[i]); });
    for (i = 0; i < maxE; i++) eParts.forEach(function (e) { if (i < e.length) payload.push(e[i]); });

    var size = ver * 4 + 17;
    var best = null;
    for (var mask = 0; mask < 8; mask++) {
      var m = makeMatrix(ver, size, payload, mask);
      var pen = penalty(m, size);
      if (!best || pen < best.pen) best = { m: m, pen: pen };
    }
    return { modules: best.m, size: size };
  }

  function makeMatrix(ver, size, payload, mask) {
    var m = [];
    for (var r = 0; r < size; r++) m.push(new Array(size).fill(null));

    function finder(row, col) {
      for (var r = -1; r <= 7; r++) for (var c = -1; c <= 7; c++) {
        var rr = row + r, cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        m[rr][cc] = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                    (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                    (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      }
    }
    finder(0, 0); finder(size - 7, 0); finder(0, size - 7);

    ALIGN[ver].forEach(function (a) {
      ALIGN[ver].forEach(function (b) {
        if (m[a][b] !== null) return;
        for (var r = -2; r <= 2; r++) for (var c = -2; c <= 2; c++)
          m[a + r][b + c] = (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0));
      });
    });

    for (var i = 8; i < size - 8; i++) {
      if (m[i][6] === null) m[i][6] = i % 2 === 0;
      if (m[6][i] === null) m[6][i] = i % 2 === 0;
    }
    m[size - 8][8] = true; // dark module

    var fmt = fmtBits(mask);
    for (i = 0; i < 15; i++) {
      var bit = ((fmt >> i) & 1) === 1;
      if (i < 6) m[i][8] = bit; else if (i < 8) m[i + 1][8] = bit; else m[size - 15 + i][8] = bit;
      if (i < 8) m[8][size - i - 1] = bit; else if (i < 9) m[8][15 - i - 1 + 1] = bit; else m[8][15 - i - 1] = bit;
    }
    if (ver >= 7) {
      var vb = verBits(ver);
      for (i = 0; i < 18; i++) {
        var b2 = ((vb >> i) & 1) === 1;
        m[Math.floor(i / 3)][i % 3 + size - 8 - 3] = b2;
        m[i % 3 + size - 8 - 3][Math.floor(i / 3)] = b2;
      }
    }

    // place payload
    var inc = -1, row = size - 1, bitIdx = 7, byteIdx = 0;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      while (true) {
        for (var c2 = 0; c2 < 2; c2++) {
          if (m[row][col - c2] === null) {
            var dark = false;
            if (byteIdx < payload.length) dark = ((payload[byteIdx] >>> bitIdx) & 1) === 1;
            if (MASKS[mask](row, col - c2)) dark = !dark;
            m[row][col - c2] = dark;
            bitIdx--;
            if (bitIdx === -1) { byteIdx++; bitIdx = 7; }
          }
        }
        row += inc;
        if (row < 0 || size <= row) { row -= inc; inc = -inc; break; }
      }
    }
    return m;
  }

  function penalty(m, size) {
    var p = 0, r, c, i;
    for (r = 0; r < size; r++) {
      for (c = 0; c < size; c++) {
        var same = 0, dark = m[r][c];
        for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          if (r + dr < 0 || r + dr >= size || c + dc < 0 || c + dc >= size) continue;
          if (m[r + dr][c + dc] === dark) same++;
        }
        if (same > 5) p += (3 + same - 5);
      }
    }
    for (r = 0; r < size - 1; r++) for (c = 0; c < size - 1; c++) {
      var cnt = 0;
      if (m[r][c]) cnt++; if (m[r + 1][c]) cnt++; if (m[r][c + 1]) cnt++; if (m[r + 1][c + 1]) cnt++;
      if (cnt === 0 || cnt === 4) p += 3;
    }
    var darkCount = 0;
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (m[r][c]) darkCount++;
    p += Math.abs(100 * darkCount / (size * size) - 50) / 5 * 10;
    return p;
  }

  /* ---------- Public API ---------- */
  var QR = {
    toSVG: function (text, px, light, dark) {
      light = light || '#ffffff'; dark = dark || '#0f1f4d';
      var q = build(text), n = q.size, quiet = 4, total = n + quiet * 2;
      var path = '';
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++)
        if (q.modules[r][c]) path += 'M' + (c + quiet) + ',' + (r + quiet) + 'h1v1h-1z';
      return '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px +
        '" viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges" role="img" aria-label="Join QR code">' +
        '<rect width="' + total + '" height="' + total + '" fill="' + light + '"/>' +
        '<path d="' + path + '" fill="' + dark + '"/></svg>';
    },
    render: function (el, text, px, light, dark) {
      try { el.innerHTML = QR.toSVG(text, px, light, dark); return true; }
      catch (e) { el.innerHTML = '<div class="qr-fail">QR unavailable<br><small>use the link/code</small></div>'; return false; }
    }
  };

  global.QR = QR;
})(window);
