/* =====================================================================
 * cfb-build.js — 진짜 CFB 파일을 바이트 단위로 만들어 내는 작성기(writer)
 *
 * 이 시각화는 "그림"이 아니라 실제 바이트를 보여 준다. 여기서 만든
 * Uint8Array를 파서가 다시 읽어서 화면을 그린다. 즉 화면에 보이는 모든
 * 오프셋과 값은 실제로 파일 안에 존재한다.
 * ===================================================================== */
(function (root) {
  'use strict';

  var C = root.CFBConst;
  var RB = root.RBTree;

  /* ---------- 저수준 쓰기 도우미 -------------------------------------- */
  function W(buf) { this.b = buf; }
  W.prototype.u8  = function (o, v) { this.b[o] = v & 0xff; };
  W.prototype.u16 = function (o, v) { this.b[o] = v & 0xff; this.b[o + 1] = (v >>> 8) & 0xff; };
  W.prototype.u32 = function (o, v) {
    v = v >>> 0;
    this.b[o] = v & 0xff; this.b[o + 1] = (v >>> 8) & 0xff;
    this.b[o + 2] = (v >>> 16) & 0xff; this.b[o + 3] = (v >>> 24) & 0xff;
  };
  W.prototype.u64 = function (o, lo, hi) { this.u32(o, lo); this.u32(o + 4, hi); };
  W.prototype.bytes = function (o, arr) { for (var i = 0; i < arr.length; i++) this.b[o + i] = arr[i]; };
  W.prototype.utf16 = function (o, s, maxBytes) {
    for (var i = 0; i < s.length && i * 2 + 1 < maxBytes; i++) this.u16(o + i * 2, s.charCodeAt(i));
  };
  /* GUID "00020906-0000-0000-C000-000000000046" → CFB의 혼합 엔디언 배치 */
  W.prototype.guid = function (o, g) {
    if (!g) return;
    var h = g.replace(/[{}-]/g, '');
    var b = [];
    for (var i = 0; i < 16; i++) b.push(parseInt(h.substr(i * 2, 2), 16));
    this.bytes(o, [b[3], b[2], b[1], b[0], b[5], b[4], b[7], b[6],
                   b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]]);
  };

  /* FILETIME: 1601-01-01 UTC 부터 100ns 단위 */
  function filetime(ms) {
    var t = BigInt(ms) * 10000n + 116444736000000000n;
    return { lo: Number(t & 0xffffffffn) >>> 0, hi: Number((t >> 32n) & 0xffffffffn) >>> 0 };
  }

  /* ---------- 스트림 내용 생성 ----------------------------------------
   * 내용을 아무 값으로나 채우지 않는다. 각 섹터를 열었을 때 "이 섹터는
   * 어느 스트림의 몇 번째 바이트인가"가 hex 뷰에 그대로 읽히도록,
   * 자기 자신을 설명하는 텍스트로 채운다.                                 */
  function ascii(s) {
    var a = [];
    for (var i = 0; i < s.length; i++) a.push(s.charCodeAt(i) & 0xff);
    return a;
  }
  function hex6(n) { return ('00000' + n.toString(16).toUpperCase()).slice(-6); }

  function makeContent(label, size, magic, utf16Text) {
    var out = new Uint8Array(size);
    var p = 0;
    if (magic) { for (var i = 0; i < magic.length && p < size; i++) out[p++] = magic[i]; }
    if (utf16Text) {
      /* 실제 Word 문서처럼 UTF-16LE 텍스트를 넣는다.
         hex 뷰에서 ASCII 글자 사이사이에 00이 끼는 특징을 눈으로 볼 수 있다. */
      while (p + 1 < size) {
        for (var j = 0; j < utf16Text.length && p + 1 < size; j++) {
          var cc = utf16Text.charCodeAt(j);
          out[p++] = cc & 0xff; out[p++] = (cc >>> 8) & 0xff;
        }
      }
      return out;
    }
    while (p < size) {
      var tag = '[' + label + ' +0x' + hex6(p) + '] ';
      var bytes = ascii(tag);
      for (var k = 0; k < bytes.length && p < size; k++) out[p++] = bytes[k];
      while (p < size && p % 32 !== 0) out[p++] = 0x2e; /* '.' 로 32바이트 경계까지 채움 */
    }
    return out;
  }

  /* ---------- 샘플 문서 정의 ------------------------------------------
   * 실제 Word 97-2003 .doc 파일의 내부 구조를 그대로 본떴다.             */
  function sampleSpec() {
    return {
      name: 'Root Entry',
      clsid: '00020906-0000-0000-C000-000000000046', /* Word.Document.8 */
      storage: true,
      children: [
        { name: 'WordDocument', size: 8192, magic: [0xec, 0xa5, 0xc1, 0x00],
          utf16: '컴파운드 파일은 파일 안의 파일시스템이다. ',
          note: 'Word 본문. 앞 4바이트 EC A5 C1 00은 FIB(File Information Block)의 서명이다.' },
        { name: '1Table', size: 5120,
          note: '서식·스타일 표. WordDocument와 짝을 이룬다.' },
        { name: 'Data', size: 2048,
          note: '그림 등 이진 데이터. 4096보다 작으므로 미니 스트림으로 간다.' },
        { name: '\u0005SummaryInformation', size: 4096, magic: [0xfe, 0xff, 0x00, 0x00],
          note: '제목·작성자 등 속성 집합. 크기가 정확히 4096이라 미니가 아니라 일반 섹터에 저장된다.' },
        { name: '\u0005DocumentSummaryInformation', size: 200, magic: [0xfe, 0xff, 0x00, 0x00],
          note: '회사·범주 등 확장 속성. 0x05 접두사는 속성 집합 스트림의 관례다.' },
        { name: 'ObjectPool', storage: true, children: [
          { name: '_1234567890', storage: true, children: [
            { name: '\u0001Ole', size: 20 },
            { name: '\u0001CompObj', size: 108 }
          ] }
        ], note: '문서에 삽입된 OLE 개체들이 사는 저장소. 여기가 "문서 안의 문서"다.' },
        { name: 'Macros', storage: true, children: [
          { name: 'PROJECT', size: 380 },
          { name: 'VBA', storage: true, children: [
            { name: 'ThisDocument', size: 1024 },
            { name: '_VBA_PROJECT', size: 2560 }
          ] }
        ], note: 'VBA 매크로. 매크로 악성코드 분석이 항상 여기부터 시작하는 이유다.' }
      ]
    };
  }

  /* ---------- 트리 평탄화 + SID 배정 ----------------------------------- */
  function flatten(spec) {
    var entries = [];
    function visit(node, parentSid) {
      var e = {
        sid: entries.length,
        name: node.name,
        type: node.storage ? (entries.length === 0 ? C.TYPE_ROOT : C.TYPE_STORAGE) : C.TYPE_STREAM,
        clsid: node.clsid || null,
        size: node.size || 0,
        magic: node.magic || null,
        utf16: node.utf16 || null,
        note: node.note || '',
        childSpecs: node.children || [],
        parentSid: parentSid,
        left: C.NOSTREAM, right: C.NOSTREAM, child: C.NOSTREAM,
        color: C.COLOR_BLACK,
        start: C.ENDOFCHAIN
      };
      entries.push(e);
      (node.children || []).forEach(function (c) { visit(c, e.sid); });
      return e;
    }
    visit(spec, -1);
    return entries;
  }

  /* ---------- 각 저장소의 자식들을 레드-블랙 트리로 묶는다 ---------------- */
  function buildTrees(entries) {
    var trees = {};
    entries.forEach(function (e) {
      if (e.type !== C.TYPE_STORAGE && e.type !== C.TYPE_ROOT) return;
      var kids = entries.filter(function (k) { return k.parentSid === e.sid; });
      if (!kids.length) return;
      var t = new RB.Tree();
      kids.forEach(function (k) { t.insert(k.name, k); });
      trees[e.sid] = t;
      e.child = t.root.payload.sid;
      t.all().forEach(function (n) {
        var ent = n.payload;
        ent.color = n.color === RB.BLACK ? C.COLOR_BLACK : C.COLOR_RED;
        ent.left  = n.left ? n.left.payload.sid : C.NOSTREAM;
        ent.right = n.right ? n.right.payload.sid : C.NOSTREAM;
      });
    });
    return trees;
  }

  /* ---------- 본체: 명세 → 바이트 ---------------------------------------- */
  function compose(opts) {
    opts = opts || {};
    var major = opts.major || 3;
    var SS = major >= 4 ? 4096 : 512;              /* 섹터 크기 */
    var MS = C.MINI_SECTOR_SIZE;                   /* 미니 섹터 크기 = 64 */
    var CUTOFF = C.DEFAULT_MINI_CUTOFF;
    var FAT_PER_SECT = SS / 4;
    var DIR_PER_SECT = SS / C.DIR_ENTRY_SIZE;
    var MINI_PER_SECT = SS / MS;

    var spec = opts.spec || sampleSpec();
    var entries = flatten(spec);
    var trees = buildTrees(entries);

    /* 1) 스트림 내용 생성 + 미니/일반 분류 -------------------------------- */
    var plan = { decisions: [], miniStreams: [], bigStreams: [] };
    entries.forEach(function (e) {
      if (e.type !== C.TYPE_STREAM) return;
      var label = e.name.replace(/[\u0000-\u001f]/g, function (c) {
        return '\\x0' + c.charCodeAt(0).toString(16);
      });
      e.content = makeContent(label, e.size, e.magic, e.utf16);
      e.isMini = e.size > 0 && e.size < CUTOFF;
      plan.decisions.push({
        sid: e.sid, name: e.name, size: e.size, mini: e.isMini,
        why: e.size === 0 ? '길이 0 → 섹터를 하나도 쓰지 않는다'
           : e.isMini ? e.size + ' < ' + CUTOFF + ' → 미니 스트림'
                      : e.size + ' >= ' + CUTOFF + ' → 일반 섹터'
      });
      (e.isMini ? plan.miniStreams : plan.bigStreams).push(e);
    });

    /* 2) 미니 스트림 조립: 작은 스트림들을 64바이트 단위로 이어 붙인다 ------- */
    var miniSectors = 0;
    plan.miniStreams.forEach(function (e) {
      e.miniStart = miniSectors;
      e.miniCount = Math.ceil(e.size / MS);
      miniSectors += e.miniCount;
    });
    var miniStreamLen = miniSectors * MS;
    var miniStream = new Uint8Array(miniStreamLen);
    plan.miniStreams.forEach(function (e) {
      miniStream.set(e.content, e.miniStart * MS);
    });

    /* 3) 섹터 수 계산 ---------------------------------------------------- */
    var nDirSect = Math.ceil(entries.length / DIR_PER_SECT);
    var nMiniFatSect = miniSectors ? Math.ceil((miniSectors * 4) / SS) : 0;
    var nMiniStreamSect = Math.ceil(miniStreamLen / SS);
    var bigSectTotal = 0;
    plan.bigStreams.forEach(function (e) {
      e.sectCount = Math.ceil(e.size / SS);
      bigSectTotal += e.sectCount;
    });

    var nonFat = nDirSect + nMiniFatSect + nMiniStreamSect + bigSectTotal;
    /* FAT 자신도 FAT에 자리를 차지한다 → 수렴할 때까지 반복 */
    var nFat = 1, nDifat = 0, total;
    for (var iter = 0; iter < 64; iter++) {
      total = nonFat + nFat + nDifat;
      var needFat = Math.max(1, Math.ceil(total / FAT_PER_SECT));
      var needDifat = needFat > C.HEADER_DIFAT_LEN
        ? Math.ceil((needFat - C.HEADER_DIFAT_LEN) / (FAT_PER_SECT - 1)) : 0;
      if (needFat === nFat && needDifat === nDifat) break;
      nFat = needFat; nDifat = needDifat;
    }
    total = nonFat + nFat + nDifat;

    /* 4) 섹터 배치 --------------------------------------------------------
     * 메타데이터를 앞쪽에 모으고 데이터를 뒤에 둔다. (Apache POI 등이 쓰는
     * 순서와 비슷하다. 명세는 순서를 강제하지 않으므로 작성기마다 다르다.) */
    var next = 0;
    var fatSects = [], difatSects = [], dirSects = [], miniFatSects = [], miniSects = [];
    for (var i = 0; i < nFat; i++) fatSects.push(next++);
    for (i = 0; i < nDifat; i++) difatSects.push(next++);
    for (i = 0; i < nDirSect; i++) dirSects.push(next++);
    for (i = 0; i < nMiniFatSect; i++) miniFatSects.push(next++);
    for (i = 0; i < nMiniStreamSect; i++) miniSects.push(next++);
    plan.bigStreams.forEach(function (e) {
      e.sects = [];
      for (var j = 0; j < e.sectCount; j++) e.sects.push(next++);
    });

    /* 5) FAT / MiniFAT 채우기 ---------------------------------------------- */
    var fat = new Uint32Array(nFat * FAT_PER_SECT).fill(C.FREESECT);
    function chain(list) {
      for (var i = 0; i < list.length; i++) {
        fat[list[i]] = i === list.length - 1 ? C.ENDOFCHAIN : list[i + 1];
      }
    }
    fatSects.forEach(function (s) { fat[s] = C.FATSECT; });
    difatSects.forEach(function (s) { fat[s] = C.DIFSECT; });
    chain(dirSects);
    chain(miniFatSects);
    chain(miniSects);
    plan.bigStreams.forEach(function (e) { chain(e.sects); });

    var minifat = new Uint32Array(nMiniFatSect * FAT_PER_SECT).fill(C.FREESECT);
    plan.miniStreams.forEach(function (e) {
      for (var i = 0; i < e.miniCount; i++) {
        var m = e.miniStart + i;
        minifat[m] = i === e.miniCount - 1 ? C.ENDOFCHAIN : m + 1;
      }
    });

    /* 6) 디렉터리 엔트리에 시작 위치 기록 ------------------------------------ */
    entries[0].start = miniSectors ? miniSects[0] : C.ENDOFCHAIN;
    entries[0].size = miniStreamLen;   /* 루트 엔트리의 크기 = 미니 스트림 길이 */
    plan.bigStreams.forEach(function (e) { e.start = e.sects[0]; });
    plan.miniStreams.forEach(function (e) { e.start = e.miniStart; });

    /* 7) 직렬화 ------------------------------------------------------------- */
    var fileLen = SS === 512 ? 512 + total * SS : SS + total * SS;
    var buf = new Uint8Array(fileLen);
    var w = new W(buf);
    var sectOff = function (s) { return (s + 1) * SS; };

    /* --- 헤더 --- */
    w.bytes(0x00, C.SIGNATURE);
    w.u16(0x18, 0x003e);
    w.u16(0x1a, major);
    w.u16(0x1c, 0xfffe);
    w.u16(0x1e, major >= 4 ? 12 : 9);
    w.u16(0x20, C.MINI_SECTOR_SHIFT);
    w.u32(0x28, major >= 4 ? nDirSect : 0);
    w.u32(0x2c, nFat);
    w.u32(0x30, dirSects[0]);
    w.u32(0x34, 0);
    w.u32(0x38, CUTOFF);
    w.u32(0x3c, nMiniFatSect ? miniFatSects[0] : C.ENDOFCHAIN);
    w.u32(0x40, nMiniFatSect);
    w.u32(0x44, nDifat ? difatSects[0] : C.ENDOFCHAIN);
    w.u32(0x48, nDifat);
    for (i = 0; i < C.HEADER_DIFAT_LEN; i++) {
      w.u32(C.HEADER_DIFAT_OFF + i * 4, i < Math.min(nFat, C.HEADER_DIFAT_LEN) ? fatSects[i] : C.FREESECT);
    }

    /* --- DIFAT 섹터 (109개를 넘을 때만) --- */
    difatSects.forEach(function (ds, idx) {
      var base = sectOff(ds);
      var perSect = FAT_PER_SECT - 1;
      for (var k = 0; k < perSect; k++) {
        var fatIdx = C.HEADER_DIFAT_LEN + idx * perSect + k;
        w.u32(base + k * 4, fatIdx < nFat ? fatSects[fatIdx] : C.FREESECT);
      }
      w.u32(base + perSect * 4, idx + 1 < difatSects.length ? difatSects[idx + 1] : C.ENDOFCHAIN);
    });

    /* --- FAT 섹터 --- */
    fatSects.forEach(function (fs, idx) {
      var base = sectOff(fs);
      for (var k = 0; k < FAT_PER_SECT; k++) w.u32(base + k * 4, fat[idx * FAT_PER_SECT + k]);
    });

    /* --- MiniFAT 섹터 --- */
    miniFatSects.forEach(function (ms2, idx) {
      var base = sectOff(ms2);
      for (var k = 0; k < FAT_PER_SECT; k++) w.u32(base + k * 4, minifat[idx * FAT_PER_SECT + k]);
    });

    /* --- 디렉터리 섹터 --- */
    var ft = filetime(opts.timestamp || Date.UTC(2003, 3, 15, 9, 30, 0));
    var dirBase = sectOff(dirSects[0]);
    /* 디렉터리 섹터들은 연속 배치했으므로 한 번에 쓸 수 있다 */
    for (i = 0; i < nDirSect * DIR_PER_SECT; i++) {
      var o = dirBase + i * C.DIR_ENTRY_SIZE;
      var e = entries[i];
      if (!e) { w.u32(o + 0x44, C.NOSTREAM); w.u32(o + 0x48, C.NOSTREAM); w.u32(o + 0x4c, C.NOSTREAM); continue; }
      w.utf16(o, e.name, 64);
      w.u16(o + 0x40, (e.name.length + 1) * 2);
      w.u8(o + 0x42, e.type);
      w.u8(o + 0x43, e.color);
      w.u32(o + 0x44, e.left);
      w.u32(o + 0x48, e.right);
      w.u32(o + 0x4c, e.child);
      if (e.clsid) w.guid(o + 0x50, e.clsid);
      w.u32(o + 0x60, 0);
      if (e.type === C.TYPE_ROOT || e.type === C.TYPE_STORAGE) {
        w.u64(o + 0x64, ft.lo, ft.hi);
        w.u64(o + 0x6c, ft.lo, ft.hi);
      }
      w.u32(o + 0x74, e.start);
      w.u64(o + 0x78, e.size >>> 0, 0);
    }

    /* --- 미니 스트림 --- */
    if (miniSects.length) buf.set(miniStream, sectOff(miniSects[0]));
    /* --- 큰 스트림 --- */
    plan.bigStreams.forEach(function (e) { buf.set(e.content, sectOff(e.sects[0])); });

    return {
      bytes: buf,
      plan: {
        sectorSize: SS, miniSectorSize: MS, cutoff: CUTOFF, major: major,
        totals: {
          total: total, fat: nFat, difat: nDifat, dir: nDirSect,
          minifat: nMiniFatSect, miniStreamSect: nMiniStreamSect,
          bigData: bigSectTotal, miniSectors: miniSectors, entries: entries.length
        },
        regions: { fat: fatSects, difat: difatSects, dir: dirSects, minifat: miniFatSects, mini: miniSects },
        decisions: plan.decisions,
        notes: entries.reduce(function (m, e) { if (e.note) m[e.name] = e.note; return m; }, {}),
        trees: trees
      }
    };
  }

  root.CFBBuild = { compose: compose, sampleSpec: sampleSpec, filetime: filetime, makeContent: makeContent };
})(typeof window !== 'undefined' ? window : globalThis);
