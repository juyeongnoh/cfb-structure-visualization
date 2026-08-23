/* =====================================================================
 * ui-panels.js — 각 장(章)의 상호작용 계기판
 *   headerPanel  : 512바이트 헤더 필드 지도
 *   fatPanel     : FAT 표 + 체인 따라가기
 *   difatPanel   : 3단 간접 참조 계산기
 *   dirPanel     : 디렉터리 엔트리 + 레드-블랙 트리
 *   miniPanel    : 미니 스트림 주소 변환기
 * ===================================================================== */
(function (root) {
  'use strict';
  var U = root.UI, el = U.el, svg = U.svg, C = root.CFBConst;

  /* ==================================================================
   * 1. 헤더 패널
   * ================================================================== */
  function headerPanel(node) {
    var strip = el('div', { style: { display: 'flex', gap: '1px', height: '2.1rem', marginBottom: '.5rem' } });
    var stripNote = el('p', { class: 'note', style: { margin: '0 0 1rem' } });
    var chips = el('div', { class: 'fieldmap' });
    var detail = el('div', {
      class: 'readout',
      style: { marginTop: '.8rem', whiteSpace: 'normal', lineHeight: '1.7' }
    });
    var hexHost = el('div', { style: { marginTop: '.8rem', border: '1px solid var(--rule)', borderRadius: '3px' } });
    node.appendChild(strip); node.appendChild(stripNote);
    node.appendChild(chips); node.appendChild(detail); node.appendChild(hexHost);
    var hv = root.HexView.make(hexHost);
    var selected = 'sig';

    function readField(p, f) {
      var b = p.bytes, dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      switch (f.kind) {
        case 'u16': return U.hex(dv.getUint16(f.off, true), 4) + '  (' + dv.getUint16(f.off, true) + ')';
        case 'u32': return U.hex(dv.getUint32(f.off, true), 8) + '  (' + U.num(dv.getUint32(f.off, true) >>> 0) + ')';
        case 'sect': {
          var v = dv.getUint32(f.off, true) >>> 0;
          var nm = C.sectName(v);
          return nm ? U.hex(v, 8) + '  = ' + nm : U.hex(v, 8) + '  = 섹터 ' + v +
                 ' (파일 오프셋 ' + U.hex(p.sectOff(v), 6) + ')';
        }
        case 'guid': return p.header.clsid === '00000000-0000-0000-0000-000000000000'
          ? '모두 0 (사용 안 함)' : p.header.clsid;
        case 'difat': {
          var n = p.headerDifatCount;
          return n + '칸 사용 중 → FAT 섹터 ' + p.difat.slice(0, 12).join(', ') +
                 (p.difat.length > 12 ? ' …' : '') + '\n나머지 ' + (109 - n) + '칸은 FREESECT(0xFFFFFFFF)';
        }
        default: {
          var out = [];
          for (var i = 0; i < Math.min(f.len, 16); i++) out.push(U.hexb(b[f.off + i]));
          return out.join(' ') + (f.len > 16 ? ' …' : '');
        }
      }
    }

    function pick(id, p) {
      selected = id;
      var f = C.HEADER_FIELDS.filter(function (x) { return x.id === id; })[0];
      U.$$('.field', chips).forEach(function (n) { n.classList.toggle('is-sel', n.dataset.id === id); });
      U.clear(detail);
      detail.appendChild(el('div', { style: { fontFamily: 'var(--font-body)', marginBottom: '.5rem' } }, [
        el('strong', { text: f.name }),
        el('span', { class: 'chip', style: { marginLeft: '.5rem' },
          text: U.hex(f.off, 2) + ' · ' + f.len + '바이트' }),
        f.expect ? el('span', { class: 'chip', style: { marginLeft: '.3rem' }, text: '기대값: ' + f.expect }) : null
      ]));
      detail.appendChild(el('div', { style: { marginBottom: '.5rem' } }, '값 = ' + readField(p, f)));
      detail.appendChild(el('div', { style: { fontFamily: 'var(--font-body)', color: 'var(--ink-2)' }, text: f.desc }));
      hv.render(p.bytes, {
        from: 0, to: 512,
        ranges: [{ start: f.off, len: f.len, tone: 1 }],
        label: '파일 오프셋 0x000 – 0x1FF · 헤더 512바이트'
      });
      hv.scrollToOffset(f.off, 0);
      U.select({ ranges: [{ start: f.off, len: f.len, tone: 1 }], focus: f.off });
    }

    function render(p) {
      U.clear(strip);
      C.HEADER_FIELDS.forEach(function (f) {
        var isDifat = f.id === 'difat';
        strip.appendChild(el('div', {
          title: f.name + ' — ' + f.len + '바이트',
          style: {
            flex: f.len + ' 0 0', minWidth: '2px',
            background: isDifat ? 'var(--c-table)' : 'var(--ink-3)',
            opacity: isDifat ? '1' : String(0.35 + 0.5 * ((C.HEADER_FIELDS.indexOf(f) % 3) / 3)),
            borderRadius: '2px'
          }
        }));
      });
      U.clear(stripNote);
      stripNote.appendChild(document.createTextNode('헤더 512바이트를 실제 비율로 그린 것이다. 오른쪽의 커다란 파란 덩어리 하나가 '));
      stripNote.appendChild(el('strong', { text: 'DIFAT 436바이트(85%)' }));
      stripNote.appendChild(document.createTextNode('다. 헤더의 대부분은 "FAT이 어디 있는지"를 적어 두는 데 쓰인다.'));

      U.clear(chips);
      C.HEADER_FIELDS.forEach(function (f) {
        chips.appendChild(el('button', {
          class: 'field', 'data-id': f.id, type: 'button',
          style: { flex: '1 1 ' + (f.id === 'difat' ? '100%' : '130px') },
          onclick: function () { pick(f.id, p); }
        }, [f.short || f.name, el('small', { text: U.hex(f.off, 2) + ' · ' + f.len + 'B' })]));
      });
      pick(selected, p);
    }
    return { render: render };
  }

  /* ==================================================================
   * 2. FAT 패널 — 체인 따라가기
   * ================================================================== */
  function fatPanel(node, mapRef) {
    var picker = el('select', { class: 'btn' });
    var playBtn = el('button', { class: 'btn primary', type: 'button', text: '▶ 체인 따라가기' });
    var stepBtn = el('button', { class: 'btn', type: 'button', text: '한 칸씩' });
    var resetBtn = el('button', { class: 'btn', type: 'button', text: '처음으로' });
    var chainEl = el('div', { class: 'chain', style: { marginTop: '.8rem' } });
    var readout = el('div', { class: 'readout', style: { marginTop: '.8rem' } });
    var fatTable = el('div', { class: 'tablewrap', style: { maxHeight: '15rem', overflowY: 'auto', marginTop: '.8rem' } });
    node.appendChild(el('div', { class: 'panel-tools', style: { marginLeft: 0, marginBottom: '.4rem' } },
      [el('span', { class: 'note', text: '스트림 선택' }), picker, playBtn, stepBtn, resetBtn]));
    node.appendChild(chainEl); node.appendChild(readout); node.appendChild(fatTable);

    var P = null, chain = [], pos = -1, timer = null, entry = null;

    function opts(p) {
      U.clear(picker);
      p.live.filter(function (e) { return e.type === C.TYPE_STREAM && e.size > 0 && !e.isMini; })
        .forEach(function (e) {
          picker.appendChild(el('option', { value: e.sid, text: e.displayPath + '  (' + U.bytesLabel(e.size) + ')' }));
        });
      p.live.filter(function (e) { return e.type === C.TYPE_STREAM && e.isMini; })
        .forEach(function (e) {
          picker.appendChild(el('option', { value: e.sid, text: e.displayPath + '  (미니 · ' + U.bytesLabel(e.size) + ')' }));
        });
      picker.appendChild(el('option', { value: 'mini', text: '★ 미니 스트림 전체 (루트 엔트리 소유)' }));
      picker.appendChild(el('option', { value: 'dir', text: '★ 디렉터리 체인' }));
    }

    function load() {
      stop();
      var v = picker.value;
      if (v === 'mini') { entry = null; chain = P.miniStreamSectors.slice(); }
      else if (v === 'dir') { entry = null; chain = P.dirSectors.slice(); }
      else {
        entry = P.entries[+v];
        chain = entry.isMini ? (entry.miniChain || []).slice() : (entry.chain || []).slice();
      }
      pos = -1;
      draw();
    }

    function draw() {
      U.clear(chainEl);
      var isMini = entry && entry.isMini;
      chain.forEach(function (s, i) {
        if (i) chainEl.appendChild(el('span', { class: 'chain-arrow', text: '→' }));
        chainEl.appendChild(el('span', {
          class: 'chain-node' + (i === pos ? ' is-current' : i < pos ? ' is-done' : ''),
          text: (isMini ? 'm' : '') + s
        }));
      });
      chainEl.appendChild(el('span', { class: 'chain-arrow', text: '→' }));
      chainEl.appendChild(el('span', { class: 'chain-node term', text: 'ENDOFCHAIN' }));

      var lines = [];
      if (pos < 0) {
        lines.push(entry
          ? '"' + entry.displayPath + '" — 크기 ' + U.num(entry.size) + '바이트, 시작 ' +
            (entry.isMini ? '미니 섹터 ' : '섹터 ') + entry.start
          : (picker.value === 'mini' ? '미니 스트림 — 루트 엔트리가 소유한 하나의 큰 스트림'
                                     : '디렉터리 체인 — 헤더의 First Directory Sector에서 출발'));
        lines.push('섹터 ' + chain.length + '개 = ' + U.num(chain.length * (entry && entry.isMini ? P.miniSectorSize : P.sectorSize)) + '바이트를 차지한다.');
        if (entry && !entry.isMini) {
          var slack = chain.length * P.sectorSize - entry.size;
          lines.push(slack === 0
            ? '크기가 섹터 경계에 딱 맞아떨어져 버리는 공간이 없다. 흔치 않은 경우다.'
            : '마지막 섹터의 뒤쪽 ' + U.num(slack) + '바이트는 쓰이지 않는다(내부 단편화). ' +
              '읽는 쪽은 반드시 크기 필드대로 잘라내야 한다.');
        }
        lines.push('▶ 를 눌러 한 칸씩 따라가 보자.');
      } else {
        var s = chain[pos];
        var table = entry && entry.isMini ? 'MiniFAT' : 'FAT';
        var nextV = entry && entry.isMini ? P.minifat[s] : P.fat[s];
        var nm = C.sectName(nextV);
        lines.push(table + '[' + s + '] = ' + (nm || nextV) + (nm ? '  ← 체인 끝' : '  → 다음은 섹터 ' + nextV));
        if (entry && entry.isMini) {
          var loc = P.miniSectorOffset(s);
          lines.push('미니 섹터 ' + s + ' → 미니 스트림 안 ' + U.hex(s * P.miniSectorSize, 6) +
                     ' → 미니 스트림의 ' + loc.indexInMiniStream + '번째 섹터(=섹터 ' + loc.sector + ')의 ' +
                     U.hex(loc.within, 4) + ' 지점 → 파일 오프셋 ' + U.hex(loc.offset, 6));
        } else {
          lines.push('섹터 ' + s + ' → 파일 오프셋 (' + s + ' + 1) × ' + P.sectorSize + ' = ' + U.hex(P.sectOff(s), 6));
        }
        lines.push('진행: ' + (pos + 1) + ' / ' + chain.length + '섹터');
      }
      readout.textContent = lines.join('\n');

      var lit, cur = null, focus = null;
      if (entry && entry.isMini) {
        lit = chain.slice(0, Math.max(pos + 1, 0)).map(function (m) {
          var l = P.miniSectorOffset(m); return l ? l.sector : -1;
        }).filter(function (x) { return x >= 0; });
        if (pos >= 0) { var l2 = P.miniSectorOffset(chain[pos]); if (l2) { cur = l2.sector; focus = l2.offset; } }
        if (pos < 0) lit = P.miniStreamSectors.slice();
      } else {
        lit = pos < 0 ? chain.slice() : chain.slice(0, pos + 1);
        if (pos >= 0) { cur = chain[pos]; focus = P.sectOff(chain[pos]); }
      }
      var ranges = [];
      if (pos >= 0 && !(entry && entry.isMini)) {
        ranges.push({ start: P.sectOff(chain[pos]), len: P.sectorSize, tone: 4 });
      } else if (pos >= 0) {
        var lo = P.miniSectorOffset(chain[pos]);
        if (lo) ranges.push({ start: lo.offset, len: P.miniSectorSize, tone: 4 });
      }
      U.select({ sectors: lit, current: cur, ranges: ranges, focus: focus,
                 sid: entry ? entry.sid : null });
    }

    function step() {
      if (pos + 1 >= chain.length) { stop(); return false; }
      pos++; draw(); return true;
    }
    function play() {
      if (timer) { stop(); return; }
      if (pos + 1 >= chain.length) pos = -1;
      playBtn.textContent = '⏸ 멈춤';
      timer = setInterval(function () { if (!step()) stop(); }, 480);
      step();
    }
    function stop() { if (timer) clearInterval(timer); timer = null; playBtn.textContent = '▶ 체인 따라가기'; }

    playBtn.onclick = play;
    stepBtn.onclick = function () { stop(); step(); };
    resetBtn.onclick = function () { stop(); pos = -1; draw(); };
    picker.onchange = load;

    function renderFatTable(p) {
      U.clear(fatTable);
      var t = el('table', { class: 'data' });
      t.appendChild(el('thead', {}, el('tr', {}, [
        el('th', { class: 'mono', text: 'FAT[n]' }), el('th', { class: 'mono', text: '값' }),
        el('th', { text: '뜻' }), el('th', { text: '섹터 n의 용도' })
      ])));
      var tb = el('tbody');
      var lim = Math.min(p.totalSectors, 80);
      for (var i = 0; i < lim; i++) {
        (function (i) {
          var v = p.fat[i] >>> 0, nm = C.sectName(v);
          tb.appendChild(el('tr', { class: 'clickable', onclick: function () {
            U.select({ sectors: [i], current: i, focus: p.sectOff(i),
                       ranges: [{ start: p.sectOff(i), len: p.sectorSize, tone: 4 }] });
          } }, [
            el('td', { class: 'mono', text: String(i) }),
            el('td', { class: 'mono', text: nm ? U.hex(v, 8) : String(v) }),
            el('td', { text: nm === 'ENDOFCHAIN' ? '체인의 마지막 섹터' :
                            nm === 'FATSECT' ? '이 섹터는 FAT 자신' :
                            nm === 'DIFSECT' ? '이 섹터는 DIFAT' :
                            nm === 'FREESECT' ? '비어 있음' : '다음 섹터는 ' + v }),
            el('td', {}, [
              el('span', { class: 'legend-sw sector', 'data-role': p.roles[i],
                style: { display: 'inline-block', verticalAlign: '-2px', marginRight: '.4rem' } }),
              p.owner[i] || C.ROLE_LABEL[p.roles[i]]
            ])
          ]));
        })(i);
      }
      t.appendChild(tb);
      fatTable.appendChild(t);
      if (p.totalSectors > lim) {
        fatTable.appendChild(el('p', { class: 'note', style: { padding: '.5rem' },
          text: '앞 ' + lim + '칸만 보여 준다. 전체 ' + U.num(p.totalSectors) + '칸.' }));
      }
    }

    function render(p) {
      P = p; stop();
      opts(p); renderFatTable(p);
      load();
    }
    return { render: render };
  }

  /* ==================================================================
   * 3. DIFAT 패널 — 3단 간접 참조 계산기
   * ================================================================== */
  function difatPanel(node) {
    var input = el('input', { class: 'btn mono', type: 'range', min: '10', max: '34',
      value: '20', step: '1', style: { width: 'min(340px, 100%)' } });
    var ver = el('select', { class: 'btn' }, [
      el('option', { value: '3', text: 'v3 — 섹터 512B' }),
      el('option', { value: '4', text: 'v4 — 섹터 4096B' })
    ]);
    var sizeOut = el('div', { class: 'val' });
    var out = el('div', { class: 'readout', style: { marginTop: '.8rem' } });
    var ladder = el('div', { style: { marginTop: '.8rem' } });
    node.appendChild(el('div', { class: 'calc' }, [
      el('div', {}, [el('label', { text: '파일 크기' }), sizeOut]),
      el('div', { style: { flex: '1 1 260px' } }, [el('label', { text: '슬라이더로 크기를 바꿔 보자' }), input]),
      el('div', {}, [el('label', { text: '버전' }), ver])
    ]));
    node.appendChild(out); node.appendChild(ladder);

    function calc() {
      var bytes = Math.pow(2, +input.value);
      var SS = ver.value === '4' ? 4096 : 512;
      var per = SS / 4;
      var sectors = Math.ceil(bytes / SS);
      var nFat = Math.ceil(sectors / per);
      var overflow = Math.max(0, nFat - 109);
      var nDifat = overflow ? Math.ceil(overflow / (per - 1)) : 0;
      /* 헤더가 차지한 섹터 한 장도 파일의 일부다. 109 × per × SS 는
         "섹터 영역"만 세고 헤더를 빠뜨린 값이다. */
      var headerReach = (1 + C.HEADER_DIFAT_LEN * per) * SS;

      sizeOut.textContent = U.bytesLabel(bytes);
      var lines = [];
      lines.push('섹터 크기       = ' + SS + '바이트   (FAT 한 장에 ' + per + '칸)');
      lines.push('전체 섹터 수    = ' + U.num(bytes) + ' ÷ ' + SS + ' = ' + U.num(sectors) + '개');
      lines.push('필요한 FAT 섹터 = ' + U.num(sectors) + ' ÷ ' + per + ' = ' + U.num(nFat) + '장');
      lines.push('');
      if (nDifat === 0) {
        lines.push('FAT 섹터가 ' + U.num(nFat) + '장 ≤ 109장 이므로');
        lines.push('→ 헤더 안 DIFAT 109칸만으로 충분하다. DIFAT 섹터: 0개.');
        lines.push('→ 헤더 한 장(512바이트)만 읽으면 FAT의 위치를 전부 알 수 있다. 2단 참조.');
      } else {
        lines.push('FAT 섹터가 ' + U.num(nFat) + '장 > 109장 → 헤더에 다 못 적는다!');
        lines.push('넘치는 ' + U.num(overflow) + '장을 DIFAT 섹터에 적는다.');
        lines.push('DIFAT 섹터 한 장은 ' + (per - 1) + '칸 + 마지막 1칸(다음 DIFAT 섹터 주소).');
        lines.push('→ 필요한 DIFAT 섹터: ' + U.num(overflow) + ' ÷ ' + (per - 1) + ' = ' + U.num(nDifat) + '개. 3단 참조.');
      }
      lines.push('');
      lines.push('이 버전에서 헤더 DIFAT만으로 닿을 수 있는 최대 크기:');
      lines.push('  (1 + 109 × ' + per + ') × ' + SS + ' = ' + U.num(headerReach) +
                 '바이트 = ' + U.bytesLabel(headerReach));
      lines.push('  앞의 1은 헤더가 차지한 섹터다. 이걸 빼먹은 계산이 흔하다.');
      if (SS === 512) {
        lines.push('');
        lines.push('※ 명세 본문은 이 값을 "약 6.875 MB"라고 적어 두었는데,');
        lines.push('   자기가 제시한 공식대로 계산하면 6.81 MiB가 나온다. 명세도 틀릴 때가 있다.');
      }
      out.textContent = lines.join('\n');

      U.clear(ladder);
      var levels = [
        { n: '1단', label: '헤더 DIFAT 109칸', v: Math.min(nFat, 109), max: 109, color: 'var(--ink-3)' },
        { n: '2단', label: 'FAT 섹터', v: nFat, max: Math.max(nFat, 109), color: 'var(--c-table)' },
        { n: '3단', label: 'DIFAT 섹터', v: nDifat, max: Math.max(nDifat, 1), color: 'var(--c-table)' }
      ];
      levels.forEach(function (L) {
        var pct = Math.max(2, Math.min(100, (L.v / L.max) * 100));
        ladder.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '.3rem' } }, [
          el('span', { class: 'mono', style: { fontSize: '.7rem', color: 'var(--ink-3)', width: '2.4rem' }, text: L.n }),
          el('span', { style: { fontSize: '.78rem', width: 'clamp(8rem,16vw,12rem)', flex: 'none' }, text: L.label }),
          el('span', { style: { flex: '1', height: '.6rem', background: 'var(--surface-2)', borderRadius: '2px', overflow: 'hidden' } },
            el('span', { style: { display: 'block', width: pct + '%', height: '100%',
              background: L.v ? L.color : 'var(--rule)', borderRadius: '2px' } })),
          el('span', { class: 'mono', style: { fontSize: '.74rem', width: '5rem', textAlign: 'right' },
            text: U.num(L.v) + '개' })
        ]));
      });
    }
    input.oninput = calc; ver.onchange = calc;
    return { render: calc };
  }

  /* ==================================================================
   * 4. 디렉터리 패널
   * ================================================================== */
  function dirPanel(node) {
    var tree = el('div', { class: 'filetree' });
    var fields = el('div', { class: 'fieldmap', style: { marginTop: '.6rem' } });
    var detail = el('div', { class: 'readout', style: { marginTop: '.6rem', whiteSpace: 'normal' } });
    var hexHost = el('div', { style: { marginTop: '.6rem', border: '1px solid var(--rule)', borderRadius: '3px' } });
    var left = el('div', {}, [el('div', { class: 'panel-title', style: { marginBottom: '.5rem' }, text: '스트림 트리' }), tree]);
    var right = el('div', {}, [
      el('div', { class: 'panel-title', style: { marginBottom: '.5rem' }, text: '128바이트 디렉터리 엔트리' }),
      fields, detail, hexHost
    ]);
    node.appendChild(el('div', { class: 'split b' }, [left, right]));
    var hv = root.HexView.make(hexHost);
    var P = null, curSid = 0, curField = 'name';

    function fieldValue(p, e, f) {
      var b = p.bytes, o = e.offset;
      var dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      switch (f.id) {
        case 'name': return '"' + e.displayName + '"  (' + e.name.length + '글자)';
        case 'nameLen': return e.nameLen + '바이트 = (' + e.name.length + '글자 + NULL 1개) × 2';
        case 'type': return e.type + ' = ' + e.typeName;
        case 'color': return e.color + ' = ' + (e.color === C.COLOR_RED ? 'RED' : 'BLACK');
        case 'left': return U.sid(e.left) + (e.left !== C.NOSTREAM && p.entries[e.left] ? '  "' + p.entries[e.left].displayName + '"' : '');
        case 'right': return U.sid(e.right) + (e.right !== C.NOSTREAM && p.entries[e.right] ? '  "' + p.entries[e.right].displayName + '"' : '');
        case 'child': return U.sid(e.child) + (e.child !== C.NOSTREAM && p.entries[e.child] ? '  "' + p.entries[e.child].displayName + '" (자식 트리의 뿌리)' : '');
        case 'clsid': return e.clsid === '00000000-0000-0000-0000-000000000000'
          ? '모두 0' : e.clsid + (e.knownClsid ? '\n= ' + e.knownClsid : '');
        case 'state': return U.hex(e.state, 8);
        case 'ctime': case 'mtime': {
          var d = f.id === 'ctime' ? e.ctime : e.mtime;
          return d ? d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '0 (기록 안 함)';
        }
        case 'start': {
          var v = e.start >>> 0, nm = C.sectName(v);
          if (nm) return U.hex(v, 8) + ' = ' + nm;
          if (e.sid === 0) return '섹터 ' + v + ' — 미니 스트림의 첫 섹터';
          return e.isMini ? '미니 섹터 ' + v + ' (미니 스트림 안 ' + U.hex(v * p.miniSectorSize, 6) + ')'
                          : '섹터 ' + v + ' (파일 오프셋 ' + U.hex(p.sectOff(v), 6) + ')';
        }
        case 'size': return U.num(e.size) + '바이트' +
          (e.sid === 0 ? ' — 미니 스트림 전체 길이' :
           e.type === C.TYPE_STREAM ? (e.isMini ? ' → 4096 미만이라 미니 스트림' : ' → 4096 이상이라 일반 섹터') : '');
        default: {
          var out = [];
          for (var i = 0; i < Math.min(f.len, 16); i++) out.push(U.hexb(b[o + i]));
          return out.join(' ');
        }
      }
    }

    function pickField(id) {
      curField = id;
      var e = P.entries[curSid];
      var f = C.DIR_FIELDS.filter(function (x) { return x.id === id; })[0];
      U.$$('.field', fields).forEach(function (n) { n.classList.toggle('is-sel', n.dataset.id === id); });
      U.clear(detail);
      detail.appendChild(el('div', { style: { marginBottom: '.4rem' } }, [
        el('strong', { text: f.name }),
        el('span', { class: 'chip', style: { marginLeft: '.5rem' },
          text: '엔트리 안 +' + U.hex(f.off, 2) + ' · ' + f.len + 'B' }),
        el('span', { class: 'chip', style: { marginLeft: '.3rem' },
          text: '파일 ' + U.hex(e.offset + f.off, 6) })
      ]));
      detail.appendChild(el('div', { class: 'mono', style: { whiteSpace: 'pre-wrap', marginBottom: '.4rem' },
        text: fieldValue(P, e, f) }));
      detail.appendChild(el('div', { style: { color: 'var(--ink-2)' }, text: f.desc }));
      hv.render(P.bytes, {
        from: e.offset, to: e.offset + 128,
        ranges: [{ start: e.offset + f.off, len: f.len, tone: 1 }],
        label: 'SID ' + e.sid + ' — "' + e.displayName + '" · 128바이트'
      });
      U.select({
        sid: e.sid,
        ranges: [{ start: e.offset + f.off, len: f.len, tone: 1 }],
        sectors: e.type === C.TYPE_STREAM && !e.isMini ? (e.chain || []) : [e.sector],
        focus: e.offset + f.off
      });
    }

    function pick(sid) {
      curSid = sid;
      U.$$('button', tree).forEach(function (n) { n.classList.toggle('is-sel', +n.dataset.sid === sid); });
      U.clear(fields);
      C.DIR_FIELDS.forEach(function (f) {
        fields.appendChild(el('button', {
          class: 'field', 'data-id': f.id, type: 'button',
          style: { flex: '1 1 ' + (f.len >= 16 ? '150px' : '96px') },
          onclick: function () { pickField(f.id); }
        }, [f.short || f.name,
            el('small', { text: '+' + U.hex(f.off, 2) + ' · ' + f.len + 'B' })]));
      });
      pickField(curField);
    }

    function render(p) {
      P = p;
      U.clear(tree);
      function row(e, depth) {
        var icon = e.type === C.TYPE_ROOT ? '▣' : e.type === C.TYPE_STORAGE ? '▸' : '·';
        tree.appendChild(el('button', {
          type: 'button', 'data-sid': e.sid,
          style: { paddingLeft: (depth * 1.1 + 0.3) + 'rem' },
          onclick: function () { pick(e.sid); }
        }, [
          el('span', { class: 'ft-kind', text: icon }),
          el('span', { text: e.sid === 0 ? 'Root Entry' : e.displayName }),
          el('span', { class: 'ft-size', text: e.type === C.TYPE_STREAM
            ? U.bytesLabel(e.size) + (e.isMini ? ' ·미니' : '') : '' })
        ]));
        (e.children || []).forEach(function (c) { row(c, depth + 1); });
      }
      row(p.root, 0);
      if (!p.entries[curSid] || p.entries[curSid].type === C.TYPE_UNALLOCATED) curSid = 0;
      pick(curSid);
    }
    return { render: render, pick: function (sid) { pick(sid); } };
  }

  /* ==================================================================
   * 5. 레드-블랙 트리 그림
   * ================================================================== */
  function treePanel(node) {
    var picker = el('select', { class: 'btn' });
    var orderBtn = el('button', { class: 'btn', type: 'button', text: '▶ 중위 순회' });
    var host = el('div', { class: 'treewrap', style: { marginTop: '.6rem' } });
    var orderOut = el('div', { class: 'readout', style: { marginTop: '.6rem' } });
    node.appendChild(el('div', { class: 'panel-tools', style: { marginLeft: 0 } },
      [el('span', { class: 'note', text: '저장소' }), picker, orderBtn]));
    node.appendChild(host); node.appendChild(orderOut);
    var P = null, timer = null;

    function layout(rootSid) {
      var nodes = [], x = 0;
      function walk(sid, depth) {
        if (sid === C.NOSTREAM || !P.entries[sid] || P.entries[sid].type === C.TYPE_UNALLOCATED) return null;
        var e = P.entries[sid];
        var L = walk(e.left, depth + 1);
        var me = { e: e, depth: depth, x: x++, left: L, right: null };
        nodes.push(me);
        me.right = walk(e.right, depth + 1);
        return me;
      }
      var r = walk(rootSid, 0);
      return { root: r, nodes: nodes };
    }

    function draw(rootSid, highlightOrder) {
      U.clear(host);
      var L = layout(rootSid);
      if (!L.root) { host.appendChild(el('p', { class: 'note', text: '자식이 없는 저장소다.' })); return; }
      var cw = 132, ch = 74;
      var maxDepth = Math.max.apply(null, L.nodes.map(function (n) { return n.depth; }));
      var W = L.nodes.length * cw + 40, H = (maxDepth + 1) * ch + 50;
      var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H,
        role: 'img', 'aria-label': '디렉터리 자식들을 묶은 레드-블랙 트리' });
      var px = function (n) { return 20 + n.x * cw + cw / 2; };
      var py = function (n) { return 34 + n.depth * ch; };
      L.nodes.forEach(function (n) {
        [n.left, n.right].forEach(function (c) {
          if (!c) return;
          s.appendChild(svg('line', { x1: px(n), y1: py(n) + 13, x2: px(c), y2: py(c) - 13,
            stroke: 'var(--ink-3)', 'stroke-width': 1.5 }));
        });
      });
      L.nodes.forEach(function (n) {
        var isRed = n.e.color === C.COLOR_RED;
        var g = svg('g', { class: 'rb-node' });
        g.appendChild(svg('rect', {
          x: px(n) - cw / 2 + 8, y: py(n) - 13, width: cw - 16, height: 26, rx: 13,
          fill: isRed ? 'var(--c-dir)' : 'var(--surface-2)',
          stroke: isRed ? 'var(--c-dir)' : 'var(--ink)', 'stroke-width': 1.5
        }));
        var label = n.e.displayName;
        if (label.length > 13) label = label.slice(0, 12) + '…';
        g.appendChild(svg('text', {
          x: px(n), y: py(n) + 4, 'text-anchor': 'middle',
          fill: isRed ? '#fff' : 'var(--ink)'
        }, label));
        g.appendChild(svg('title', {}, n.e.displayName + ' — ' + (isRed ? 'RED' : 'BLACK') +
          ' · SID ' + n.e.sid + ' · 이름 길이 ' + n.e.name.length));
        if (highlightOrder && highlightOrder.indexOf(n.e.sid) >= 0) {
          g.appendChild(svg('circle', { cx: px(n), cy: py(n) - 22, r: 8,
            fill: 'var(--ink)' }));
          g.appendChild(svg('text', { x: px(n), y: py(n) - 18, 'text-anchor': 'middle',
            fill: 'var(--paper)', 'font-size': '10' }, String(highlightOrder.indexOf(n.e.sid) + 1)));
        }
        s.appendChild(g);
      });
      host.appendChild(s);
    }

    function inorder(rootSid) {
      var out = [];
      (function walk(sid) {
        if (sid === C.NOSTREAM || !P.entries[sid] || P.entries[sid].type === C.TYPE_UNALLOCATED) return;
        var e = P.entries[sid];
        walk(e.left); out.push(e); walk(e.right);
      })(rootSid);
      return out;
    }

    function play() {
      if (timer) { clearInterval(timer); timer = null; orderBtn.textContent = '▶ 중위 순회'; return; }
      var sid = +picker.value;
      var seq = inorder(P.entries[sid].child);
      var i = 0;
      orderBtn.textContent = '⏸ 멈춤';
      timer = setInterval(function () {
        i++;
        if (i > seq.length) {
          clearInterval(timer); timer = null; orderBtn.textContent = '▶ 중위 순회';
          return;
        }
        var shown = seq.slice(0, i);
        draw(P.entries[sid].child, shown.map(function (e) { return e.sid; }));
        orderOut.textContent = '중위 순회 결과 (이름 길이 → 대문자 순):\n' +
          shown.map(function (e, k) {
            return (k + 1) + '. ' + e.displayName + '   (길이 ' + e.name.length + ')';
          }).join('\n');
      }, 520);
    }

    function render(p) {
      P = p;
      if (timer) { clearInterval(timer); timer = null; orderBtn.textContent = '▶ 중위 순회'; }
      U.clear(picker);
      p.live.filter(function (e) {
        return (e.type === C.TYPE_ROOT || e.type === C.TYPE_STORAGE) && e.child !== C.NOSTREAM;
      }).forEach(function (e) {
        picker.appendChild(el('option', { value: e.sid, text: (e.sid === 0 ? '/ (Root Entry)' : e.displayPath) }));
      });
      picker.onchange = function () { U.clear(orderOut); draw(P.entries[+picker.value].child); };
      orderBtn.onclick = play;
      U.clear(orderOut);
      if (picker.value) draw(P.entries[+picker.value].child);
    }
    return { render: render };
  }

  /* ==================================================================
   * 6. 미니 스트림 주소 변환기
   * ================================================================== */
  function miniPanel(node) {
    var sizeIn = el('input', { type: 'range', min: '0', max: '8192', step: '64', value: '2048',
      style: { width: 'min(360px,100%)' } });
    var sizeOut = el('div', { class: 'val' });
    var verdict = el('div', { style: { marginTop: '.4rem', fontSize: '.9rem' } });
    var waste = el('div', { class: 'note', style: { marginTop: '.2rem' } });
    var bar = el('div', { style: { display: 'flex', gap: '2px', marginTop: '.7rem', flexWrap: 'wrap' } });
    var tradeoff = el('div', { style: { marginTop: '.9rem' } });
    var trans = el('div', { class: 'readout', style: { marginTop: '1rem' } });
    var offIn = el('input', { class: 'btn mono', type: 'number', min: '0', value: '100', style: { width: '7rem' } });
    var streamSel = el('select', { class: 'btn' });

    node.appendChild(el('div', { class: 'calc' }, [
      el('div', {}, [el('label', { text: '스트림 크기' }), sizeOut]),
      el('div', { style: { flex: '1 1 280px' } }, [
        el('label', { text: '0 – 8192바이트' }), sizeIn])
    ]));
    node.appendChild(verdict); node.appendChild(waste); node.appendChild(bar); node.appendChild(tradeoff);
    node.appendChild(el('hr', { style: { border: 0, borderTop: '1px solid var(--rule)', margin: '1.2rem 0' } }));
    node.appendChild(el('div', { class: 'calc' }, [
      el('div', {}, [el('label', { text: '미니 스트림' }), streamSel]),
      el('div', {}, [el('label', { text: '그 안의 바이트 위치' }), offIn])
    ]));
    node.appendChild(trans);
    var P = null;

    function sizeCalc() {
      var n = +sizeIn.value;
      var mini = n > 0 && n < 4096;
      sizeOut.textContent = U.num(n) + ' B';
      U.clear(verdict);
      if (n === 0) {
        verdict.appendChild(el('span', { class: 'chip', text: '길이 0' }));
        verdict.appendChild(document.createTextNode(' 섹터를 하나도 쓰지 않는다. 시작 위치는 ENDOFCHAIN.'));
        waste.textContent = '';
      } else {
        verdict.appendChild(el('strong', { text: n + (mini ? ' < 4096' : ' ≥ 4096') }));
        verdict.appendChild(document.createTextNode(mini
          ? ' → 미니 스트림에 넣는다. 64바이트 미니 섹터 ' + Math.ceil(n / 64) + '개.'
          : ' → 일반 섹터에 넣는다. 512바이트 섹터 ' + Math.ceil(n / 512) + '개.'));
        var unit = mini ? 64 : 512;
        var used = Math.ceil(n / unit) * unit;
        waste.textContent = '실제로 차지하는 공간 ' + U.num(used) + '바이트 → 버리는 공간 ' +
          U.num(used - n) + '바이트' + (mini ? '' : '  ← 미니 스트림이 없었다면 이만큼을 낭비했을 것이다');
      }
      U.clear(bar);
      var unit2 = mini ? 64 : 512;
      var cnt = Math.min(Math.ceil(n / unit2), 64);
      for (var i = 0; i < cnt; i++) {
        var full = (i + 1) * unit2 <= n;
        bar.appendChild(el('span', {
          title: (mini ? '미니 섹터 ' : '섹터 ') + i,
          style: {
            width: mini ? '14px' : '30px', height: '18px', borderRadius: '2px',
            background: full ? 'var(--c-data)' : 'var(--surface-2)',
            border: full ? 'none' : '1px dashed var(--rule)',
            backgroundImage: mini ? 'repeating-linear-gradient(135deg, rgb(255 255 255 / .34) 0 2px, transparent 2px 5px)' : ''
          }
        }));
      }
      if (n > 0 && cnt) {
        bar.appendChild(el('span', { class: 'note', style: { alignSelf: 'center', marginLeft: '.5rem' },
          text: (mini ? '64B 미니 섹터' : '512B 섹터') + ' × ' + Math.ceil(n / unit2) +
                (Math.ceil(n / unit2) > 64 ? ' (앞 64개만 표시)' : '') }));
      }
      renderTradeoff(n);
    }

    /* 미니 스트림이 언제 손해인가 ------------------------------------------
     * "작은 건 미니에 넣으면 이득"은 절반만 맞다. 표 비용까지 세면
     * 두 계단이 서로를 여러 번 넘나든다.
     *   미니 = ceil(n/64) × (64 + 4)      64바이트 + MiniFAT 4바이트
     *   일반 = ceil(n/512) × (512 + 4)    512바이트 + FAT 4바이트
     * (미니 스트림을 담는 그릇 자체의 값은 여기서 뺐다 — 여러 스트림이
     *  나눠 지므로 스트림 하나에 얹기 어렵다.)                             */
    function renderTradeoff(n) {
      U.clear(tradeoff);
      if (!n) return;
      var miniCost = Math.ceil(n / 64) * 68;
      var bigCost = Math.ceil(n / 512) * 516;
      var rule = n < 4096 ? 'mini' : 'big';
      var best = miniCost <= bigCost ? 'mini' : 'big';
      var max = Math.max(miniCost, bigCost);
      [['미니 스트림에 넣으면', miniCost, 'mini'], ['일반 섹터에 넣으면', bigCost, 'big']].forEach(function (row) {
        tradeoff.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '.25rem' } }, [
          el('span', { style: { fontSize: '.78rem', width: 'clamp(8rem,15vw,10rem)', flex: 'none' }, text: row[0] }),
          el('span', { style: { flex: '1', height: '.55rem', background: 'var(--surface-2)', borderRadius: '2px', overflow: 'hidden' } },
            el('span', { style: { display: 'block', width: Math.max(2, (row[1] / max) * 100) + '%', height: '100%',
              background: row[2] === rule ? 'var(--c-data)' : 'var(--rule)', borderRadius: '2px' } })),
          el('span', { class: 'mono', style: { fontSize: '.74rem', width: '5.5rem', textAlign: 'right' },
            text: U.num(row[1]) + ' B' }),
          row[2] === rule ? el('span', { class: 'chip', text: '규칙이 고르는 쪽' }) : el('span', { style: { width: '0' } })
        ]));
      });
      tradeoff.appendChild(el('p', { class: 'note', style: { margin: '.35rem 0 0' },
        text: best === rule
          ? '이 크기에서는 규칙이 고른 쪽이 실제로도 더 싸다.'
          : '이 크기에서는 규칙이 고른 쪽이 오히려 ' + U.num(Math.abs(miniCost - bigCost)) +
            '바이트 더 든다. 64바이트 계단과 512바이트 계단이 서로를 넘나들기 때문에, ' +
            '"작으면 미니가 이득"은 크기에 따라 참이 되었다 거짓이 되었다 한다.' }));
    }

    function translate() {
      if (!P) return;
      var e = P.entries[+streamSel.value];
      if (!e) { trans.textContent = '이 파일에는 미니 스트림이 없다.'; return; }
      var off = Math.max(0, Math.min(+offIn.value || 0, Math.max(0, e.size - 1)));
      var MSS = P.miniSectorSize, SS = P.sectorSize;
      var idx = Math.floor(off / MSS);
      var within = off % MSS;
      var chain = e.miniChain || [];
      var m = chain[idx];
      var lines = [];
      lines.push('"' + e.displayPath + '"의 ' + off + '번째 바이트를 읽으려면:');
      lines.push('');
      lines.push('① 스트림 안 위치 → 몇 번째 미니 섹터인가');
      lines.push('   ' + off + ' ÷ ' + MSS + ' = ' + idx + ' … ' + within);
      lines.push('   → 이 스트림의 ' + idx + '번째 미니 섹터, 그 안의 ' + within + '바이트 지점');
      lines.push('');
      lines.push('② MiniFAT 체인을 따라 실제 미니 섹터 번호를 찾는다');
      lines.push('   체인: ' + chain.slice(0, 8).map(function (x, i) { return (i === idx ? '[' + x + ']' : x); }).join(' → ') +
                 (chain.length > 8 ? ' …' : ''));
      if (m === undefined) { trans.textContent = lines.join('\n') + '\n   → 범위를 벗어났다.'; return; }
      lines.push('   → 미니 섹터 ' + m);
      lines.push('');
      lines.push('③ 미니 섹터 → 미니 스트림 안의 바이트 위치');
      lines.push('   ' + m + ' × ' + MSS + ' = ' + (m * MSS) + '  (+' + within + ' = ' + (m * MSS + within) + ')');
      lines.push('');
      lines.push('④ 미니 스트림은 그 자체가 일반 스트림이다 — 몇 번째 섹터인가');
      var whichSect = Math.floor((m * MSS) / SS);
      var withinSect = (m * MSS) % SS;
      lines.push('   ' + (m * MSS) + ' ÷ ' + SS + ' = ' + whichSect + ' … ' + withinSect);
      lines.push('   미니 스트림 체인: ' + P.miniStreamSectors.slice(0, 8)
        .map(function (x, i) { return (i === whichSect ? '[' + x + ']' : x); }).join(' → ') +
        (P.miniStreamSectors.length > 8 ? ' …' : ''));
      var sec = P.miniStreamSectors[whichSect];
      lines.push('   → 실제 섹터 ' + sec);
      lines.push('');
      lines.push('⑤ 마침내 파일 오프셋');
      lines.push('   (' + sec + ' + 1) × ' + SS + ' + ' + (withinSect + within) + ' = ' +
                 U.hex(P.sectOff(sec) + withinSect + within, 6) +
                 '  (' + U.num(P.sectOff(sec) + withinSect + within) + ')');
      var byteVal = P.bytes[P.sectOff(sec) + withinSect + within];
      lines.push('   그 자리의 바이트 = ' + U.hexb(byteVal) + '  \'' + U.printable(byteVal) + '\'');
      trans.textContent = lines.join('\n');

      U.select({
        sectors: P.miniStreamSectors, current: sec,
        ranges: [{ start: P.sectOff(sec) + withinSect, len: MSS, tone: 4 },
                 { start: P.sectOff(sec) + withinSect + within, len: 1, tone: 1 }],
        focus: P.sectOff(sec) + withinSect + within, sid: e.sid
      });
    }

    sizeIn.oninput = sizeCalc;
    offIn.oninput = translate;
    streamSel.onchange = function () {
      var e = P.entries[+streamSel.value];
      offIn.max = Math.max(0, e.size - 1);
      translate();
    };

    function render(p) {
      P = p;
      U.clear(streamSel);
      p.live.filter(function (e) { return e.type === C.TYPE_STREAM && e.isMini; })
        .forEach(function (e) {
          streamSel.appendChild(el('option', { value: e.sid,
            text: e.displayPath + '  (' + U.num(e.size) + 'B)' }));
        });
      sizeCalc(); translate();
    }
    return { render: render };
  }

  root.Panels = {
    headerPanel: headerPanel, fatPanel: fatPanel, difatPanel: difatPanel,
    dirPanel: dirPanel, treePanel: treePanel, miniPanel: miniPanel
  };
})(window);
