/* =====================================================================
 * inflate.js — DEFLATE(RFC 1951) 압축 해제와 압축, 의존성 없이
 *
 * HWP 5.0은 CFB 스트림 안의 내용을 한 번 더 압축해 둔다. 그것도 zlib
 * 헤더 없는 "raw deflate"다 (파이썬 코드에서 zlib.decompress(data, -15)
 * 를 쓰는 이유가 이것이다).
 *
 * 브라우저의 DecompressionStream은 비동기라 이 페이지의 "모든 것이 한
 * 프레임 안에서 실제 바이트로 계산된다"는 원칙과 맞지 않는다. 그래서
 * 동기 구현을 직접 둔다. 알고리즘은 zlib의 puff.c와 같은 정석이다.
 * ===================================================================== */
(function (root) {
  'use strict';

  /* ---------- 비트 읽기 (LSB 먼저) ------------------------------------ */
  function BitReader(buf) {
    this.b = buf; this.pos = 0; this.bit = 0; this.val = 0;
  }
  BitReader.prototype.bits = function (need) {
    var val = this.val, cnt = this.bit;
    while (cnt < need) {
      if (this.pos >= this.b.length) throw new Error('압축 데이터가 도중에 끊겼다');
      val |= this.b[this.pos++] << cnt;
      cnt += 8;
    }
    this.val = val >>> need;
    this.bit = cnt - need;
    return val & ((1 << need) - 1);
  };
  BitReader.prototype.align = function () { this.bit = 0; this.val = 0; };

  /* ---------- 허프만 표 -------------------------------------------------
   * 정규(canonical) 허프만: 부호 길이 목록만으로 표를 복원할 수 있다.
   * count[n] = 길이 n인 부호의 개수, symbol[] = 길이순으로 정렬된 심볼   */
  function Huffman(lengths, n) {
    this.count = new Int32Array(16);
    this.symbol = new Int32Array(n);
    var i;
    for (i = 0; i < n; i++) this.count[lengths[i]]++;
    if (this.count[0] === n) return;            /* 전부 미사용 */
    var left = 1;
    for (i = 1; i < 16; i++) {
      left <<= 1; left -= this.count[i];
      if (left < 0) throw new Error('허프만 부호가 과포화됐다');
    }
    var offs = new Int32Array(16);
    for (i = 1; i < 15; i++) offs[i + 1] = offs[i] + this.count[i];
    for (i = 0; i < n; i++) if (lengths[i]) this.symbol[offs[lengths[i]]++] = i;
  }
  function decodeSym(br, h) {
    var code = 0, first = 0, index = 0;
    for (var len = 1; len < 16; len++) {
      code |= br.bits(1);
      var count = h.count[len];
      if (code - first < count) return h.symbol[index + (code - first)];
      index += count; first += count; first <<= 1; code <<= 1;
    }
    throw new Error('허프만 부호를 해석할 수 없다');
  }

  /* ---------- 길이/거리 표 (RFC 1951 §3.2.5) --------------------------- */
  var LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59,
                  67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
                   1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  var fixedLit = null, fixedDist = null;
  function buildFixed() {
    if (fixedLit) return;
    var l = new Uint8Array(288), i;
    for (i = 0; i < 144; i++) l[i] = 8;
    for (; i < 256; i++) l[i] = 9;
    for (; i < 280; i++) l[i] = 7;
    for (; i < 288; i++) l[i] = 8;
    fixedLit = new Huffman(l, 288);
    var d = new Uint8Array(30);
    for (i = 0; i < 30; i++) d[i] = 5;
    fixedDist = new Huffman(d, 30);
  }

  /* ---------- 출력 버퍼 (필요하면 자란다) ------------------------------- */
  function Out(hint) { this.b = new Uint8Array(Math.max(1024, hint | 0)); this.n = 0; }
  Out.prototype.need = function (k) {
    if (this.n + k <= this.b.length) return;
    var cap = this.b.length;
    while (cap < this.n + k) cap *= 2;
    var nb = new Uint8Array(cap); nb.set(this.b.subarray(0, this.n)); this.b = nb;
  };
  Out.prototype.push = function (v) { this.need(1); this.b[this.n++] = v; };
  Out.prototype.done = function () { return this.b.slice(0, this.n); };

  function codes(br, out, lit, dist) {
    for (;;) {
      var sym = decodeSym(br, lit);
      if (sym < 256) { out.push(sym); continue; }
      if (sym === 256) return;
      sym -= 257;
      if (sym >= 29) throw new Error('길이 부호가 범위를 벗어났다');
      var len = LEN_BASE[sym] + br.bits(LEN_EXTRA[sym]);
      var dsym = decodeSym(br, dist);
      if (dsym >= 30) throw new Error('거리 부호가 범위를 벗어났다');
      var d = DIST_BASE[dsym] + br.bits(DIST_EXTRA[dsym]);
      if (d > out.n) throw new Error('거리가 이미 푼 데이터보다 멀다');
      out.need(len);
      var from = out.n - d;
      for (var i = 0; i < len; i++) out.b[out.n++] = out.b[from + i];
    }
  }

  function dynamicTables(br) {
    var nlen = br.bits(5) + 257, ndist = br.bits(5) + 1, ncode = br.bits(4) + 4;
    if (nlen > 286 || ndist > 30) throw new Error('부호 개수가 너무 많다');
    var clens = new Uint8Array(19), i;
    for (i = 0; i < ncode; i++) clens[CLEN_ORDER[i]] = br.bits(3);
    var clenHuff = new Huffman(clens, 19);
    var lengths = new Uint8Array(nlen + ndist);
    i = 0;
    while (i < nlen + ndist) {
      var sym = decodeSym(br, clenHuff), len, rep;
      if (sym < 16) { lengths[i++] = sym; continue; }
      if (sym === 16) {
        if (i === 0) throw new Error('반복할 앞 부호가 없다');
        len = lengths[i - 1]; rep = 3 + br.bits(2);
      } else if (sym === 17) { len = 0; rep = 3 + br.bits(3); }
      else { len = 0; rep = 11 + br.bits(7); }
      if (i + rep > nlen + ndist) throw new Error('부호 길이 목록이 넘쳤다');
      while (rep--) lengths[i++] = len;
    }
    return {
      lit: new Huffman(lengths.subarray(0, nlen), nlen),
      dist: new Huffman(lengths.subarray(nlen), ndist)
    };
  }

  /* ---------- 본체: raw deflate 풀기 ------------------------------------ */
  function inflateRaw(bytes, sizeHint) {
    var br = new BitReader(bytes);
    var out = new Out(sizeHint || bytes.length * 4);
    var blocks = 0;
    for (;;) {
      var last = br.bits(1);
      var type = br.bits(2);
      blocks++;
      if (type === 0) {
        br.align();
        if (br.pos + 4 > bytes.length) throw new Error('저장 블록 머리가 잘렸다');
        var len = bytes[br.pos] | (bytes[br.pos + 1] << 8);
        var nlen = bytes[br.pos + 2] | (bytes[br.pos + 3] << 8);
        br.pos += 4;
        if ((len ^ 0xffff) !== nlen) throw new Error('저장 블록 길이 검사가 어긋났다');
        if (br.pos + len > bytes.length) throw new Error('저장 블록 내용이 잘렸다');
        out.need(len);
        out.b.set(bytes.subarray(br.pos, br.pos + len), out.n);
        out.n += len; br.pos += len;
      } else if (type === 1) {
        buildFixed();
        codes(br, out, fixedLit, fixedDist);
      } else if (type === 2) {
        var t = dynamicTables(br);
        codes(br, out, t.lit, t.dist);
      } else {
        throw new Error('알 수 없는 블록 종류 3');
      }
      if (last) break;
      if (blocks > 1 << 20) throw new Error('블록이 너무 많다');
    }
    return { data: out.done(), consumed: br.pos, blocks: blocks };
  }

  /* zlib 헤더(0x78 …)가 붙어 있으면 벗겨 낸다.
   * HWP는 raw deflate지만, 실무에서 두 형태를 다 만난다. */
  function inflateAuto(bytes, sizeHint) {
    var looksZlib = bytes.length > 2 && (bytes[0] & 0x0f) === 8 &&
                    ((bytes[0] << 8) + bytes[1]) % 31 === 0;
    if (looksZlib) {
      try { return Object.assign(inflateRaw(bytes.subarray(2), sizeHint), { zlibHeader: true }); }
      catch (e) { /* 아래에서 raw 로 다시 시도 */ }
    }
    return Object.assign(inflateRaw(bytes, sizeHint), { zlibHeader: false });
  }

  /* ---------- 압축 (고정 허프만 + LZ77) ---------------------------------
   * 샘플 파일을 만들 때 쓴다. zlib만큼 잘 줄이지는 않지만, 진짜
   * deflate 스트림이라 표준 도구로도 풀린다.                            */
  function BitWriter() { this.b = []; this.val = 0; this.bit = 0; }
  BitWriter.prototype.put = function (v, n) {          /* LSB 먼저 */
    this.val |= (v & ((1 << n) - 1)) << this.bit;
    this.bit += n;
    while (this.bit >= 8) { this.b.push(this.val & 0xff); this.val >>>= 8; this.bit -= 8; }
  };
  BitWriter.prototype.putRev = function (code, n) {    /* 허프만 부호는 MSB 먼저 */
    for (var i = n - 1; i >= 0; i--) this.put((code >>> i) & 1, 1);
  };
  BitWriter.prototype.finish = function () {
    if (this.bit) this.b.push(this.val & 0xff);
    return new Uint8Array(this.b);
  };

  /* 고정 허프만의 리터럴/길이 부호 (RFC 1951 §3.2.6) */
  function litCode(sym) {
    if (sym < 144) return { code: 0x30 + sym, bits: 8 };
    if (sym < 256) return { code: 0x190 + sym - 144, bits: 9 };
    if (sym < 280) return { code: sym - 256, bits: 7 };
    return { code: 0xc0 + sym - 280, bits: 8 };
  }
  function lenSym(len) {
    for (var i = 28; i >= 0; i--) if (len >= LEN_BASE[i]) return i;
    return 0;
  }
  function distSym(d) {
    for (var i = 29; i >= 0; i--) if (d >= DIST_BASE[i]) return i;
    return 0;
  }

  /* 줄지 않는 데이터는 "저장 블록"으로 그냥 담는다.
   * 진짜 deflate 도 똑같이 한다 — 압축이 손해면 압축하지 않는다. */
  function storedRaw(data) {
    var out = [], p = 0;
    do {
      var n = Math.min(65535, data.length - p);
      var last = (p + n >= data.length) ? 1 : 0;
      out.push(last);                       /* BFINAL=last, BTYPE=00 → 1바이트로 정렬 */
      out.push(n & 0xff, (n >>> 8) & 0xff);
      out.push(~n & 0xff, (~n >>> 8) & 0xff);
      for (var i = 0; i < n; i++) out.push(data[p + i]);
      p += n;
    } while (p < data.length);
    return new Uint8Array(out);
  }

  function deflateRaw(data) {
    var packed = deflateFixed(data);
    var stored = storedRaw(data);
    return packed.length <= stored.length ? packed : stored;
  }

  function deflateFixed(data) {
    var bw = new BitWriter();
    bw.put(1, 1);   /* 마지막 블록 */
    bw.put(1, 2);   /* 고정 허프만 */

    /* 해시 체인으로 최근 일치를 찾는다 (창 32KB, 탐색 깊이 제한) */
    var head = new Int32Array(1 << 15).fill(-1);
    var prev = new Int32Array(data.length).fill(-1);
    var hash = function (i) {
      return ((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & 0x7fff;
    };
    var i = 0;
    while (i < data.length) {
      var bestLen = 0, bestDist = 0;
      if (i + 3 <= data.length) {
        var h = hash(i), j = head[h], depth = 0;
        while (j >= 0 && depth++ < 32 && i - j <= 32768) {
          var l = 0;
          while (l < 258 && i + l < data.length && data[j + l] === data[i + l]) l++;
          if (l > bestLen) { bestLen = l; bestDist = i - j; if (l >= 258) break; }
          j = prev[j];
        }
      }
      if (bestLen >= 3) {
        var ls = lenSym(bestLen), lc = litCode(257 + ls);
        bw.putRev(lc.code, lc.bits);
        bw.put(bestLen - LEN_BASE[ls], LEN_EXTRA[ls]);
        var ds = distSym(bestDist);
        bw.putRev(ds, 5);
        bw.put(bestDist - DIST_BASE[ds], DIST_EXTRA[ds]);
        for (var k = 0; k < bestLen; k++) {
          if (i + k + 3 <= data.length) { var hh = hash(i + k); prev[i + k] = head[hh]; head[hh] = i + k; }
        }
        i += bestLen;
      } else {
        var c = litCode(data[i]);
        bw.putRev(c.code, c.bits);
        if (i + 3 <= data.length) { var h2 = hash(i); prev[i] = head[h2]; head[h2] = i; }
        i++;
      }
    }
    var e = litCode(256);
    bw.putRev(e.code, e.bits);
    return bw.finish();
  }

  /* ---------- CRC-32 (RFC 1952) ------------------------------------------
   * 한글은 압축 데이터 뒤에 8바이트를 덧붙인다: CRC-32 + 원본 길이.
   * gzip 꼬리에서 머리만 뗀 모양이다. 명세에는 없고, 읽는 쪽도 보지 않는다. */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  root.Inflate = {
    inflateRaw: inflateRaw, inflateAuto: inflateAuto, deflateRaw: deflateRaw, crc32: crc32
  };
})(typeof window !== 'undefined' ? window : globalThis);
