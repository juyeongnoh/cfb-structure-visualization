/* =====================================================================
 * ui-story.js — 읽기 워크스루, 쓰기 실습실, 파일 열기
 * ===================================================================== */
(function (root) {
  'use strict';
  var U = root.UI, el = U.el, C = root.CFBConst;

  /* ==================================================================
   * 읽기 워크스루 — "이 파일에서 /WordDocument를 읽어라"
   * ================================================================== */
  function buildStory(p, targetSid) {
    var steps = p.trace.map(function (t) {
      return { title: t.title, detail: t.detail, sectors: t.sectors || [],
               ranges: (t.bytes || []).map(function (b) { return { start: b[0], len: b[1], tone: 1 }; }),
               sid: null, focus: (t.bytes && t.bytes[0]) ? t.bytes[0][0] : null };
    });
    var e = p.entries[targetSid];
    if (!e) return steps;

    /* 경로를 따라 트리를 내려가는 과정 */
    var parts = e.path.split('/').filter(Boolean);
    var cur = p.root, pathSoFar = '';
    parts.forEach(function (part, i) {
      var kids = cur.children || [];
      var target = kids.filter(function (k) { return k.name === part; })[0];
      if (!target) return;
      /* 트리 안에서 비교하며 내려간 경로 */
      var probe = cur.child, hops = [];
      var guard = 0;
      while (probe !== C.NOSTREAM && p.entries[probe] && guard++ < 64) {
        var n = p.entries[probe];
        var c = root.RBTree.cmpName(part, n.name);
        if (c === 0) { hops.push('"' + n.displayName + '" 일치'); break; }
        hops.push('"' + n.displayName + '"와 비교 → ' +
          (part.length !== n.name.length
            ? '이름 길이 ' + part.length + (part.length < n.name.length ? ' < ' : ' > ') + n.name.length
            : '대문자 비교') + ' → ' + (c < 0 ? '왼쪽' : '오른쪽'));
        probe = c < 0 ? n.left : n.right;
      }
      pathSoFar += '/' + part;
      steps.push({
        title: (steps.length + 1) + '. 경로 찾기 — "' + part + '"',
        detail: '"' + (cur.sid === 0 ? '/' : cur.displayName) + '"의 자식 트리를 뒤진다. ' +
                '이름 순서대로 정렬된 이진 탐색 트리이므로 전부 훑을 필요가 없다.\n· ' + hops.join('\n· '),
        sectors: [target.sector], sid: target.sid,
        ranges: [{ start: target.offset, len: 128, tone: 1 }],
        focus: target.offset
      });
      cur = target;
    });

    /* 미니/일반 판정 */
    steps.push({
      title: (steps.length + 1) + '. 미니냐 일반이냐',
      detail: '크기 ' + U.num(e.size) + '바이트 ' + (e.isMini ? '< ' : '≥ ') + p.header.miniCutoff +
              ' → ' + (e.isMini ? 'MiniFAT과 미니 스트림을 써야 한다.' : '일반 FAT과 섹터를 쓴다.') +
              ' 시작 위치는 ' + (e.isMini ? '미니 섹터 ' : '섹터 ') + e.start + '.',
      sectors: e.isMini ? p.miniStreamSectors : (e.chain || []),
      sid: e.sid,
      ranges: [{ start: e.offset + 0x74, len: 12, tone: 1 }],
      focus: e.offset + 0x74
    });

    /* 체인 따라가기 */
    var chain = e.isMini ? (e.miniChain || []) : (e.chain || []);
    var shown = Math.min(chain.length, 6);
    for (var i = 0; i < shown; i++) {
      (function (i) {
        var s = chain[i];
        var loc = e.isMini ? p.miniSectorOffset(s) : null;
        var fileOff = e.isMini ? (loc ? loc.offset : 0) : p.sectOff(s);
        var unit = e.isMini ? p.miniSectorSize : p.sectorSize;
        steps.push({
          title: (steps.length + 1) + '. 체인 ' + (i + 1) + '/' + chain.length +
                 ' — ' + (e.isMini ? '미니 섹터 ' : '섹터 ') + s,
          detail: (e.isMini
            ? '미니 섹터 ' + s + ' → 미니 스트림 안 ' + U.hex(s * p.miniSectorSize, 6) +
              ' → 실제 섹터 ' + (loc ? loc.sector : '?') + ' → 파일 오프셋 ' + U.hex(fileOff, 6)
            : '섹터 ' + s + ' → (' + s + ' + 1) × ' + p.sectorSize + ' = 파일 오프셋 ' + U.hex(fileOff, 6)) +
            '. ' + unit + '바이트를 읽어 버퍼에 이어 붙인다. ' +
            (e.isMini ? 'MiniFAT[' : 'FAT[') + s + '] = ' +
            U.sect(e.isMini ? p.minifat[s] : p.fat[s]) + ' 이 다음 목적지다.',
          sectors: e.isMini
            ? chain.slice(0, i + 1).map(function (m) { var l = p.miniSectorOffset(m); return l ? l.sector : -1; })
            : chain.slice(0, i + 1),
          current: e.isMini ? (loc ? loc.sector : null) : s,
          sid: e.sid,
          ranges: [{ start: fileOff, len: unit, tone: 4 }],
          focus: fileOff
        });
      })(i);
    }
    if (chain.length > shown) {
      steps.push({
        title: (steps.length + 1) + '. … 나머지 ' + (chain.length - shown) + '칸도 같은 방식으로',
        detail: '같은 동작을 반복한다: 표에서 다음 번호를 읽고, 번호를 오프셋으로 바꾸고, 읽어서 이어 붙인다. ' +
                'ENDOFCHAIN(0xFFFFFFFE)을 만나면 끝이다.',
        sectors: e.isMini
          ? chain.map(function (m) { var l = p.miniSectorOffset(m); return l ? l.sector : -1; })
          : chain,
        sid: e.sid, ranges: []
      });
    }

    /* 마무리: 크기대로 자르기 */
    var raw = chain.length * (e.isMini ? p.miniSectorSize : p.sectorSize);
    steps.push({
      title: (steps.length + 1) + '. 크기대로 잘라내기 — 마지막이자 잊기 쉬운 단계',
      detail: '읽어 모은 바이트는 ' + U.num(raw) + '바이트지만, 이 스트림의 진짜 길이는 ' + U.num(e.size) +
              '바이트다. 뒤의 ' + U.num(raw - e.size) + '바이트는 패딩이거나, 예전에 여기 있던 다른 데이터의 잔해다. ' +
              '디렉터리 엔트리의 Stream Size 필드대로 잘라야 한다. 이 단계를 빠뜨린 파서는 파일 끝에 쓰레기를 붙인다.',
      sectors: e.isMini
        ? chain.map(function (m) { var l = p.miniSectorOffset(m); return l ? l.sector : -1; })
        : chain,
      sid: e.sid,
      ranges: [{ start: e.offset + 0x78, len: 8, tone: 1 }],
      focus: e.offset + 0x78
    });
    return steps;
  }

  function walkPanel(node) {
    var picker = el('select', { class: 'btn' });
    var prevB = el('button', { class: 'btn', type: 'button', text: '◀' });
    var playB = el('button', { class: 'btn primary', type: 'button', text: '▶ 재생' });
    var nextB = el('button', { class: 'btn', type: 'button', text: '▶|' });
    var progress = el('span', { class: 'chip' });
    var mapHost = el('div', { style: { marginBottom: '.8rem' } });
    var stepsEl = el('div', { class: 'steps', style: { maxHeight: '24rem', overflowY: 'auto' } });
    var hexHost = el('div', { style: { border: '1px solid var(--rule)', borderRadius: '3px' } });

    node.appendChild(el('div', { class: 'panel-tools', style: { marginLeft: 0, marginBottom: '.7rem' } },
      [el('span', { class: 'note', text: '읽을 스트림' }), picker, prevB, playB, nextB, progress]));
    node.appendChild(mapHost);
    node.appendChild(el('div', { class: 'split a' }, [stepsEl, hexHost]));

    var map = root.SectorMap.make(mapHost, { regions: false, onSelect: function () {} });
    var hv = root.HexView.make(hexHost);
    var P = null, story = [], idx = 0, timer = null;

    function show(i) {
      idx = Math.max(0, Math.min(i, story.length - 1));
      var s = story[idx];
      U.$$('.step', stepsEl).forEach(function (n, k) {
        n.classList.toggle('is-current', k === idx);
        n.classList.toggle('is-past', k < idx);
      });
      var cn = stepsEl.children[idx];
      if (cn) cn.scrollIntoView({ block: 'nearest' });
      progress.textContent = (idx + 1) + ' / ' + story.length;
      map.render(P, { sectors: s.sectors || [], current: s.current !== undefined ? s.current : null });
      var from = 0, to = 512;
      if (s.focus !== null && s.focus !== undefined) {
        from = Math.max(0, Math.floor(s.focus / 512) * 512 - 512);
        to = Math.min(P.bytes.length, from + 1536);
      }
      hv.render(P.bytes, { from: from, to: to, ranges: s.ranges || [],
        label: '파일 ' + U.hex(from, 6) + ' – ' + U.hex(to - 1, 6) });
      if (s.focus !== null && s.focus !== undefined) hv.scrollToOffset(s.focus, from);
      U.select({ sectors: s.sectors || [], current: s.current !== undefined ? s.current : null,
                 ranges: s.ranges || [], sid: s.sid, focus: s.focus });
    }

    function build() {
      story = buildStory(P, +picker.value);
      U.clear(stepsEl);
      story.forEach(function (s, i) {
        stepsEl.appendChild(el('button', { class: 'step', type: 'button', onclick: function () { stop(); show(i); } }, [
          el('span', { class: 'step-n', text: String(i + 1).padStart(2, '0') }),
          el('span', {}, [
            el('span', { class: 'step-t', text: s.title.replace(/^\d+\.\s*/, '') }),
            el('span', { class: 'step-d', style: { whiteSpace: 'pre-line' }, text: s.detail })
          ])
        ]));
      });
      show(0);
    }
    function stop() { if (timer) clearInterval(timer); timer = null; playB.textContent = '▶ 재생'; }
    playB.onclick = function () {
      if (timer) { stop(); return; }
      if (idx >= story.length - 1) idx = -1;
      playB.textContent = '⏸ 멈춤';
      timer = setInterval(function () {
        if (idx >= story.length - 1) { stop(); return; }
        show(idx + 1);
      }, 2600);
      show(idx + 1);
    };
    prevB.onclick = function () { stop(); show(idx - 1); };
    nextB.onclick = function () { stop(); show(idx + 1); };
    picker.onchange = function () { stop(); build(); };

    function render(p) {
      P = p; stop();
      var keep = picker.value;
      U.clear(picker);
      p.live.filter(function (e) { return e.type === C.TYPE_STREAM && e.size > 0; })
        .forEach(function (e) {
          picker.appendChild(el('option', { value: e.sid,
            text: e.displayPath + (e.isMini ? '  (미니 · ' : '  (') + U.bytesLabel(e.size) + ')' }));
        });
      if (keep && picker.querySelector('option[value="' + keep + '"]')) picker.value = keep;
      build();
    }
    return { render: render };
  }

  /* ==================================================================
   * 쓰기 실습실
   * ================================================================== */
  function writeLab(node, onFileChanged) {
    var target = el('select', { class: 'btn' });
    var sizeIn = el('input', { class: 'btn mono', type: 'number', value: '6000', min: '0', max: '200000',
      step: '512', style: { width: '7.5rem' } });
    var delB = el('button', { class: 'btn danger', type: 'button', text: '스트림 삭제' });
    var addB = el('button', { class: 'btn', type: 'button', text: '스트림 추가' });
    var growB = el('button', { class: 'btn', type: 'button', text: '크기 변경' });
    var packB = el('button', { class: 'btn', type: 'button', text: '조각 모음(다시 저장)' });
    var undoB = el('button', { class: 'btn', type: 'button', text: '원래대로' });
    var ghostB = el('button', { class: 'btn', type: 'button', text: '👻 지운 데이터 들춰보기' });
    var mapHost = el('div', { style: { marginTop: '.8rem' } });
    var logEl = el('div', { class: 'readout', style: { marginTop: '.8rem', maxHeight: '17rem', overflowY: 'auto' } });
    var statEl = el('div', { class: 'pill-row', style: { marginTop: '.6rem' } });

    node.appendChild(el('div', { class: 'panel-tools', style: { marginLeft: 0 } },
      [el('span', { class: 'note', text: '대상' }), target, delB, growB,
       el('span', { class: 'note', style: { marginLeft: '.4rem' }, text: '크기' }), sizeIn, addB]));
    node.appendChild(el('div', { class: 'panel-tools', style: { marginLeft: 0, marginTop: '.4rem' } },
      [packB, ghostB, undoB]));
    node.appendChild(statEl);
    node.appendChild(mapHost);
    node.appendChild(logEl);

    var map = root.SectorMap.make(mapHost, { regions: false, onSelect: function (s) {
      U.select({ current: s, sectors: [s], focus: cur.sectOff(s),
                 ranges: [{ start: cur.sectOff(s), len: cur.sectorSize, tone: 4 }] });
    } });
    var original = null, cur = null, ghostSectors = [], prevRoles = null, addCount = 0;

    function stats(p) {
      U.clear(statEl);
      var free = p.roles.filter(function (r) { return r === 'free'; }).length;
      [['파일 크기', U.bytesLabel(p.bytes.length)],
       ['섹터', U.num(p.totalSectors) + '개'],
       ['빈 섹터', U.num(free) + '개'],
       ['스트림', U.num(p.live.filter(function (e) { return e.type === C.TYPE_STREAM; }).length) + '개'],
       ['단편화', fragScore(p)]
      ].forEach(function (kv) {
        statEl.appendChild(el('span', { class: 'chip', text: kv[0] + ' ' + kv[1] }));
      });
    }
    /* 체인이 앞뒤로 얼마나 튀는지 — 연속하지 않은 이음매의 비율 */
    function fragScore(p) {
      var jumps = 0, links = 0;
      p.live.forEach(function (e) {
        if (e.type !== C.TYPE_STREAM || !e.chain) return;
        for (var i = 1; i < e.chain.length; i++) { links++; if (e.chain[i] !== e.chain[i - 1] + 1) jumps++; }
      });
      return links ? Math.round((jumps / links) * 100) + '%' : '0%';
    }

    function repaint() {
      map.render(cur, { ghosts: ghostSectors });
      stats(cur);
      /* 방금 바뀐 섹터에 애니메이션 */
      if (prevRoles) {
        U.$$('.sector', mapHost).forEach(function (b, s) {
          if (prevRoles[s] !== cur.roles[s]) {
            b.classList.add('just-changed');
            setTimeout(function () { b.classList.remove('just-changed'); }, 520);
          }
        });
      }
      prevRoles = cur.roles.slice();
      fillTargets();
      if (onFileChanged) onFileChanged(cur);
    }

    function fillTargets() {
      var keep = target.value;
      U.clear(target);
      cur.live.filter(function (e) { return e.type === C.TYPE_STREAM; }).forEach(function (e) {
        target.appendChild(el('option', { value: e.sid,
          text: e.displayPath + '  (' + U.bytesLabel(e.size) + (e.isMini ? ' ·미니' : '') + ')' }));
      });
      if (keep && target.querySelector('option[value="' + keep + '"]')) target.value = keep;
    }

    function applyLog(m) {
      logEl.textContent = m.log.map(function (l) {
        var mark = { op: '▸', free: '  ✂', reuse: '  ♻', grow: '  ＋', dir: '  ▤', tree: '  ⑂',
                     warn: '  ⚠', migrate: '  ⇄', chain: '  ⛓', decide: '  ?', done: '  ✓',
                     fatgrow: '  ⊞', difatgrow: '  ⊞', dirgrow: '  ⊞', note: '  ·' }[l.kind] || '  ·';
        return mark + ' ' + l.text;
      }).join('\n');
    }

    function run(fn) {
      var m = root.CFBOps.toModel(cur);
      fn(m);
      var bytes = root.CFBOps.serialize(m);
      var p = root.CFBParse.parse(bytes);
      if (!p.ok) { logEl.textContent = '오류: ' + p.error; return; }
      applyLog(m);
      cur = p;
      repaint();
    }

    delB.onclick = function () {
      var sid = +target.value;
      var e = cur.entries[sid];
      ghostSectors = e && !e.isMini ? (e.chain || []).slice() : [];
      run(function (m) { root.CFBOps.deleteStream(m, sid); });
    };
    growB.onclick = function () {
      var sid = +target.value;
      ghostSectors = [];
      run(function (m) { root.CFBOps.resizeStream(m, sid, Math.max(0, +sizeIn.value | 0)); });
    };
    addB.onclick = function () {
      var n = Math.max(0, +sizeIn.value | 0);
      addCount++;
      var name = 'NewStream' + addCount;
      var content = new Uint8Array(n);
      var tag = '[' + name + ' 새로 쓴 데이터] ';
      for (var i = 0; i < n; i++) content[i] = tag.charCodeAt(i % tag.length);
      ghostSectors = [];
      run(function (m) { root.CFBOps.addStream(m, 0, name, content); });
    };
    packB.onclick = function () { ghostSectors = []; run(function (m) { root.CFBOps.repack(m); }); };
    undoB.onclick = function () {
      cur = root.CFBParse.parse(original.slice());
      ghostSectors = []; prevRoles = null;
      logEl.textContent = '원래 파일로 되돌렸다.';
      repaint();
    };
    ghostB.onclick = function () {
      var free = [];
      for (var s = 0; s < cur.totalSectors; s++) if (cur.roles[s] === 'free') free.push(s);
      if (!free.length) { logEl.textContent = '빈 섹터가 없다. 먼저 스트림을 하나 지워 보자.'; return; }
      var lines = ['FAT은 이 섹터들을 "비었다"고 말한다: ' + free.join(', '),
                   '하지만 그 자리의 바이트를 그대로 읽어 보면:', ''];
      free.slice(0, 6).forEach(function (s) {
        var o = cur.sectOff(s), txt = '';
        for (var i = 0; i < 64; i++) txt += U.printable(cur.bytes[o + i]);
        lines.push('섹터 ' + String(s).padStart(3) + ' @' + U.hex(o, 6) + '  ' + txt);
      });
      if (free.length > 6) lines.push('… 그리고 ' + (free.length - 6) + '개 더');
      lines.push('');
      lines.push('지운 적이 있는 문서를 남에게 보낼 때 무엇이 함께 가는지 생각해 볼 만하다.');
      logEl.textContent = lines.join('\n');
      ghostSectors = free;
      map.render(cur, { ghosts: ghostSectors });
    };

    function render(p) {
      if (!original) original = p.bytes.slice();
      cur = p; prevRoles = null; ghostSectors = [];
      logEl.textContent = '버튼을 눌러 파일을 바꿔 보자. 모든 연산은 진짜 바이트를 다시 쓰고, ' +
        '그 결과를 파서가 다시 읽는다. 위 지도는 언제나 실제 파일을 비춘다.';
      repaint();
    }
    return { render: render, reset: function () { original = null; } };
  }

  /* ==================================================================
   * 파일 열기
   * ================================================================== */
  function fileLoader(node, onLoad) {
    var input = el('input', { type: 'file', class: 'sr-only', id: 'cfb-file',
      accept: '.doc,.xls,.ppt,.msi,.msg,.db,.vsd,.pub,.dot,.xlt,.pot,.wps,.sda,.sdw,.thmx,application/*' });
    var zone = el('div', { class: 'dropzone' }, [
      el('p', { style: { margin: '0 0 .6rem' } }, [
        el('strong', { text: '내 파일을 여기에 끌어다 놓아 보자' })
      ]),
      el('p', { class: 'note', style: { margin: '0 0 .9rem' } },
        '.doc · .xls · .ppt (2003 이전) · .msi · .msg · Thumbs.db — 전부 CFB 컨테이너다. ' +
        '파일은 브라우저 안에서만 읽히고 아무 곳에도 전송되지 않는다.'),
      el('label', { class: 'btn primary', for: 'cfb-file', style: { cursor: 'pointer' }, text: '파일 고르기' }),
      input
    ]);
    var msg = el('div', { style: { marginTop: '.7rem' } });
    node.appendChild(zone); node.appendChild(msg);

    function handle(file) {
      var fr = new FileReader();
      fr.onload = function () {
        var bytes = new Uint8Array(fr.result);
        U.clear(msg);
        if (bytes.length < 512) {
          msg.appendChild(el('div', { class: 'warnbox', text: '파일이 512바이트보다 작다. CFB 헤더조차 들어갈 수 없다.' }));
          return;
        }
        var p = root.CFBParse.parse(bytes);
        if (!p.ok) {
          var isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
          msg.appendChild(el('div', { class: 'warnbox' },
            p.error + (isZip
              ? ' 앞 두 바이트가 "PK"다 — 이건 ZIP 파일이다. .docx / .xlsx / .pptx는 CFB가 아니라 ZIP이다. ' +
                '(단, 암호가 걸린 .docx는 다시 CFB 껍데기 안에 들어간다.)'
              : ' 첫 8바이트: ' + Array.prototype.slice.call(bytes.subarray(0, 8))
                  .map(U.hexb).join(' ') + '.')));
          return;
        }
        msg.appendChild(el('div', { class: 'pill-row' }, [
          el('span', { class: 'chip', text: file.name }),
          el('span', { class: 'chip', text: U.bytesLabel(bytes.length) }),
          el('span', { class: 'chip', text: 'v' + p.header.majorVersion + ' · 섹터 ' + p.sectorSize + 'B' }),
          el('span', { class: 'chip', text: '섹터 ' + U.num(p.totalSectors) + '개' }),
          el('span', { class: 'chip', text: '엔트리 ' + U.num(p.live.length) + '개' }),
          p.root && p.root.knownClsid ? el('span', { class: 'chip', text: p.root.knownClsid }) : null
        ]));
        if (p.warn.length) {
          msg.appendChild(el('div', { class: 'warnbox', style: { marginTop: '.5rem' } },
            '파서가 남긴 경고: ' + p.warn.slice(0, 5).join(' / ')));
        }
        onLoad(p, file.name);
      };
      fr.readAsArrayBuffer(file);
    }

    input.onchange = function () { if (input.files[0]) handle(input.files[0]); };
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('is-over'); });
    });
    zone.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handle(f);
    });
    return { node: zone };
  }

  root.Story = { walkPanel: walkPanel, writeLab: writeLab, fileLoader: fileLoader, buildStory: buildStory };
})(window);
