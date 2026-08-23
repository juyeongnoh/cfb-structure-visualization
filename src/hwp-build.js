/* =====================================================================
 * hwp-build.js — 진짜 HWP 5.0 파일을 바이트 단위로 만드는 작성기
 *
 * 만드는 순서는 실제 한글이 저장할 때와 같다:
 *   레코드를 이어 붙여 스트림을 만든다
 *     → raw deflate 로 압축한다
 *       → CFB 컨테이너에 스트림으로 넣는다
 *
 * 레코드 머리(태그·레벨·크기 비트 우겨넣기)는 명세 그대로다. 페이로드는
 * 교육용으로 필요한 필드까지만 채우고 나머지는 0으로 둔다 — 채운 필드는
 * 화면에서 실제로 해석해 보여 주므로 정확해야 한다.
 * ===================================================================== */
(function (root) {
  'use strict';

  var H = root.HWPConst;

  /* ---------- 레코드 조립기 -------------------------------------------- */
  function Rec() { this.parts = []; this.total = 0; }
  Rec.prototype.add = function (tagName, level, payload) {
    var tag = null;
    for (var k in H.TAGS) if (H.TAGS[k].name === tagName) { tag = H.TAGS[k].id; break; }
    if (tag === null) throw new Error('모르는 태그: ' + tagName);
    payload = payload || new Uint8Array(0);
    var size = payload.length;
    var big = size >= H.SIZE_ESCAPE;          /* 12비트로 안 되면 확장 */
    var head = new Uint8Array(big ? 8 : 4);
    var hv = new DataView(head.buffer);
    hv.setUint32(0, H.pack(tag, level, big ? H.SIZE_ESCAPE : size), true);
    if (big) hv.setUint32(4, size, true);
    this.parts.push(head, payload);
    this.total += head.length + payload.length;
    return this;
  };
  Rec.prototype.bytes = function () {
    var out = new Uint8Array(this.total), p = 0;
    this.parts.forEach(function (b) { out.set(b, p); p += b.length; });
    return out;
  };

  /* ---------- 페이로드 짓기 도우미 --------------------------------------- */
  function Buf(n) { this.b = new Uint8Array(n); this.dv = new DataView(this.b.buffer); this.p = 0; }
  Buf.prototype.u8 = function (v) { this.b[this.p++] = v & 0xff; return this; };
  Buf.prototype.u16 = function (v) { this.dv.setUint16(this.p, v & 0xffff, true); this.p += 2; return this; };
  Buf.prototype.u32 = function (v) { this.dv.setUint32(this.p, v >>> 0, true); this.p += 4; return this; };
  Buf.prototype.i16 = function (v) { this.dv.setInt16(this.p, v, true); this.p += 2; return this; };
  Buf.prototype.wstr = function (s) {                    /* UINT16 길이 + UTF-16LE */
    this.u16(s.length);
    for (var i = 0; i < s.length; i++) this.u16(s.charCodeAt(i));
    return this;
  };
  Buf.prototype.skip = function (n) { this.p += n; return this; };
  Buf.prototype.done = function () { return this.b.slice(0, this.p); };

  function utf16le(s) {
    var b = new Uint8Array(s.length * 2), dv = new DataView(b.buffer);
    for (var i = 0; i < s.length; i++) dv.setUint16(i * 2, s.charCodeAt(i), true);
    return b;
  }
  /* 컨트롤 ID: 네 글자를 뒤집어 uint32 로 넣는다. hex 뷰에서 " lbt" 처럼 보인다. */
  function ctrlId(s) {
    return ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) |
            (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;
  }

  /* ---------- 문단 텍스트 만들기 -----------------------------------------
   * 제어 문자를 실제로 섞어 넣는다. 확장/인라인 컨트롤은 8글자(16바이트)
   * 자리를 차지하고 양 끝이 같은 제어 문자로 감싸인다.                    */
  function paraTextBytes(items) {
    var units = [];
    items.forEach(function (it) {
      if (typeof it === 'string') {
        for (var i = 0; i < it.length; i++) units.push(it.charCodeAt(i));
        return;
      }
      var code = it.ctrl;
      var w = H.ctrlWidth(code);
      if (w === 1) { units.push(code); return; }
      units.push(code);
      var info = it.info || [0, 0, 0, 0, 0, 0];
      for (var k = 0; k < 6; k++) units.push(info[k] || 0);
      units.push(code);                 /* 양 끝을 같은 제어 문자로 닫는다 */
    });
    var b = new Uint8Array(units.length * 2), dv = new DataView(b.buffer);
    units.forEach(function (u, i) { dv.setUint16(i * 2, u, true); });
    return { bytes: b, chars: units.length };
  }

  /* PARA_HEADER — 명세의 필드 순서 그대로.
   * 5.0.3.2 미만은 22바이트, 그 이상은 변경 추적 필드가 붙어 24바이트다. */
  function paraHeader(nChars, ctrlMask, paraShapeId, styleId, charShapeCount) {
    return new Buf(24)
      .u32(nChars)            /* 글자 수 */
      .u32(ctrlMask)          /* 제어 문자 마스크 */
      .u16(paraShapeId)       /* 문단 모양 번호 */
      .u8(styleId)            /* 스타일 번호 */
      .u8(0)                  /* 단 나누기 종류 */
      .u16(charShapeCount)    /* 글자 모양 정보 수 */
      .u16(0)                 /* 영역 태그 수 */
      .u16(1)                 /* 줄 정렬 정보 수 */
      .u32(0)                 /* 문단 인스턴스 ID */
      .u16(0)                 /* 변경 추적 병합 문단 */
      .done();
  }
  /* PARA_CHAR_SHAPE — (시작 위치, 글자모양 번호) 쌍의 배열, 원소 8바이트 */
  function paraCharShape(pairs) {
    var b = new Buf(pairs.length * 8);
    pairs.forEach(function (pr) { b.u32(pr[0]).u32(pr[1]); });
    return b.done();
  }
  function paraLineSeg(nChars) {
    /* 줄 하나짜리 배치 정보. 화면 배치용이라 글자 추출에는 쓰이지 않는다. */
    return new Buf(36).u32(0).u32(0).u32(1000).u32(1000).u32(1000).u32(0)
      .u32(41954).u32(41954).u32(0).done();
  }

  /* ---------- 샘플 문서 ---------------------------------------------------
   * 교재로 쓰려면 다음이 전부 들어 있어야 한다:
   *   · 레벨이 0에서 3까지 내려가는 중첩 (표 안의 문단)
   *   · 크기 4095를 넘겨 확장 헤더를 쓰는 레코드
   *   · 본문에 섞인 제어 문자 (탭, 표, 문단 끝)
   *   · 압축이 실제로 효과를 내는 반복 텍스트
   * ---------------------------------------------------------------------- */
  var FONTS = ['함초롬바탕', '함초롬돋움', 'HY헤드라인M', 'Times New Roman'];
  var PARAS = [
    { text: '한글 문서 파일 형식 5.0', shape: 1, style: 1 },
    { text: 'HWP 파일을 바이너리로 열면 가장 먼저 만나는 것은 D0 CF 11 E0이다. ' +
            'CFB 컴파운드 파일의 시그니처다. 즉 .hwp의 바깥 껍데기는 .doc와 똑같다.', shape: 0, style: 0 },
    { text: '다른 점은 그 안에 있다. 한글은 스트림 하나를 통째로 압축해 두고, ' +
            '압축을 풀면 "레코드"라는 두 번째 구조가 나온다.', shape: 0, style: 0 },
    { tab: true, text: '레코드는 4바이트 머리에 태그·레벨·크기를 우겨넣는다.', shape: 0, style: 0 },
    { table: true },
    { text: '아래 문단은 일부러 길게 만들었다. 레코드 크기가 12비트로 담을 수 있는 ' +
            '4095바이트를 넘으면, 머리 뒤에 4바이트 크기가 하나 더 붙는다.', shape: 0, style: 0 },
    { long: true, shape: 0, style: 0 }
  ];

  function buildDocInfo() {
    var r = new Rec();
    /* 문서 속성 — 구역 1개, 시작 번호들 */
    r.add('DOCUMENT_PROPERTIES', 0, new Buf(26)
      .u16(1)            /* 구역 개수 */
      .u16(1).u16(1).u16(1).u16(1).u16(1).u16(1)   /* 시작 쪽/각주/미주/그림/표/수식 번호 */
      .u32(0).u32(0).u32(0)                        /* 캐럿 위치 (list/para/pos) */
      .done());

    /* ID 매핑 — 뒤에 나올 정의들이 각각 몇 개인지 미리 센다 */
    var counts = [
      1,                    /* 바이너리 데이터 */
      FONTS.length, 0, 0, 0, 0, 0,   /* 한글/영문/한자/일어/기타/기호 글꼴 */
      0,                    /* 사용자 글꼴 */
      1,                    /* 테두리/배경 */
      2,                    /* 글자 모양 */
      1,                    /* 탭 정의 */
      0, 0,                 /* 번호 매기기 / 글머리표 */
      2,                    /* 문단 모양 */
      2                     /* 스타일 */
    ];
    var idb = new Buf(counts.length * 4);
    counts.forEach(function (c) { idb.u32(c); });
    r.add('ID_MAPPINGS', 0, idb.done());

    /* 삽입된 그림이 BinData의 몇 번 항목인지 */
    r.add('BIN_DATA', 0, new Buf(64).u16(0x0001).u16(1).wstr('png').done());

    /* 글꼴 정의 — 나오는 순서가 곧 번호다 */
    FONTS.forEach(function (f) {
      var b = new Buf(2 + 2 + f.length * 2 + 8);
      b.u8(0);            /* 속성 (대체 글꼴/글꼴 유형 정보 없음) */
      b.wstr(f);
      r.add('FACE_NAME', 0, b.done());
    });

    r.add('BORDER_FILL', 0, new Buf(40).u16(0).done());

    /* 글자 모양 두 벌 — 본문용과 제목용 */
    [[1000, 0x000000], [1600, 0x1b3a6b]].forEach(function (cs) {
      var b = new Buf(72);
      for (var i = 0; i < 7; i++) b.u16(0);     /* 언어별 글꼴 번호 7개 */
      for (i = 0; i < 7; i++) b.u8(100);        /* 장평 */
      for (i = 0; i < 7; i++) b.u8(0);          /* 자간 */
      for (i = 0; i < 7; i++) b.u8(100);        /* 상대 크기 */
      for (i = 0; i < 7; i++) b.u8(0);          /* 글자 위치 */
      b.u32(cs[0]);                             /* 기준 크기 (1/100 pt) */
      b.u32(cs[1] === 0 ? 0 : 1);               /* 속성 (굵게 등) */
      b.u8(0).u8(0);                            /* 그림자 간격 */
      b.u32(cs[1]);                             /* 글자 색 */
      r.add('CHAR_SHAPE', 0, b.done());
    });

    r.add('TAB_DEF', 0, new Buf(8).u32(0).u32(0).done());

    /* 문단 모양 두 벌 — 본문(양쪽)과 제목(가운데) */
    [0, 1].forEach(function (align) {
      var b = new Buf(54);
      b.u32(align === 1 ? (1 << 2) : 0);   /* 정렬 방식이 든 속성 비트 */
      b.u32(0).u32(0).u32(0);              /* 여백 */
      b.u32(160);                          /* 줄 간격 */
      b.u16(0).u16(0).u16(0).u16(0);       /* 탭/번호/테두리 참조 */
      r.add('PARA_SHAPE', 0, b.done());
    });

    ['바탕글', '제목'].forEach(function (name, i) {
      var b = new Buf(2 + name.length * 2 + 2 + 8 + 16);
      b.wstr(name); b.wstr(''); b.u8(0).u8(0);
      b.u16(i).u16(i);                      /* 문단 모양 / 글자 모양 번호 */
      r.add('STYLE', 0, b.done());
    });

    r.add('COMPATIBLE_DOCUMENT', 0, new Buf(4).u32(0).done());
    r.add('LAYOUT_COMPATIBILITY', 0, new Buf(20).u32(0).u32(0).u32(0).u32(0).u32(0).done());
    return r.bytes();
  }

  function buildSection() {
    var r = new Rec();
    /* 구역 첫 문단에 딸린 설정들 — 레벨 1로 매달린다 */
    r.add('PARA_HEADER', 0, paraHeader(1, 0, 0, 0, 1));
    r.add('PARA_TEXT', 1, paraTextBytes([{ ctrl: 2 }]).bytes);   /* 구역 정의 컨트롤 */
    r.add('PARA_CHAR_SHAPE', 1, paraCharShape([[0, 0]]));
    r.add('CTRL_HEADER', 1, new Buf(4).u32(ctrlId('dces')).done());
    r.add('PAGE_DEF', 2, new Buf(40)
      .u32(59528).u32(84188)                 /* 용지 가로/세로 (1/7200 인치) */
      .u32(8504).u32(8504).u32(5668).u32(4252).u32(4252).u32(0)
      .u32(0).u32(0).done());
    r.add('FOOTNOTE_SHAPE', 2, new Buf(30).u32(0).done());
    r.add('FOOTNOTE_SHAPE', 2, new Buf(30).u32(0).done());
    r.add('PAGE_BORDER_FILL', 2, new Buf(14).u32(0).done());
    r.add('PAGE_BORDER_FILL', 2, new Buf(14).u32(0).done());
    r.add('PAGE_BORDER_FILL', 2, new Buf(14).u32(0).done());
    r.add('PARA_LINE_SEG', 1, paraLineSeg(1));

    PARAS.forEach(function (para) {
      if (para.table) { addTable(r); return; }
      var items = [];
      if (para.tab) items.push({ ctrl: 9 });
      var body = para.long
        ? '레코드 크기 필드는 12비트뿐이라 4095바이트까지만 담을 수 있다. ' +
          '그보다 큰 레코드는 크기 자리에 0xFFF를 적어 두고, 진짜 크기를 뒤에 4바이트로 붙인다. ' +
          '이 문단은 그 경우를 실제로 만들기 위해 길게 늘여 둔 것이다. '
        : para.text;
      /* 4095바이트(=2047글자)를 확실히 넘겨 확장 헤더가 나오게 만든다 */
      if (para.long) { var rep = body; while (body.length * 2 < 5200) body += rep; }
      items.push(body);
      var t = paraTextBytes(items);
      r.add('PARA_HEADER', 0, paraHeader(t.chars, para.tab ? (1 << 9) : 0,
                                          para.shape || 0, para.style || 0, 1));
      r.add('PARA_TEXT', 1, t.bytes);
      r.add('PARA_CHAR_SHAPE', 1, paraCharShape([[0, para.style === 1 ? 1 : 0]]));
      r.add('PARA_LINE_SEG', 1, paraLineSeg(t.chars));
    });
    return r.bytes();
  }

  /* 표 — 레벨이 어떻게 깊어지는지 보여 주는 대목.
   * 본문 문단(0) → 컨트롤(1) → 표(2) → 칸(2) → 칸 안 문단(3) */
  function addTable(r) {
    var cells = [['구조', '무엇이 다른가'],
                 ['CFB', '이름 붙은 스트림, 포인터로 그린 트리'],
                 ['HWP 레코드', '번호 붙은 태그, 레벨로 세우는 트리']];
    var marker = paraTextBytes([{ ctrl: 11 }]);   /* 표가 본문에 끼어드는 자리 */
    r.add('PARA_HEADER', 0, paraHeader(marker.chars, 1 << 11, 0, 0, 1));
    r.add('PARA_TEXT', 1, marker.bytes);
    r.add('PARA_CHAR_SHAPE', 1, paraCharShape([[0, 0]]));
    r.add('CTRL_HEADER', 1, new Buf(20).u32(ctrlId('tbl ')).u32(0).u32(0).u32(0).u32(0).done());
    r.add('TABLE', 2, new Buf(24)
      .u32(0)                       /* 속성 */
      .u16(cells.length)            /* 행 수 */
      .u16(2)                       /* 열 수 */
      .u16(0).u16(0)                /* 셀 간격 / 안 여백 */
      .u16(cells.length).u16(2)
      .done());
    cells.forEach(function (row, ri) {
      row.forEach(function (text, ci) {
        r.add('LIST_HEADER', 2, new Buf(30)
          .u16(1)                   /* 이 칸에 든 문단 수 */
          .u32(0)                   /* 속성 */
          .u16(ci).u16(ri)          /* 열 / 행 주소 */
          .u16(1).u16(1)            /* 칸 병합 개수 */
          .u32(20000).u32(3000)     /* 칸 너비 / 높이 */
          .done());
        var t = paraTextBytes([text]);
        r.add('PARA_HEADER', 3, paraHeader(t.chars, 0, 0, 0, 1));
        r.add('PARA_TEXT', 4, t.bytes);
        r.add('PARA_CHAR_SHAPE', 4, paraCharShape([[0, 0]]));
        r.add('PARA_LINE_SEG', 4, paraLineSeg(t.chars));
      });
    });
    r.add('PARA_LINE_SEG', 1, paraLineSeg(marker.chars));
  }

  /* 가장 작은 유효 PNG (1×1 투명) — BinData 시연용 */
  var TINY_PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
  ]);

  function fileHeader(opts) {
    var b = new Uint8Array(H.FILEHEADER_SIZE);
    b.set(H.SIGNATURE, 0);
    var dv = new DataView(b.buffer);
    /* 버전 5.0.3.4 → 디스크에는 rev, build, minor, major 순으로 적힌다 */
    b[0x20] = 4; b[0x21] = 3; b[0x22] = 0; b[0x23] = 5;
    var props = 0;
    if (opts.compressed !== false) props |= 1 << 0;
    if (opts.hasScripts) props |= 1 << 3;
    dv.setUint32(0x24, props, true);
    dv.setUint32(0x28, 0, true);
    dv.setUint32(0x2c, 0, true);
    return b;
  }

  /* ---------- 본체 -------------------------------------------------------- */
  function compose(opts) {
    opts = opts || {};
    var compressed = opts.compressed !== false;
    var pack = function (bytes) {
      return compressed ? root.Inflate.deflateRaw(bytes) : bytes;
    };

    var docInfo = buildDocInfo();
    var section = buildSection();
    var prvText = utf16le(PARAS.filter(function (p) { return p.text; })
      .map(function (p) { return p.text; }).join('\n').slice(0, 500));

    var raw = { docInfo: docInfo, section: section };
    var spec = {
      name: 'Root Entry', storage: true,
      clsid: '00000000-0000-0000-0000-000000000000',
      children: [
        { name: 'FileHeader', content: fileHeader({ compressed: compressed }),
          note: 'HWP임을 알리는 256바이트. 절대 압축하지 않는다.' },
        { name: 'DocInfo', content: pack(docInfo),
          note: '문서 전체가 공유하는 정의들. 압축된 레코드 스트림.' },
        { name: 'BodyText', storage: true, children: [
          { name: 'Section0', content: pack(section),
            note: '본문. 문단 레코드가 줄줄이 들어 있다.' }
        ], note: '구역마다 SectionN 스트림이 하나씩.' },
        { name: 'BinData', storage: true, children: [
          { name: 'BIN0001.png', content: pack(TINY_PNG),
            note: '삽입된 그림. DocInfo의 BIN_DATA 레코드가 이 이름을 가리킨다.' }
        ] },
        { name: 'PrvText', content: prvText,
          note: '미리보기 텍스트. 평문 UTF-16LE — 압축도 암호화도 없다.' },
        { name: 'PrvImage', content: TINY_PNG, note: '미리보기 그림.' },
        { name: '\u0005HwpSummaryInformation', size: 400,
          magic: [0xfe, 0xff, 0x00, 0x00], note: '제목·작성자 등 속성 집합.' }
      ]
    };

    var built = root.CFBBuild.compose({
      major: opts.major || 3,
      timestamp: opts.timestamp || Date.UTC(2024, 2, 14, 10, 0, 0),
      spec: spec
    });
    return {
      bytes: built.bytes,
      plan: built.plan,
      rawStreams: raw,
      compressed: compressed
    };
  }

  root.HWPBuild = {
    compose: compose, buildDocInfo: buildDocInfo, buildSection: buildSection,
    fileHeader: fileHeader, paraTextBytes: paraTextBytes, ctrlId: ctrlId,
    Rec: Rec, Buf: Buf, utf16le: utf16le
  };
})(typeof window !== 'undefined' ? window : globalThis);
