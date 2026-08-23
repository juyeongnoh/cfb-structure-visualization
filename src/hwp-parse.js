/* =====================================================================
 * hwp-parse.js — 계측된 HWP 5.0 리더
 *
 * 입력은 이미 파싱된 CFB다. 여기서는 그 위에 얹힌 HWP 층만 다룬다:
 *   FileHeader 읽기 → 압축 풀기 → 레코드로 자르기 → 레벨로 트리 만들기
 * CFB 파서와 마찬가지로 "무엇을 왜 읽었는가"를 단계로 남긴다.
 * ===================================================================== */
(function (root) {
  'use strict';

  var H = root.HWPConst;

  /* 압축 대상 판정 — FileHeader·미리보기·속성집합은 절대 압축하지 않는다 */
  function isCompressible(path) {
    return /^\/(DocInfo|BodyText\/|ViewText\/|BinData\/|Scripts\/|XMLTemplate\/|DocHistory\/)/.test(path);
  }

  /* ---------- 레코드로 자르기 ------------------------------------------ */
  function parseRecords(bytes, warn, label) {
    var recs = [], p = 0;
    if (!bytes.length) return { records: recs, trailing: 0 };
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var guard = 0;
    while (p + 4 <= bytes.length && guard++ < 1000000) {
      var v = dv.getUint32(p, true);
      var u = H.unpack(v);
      var headerLen = 4, size = u.size, extended = false;
      if (size === H.SIZE_ESCAPE) {
        if (p + 8 > bytes.length) { warn.push(label + ': 확장 크기가 들어갈 자리가 없다'); break; }
        size = dv.getUint32(p + 4, true);
        headerLen = 8; extended = true;
      }
      if (p + headerLen + size > bytes.length) {
        warn.push(label + ': 레코드 ' + recs.length + '(' + H.tagName(u.tag) + ')의 크기 ' +
                  size + '가 스트림 밖을 가리킨다');
        break;
      }
      recs.push({
        index: recs.length, raw: v,
        tag: u.tag, level: u.level, size: size,
        headerOffset: p, headerLen: headerLen, payloadOffset: p + headerLen,
        extended: extended
      });
      p += headerLen + size;
      if (size === 0 && headerLen === 4 && v === 0) {
        /* 0으로 채워진 꼬리를 레코드로 오해하지 않는다 */
        recs.pop();
        break;
      }
    }
    return { records: recs, trailing: bytes.length - p };
  }

  /* ---------- 레벨로 트리 만들기 ----------------------------------------
   * CFB는 트리를 포인터로 그렸다. HWP는 아예 그리지 않는다 —
   * 각 레코드가 자기 깊이만 적어 두고, 읽는 쪽이 그것으로 트리를 세운다. */
  function buildTree(recs) {
    var roots = [], stack = [];
    recs.forEach(function (r) {
      r.children = [];
      while (stack.length && stack[stack.length - 1].level >= r.level) stack.pop();
      if (stack.length) { r.parentIndex = stack[stack.length - 1].index; stack[stack.length - 1].children.push(r); }
      else { r.parentIndex = -1; roots.push(r); }
      stack.push(r);
    });
    return roots;
  }

  /* ---------- PARA_TEXT 해석 --------------------------------------------
   * UTF-16LE 글자들 사이에 제어 문자가 섞여 있고, 제어 문자는 종류에 따라
   * 1글자 또는 8글자 자리를 차지한다. 이걸 모르면 글자가 깨진다.        */
  function readParaText(bytes) {
    var pieces = [], text = '';
    var i = 0;
    while (i + 1 < bytes.length) {
      var c = bytes[i] | (bytes[i + 1] << 8);
      if (c < 32) {
        var info = H.CTRL_CHARS[c] || { kind: 'char', name: '알 수 없음' };
        var w = H.ctrlWidth(c) * 2;
        if (i + w > bytes.length) w = bytes.length - i;
        pieces.push({ kind: 'ctrl', code: c, info: info, at: i, len: w });
        if (info.text) text += info.text;
        i += w;
      } else {
        var start = i, s = '';
        while (i + 1 < bytes.length) {
          var d = bytes[i] | (bytes[i + 1] << 8);
          if (d < 32) break;
          s += String.fromCharCode(d);
          i += 2;
        }
        pieces.push({ kind: 'text', text: s, at: start, len: i - start });
        text += s;
      }
    }
    return { pieces: pieces, text: text };
  }

  /* ---------- 본체 -------------------------------------------------------- */
  function parse(cfb) {
    var trace = [], warn = [];
    function step(o) { trace.push(o); return o; }

    if (!cfb || !cfb.ok) return { ok: false, error: 'CFB 컨테이너부터 읽히지 않는다.', trace: trace };

    /* --- 1. FileHeader 스트림 찾기 --- */
    var fhEntry = cfb.byPath['/FileHeader'];
    if (!fhEntry) {
      return { ok: false,
        error: 'CFB 파일이긴 한데 FileHeader 스트림이 없다. HWP 5.0 문서가 아니다.',
        trace: trace };
    }
    var fh = cfb.readStream(fhEntry);
    step({
      id: 'find', title: '1. 컨테이너 안에서 FileHeader 찾기',
      detail: '바깥은 평범한 CFB다. 루트 바로 아래 "FileHeader"라는 ' + fh.length + '바이트 스트림이 있으면 HWP 5.0일 가능성이 높다. ' +
              '이 스트림은 ' + (fhEntry.isMini ? '4096보다 작으므로 미니 스트림' : '일반 섹터') + '에 들어 있다.',
      sid: fhEntry.sid
    });

    /* --- 2. 시그니처 --- */
    var sigOk = true;
    for (var i = 0; i < H.SIGNATURE_TEXT.length; i++) {
      if (fh[i] !== H.SIGNATURE_TEXT.charCodeAt(i)) { sigOk = false; break; }
    }
    if (!sigOk) {
      return { ok: false,
        error: 'FileHeader의 첫 바이트가 "HWP Document File"이 아니다.',
        trace: trace };
    }
    step({
      id: 'sig', title: '2. HWP 시그니처 확인',
      detail: 'FileHeader의 첫 17바이트가 "HWP Document File"이다. ' +
              'CFB 시그니처(D0 CF 11 E0 …)는 파일의 맨 앞 8바이트고, 이건 그 안에 든 스트림의 첫 바이트다. ' +
              '서명이 두 층에 하나씩 있는 셈이다.',
      hwpBytes: [[0, 32]]
    });

    /* --- 3. 버전 --- */
    var version = { rev: fh[0x20], build: fh[0x21], minor: fh[0x22], major: fh[0x23] };
    version.text = version.major + '.' + version.minor + '.' + version.build + '.' + version.rev;
    step({
      id: 'ver', title: '3. 버전 읽기',
      detail: '+0x20의 4바이트를 리틀엔디언으로 읽으면 ' +
              [fh[0x20], fh[0x21], fh[0x22], fh[0x23]].map(function (b) {
                return ('0' + b.toString(16).toUpperCase()).slice(-2);
              }).join(' ') + ' → 버전 ' + version.text + '. ' +
              '디스크에 적힌 순서와 사람이 읽는 순서가 반대라 헷갈리기 쉽다.',
      hwpBytes: [[0x20, 4]]
    });

    /* --- 4. 속성 비트 --- */
    var dv = new DataView(fh.buffer, fh.byteOffset, fh.byteLength);
    var propRaw = fh.length >= 0x28 ? dv.getUint32(0x24, true) : 0;
    var props = {};
    H.PROP_BITS.forEach(function (b) { props[b.bit] = !!(propRaw & (1 << b.bit)); });
    var compressed = !!props[0], encrypted = !!props[1], distributed = !!props[2];
    var onBits = H.PROP_BITS.filter(function (b) { return props[b.bit]; });
    step({
      id: 'props', title: '4. 속성 비트 — 이 파일을 어떻게 읽어야 하는가',
      detail: '+0x24의 4바이트 = 0x' + ('00000000' + propRaw.toString(16).toUpperCase()).slice(-8) + '. ' +
              (onBits.length
                ? '켜진 비트: ' + onBits.map(function (b) { return b.bit + '번(' + b.name + ')'; }).join(', ') + '.'
                : '켜진 비트가 없다.') +
              (compressed ? ' 압축 비트가 켜져 있으므로 내용 스트림을 그냥 읽으면 쓰레기가 나온다.' : ''),
      hwpBytes: [[0x24, 4]]
    });
    if (encrypted) warn.push('암호가 걸린 문서다 — 내용을 풀 수 없다');
    if (distributed) warn.push('배포용 문서다 — BodyText 대신 ViewText가 있고 추가 복호화가 필요하다');

    /* --- 5. 스트림 훑기 --- */
    var streams = [];
    cfb.live.forEach(function (e) {
      if (e.type !== 2 || !e.path) return;
      var raw = cfb.readStream(e);
      var comp = compressed && isCompressible(e.path);
      var s = {
        path: e.path, displayPath: e.displayPath, sid: e.sid, entry: e,
        raw: raw, size: raw.length, compressed: comp,
        data: raw, error: null, inflated: null
      };
      if (comp && raw.length) {
        try {
          var r = root.Inflate.inflateAuto(raw);
          s.data = r.data;
          s.inflated = { from: raw.length, to: r.data.length, blocks: r.blocks, zlibHeader: r.zlibHeader };
        } catch (err) {
          s.error = '압축을 풀 수 없다: ' + err.message;
          s.data = new Uint8Array(0);
          warn.push(e.displayPath + ': ' + s.error);
        }
      }
      streams.push(s);
    });
    var compCount = streams.filter(function (s) { return s.compressed && !s.error; }).length;
    var before = streams.reduce(function (a, s) { return a + (s.compressed ? s.size : 0); }, 0);
    var after = streams.reduce(function (a, s) { return a + (s.compressed ? s.data.length : 0); }, 0);
    step({
      id: 'inflate', title: '5. 압축 풀기',
      detail: compressed
        ? '스트림 ' + compCount + '개를 풀었다. ' + before + '바이트 → ' + after + '바이트 (' +
          (before ? (after / before).toFixed(1) : '0') + '배). ' +
          'zlib 헤더 없는 raw deflate라, 파이썬이라면 zlib.decompress(data, -15)로 푼다. ' +
          'FileHeader와 미리보기 스트림은 압축 대상이 아니다 — 압축 여부를 FileHeader에서 읽어야 하니까.'
        : '압축 비트가 꺼져 있어 스트림을 그대로 쓴다.'
    });

    /* --- 6. 레코드로 자르기 --- */
    var recordStreams = streams.filter(function (s) {
      return /^\/(DocInfo|BodyText\/|ViewText\/)/.test(s.path) && !s.error;
    });
    recordStreams.forEach(function (s) {
      var r = parseRecords(s.data, warn, s.displayPath);
      s.records = r.records;
      s.trailing = r.trailing;
      s.tree = buildTree(r.records);
    });
    var totalRecs = recordStreams.reduce(function (a, s) { return a + s.records.length; }, 0);
    step({
      id: 'records', title: '6. 레코드로 자르기',
      detail: '스트림 ' + recordStreams.length + '개에서 레코드 ' + totalRecs + '개를 얻었다. ' +
              '레코드 하나는 4바이트 머리 + 내용이다. 머리 안에 태그 10비트, 레벨 10비트, 크기 12비트가 들어 있다. ' +
              '앞에서부터 크기만큼 건너뛰며 읽으면 끝까지 훑을 수 있다 — 목차도, 색인도 없다.'
    });

    /* --- 7. 레벨 → 트리 --- */
    var maxLevel = 0;
    recordStreams.forEach(function (s) {
      s.records.forEach(function (r) { if (r.level > maxLevel) maxLevel = r.level; });
    });
    step({
      id: 'tree', title: '7. 레벨로 트리 세우기',
      detail: 'CFB는 트리를 포인터(left/right/child)로 그려 두었다. HWP는 아예 그리지 않는다. ' +
              '레코드마다 "내 깊이는 얼마"만 적어 두고, 읽는 쪽이 앞에서부터 훑으며 트리를 세운다. ' +
              '이 파일의 최대 깊이는 ' + maxLevel + '이다.'
    });

    /* --- 8. 글자 뽑기 --- */
    var sections = recordStreams.filter(function (s) { return /^\/(BodyText|ViewText)\//.test(s.path); });
    var paragraphs = [];
    sections.forEach(function (s) {
      s.records.forEach(function (r) {
        if (H.tagName(r.tag) !== 'PARA_TEXT') return;
        var body = s.data.subarray(r.payloadOffset, r.payloadOffset + r.size);
        var t = readParaText(body);
        r.parsed = t;
        paragraphs.push({ stream: s.path, record: r, text: t.text, pieces: t.pieces });
      });
    });
    var text = paragraphs.map(function (p) { return p.text; }).join('\n');
    var ctrlCount = paragraphs.reduce(function (a, p) {
      return a + p.pieces.filter(function (x) { return x.kind === 'ctrl'; }).length;
    }, 0);
    step({
      id: 'text', title: '8. 글자 뽑아내기',
      detail: 'PARA_TEXT 레코드 ' + paragraphs.length + '개에서 글자 ' + text.length + '자를 얻었다. ' +
              '그 사이에 제어 문자 ' + ctrlCount + '개가 섞여 있었고, 그중 일부는 한 글자가 아니라 ' +
              '여덟 글자 자리를 차지한다. 이걸 모르고 UTF-16으로 그냥 디코드하면 글자가 어긋난다.'
    });

    var docInfo = streams.filter(function (s) { return s.path === '/DocInfo'; })[0] || null;

    return {
      ok: true, cfb: cfb, warn: warn, trace: trace,
      fileHeader: fh, fileHeaderEntry: fhEntry,
      version: version, propRaw: propRaw, props: props,
      compressed: compressed, encrypted: encrypted, distributed: distributed,
      streams: streams, recordStreams: recordStreams,
      docInfo: docInfo, sections: sections,
      paragraphs: paragraphs, text: text,
      maxLevel: maxLevel,
      readParaText: readParaText
    };
  }

  root.HWPParse = {
    parse: parse, parseRecords: parseRecords, buildTree: buildTree,
    readParaText: readParaText, isCompressible: isCompressible
  };
})(typeof window !== 'undefined' ? window : globalThis);
