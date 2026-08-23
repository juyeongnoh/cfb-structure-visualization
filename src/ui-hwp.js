/* =====================================================================
 * ui-hwp.js — HWP 장(章)들의 계기판
 *   headerPanel   : FileHeader 256바이트 + 속성 비트
 *   streamPanel   : 스트림 구성과 압축비
 *   bitsPanel     : 레코드 머리 4바이트의 비트 쪼개기  ← 이 페이지의 중심
 *   recordPanel   : 레코드 목록 · 레벨 트리 · 페이로드 해부
 *   textPanel     : 제어 문자를 걷어 내고 글자 뽑기
 *   walkPanel     : 읽기 워크스루
 *
 * 색은 앞 페이지의 세 계열을 그대로 이어 쓴다:
 *   주황 = 이름표(무엇인가) · 파랑 = 주소표(어디에 속하는가) · 청록 = 내용(얼마나)
 * ===================================================================== */
(function (root) {
  'use strict';
  var U = root.UI, el = U.el, svg = U.svg, H = root.HWPConst;

  function dvOf(b) { return new DataView(b.buffer, b.byteOffset, b.byteLength); }
  function wstr(b, off) {
    var dv = dvOf(b), n = dv.getUint16(off, true), s = '';
    for (var i = 0; i < n && off + 2 + i * 2 + 1 < b.length; i++) s += String.fromCharCode(dv.getUint16(off + 2 + i * 2, true));
    return { text: s, len: 2 + n * 2 };
  }

  /* ---------- 레코드 페이로드 해석 --------------------------------------
   * 모든 태그를 다 풀지는 않는다. 화면에 값을 보여 주는 것만 정확히 푼다. */
  function decode(tagName, b) {
    var dv = dvOf(b), f = [];
    var u32 = function (o) { return o + 4 <= b.length ? dv.getUint32(o, true) : null; };
    var u16 = function (o) { return o + 2 <= b.length ? dv.getUint16(o, true) : null; };
    var u8 = function (o) { return o < b.length ? b[o] : null; };
    var add = function (off, len, label, value, note) { f.push({ off: off, len: len, label: label, value: value, note: note }); };

    switch (tagName) {
      case 'DOCUMENT_PROPERTIES':
        add(0, 2, '구역 개수', u16(0), 'BodyText/SectionN 이 몇 개인지');
        add(2, 2, '시작 쪽 번호', u16(2));
        add(4, 2, '시작 각주 번호', u16(4));
        add(6, 2, '시작 미주 번호', u16(6));
        add(8, 2, '시작 그림 번호', u16(8));
        add(10, 2, '시작 표 번호', u16(10));
        add(12, 2, '시작 수식 번호', u16(12));
        add(14, 4, '캐럿 위치 (list)', u32(14));
        add(18, 4, '캐럿 위치 (para)', u32(18));
        add(22, 4, '캐럿 위치 (pos)', u32(22));
        break;
      case 'ID_MAPPINGS': {
        var names = ['바이너리 데이터', '한글 글꼴', '영문 글꼴', '한자 글꼴', '일어 글꼴',
                     '기타 글꼴', '기호 글꼴', '사용자 글꼴', '테두리/배경', '글자 모양',
                     '탭 정의', '번호 매기기', '글머리표', '문단 모양', '스타일',
                     '메모 모양', '변경 추적', '변경 추적 작성자'];
        for (var i = 0; i * 4 + 4 <= b.length; i++) {
          add(i * 4, 4, names[i] || ('슬롯 ' + i), u32(i * 4),
              i === 0 ? '이 개수가 곧 뒤따라올 레코드의 개수이자 배열 길이다' : '');
        }
        break;
      }
      case 'FACE_NAME': {
        add(0, 1, '속성', '0x' + (u8(0) || 0).toString(16).toUpperCase(), '대체 글꼴·글꼴 유형 정보가 붙어 있는지');
        var n = wstr(b, 1);
        add(1, n.len, '글꼴 이름', '"' + n.text + '"', '나오는 순서가 곧 이 글꼴의 번호다');
        break;
      }
      case 'CHAR_SHAPE':
        add(0, 14, '언어별 글꼴 번호 ×7', '한글·영문·한자·일어·기타·기호·사용자',
            'FACE_NAME 레코드의 등장 순서를 가리키는 번호');
        add(42, 4, '기준 크기', u32(42) !== null ? (u32(42) / 100) + ' pt' : null, '1/100 pt 단위');
        add(46, 4, '속성', u32(46) !== null ? '0x' + u32(46).toString(16) : null, '굵게·기울임·밑줄 등의 비트');
        add(52, 4, '글자 색', u32(52) !== null ? '#' + ('000000' + (u32(52) & 0xffffff).toString(16)).slice(-6) : null);
        break;
      case 'PARA_SHAPE':
        add(0, 4, '속성 1', u32(0) !== null ? '0x' + u32(0).toString(16) : null, '정렬 방식이 이 비트 안에 들어 있다');
        add(4, 4, '왼쪽 여백', u32(4));
        add(8, 4, '오른쪽 여백', u32(8));
        add(16, 4, '줄 간격', u32(16));
        break;
      case 'BIN_DATA': {
        var t = u16(0);
        add(0, 2, '속성', t !== null ? '0x' + t.toString(16).toUpperCase() +
            '  (종류 ' + (t & 0xf) + ', 압축 ' + ((t >> 4) & 3) + ')' : null,
            '하위 4비트 = 종류(0 연결·1 포함·2 스토리지), 비트 4~5 = 압축(0 기본·1 무조건·2 안 함)');
        add(2, 2, 'BinData 항목 번호', u16(2), 'BinData/BIN000N 의 N');
        var ext = wstr(b, 4);
        add(4, ext.len, '확장자', '"' + ext.text + '"');
        break;
      }
      case 'PARA_HEADER': {
        var raw = u32(0);
        var nch = raw === null ? null : (raw & 0x7fffffff);
        add(0, 4, '글자 수', nch === null ? null :
            nch + (raw & 0x80000000 ? '   (최상위 비트가 켜져 있다 — 목록의 마지막 문단)' : ''),
            '최상위 비트는 개수가 아니라 깃발이다. 0x7FFFFFFF 로 가려야 한다');
        add(4, 4, '컨트롤 마스크', u32(4) !== null ? '0x' + u32(4).toString(16) : null,
            '이 문단에 어떤 제어 문자가 들어 있는지의 비트 요약');
        add(8, 2, '문단 모양 번호', u16(8), 'DocInfo 의 PARA_SHAPE 배열 인덱스');
        add(10, 1, '스타일 번호', u8(10));
        add(11, 1, '단 나누기', u8(11));
        add(12, 2, '글자 모양 정보 수', u16(12), 'PARA_CHAR_SHAPE 의 원소 개수');
        add(14, 2, '영역 태그 수', u16(14));
        add(16, 2, '줄 정렬 정보 수', u16(16));
        add(18, 4, '문단 인스턴스 ID', u32(18));
        if (b.length >= 24) add(22, 2, '변경 추적 병합', u16(22), '5.0.3.2 이상에서만 있는 필드');
        break;
      }
      case 'PARA_CHAR_SHAPE':
        for (var k = 0; k * 8 + 8 <= b.length; k++) {
          add(k * 8, 8, '구간 ' + k,
              u32(k * 8) + '번째 글자부터 → 글자모양 ' + u32(k * 8 + 4) + '번',
              k === 0 ? '(시작 위치, 글자 모양 번호) 쌍이 8바이트씩' : '');
        }
        break;
      case 'CTRL_HEADER': {
        var id = u32(0);
        var chars = '';
        if (id !== null) {
          chars = String.fromCharCode((id >>> 24) & 0xff, (id >>> 16) & 0xff, (id >>> 8) & 0xff, id & 0xff);
        }
        var disk = chars.split('').reverse().join('');
        add(0, 4, '컨트롤 ID', '"' + chars + '"   (디스크에는 "' + disk + '" 순서로)',
            '논리적 이름은 tbl =표, secd=구역 정의, gso =그리기. 디스크에는 네 글자가 뒤집혀 놓인다');
        break;
      }
      case 'TABLE':
        add(0, 4, '속성', u32(0) !== null ? '0x' + u32(0).toString(16) : null);
        add(4, 2, '행 개수', u16(4));
        add(6, 2, '열 개수', u16(6));
        add(8, 2, '셀 간격', u16(8));
        break;
      case 'LIST_HEADER':
        add(0, 4, '문단 개수', u32(0),
            '뒤따라오는 "같은 레벨"의 PARA_HEADER 를 이만큼 세어 가면 이 칸에 속한 문단이다');
        add(4, 4, '속성', u32(4) !== null ? '0x' + u32(4).toString(16) : null);
        add(8, 2, '열 주소', u16(8));
        add(10, 2, '행 주소', u16(10));
        add(16, 4, '칸 너비', u32(16));
        break;
      case 'PAGE_DEF':
        add(0, 4, '용지 가로', u32(0) !== null ? (u32(0) / 7200).toFixed(2) + ' 인치' : null, '1/7200 인치 단위');
        add(4, 4, '용지 세로', u32(4) !== null ? (u32(4) / 7200).toFixed(2) + ' 인치' : null);
        add(8, 4, '왼쪽 여백', u32(8));
        add(12, 4, '오른쪽 여백', u32(12));
        break;
      default:
        return null;
    }
    return f.filter(function (x) { return x.value !== null && x.value !== undefined; });
  }

  /* ==================================================================
   * 0. 레코드 지도 — 레코드 스트림의 불꽃 그래프
   *
   * 가로는 스트림 안의 위치, 너비는 차지하는 바이트, 세로 칸은 레벨이다.
   * 레벨이 트리를 만든다는 말이 바로 이 그림이다: 위 칸의 레코드가
   * 아래 칸의 레코드들을 품는다.
   * ================================================================== */
  function familyOf(tagName) {
    if (/^PARA_(HEADER|TEXT|CHAR_SHAPE|LINE_SEG|RANGE_TAG)$/.test(tagName)) return 'para';
    if (/^(CTRL_HEADER|LIST_HEADER|TABLE|CTRL_DATA|SHAPE_|PAGE_|FOOTNOTE_|EQEDIT|FORM_)/.test(tagName)) return 'ctrl';
    return 'def';
  }
  var FAMILY_COLOR = { para: 'var(--c-data)', ctrl: 'var(--c-dir)', def: 'var(--c-table)' };
  var FAMILY_NAME = { para: '문단', ctrl: '컨트롤·배치', def: '정의' };

  /* 각 레코드가 자기 자손까지 포함해 어디까지 뻗는지 */
  function spansOf(recs) {
    var ends = new Array(recs.length), stack = [];
    recs.forEach(function (r, i) {
      while (stack.length && recs[stack[stack.length - 1]].level >= r.level) ends[stack.pop()] = i - 1;
      stack.push(i);
    });
    while (stack.length) ends[stack.pop()] = recs.length - 1;
    return ends;
  }

  function recordMap(container, opts) {
    opts = opts || {};
    var host = el('div', { style: { position: 'relative', width: '100%' } });
    var legend = el('div', { class: 'legend', style: { marginTop: '.7rem' } });
    container.appendChild(host); container.appendChild(legend);
    var cells = [];

    function render(stream, sel) {
      U.clear(host); cells = [];
      var recs = stream.records || [];
      if (!recs.length) { host.appendChild(el('p', { class: 'note', text: '레코드가 없다.' })); return; }
      var ends = spansOf(recs);
      var total = stream.data.length;
      var maxLevel = Math.max.apply(null, recs.map(function (r) { return r.level; }));
      var rowH = 22;
      host.style.height = ((maxLevel + 1) * (rowH + 2)) + 'px';

      recs.forEach(function (r, i) {
        var last = recs[ends[i]];
        var from = r.headerOffset;
        var to = last.payloadOffset + last.size;
        var fam = familyOf(H.tagName(r.tag));
        var w = ((to - from) / total) * 100;
        var b = el('button', {
          type: 'button',
          'data-i': i,
          title: '#' + i + '  ' + H.tagName(r.tag) + '  레벨 ' + r.level +
                 '  자기 ' + r.size + 'B' + (ends[i] > i ? ' · 자손 포함 ' + (to - from) + 'B' : '') +
                 '\n스트림 안 ' + U.hex(from, 6) + ' – ' + U.hex(to - 1, 6),
          style: {
            position: 'absolute',
            left: ((from / total) * 100) + '%',
            top: (r.level * (rowH + 2)) + 'px',
            width: 'max(2px, calc(' + w + '% - 1px))',
            height: rowH + 'px',
            background: FAMILY_COLOR[fam],
            border: 'none', borderRadius: '2px', padding: '0 3px', cursor: 'pointer',
            overflow: 'hidden', whiteSpace: 'nowrap',
            fontFamily: 'var(--font-mono)', fontSize: '.6rem', color: '#fff',
            textAlign: 'left', lineHeight: rowH + 'px'
          },
          onclick: function () { if (opts.onSelect) opts.onSelect(i); }
        }, w > 9 ? H.tagName(r.tag) : '');
        cells.push(b);
        host.appendChild(b);
      });

      U.clear(legend);
      legend.appendChild(el('span', { class: 'legend-group', text: '세로 = 레벨' }));
      ['para', 'ctrl', 'def'].forEach(function (f) {
        legend.appendChild(el('span', { class: 'legend-item' }, [
          el('span', { class: 'legend-sw', style: { background: FAMILY_COLOR[f] } }),
          FAMILY_NAME[f]
        ]));
      });
      legend.appendChild(el('span', { class: 'note', style: { marginLeft: 'auto' },
        text: '가로 = 스트림 안 위치 · 너비 = 자손까지 포함한 바이트' }));
      paint(sel);
    }

    function paint(sel) {
      var on = sel === undefined || sel === null ? -1 : sel;
      cells.forEach(function (b, i) {
        b.style.outline = i === on ? '2px solid var(--ink)' : 'none';
        b.style.outlineOffset = '1px';
        b.style.opacity = on < 0 || i === on ? '1' : '.55';
      });
    }
    return { render: render, paint: paint };
  }

  /* ==================================================================
   * 1. FileHeader
   * ================================================================== */
  function headerPanel(node) {
    var chips = el('div', { class: 'fieldmap' });
    var detail = el('div', { class: 'readout', style: { marginTop: '.8rem', whiteSpace: 'normal' } });
    var bitsWrap = el('div', { style: { marginTop: '.8rem' } });
    var hexHost = el('div', { style: { marginTop: '.8rem', border: '1px solid var(--rule)', borderRadius: '3px' } });
    node.appendChild(chips); node.appendChild(detail);
    node.appendChild(bitsWrap); node.appendChild(hexHost);
    var hv = root.HexView.make(hexHost);
    var sel = 'sig', P = null;

    function value(f) {
      var b = P.fileHeader, dv = dvOf(b);
      switch (f.kind) {
        case 'text': {
          var s = '';
          for (var i = 0; i < 32; i++) s += b[i] >= 0x20 && b[i] < 0x7f ? String.fromCharCode(b[i]) : '·';
          return '"' + s + '"';
        }
        case 'version':
          return [b[0x23], b[0x22], b[0x21], b[0x20]].join('.') +
                 '   (디스크 순서: ' + [b[0x20], b[0x21], b[0x22], b[0x23]].map(U.hexb).join(' ') + ')';
        case 'bits':
          return U.hex(dv.getUint32(f.off, true), 8);
        case 'u32': return U.hex(dv.getUint32(f.off, true), 8);
        case 'u8': return String(b[f.off]);
        default: {
          var out = [];
          for (var k = 0; k < Math.min(f.len, 16); k++) out.push(U.hexb(b[f.off + k]));
          return out.join(' ') + (f.len > 16 ? ' …' : '');
        }
      }
    }

    function drawBits() {
      U.clear(bitsWrap);
      var raw = P.propRaw;
      var grid = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '.3rem' } });
      H.PROP_BITS.forEach(function (b) {
        var on = !!(raw & (1 << b.bit));
        grid.appendChild(el('div', {
          class: 'chip',
          title: b.desc || b.name,
          style: {
            background: on ? 'var(--c-dir)' : 'var(--surface-2)',
            color: on ? '#fff' : 'var(--ink-3)',
            borderColor: on ? 'var(--c-dir)' : 'var(--rule)',
            fontWeight: on ? '600' : '400'
          }
        }, (on ? '● ' : '○ ') + b.bit + ' ' + b.name));
      });
      bitsWrap.appendChild(el('p', { class: 'note', style: { margin: '0 0 .4rem' },
        text: '속성 4바이트의 비트들 — 켜진 것만 색이 들어온다' }));
      bitsWrap.appendChild(grid);
    }

    function pick(id) {
      sel = id;
      var f = H.FILEHEADER_FIELDS.filter(function (x) { return x.id === id; })[0];
      U.$$('.field', chips).forEach(function (n) { n.classList.toggle('is-sel', n.dataset.id === id); });
      U.clear(detail);
      detail.appendChild(el('div', { style: { marginBottom: '.4rem' } }, [
        el('strong', { text: f.name }),
        el('span', { class: 'chip', style: { marginLeft: '.5rem' }, text: U.hex(f.off, 2) + ' · ' + f.len + 'B' }),
        f.expect ? el('span', { class: 'chip', style: { marginLeft: '.3rem' }, text: f.expect }) : null
      ]));
      detail.appendChild(el('div', { class: 'mono', style: { marginBottom: '.4rem' }, text: '값 = ' + value(f) }));
      detail.appendChild(el('div', { style: { color: 'var(--ink-2)' }, text: f.desc }));
      bitsWrap.style.display = f.id === 'props' ? '' : 'none';
      hv.render(P.fileHeader, {
        from: 0, to: 256, ranges: [{ start: f.off, len: f.len, tone: 1 }],
        label: 'FileHeader 스트림 · 256바이트 (파일 안 오프셋 아님 — 스트림 안 오프셋이다)'
      });
      hv.scrollToOffset(f.off, 0);
    }

    function render(p) {
      P = p;
      U.clear(chips);
      H.FILEHEADER_FIELDS.forEach(function (f) {
        chips.appendChild(el('button', {
          class: 'field', 'data-id': f.id, type: 'button',
          style: { flex: '1 1 ' + (f.len > 32 ? '100%' : '140px') },
          onclick: function () { pick(f.id); }
        }, [f.short || f.name, el('small', { text: U.hex(f.off, 2) + ' · ' + f.len + 'B' })]));
      });
      drawBits();
      pick(sel);
    }
    return { render: render };
  }

  /* ==================================================================
   * 2. 스트림 구성
   * ================================================================== */
  function streamPanel(node) {
    var host = el('div', { class: 'tablewrap' });
    node.appendChild(host);
    function render(p) {
      U.clear(host);
      var t = el('table', { class: 'data' });
      t.appendChild(el('thead', {}, el('tr', {}, [
        el('th', { text: '스트림' }), el('th', { class: 'num', text: '파일 안' }),
        el('th', { class: 'num', text: '압축 풀면' }), el('th', { class: 'num', text: '배' }),
        el('th', { text: '무엇' })
      ])));
      var tb = el('tbody');
      var known = {};
      H.STREAMS.forEach(function (s) { known[s.path.replace(/BIN0001\.png/, '')] = s; });
      p.streams.forEach(function (s) {
        var key = s.path.replace(/^\//, '').replace(/BIN\d+\..*$/, '');
        var meta = known[key] || known[key.replace(/\/$/, '')] ||
                   H.STREAMS.filter(function (x) { return s.path.indexOf('/' + x.path.split('/')[0]) === 0; })[0];
        var ratio = s.compressed && s.size ? (s.data.length / s.size) : null;
        tb.appendChild(el('tr', {
          class: 'clickable',
          onclick: function () {
            U.select({ sid: s.sid, sectors: s.entry.isMini ? p.cfb.miniStreamSectors : (s.entry.chain || []),
                       focus: s.entry.offset, ranges: [{ start: s.entry.offset, len: 128, tone: 1 }] });
          }
        }, [
          el('td', { class: 'mono', text: s.displayPath }),
          el('td', { class: 'mono num', text: U.num(s.size) }),
          el('td', { class: 'mono num', text: s.compressed ? U.num(s.data.length) : '—' }),
          el('td', { class: 'mono num', text: ratio ? '×' + ratio.toFixed(1) : '' }),
          el('td', {}, [
            s.compressed
              ? el('span', { class: 'chip', style: { marginRight: '.4rem', background: 'var(--c-data)', color: '#fff', borderColor: 'var(--c-data)' }, text: '압축' })
              : el('span', { class: 'chip', style: { marginRight: '.4rem' }, text: '평문' }),
            meta ? meta.desc : ''
          ])
        ]));
      });
      t.appendChild(tb);
      host.appendChild(t);
    }
    return { render: render };
  }

  /* ==================================================================
   * 3. 레코드 머리 — 4바이트 비트 쪼개기 (이 페이지의 중심)
   * ================================================================== */
  function bitsPanel(node) {
    var picker = el('select', { class: 'btn' });
    var recSel = el('select', { class: 'btn' });
    var manual = el('button', { class: 'btn', type: 'button', text: '직접 만들어 보기' });
    var bar = el('div', { style: { marginTop: '1rem' } });
    var mathOut = el('div', { class: 'readout', style: { marginTop: '.8rem' } });
    var sliders = el('div', { style: { marginTop: '.8rem', display: 'none' } });
    node.appendChild(el('div', { class: 'panel-tools', style: { marginLeft: 0 } },
      [el('span', { class: 'note', text: '스트림' }), picker,
       el('span', { class: 'note', text: '레코드' }), recSel, manual]));
    node.appendChild(bar); node.appendChild(sliders); node.appendChild(mathOut);

    var P = null, mode = 'file';
    var mTag = el('input', { type: 'range', min: '16', max: '120', value: '66', style: { width: '100%' } });
    var mLevel = el('input', { type: 'range', min: '0', max: '7', value: '1', style: { width: '100%' } });
    var mSize = el('input', { type: 'range', min: '0', max: '4095', value: '24', style: { width: '100%' } });
    sliders.appendChild(el('div', { class: 'split a' }, [
      el('div', {}, [el('label', { class: 'note', text: '태그 ID (10비트)' }), mTag]),
      el('div', {}, [el('label', { class: 'note', text: '레벨 (10비트)' }), mLevel])
    ]));
    sliders.appendChild(el('div', {}, [el('label', { class: 'note', text: '크기 (12비트)' }), mSize]));
    [mTag, mLevel, mSize].forEach(function (s) { s.oninput = function () { draw(); }; });

    function current() {
      if (mode === 'manual') {
        var tag = +mTag.value, level = +mLevel.value, size = +mSize.value;
        return { raw: H.pack(tag, level, size), tag: tag, level: level, size: size, manual: true };
      }
      var s = P.recordStreams[+picker.value];
      var r = s && s.records[+recSel.value];
      if (!r) return null;
      return { raw: r.raw, tag: r.tag, level: r.level, size: r.size, rec: r, stream: s };
    }

    function draw() {
      var c = current();
      if (!c) { mathOut.textContent = '레코드가 없다.'; U.clear(bar); return; }
      U.clear(bar);

      /* 32칸 비트 줄 — 비트 31이 왼쪽 */
      var row = el('div', { style: { display: 'flex', gap: '1px', flexWrap: 'nowrap', overflowX: 'auto' } });
      for (var i = 31; i >= 0; i--) {
        var on = (c.raw >>> i) & 1;
        var field = i >= 20 ? 'size' : i >= 10 ? 'level' : 'tag';
        var color = field === 'tag' ? 'var(--c-dir)' : field === 'level' ? 'var(--c-table)' : 'var(--c-data)';
        row.appendChild(el('div', {
          title: '비트 ' + i + ' — ' + (field === 'tag' ? '태그' : field === 'level' ? '레벨' : '크기'),
          style: {
            flex: '1 1 0', minWidth: '15px', height: '28px', display: 'grid', placeItems: 'center',
            fontFamily: 'var(--font-mono)', fontSize: '.68rem', borderRadius: '2px',
            background: on ? color : 'var(--surface-2)',
            color: on ? '#fff' : 'var(--ink-3)',
            border: '1px solid ' + (on ? color : 'var(--rule)')
          }
        }, String(on)));
      }
      bar.appendChild(row);

      /* 필드 구간 표시 */
      var legend = el('div', { style: { display: 'flex', gap: '1px', marginTop: '3px' } });
      [['크기 12비트', 12, 'var(--c-data)'], ['레벨 10비트', 10, 'var(--c-table)'], ['태그 10비트', 10, 'var(--c-dir)']]
        .forEach(function (g) {
          legend.appendChild(el('div', {
            style: {
              flex: g[1] + ' 1 0', minWidth: '0', textAlign: 'center', borderTop: '2px solid ' + g[2],
              fontFamily: 'var(--font-mono)', fontSize: '.62rem', color: 'var(--ink-2)', paddingTop: '2px',
              overflow: 'hidden', whiteSpace: 'nowrap'
            }
          }, g[0]));
        });
      bar.appendChild(legend);

      var lines = [];
      var hex32 = '0x' + ('00000000' + c.raw.toString(16).toUpperCase()).slice(-8);
      var bytes = [c.raw & 0xff, (c.raw >>> 8) & 0xff, (c.raw >>> 16) & 0xff, (c.raw >>> 24) & 0xff];
      lines.push('4바이트 값        ' + hex32);
      lines.push('디스크 바이트 순서 ' + bytes.map(U.hexb).join(' ') + '   (리틀엔디언)');
      lines.push('');
      lines.push('태그  = 값 & 0x3FF                 = ' + c.tag + '  (' + H.tagName(c.tag) + ')');
      lines.push('레벨  = (값 >> 10) & 0x3FF         = ' + c.level);
      /* 비트에서 뽑히는 값과, 확장 헤더까지 읽어 확정된 크기는 서로 다르다 */
      var bitSize = (c.raw >>> H.SIZE_SHIFT) & H.SIZE_MASK;
      lines.push('크기  = (값 >> 20) & 0xFFF         = ' + bitSize +
                 (bitSize === H.SIZE_ESCAPE ? '  ← 0xFFF! "12비트로는 모자람" 이라는 신호다' : ''));
      if (c.rec) {
        lines.push('');
        lines.push('머리 위치  스트림 안 ' + U.hex(c.rec.headerOffset, 6) +
                   ' (' + c.rec.headerLen + '바이트)');
        lines.push('내용 위치  스트림 안 ' + U.hex(c.rec.payloadOffset, 6) +
                   ' ~ ' + U.hex(c.rec.payloadOffset + c.rec.size - 1, 6));
        if (c.rec.extended) {
          lines.push('');
          lines.push('확장 헤더: 크기 자리의 0xFFF는 숫자가 아니라 신호다.');
          lines.push('바로 뒤 4바이트 = ' + U.hex(c.rec.size, 8) + ' = ' + U.num(c.rec.size) +
                     ' 이 진짜 크기다.');
          lines.push('그래서 이 레코드의 머리는 4바이트가 아니라 8바이트다.');
        }
      } else {
        lines.push('');
        lines.push('세 값이 4바이트 하나에 겹치지 않고 딱 들어간다: 10 + 10 + 12 = 32비트.');
        lines.push('크기가 12비트뿐이라 4095바이트가 한 레코드의 한계이고,');
        lines.push('그래서 0xFFF를 "더 크다"는 신호로 따로 빼 두었다.');
      }
      mathOut.textContent = lines.join('\n');
    }

    manual.onclick = function () {
      mode = mode === 'manual' ? 'file' : 'manual';
      manual.classList.toggle('is-active', mode === 'manual');
      manual.textContent = mode === 'manual' ? '파일에서 고르기' : '직접 만들어 보기';
      sliders.style.display = mode === 'manual' ? '' : 'none';
      picker.disabled = recSel.disabled = mode === 'manual';
      draw();
    };
    picker.onchange = function () { fillRecords(); draw(); };
    recSel.onchange = draw;

    function fillRecords() {
      var s = P.recordStreams[+picker.value];
      U.clear(recSel);
      if (!s) return;
      s.records.forEach(function (r, i) {
        recSel.appendChild(el('option', { value: i,
          text: i + '. ' + '· '.repeat(r.level) + H.tagName(r.tag) + ' (' + r.size + 'B)' +
                (r.extended ? ' ★확장' : '') }));
      });
      /* 확장 헤더를 쓰는 레코드가 있으면 그것을 먼저 보여 준다 — 가장 재미있는 경우다 */
      var big = s.records.findIndex(function (r) { return r.extended; });
      recSel.value = big >= 0 ? big : 0;
    }

    function render(p) {
      P = p;
      U.clear(picker);
      p.recordStreams.forEach(function (s, i) {
        picker.appendChild(el('option', { value: i, text: s.displayPath + ' (' + s.records.length + '개)' }));
      });
      var sec = p.recordStreams.findIndex(function (s) { return /Section/.test(s.path); });
      picker.value = sec >= 0 ? sec : 0;
      fillRecords();
      draw();
    }
    return { render: render };
  }

  /* ==================================================================
   * 3b. 압축 층 벗기기 — 같은 스트림을 두 얼굴로
   * ================================================================== */
  function zipPanel(node, statChip) {
    var picker = el('select', { class: 'btn' });
    var left = el('div', { style: { border: '1px solid var(--rule)', borderRadius: '3px' } });
    var right = el('div', { style: { border: '1px solid var(--rule)', borderRadius: '3px' } });
    var note = el('div', { class: 'readout', style: { marginTop: '.8rem' } });
    node.appendChild(el('div', { class: 'panel-tools', style: { marginLeft: 0, marginBottom: '.6rem' } },
      [el('span', { class: 'note', text: '스트림' }), picker]));
    node.appendChild(el('div', { class: 'split a' }, [left, right]));
    node.appendChild(note);
    var hvL = root.HexView.make(left), hvR = root.HexView.make(right);
    var P = null;

    function draw() {
      var s = P.streams[+picker.value];
      if (!s) return;
      hvL.render(s.raw, { from: 0, to: Math.min(s.raw.length, 512), ranges: [],
        label: 'CFB 스트림에 실제로 든 바이트' + (s.compressed ? ' (압축됨)' : ' (평문)') });
      hvR.render(s.data, { from: 0, to: Math.min(s.data.length, 512),
        ranges: s.compressed && s.records ? [{ start: 0, len: 4, tone: 3 }] : [],
        label: s.compressed ? '압축을 푼 결과' : '(압축하지 않는 스트림 — 왼쪽과 같다)' });

      var lines = [];
      if (!s.compressed) {
        lines.push('이 스트림은 압축 대상이 아니다.');
        lines.push(/FileHeader/.test(s.path)
          ? 'FileHeader는 "압축했는지"를 알려 주는 곳이라 압축할 수 없다.'
          : '미리보기와 속성 집합은 다른 프로그램도 바로 읽을 수 있어야 해서 평문으로 둔다.');
      } else if (s.error) {
        lines.push(s.error);
      } else {
        lines.push(U.num(s.raw.length) + '바이트  →  ' + U.num(s.data.length) + '바이트   (' +
                   (s.data.length / s.raw.length).toFixed(1) + '배, ' +
                   Math.round(100 - s.raw.length / s.data.length * 100) + '% 절약)');
        lines.push('DEFLATE 블록 ' + s.inflated.blocks + '개, zlib 헤더 ' +
                   (s.inflated.zlibHeader ? '있음' : '없음 (raw deflate)') + '.');
        if (s.trailer && s.trailer.bytes >= 8) {
          lines.push('');
          lines.push('압축 데이터는 ' + U.hex(s.trailer.at, 6) + ' 에서 끝나고, 그 뒤 8바이트가 더 있다:');
          lines.push('  CRC-32   ' + U.hex(s.trailer.crc, 8) +
                     (s.trailer.crcZero ? '   ← 0이다. 이 파일을 쓴 프로그램은 CRC를 계산하지 않았다'
                                        : s.trailer.crcOk ? '   ← 풀어 낸 데이터와 일치한다' : '   ← 맞지 않는다'));
          lines.push('  원본 길이 ' + U.hex(s.trailer.size, 8) + ' = ' + U.num(s.trailer.size) +
                     (s.trailer.sizeOk ? '   ← 일치' : '   ← 맞지 않는다'));
          lines.push('  이 8바이트는 명세에 없다. gzip 꼬리에서 머리만 뗀 모양이고,');
          lines.push('  inflate 는 마지막 블록에서 멈추므로 읽는 쪽은 대개 그냥 버린다.');
        } else if (s.trailer) {
          lines.push('압축 데이터 뒤에 남은 바이트: ' + s.trailer.bytes + '개.');
        }
        lines.push('');
        lines.push('왼쪽 첫 바이트: ' + Array.prototype.slice.call(s.raw.subarray(0, 6)).map(U.hexb).join(' ') +
                   ' …  — 아무 구조도 읽히지 않는다.');
        if (s.records && s.records.length) {
          var r0 = s.records[0];
          lines.push('오른쪽 첫 4바이트: ' + Array.prototype.slice.call(s.data.subarray(0, 4)).map(U.hexb).join(' ') +
                     '  = 레코드 머리 ' + U.hex(r0.raw, 8));
          lines.push('  → 태그 ' + r0.tag + '(' + H.tagName(r0.tag) + '), 레벨 ' + r0.level + ', 크기 ' + r0.size);
          lines.push('');
          lines.push('압축을 풀어야만 구조가 보인다. 그리고 위의 CRC를 아무도 확인하지 않기 때문에,');
          lines.push('잘못 풀어도 예외 대신 그럴듯한 쓰레기가 나온다 — 검사할 수 있는데 하지 않는 것이다.');
        }
      }
      note.textContent = lines.join('\n');
      if (statChip) {
        var tot = P.streams.reduce(function (a, x) { return a + (x.compressed ? x.size : 0); }, 0);
        var un = P.streams.reduce(function (a, x) { return a + (x.compressed ? x.data.length : 0); }, 0);
        statChip.textContent = tot ? '압축 스트림 합계 ' + U.num(tot) + 'B → ' + U.num(un) + 'B' : '압축 꺼짐';
      }
    }
    picker.onchange = draw;

    function render(p) {
      P = p;
      U.clear(picker);
      p.streams.forEach(function (s, i) {
        picker.appendChild(el('option', { value: i,
          text: s.displayPath + (s.compressed ? '  (압축)' : '  (평문)') }));
      });
      var sec = p.streams.findIndex(function (s) { return /Section0/.test(s.path); });
      picker.value = sec >= 0 ? sec : 0;
      draw();
    }
    return { render: render };
  }

  /* ==================================================================
   * 4. 레코드 목록 · 레벨 트리 · 페이로드 해부
   * ================================================================== */
  function recordPanel(node) {
    var picker = el('select', { class: 'btn' });
    var listHost = el('div', { style: { maxHeight: '26rem', overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: '.76rem' } });
    var detail = el('div', { class: 'readout', style: { whiteSpace: 'normal' } });
    var fieldsHost = el('div', { class: 'tablewrap', style: { marginTop: '.6rem' } });
    var hexHost = el('div', { style: { marginTop: '.6rem', border: '1px solid var(--rule)', borderRadius: '3px' } });
    node.appendChild(el('div', { class: 'panel-tools', style: { marginLeft: 0, marginBottom: '.6rem' } },
      [el('span', { class: 'note', text: '스트림' }), picker]));
    node.appendChild(el('div', { class: 'split a' }, [
      el('div', {}, listHost),
      el('div', {}, [detail, fieldsHost, hexHost])
    ]));
    var hv = root.HexView.make(hexHost);
    var P = null, cur = 0;

    function pick(i) {
      cur = i;
      var s = P.recordStreams[+picker.value];
      var r = s.records[i];
      if (!r) return;
      U.$$('button', listHost).forEach(function (n, k) { n.classList.toggle('is-sel', k === i); });
      var info = H.tagInfo(r.tag);
      U.clear(detail);
      detail.appendChild(el('div', { style: { marginBottom: '.4rem' } }, [
        el('strong', { class: 'mono', text: info.name }),
        el('span', { class: 'chip', style: { marginLeft: '.5rem' }, text: '태그 ' + r.tag + ' / 0x' + r.tag.toString(16).toUpperCase() }),
        el('span', { class: 'chip', style: { marginLeft: '.3rem' }, text: '레벨 ' + r.level }),
        el('span', { class: 'chip', style: { marginLeft: '.3rem' }, text: r.size + 'B' }),
        r.extended ? el('span', { class: 'chip', style: { marginLeft: '.3rem', background: 'var(--c-data)', color: '#fff', borderColor: 'var(--c-data)' }, text: '확장 헤더' }) : null
      ]));
      detail.appendChild(el('div', { style: { color: 'var(--ink-2)' }, text: info.desc }));
      if (r.parentIndex >= 0) {
        var par = s.records[r.parentIndex];
        detail.appendChild(el('p', { class: 'note', style: { margin: '.4rem 0 0' },
          text: '레벨 ' + r.level + '이므로, 바로 앞의 레벨 ' + par.level + ' 레코드인 ' +
                H.tagName(par.tag) + '(#' + par.index + ')에 매달린다.' }));
      } else {
        detail.appendChild(el('p', { class: 'note', style: { margin: '.4rem 0 0' },
          text: '레벨 0이므로 트리의 뿌리 중 하나다.' }));
      }

      /* 페이로드 해석 */
      U.clear(fieldsHost);
      var body = s.data.subarray(r.payloadOffset, r.payloadOffset + r.size);
      var fields = decode(info.name, body);
      if (fields && fields.length) {
        var t = el('table', { class: 'data' });
        t.appendChild(el('thead', {}, el('tr', {}, [
          el('th', { class: 'mono', text: '+오프셋' }), el('th', { text: '필드' }),
          el('th', { text: '값' }), el('th', { text: '' })
        ])));
        var tb = el('tbody');
        fields.forEach(function (f) {
          tb.appendChild(el('tr', {
            class: 'clickable',
            onclick: function () {
              hv.render(body, { from: 0, to: body.length,
                ranges: [{ start: f.off, len: f.len, tone: 1 }],
                label: info.name + ' 내용 ' + body.length + '바이트' });
              hv.scrollToOffset(f.off, 0);
            }
          }, [
            el('td', { class: 'mono', text: U.hex(f.off, 2) }),
            el('td', { text: f.label }),
            el('td', { class: 'mono', text: String(f.value) }),
            el('td', { class: 'note', text: f.note || '' })
          ]));
        });
        t.appendChild(tb);
        fieldsHost.appendChild(t);
      } else if (info.name === 'PARA_TEXT') {
        fieldsHost.appendChild(el('p', { class: 'note',
          text: '글자 내용이다. 아래 "글자 뽑아내기" 패널에서 제어 문자까지 갈라 볼 수 있다.' }));
      } else {
        fieldsHost.appendChild(el('p', { class: 'note',
          text: '이 태그의 내용은 이 페이지에서 풀지 않는다. 아래 hex로 원본 바이트를 볼 수 있다.' }));
      }

      hv.render(body, { from: 0, to: Math.min(body.length, 1024),
        ranges: [], label: info.name + ' 내용 ' + body.length + '바이트 (스트림 안 ' + U.hex(r.payloadOffset, 6) + '부터)' });
    }

    function fill() {
      var s = P.recordStreams[+picker.value];
      U.clear(listHost);
      if (!s) return;
      s.records.forEach(function (r, i) {
        var info = H.tagInfo(r.tag);
        listHost.appendChild(el('button', {
          type: 'button',
          style: {
            display: 'flex', gap: '.5rem', width: '100%', textAlign: 'left',
            background: 'none', border: '1px solid transparent', font: 'inherit', color: 'inherit',
            cursor: 'pointer', padding: '.1rem .3rem', borderRadius: '2px',
            paddingLeft: (0.3 + r.level * 1.1) + 'rem'
          },
          onclick: function () { pick(i); }
        }, [
          el('span', { style: { color: 'var(--ink-3)', width: '2.2rem', flex: 'none' }, text: '#' + i }),
          el('span', {
            style: {
              width: '.5rem', flex: 'none', borderLeft: '2px solid ' +
                (info.where === 'DocInfo' ? 'var(--c-table)' : 'var(--c-data)')
            }
          }),
          el('span', { text: info.name }),
          el('span', { style: { marginLeft: 'auto', color: 'var(--ink-3)', flex: 'none' },
            text: r.size + 'B' + (r.extended ? ' ★' : '') })
        ]));
      });
      pick(0);
    }
    picker.onchange = fill;

    function render(p) {
      P = p;
      U.clear(picker);
      p.recordStreams.forEach(function (s, i) {
        picker.appendChild(el('option', { value: i, text: s.displayPath + ' (' + s.records.length + '개)' }));
      });
      var sec = p.recordStreams.findIndex(function (s) { return /Section/.test(s.path); });
      picker.value = sec >= 0 ? sec : 0;
      fill();
    }
    return { render: render };
  }

  /* ==================================================================
   * 5. 레벨 → 트리
   * ================================================================== */
  function treePanel(node) {
    var picker = el('select', { class: 'btn' });
    var fromIn = el('input', { class: 'btn mono', type: 'number', min: '0', value: '0', style: { width: '5.5rem' } });
    var host = el('div', { class: 'treewrap', style: { marginTop: '.6rem' } });
    node.appendChild(el('div', { class: 'panel-tools', style: { marginLeft: 0 } },
      [el('span', { class: 'note', text: '스트림' }), picker,
       el('span', { class: 'note', text: '시작 레코드' }), fromIn]));
    node.appendChild(host);
    var P = null;

    function draw() {
      U.clear(host);
      var s = P.recordStreams[+picker.value];
      if (!s || !s.records.length) return;
      var from = Math.max(0, Math.min(+fromIn.value || 0, s.records.length - 1));
      var recs = s.records.slice(from, from + 16);

      var W = 940, rowH = 30, H0 = recs.length * rowH + 60;
      var g = svg('svg', { viewBox: '0 0 ' + W + ' ' + H0, width: W, height: H0,
        role: 'img', 'aria-label': '평평한 레코드 목록의 레벨 값이 오른쪽의 트리 모양을 만든다' });

      g.appendChild(svg('text', { x: 0, y: 14, 'font-family': 'IBM Plex Mono, monospace',
        'font-size': '11', fill: 'currentColor', 'fill-opacity': '.65' },
        '스트림에 실제로 있는 것 — 앞에서부터 죽 이어진 레코드'));
      g.appendChild(svg('text', { x: 480, y: 14, 'font-family': 'IBM Plex Mono, monospace',
        'font-size': '11', fill: 'currentColor', 'fill-opacity': '.65' },
        '레벨 값이 만들어 내는 트리'));

      var prevY = {};
      recs.forEach(function (r, i) {
        var y = 36 + i * rowH;
        var info = H.tagInfo(r.tag);
        /* 왼쪽: 평평한 목록 */
        g.appendChild(svg('rect', { x: 0, y: y, width: 60, height: rowH - 6, rx: 2,
          fill: 'var(--c-table)' }));
        g.appendChild(svg('text', { x: 30, y: y + 16, 'text-anchor': 'middle',
          'font-family': 'IBM Plex Mono, monospace', 'font-size': '11', fill: '#fff' },
          'L' + r.level));
        g.appendChild(svg('text', { x: 70, y: y + 16, 'font-family': 'IBM Plex Mono, monospace',
          'font-size': '11', fill: 'currentColor' },
          '#' + (from + i) + '  ' + info.name.slice(0, 22)));

        /* 오른쪽: 들여쓰기로 세운 트리 */
        var x = 500 + r.level * 34;
        g.appendChild(svg('circle', { cx: x, cy: y + 10, r: 5,
          fill: info.where === 'DocInfo' ? 'var(--c-table)' : 'var(--c-data)' }));
        g.appendChild(svg('text', { x: x + 12, y: y + 14, 'font-family': 'IBM Plex Mono, monospace',
          'font-size': '11', fill: 'currentColor' }, info.name.slice(0, 26)));
        if (r.level > 0 && prevY[r.level - 1] !== undefined) {
          var px = 500 + (r.level - 1) * 34;
          g.appendChild(svg('path', {
            d: 'M' + px + ',' + (prevY[r.level - 1] + 16) + ' L' + px + ',' + (y + 10) + ' L' + (x - 6) + ',' + (y + 10),
            stroke: 'var(--ink-3)', 'stroke-width': 1.2, fill: 'none'
          }));
        }
        prevY[r.level] = y;
        Object.keys(prevY).forEach(function (k) { if (+k > r.level) delete prevY[k]; });

        /* 가운데 연결 */
        g.appendChild(svg('line', { x1: 300, y1: y + 10, x2: 470, y2: y + 10,
          stroke: 'var(--rule)', 'stroke-width': 1, 'stroke-dasharray': '2 3' }));
      });
      host.appendChild(g);
      host.appendChild(el('p', { class: 'note', style: { marginTop: '.5rem' },
        text: '규칙은 하나뿐이다: 앞에서부터 읽다가, 레벨이 앞 레코드보다 크면 그 아래에 매단다. ' +
              '같거나 작으면 그 레벨의 형제가 될 때까지 위로 올라간다. ' +
              'CFB가 포인터 세 개로 그려 둔 트리를, HWP는 숫자 하나로 대신한다.' }));
    }
    picker.onchange = function () { fromIn.value = 0; draw(); };
    fromIn.oninput = draw;

    function render(p) {
      P = p;
      U.clear(picker);
      p.recordStreams.forEach(function (s, i) {
        picker.appendChild(el('option', { value: i, text: s.displayPath + ' (' + s.records.length + '개)' }));
      });
      var sec = p.recordStreams.findIndex(function (s) { return /Section/.test(s.path); });
      picker.value = sec >= 0 ? sec : 0;
      /* 표가 시작되는 지점을 기본으로 — 레벨이 가장 깊어지는 곳이 볼 만하다 */
      var s = p.recordStreams[+picker.value];
      var deep = s ? s.records.findIndex(function (r) { return r.level >= 3; }) : -1;
      fromIn.value = deep > 4 ? deep - 4 : 0;
      fromIn.max = s ? s.records.length - 1 : 0;
      draw();
    }
    return { render: render };
  }

  /* ==================================================================
   * 6. 글자 뽑아내기
   * ================================================================== */
  function textPanel(node) {
    var picker = el('select', { class: 'btn' });
    var pieces = el('div', { style: { marginTop: '.7rem', display: 'flex', flexWrap: 'wrap', gap: '.25rem' } });
    var out = el('div', { class: 'readout', style: { marginTop: '.7rem', whiteSpace: 'pre-wrap' } });
    var all = el('div', { class: 'readout', style: { marginTop: '.7rem', maxHeight: '14rem', overflowY: 'auto', whiteSpace: 'pre-wrap' } });
    node.appendChild(el('div', { class: 'panel-tools', style: { marginLeft: 0 } },
      [el('span', { class: 'note', text: '문단' }), picker]));
    node.appendChild(pieces); node.appendChild(out);
    node.appendChild(el('p', { class: 'note', style: { margin: '1rem 0 .3rem' }, text: '문서 전체에서 뽑아낸 글자' }));
    node.appendChild(all);
    var P = null;

    function draw() {
      var p = P.paragraphs[+picker.value];
      U.clear(pieces);
      if (!p) { out.textContent = ''; return; }
      p.pieces.forEach(function (pc) {
        if (pc.kind === 'text') {
          pieces.appendChild(el('span', {
            class: 'chip',
            style: { background: 'var(--surface)', maxWidth: '32ch', overflow: 'hidden',
                     textOverflow: 'ellipsis', display: 'inline-block' },
            title: pc.text
          }, '글자 ' + pc.text.length + '자 · ' + pc.len + 'B'));
        } else {
          var isWide = pc.info.kind !== 'char';
          pieces.appendChild(el('span', {
            class: 'chip',
            title: pc.info.name + (pc.info.note ? ' — ' + pc.info.note : ''),
            style: {
              background: isWide ? 'var(--c-dir)' : 'var(--surface-2)',
              color: isWide ? '#fff' : 'var(--ink-2)',
              borderColor: isWide ? 'var(--c-dir)' : 'var(--rule)'
            }
          }, '제어 ' + pc.code + ' ' + pc.info.name + ' · ' + pc.len + 'B'));
        }
      });
      var lines = [];
      lines.push('이 문단의 PARA_TEXT는 ' + (p.record.size) + '바이트 = ' + (p.record.size / 2) + '글자 자리다.');
      var ctrl = p.pieces.filter(function (x) { return x.kind === 'ctrl'; });
      var wide = ctrl.filter(function (x) { return x.info.kind !== 'char'; });
      lines.push('그중 제어 문자가 ' + ctrl.length + '개' +
                 (wide.length ? ' (여덟 글자 자리를 차지하는 것 ' + wide.length + '개 포함)' : '') + '.');
      lines.push('실제 글자는 ' + p.text.replace(/[\t\n]/g, '').length + '자.');
      lines.push('');
      lines.push('뽑아낸 결과 ▾');
      lines.push(p.text || '(글자 없음 — 컨트롤만 들어 있는 문단)');
      out.textContent = lines.join('\n');
    }
    picker.onchange = draw;

    function render(p) {
      P = p;
      U.clear(picker);
      p.paragraphs.forEach(function (par, i) {
        var t = par.text.replace(/\s+/g, ' ').trim();
        picker.appendChild(el('option', { value: i,
          text: '#' + i + '  ' + (t ? t.slice(0, 34) : '(컨트롤만)') }));
      });
      all.textContent = p.text || '(뽑아낸 글자가 없다)';
      draw();
    }
    return { render: render };
  }

  /* ==================================================================
   * 6b. 4095 경계 — 읽는 쪽과 쓰는 쪽의 규칙이 다르다
   * ================================================================== */
  function edgePanel(node) {
    var slider = el('input', { type: 'range', min: '4088', max: '4100', value: '4095',
      style: { width: 'min(420px,100%)' } });
    var val = el('div', { class: 'val' });
    var out = el('div', { class: 'readout', style: { marginTop: '.8rem' } });
    node.appendChild(el('div', { class: 'calc' }, [
      el('div', {}, [el('label', { text: '레코드 내용의 크기' }), val]),
      el('div', { style: { flex: '1 1 280px' } }, [el('label', { text: '4088 – 4100 바이트' }), slider])
    ]));
    node.appendChild(out);

    function draw() {
      var n = +slider.value;
      val.textContent = U.num(n) + ' B';
      var correct = n >= H.SIZE_ESCAPE;        /* 4095 는 신호로 써 버렸으므로 값으로 쓸 수 없다 */
      var buggy = n > H.SIZE_ESCAPE;           /* 실제 구현에 있었던 흔한 실수 */
      var lines = [];
      lines.push('올바른 작성기:  size >= 4095  →  ' +
        (correct ? '확장 헤더 (머리 8바이트, 크기 자리에 0xFFF)' : '보통 헤더 (머리 4바이트, 크기 자리에 ' + n + ')'));
      lines.push('흔한 버그   :  size >  4095  →  ' +
        (buggy ? '확장 헤더' : '보통 헤더 (크기 자리에 ' + Math.min(n, 4095) + ')'));
      lines.push('');
      if (n === H.SIZE_ESCAPE) {
        lines.push('★ 여기가 갈리는 지점이다.');
        lines.push('');
        lines.push('내용이 정확히 4095바이트일 때, > 로 비교하는 작성기는 보통 헤더를 쓰면서');
        lines.push('크기 자리에 4095 = 0xFFF 를 적는다. 그런데 읽는 쪽에서 0xFFF 는');
        lines.push('"뒤에 4바이트가 더 있다"는 신호다.');
        lines.push('');
        lines.push('그래서 읽는 쪽은 다음 레코드의 머리 4바이트를 "크기"로 집어삼키고,');
        lines.push('그 뒤로 스트림 전체가 어긋난다. 파일은 열리지 않거나 엉뚱한 내용이 나온다.');
        lines.push('');
        lines.push('실제로 libhwp 라는 구현에 이 버그가 있었다.');
      } else if (n > H.SIZE_ESCAPE) {
        lines.push('4095를 넘으므로 두 규칙이 같은 답을 낸다 — 확장 헤더.');
        lines.push('머리 8바이트 + 내용 ' + U.num(n) + '바이트.');
      } else {
        lines.push('4095 미만이라 두 규칙이 같은 답을 낸다 — 보통 헤더.');
        lines.push('머리 4바이트 + 내용 ' + U.num(n) + '바이트.');
      }
      lines.push('');
      lines.push('한 레코드가 보통 헤더로 담을 수 있는 크기: 0 – 4094 바이트.');
      lines.push('4095는 값이 아니라 신호로 쓰였기 때문에, 12비트의 마지막 한 칸이 비어 있는 셈이다.');
      out.textContent = lines.join('\n');
    }
    slider.oninput = draw;
    return { render: draw };
  }

  /* ==================================================================
   * 6c. 쓰기 실습실 — 파생 값을 하나 빼먹으면 무슨 일이 생기나
   * ================================================================== */
  function writeLab(node, rebuild) {
    var picker = el('select', { class: 'btn' });
    var input = el('input', { class: 'btn mono', type: 'text',
      style: { flex: '1 1 320px', minWidth: '12rem' } });
    var goB = el('button', { class: 'btn primary', type: 'button', text: '고쳐 쓰기' });
    var badB = el('button', { class: 'btn danger', type: 'button', text: '글자 수는 그대로 두고 쓰기' });
    var prvB = el('button', { class: 'btn danger', type: 'button', text: '미리보기는 그대로 두고 쓰기' });
    var resetB = el('button', { class: 'btn', type: 'button', text: '원래대로' });
    var out = el('div', { class: 'readout', style: { marginTop: '.9rem' } });
    node.appendChild(el('div', { class: 'panel-tools', style: { marginLeft: 0, flexWrap: 'wrap' } },
      [el('span', { class: 'note', text: '문단' }), picker, input, goB]));
    node.appendChild(el('div', { class: 'panel-tools', style: { marginLeft: 0, marginTop: '.4rem' } },
      [badB, prvB, resetB]));
    node.appendChild(out);
    var P = null, editable = [];

    function fill() {
      U.clear(picker);
      editable = [];
      (root.HWPBuild.PARAS || []).forEach(function (para, i) {
        if (!para.text || para.long) return;
        editable.push(i);
        picker.appendChild(el('option', { value: i, text: '#' + i + '  ' + para.text.slice(0, 30) }));
      });
      if (editable.length) input.value = root.HWPBuild.PARAS[editable[0]].text;
    }
    picker.onchange = function () { input.value = root.HWPBuild.PARAS[+picker.value].text; };

    function report(before, after, omit) {
      var lines = [];
      var idx = +picker.value;
      var b = before.paragraphs, a = after.paragraphs;
      lines.push('본문 한 문단의 글자를 바꿨다. 같이 바뀌어야 하는 것들:');
      lines.push('');
      var rows = [
        ['PARA_TEXT 레코드 크기', before.secSize, after.secSize],
        ['PARA_HEADER 의 글자 수', before.declared, after.declared],
        ['레코드 머리 4바이트', U.hex(before.rawHeader, 8), U.hex(after.rawHeader, 8)],
        ['PrvText 스트림 크기', before.prv, after.prv],
        ['압축 뒤 스트림 크기', before.packed, after.packed],
        ['CRC-32 꼬리', U.hex(before.crc, 8), U.hex(after.crc, 8)]
      ];
      rows.forEach(function (row) {
        var same = String(row[1]) === String(row[2]);
        lines.push('  ' + String(row[0]).padEnd(24) + String(row[1]).padStart(12) +
                   '  →  ' + String(row[2]).padStart(12) + (same ? '   (그대로)' : ''));
      });
      lines.push('');
      if (!omit) {
        lines.push('여섯 가지가 전부 맞물려 바뀌었다. 파서가 남긴 경고: ' +
                   (after.warn.length ? after.warn.join(' / ') : '없음.'));
        lines.push('');
        lines.push('이 중 어느 것도 파일 안에서 자동으로 계산되지 않는다.');
        lines.push('전부 쓰는 쪽이 손으로 맞춰 넣어야 하고, 아무도 검사해 주지 않는다.');
      } else if (omit === 'nChars') {
        lines.push('※ 이번에는 PARA_HEADER 의 글자 수만 옛 값으로 남겨 두었다.');
        lines.push('');
        if (after.warn.length) {
          after.warn.forEach(function (w) { lines.push('  ⚠ ' + w); });
        }
        lines.push('');
        lines.push('파일은 여전히 "열린다". CFB도 멀쩡하고, 압축도 풀리고, 레코드도 잘 잘린다.');
        lines.push('어긋난 것은 두 값의 관계뿐이다 — 그리고 그 관계를 검사하는 곳은 아무 데도 없다.');
        lines.push('어떤 프로그램은 선언된 글자 수만큼만 읽어 뒷부분을 잘라 버리고,');
        lines.push('어떤 프로그램은 레코드 크기를 믿고 전부 읽는다. 프로그램마다 다르게 보인다.');
      } else {
        lines.push('※ 이번에는 PrvText(미리보기 텍스트)를 옛 내용 그대로 두었다.');
        lines.push('');
        lines.push('본문:      "' + after.bodySnippet + '"');
        lines.push('미리보기:  "' + after.prvSnippet + '"');
        lines.push('');
        lines.push('경고는 하나도 나오지 않는다. 형식상 아무 문제가 없기 때문이다.');
        lines.push('미리보기는 원래 본문과 별개로 저장되는 값이라, 갱신을 빠뜨려도 파일은 유효하다.');
        lines.push('그래서 실제 문서에서도 미리보기가 본문과 어긋나 있는 경우가 있다 —');
        lines.push('검색 색인이나 포렌식에서 이 차이가 단서가 되기도 한다.');
      }
      out.textContent = lines.join('\n');
    }

    function snapshot(hwp) {
      var idx = +picker.value;
      var target = hwp.paragraphs.filter(function (x) { return x.text.replace(/[\n\t]/g, '').length; })[0];
      /* 편집한 문단을 이름이 아니라 순서로 찾는다 */
      var sec = hwp.recordStreams.filter(function (x) { return /Section/.test(x.path); })[0];
      var headers = sec.records.filter(function (r) { return H.tagName(r.tag) === 'PARA_HEADER'; });
      var texts = sec.records.filter(function (r) { return H.tagName(r.tag) === 'PARA_TEXT'; });
      var order = editable.indexOf(idx) + 1;   /* 0번은 구역 정의 문단 */
      var t = texts[order] || texts[0];
      var h = headers[order] || headers[0];
      var prvStream = hwp.streams.filter(function (x) { return x.path === '/PrvText'; })[0];
      var secStream = hwp.streams.filter(function (x) { return /Section0/.test(x.path); })[0];
      var dec = '';
      for (var i = 0; i + 1 < Math.min(prvStream.data.length, 160); i += 2) {
        dec += String.fromCharCode(prvStream.data[i] | (prvStream.data[i + 1] << 8));
      }
      return {
        secSize: t.size, declared: h.declaredChars, rawHeader: t.raw,
        prv: prvStream.size, packed: secStream.size,
        crc: secStream.trailer ? secStream.trailer.crc : 0,
        warn: hwp.warn,
        bodySnippet: (hwp.paragraphs[order] ? hwp.paragraphs[order].text : '').replace(/[\n\t]/g, ' ').slice(0, 42),
        prvSnippet: dec.split('\n').slice(0, 3).join(' / ').slice(0, 42)
      };
    }

    function run(omit) {
      var idx = +picker.value;
      var before = snapshot(P);
      var after = rebuild({ edit: { index: idx, text: input.value }, omit: omit });
      if (!after) return;
      report(before, snapshot(after), omit);
      P = after;
    }
    goB.onclick = function () { run(null); };
    badB.onclick = function () { run('nChars'); };
    prvB.onclick = function () { run('prvText'); };
    resetB.onclick = function () {
      var after = rebuild({});
      if (after) { P = after; fill();
        out.textContent = '원래 문서로 되돌렸다. 문단을 골라 글자를 고친 뒤 버튼을 눌러 보자.'; }
    };

    function render(p) {
      P = p;
      if (!picker.options.length) fill();
      if (!out.textContent) {
        out.textContent = '문단을 고르고 글자를 바꾼 다음 "고쳐 쓰기"를 눌러 보자.\n' +
          '레코드를 다시 만들고, 다시 압축하고, CFB에 다시 넣은 새 파일이 만들어진다.';
      }
    }
    return { render: render };
  }

  /* ==================================================================
   * 7. 읽기 워크스루
   * ================================================================== */
  function walkPanel(node) {
    var prevB = el('button', { class: 'btn', type: 'button', text: '◀' });
    var playB = el('button', { class: 'btn primary', type: 'button', text: '▶ 재생' });
    var nextB = el('button', { class: 'btn', type: 'button', text: '▶|' });
    var prog = el('span', { class: 'chip' });
    var steps = el('div', { class: 'steps' });
    var hexHost = el('div', { style: { border: '1px solid var(--rule)', borderRadius: '3px' } });
    node.appendChild(el('div', { class: 'panel-tools', style: { marginLeft: 0, marginBottom: '.7rem' } },
      [prevB, playB, nextB, prog]));
    node.appendChild(el('div', { class: 'split a' }, [steps, hexHost]));
    var hv = root.HexView.make(hexHost);
    var P = null, idx = 0, timer = null;

    function show(i) {
      idx = Math.max(0, Math.min(i, P.trace.length - 1));
      var s = P.trace[idx];
      U.$$('.step', steps).forEach(function (n, k) {
        n.classList.toggle('is-current', k === idx);
        n.classList.toggle('is-past', k < idx);
      });
      if (steps.children[idx]) steps.children[idx].scrollIntoView({ block: 'nearest' });
      prog.textContent = (idx + 1) + ' / ' + P.trace.length;
      if (s.hwpBytes) {
        hv.render(P.fileHeader, { from: 0, to: 256,
          ranges: s.hwpBytes.map(function (r) { return { start: r[0], len: r[1], tone: 1 }; }),
          label: 'FileHeader 스트림 256바이트' });
        hv.scrollToOffset(s.hwpBytes[0][0], 0);
      } else if (P.recordStreams.length) {
        var st = P.recordStreams[P.recordStreams.length - 1];
        hv.render(st.data, { from: 0, to: Math.min(st.data.length, 768), ranges: [],
          label: st.displayPath + ' — 압축을 푼 뒤의 바이트' });
      }
    }
    function stop() { if (timer) clearInterval(timer); timer = null; playB.textContent = '▶ 재생'; }
    playB.onclick = function () {
      if (timer) { stop(); return; }
      if (idx >= P.trace.length - 1) idx = -1;
      playB.textContent = '⏸ 멈춤';
      timer = setInterval(function () {
        if (idx >= P.trace.length - 1) { stop(); return; }
        show(idx + 1);
      }, 2800);
      show(idx + 1);
    };
    prevB.onclick = function () { stop(); show(idx - 1); };
    nextB.onclick = function () { stop(); show(idx + 1); };

    function render(p) {
      P = p; stop();
      U.clear(steps);
      p.trace.forEach(function (s, i) {
        steps.appendChild(el('button', { class: 'step', type: 'button', onclick: function () { stop(); show(i); } }, [
          el('span', { class: 'step-n', text: String(i + 1).padStart(2, '0') }),
          el('span', {}, [
            el('span', { class: 'step-t', text: s.title.replace(/^\d+\.\s*/, '') }),
            el('span', { class: 'step-d', text: s.detail })
          ])
        ]));
      });
      show(0);
    }
    return { render: render };
  }

  root.HWPPanels = {
    recordMap: recordMap, headerPanel: headerPanel, streamPanel: streamPanel,
    zipPanel: zipPanel, bitsPanel: bitsPanel, edgePanel: edgePanel, writeLab: writeLab,
    recordPanel: recordPanel, treePanel: treePanel, textPanel: textPanel,
    walkPanel: walkPanel, decode: decode
  };
})(window);
