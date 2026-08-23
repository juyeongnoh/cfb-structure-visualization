/* =====================================================================
 * main-hwp.js — HWP 페이지 조립
 *
 * 샘플 .hwp를 만들고 → CFB로 파싱하고 → 그 위에 HWP 층을 파싱해서
 * 모든 패널에 나눠 준다. 사용자가 자기 .hwp를 열면 같은 경로로 흐른다.
 * ===================================================================== */
(function (root) {
  'use strict';
  var U = root.UI, el = U.el, C = root.CFBConst, H = root.HWPConst;

  var panels = {}, heroMap, heroRec, heroDetail, heroStat, heroName, toggleBtn, ribbonEl;
  var heroStream = null;
  var ribbonCells = [], compressed = true;

  function buildRibbon(p) {
    U.clear(ribbonEl); ribbonCells = [];
    var step = Math.max(1, Math.ceil(p.totalSectors / 240));
    for (var s = 0; s < p.totalSectors; s += step) {
      var cell = el('i', { 'data-role': p.roles[s],
        title: '섹터 ' + s + ' · ' + (p.owner[s] || C.ROLE_LABEL[p.roles[s]]) });
      ribbonEl.appendChild(cell);
      ribbonCells.push({ node: cell, from: s, to: Math.min(s + step - 1, p.totalSectors - 1) });
    }
  }
  function paintRibbon(sel) {
    var lit = sel && sel.sectors && sel.sectors.length ? sel.sectors : null;
    var cur = sel ? sel.current : null;
    ribbonEl.classList.toggle('has-sel', !!lit || (cur !== null && cur !== undefined));
    ribbonCells.forEach(function (c) {
      var on = cur !== null && cur !== undefined && cur >= c.from && cur <= c.to;
      if (!on && lit) for (var i = 0; i < lit.length; i++) {
        if (lit[i] >= c.from && lit[i] <= c.to) { on = true; break; }
      }
      c.node.classList.toggle('on', on);
    });
  }

  function makeSample() {
    return root.HWPBuild.compose({
      compressed: compressed,
      timestamp: Date.UTC(2024, 2, 14, 10, 0, 0)
    }).bytes;
  }

  /* HWP 층의 정보를 CFB 섹터 지도의 이름표로 되먹인다 —
     "이 섹터는 압축된 본문"처럼 읽히게 만든다. */
  function annotate(cfb, hwp) {
    if (!hwp || !hwp.ok) return;
    hwp.streams.forEach(function (s) {
      var label = s.displayPath.replace(/^\//, '');
      var mark = s.compressed ? label + ' (압축)' : label;
      if (s.entry.isMini) return;                    /* 미니 스트림은 한 덩어리라 구분이 안 된다 */
      (s.entry.chain || []).forEach(function (sec) {
        if (sec >= 0 && sec < cfb.totalSectors) cfb.owner[sec] = mark;
      });
    });
  }

  function distribute(cfb, name) {
    var hwp = root.HWPParse.parse(cfb);
    if (!hwp.ok) {
      U.clear(heroDetail);
      heroDetail.appendChild(el('div', { class: 'warnbox', text: hwp.error }));
      return false;
    }
    annotate(cfb, hwp);
    U.set({ bytes: cfb.bytes, parsed: cfb, hwp: hwp, fileName: name });
    Object.keys(panels).forEach(function (k) {
      try { panels[k].render(hwp); } catch (e) { console.error('패널 ' + k + ' 렌더 실패', e); }
    });
    heroMap.render(cfb, {});
    heroStream = hwp.recordStreams.filter(function (x) { return /Section/.test(x.path); })[0] ||
                 hwp.recordStreams[0];
    if (heroStream) heroRec.render(heroStream, null);
    buildRibbon(cfb); paintRibbon(null);
    if (heroName) heroName.textContent = name;
    heroStat.textContent = U.bytesLabel(cfb.bytes.length) + ' · 섹터 ' + cfb.totalSectors +
      '개 · HWP ' + hwp.version.text + (hwp.compressed ? ' · 압축' : ' · 압축 안 함');
    describe(cfb, hwp, null);
    if (hwp.warn.length) {
      heroDetail.appendChild(el('div', { class: 'warnbox', style: { marginTop: '.5rem' },
        text: '파서가 남긴 경고: ' + hwp.warn.slice(0, 4).join(' / ') }));
    }
    return true;
  }

  /* 히어로의 레코드 지도에서 하나를 누르면 */
  function describeRecord(i) {
    var hwp = U.State.hwp;
    var r = heroStream.records[i];
    if (!r) return;
    var info = H.tagInfo(r.tag);
    U.clear(heroDetail);
    heroDetail.appendChild(el('div', { class: 'pill-row', style: { marginBottom: '.4rem' } }, [
      el('span', { class: 'chip', text: '#' + i }),
      el('span', { class: 'chip', text: info.name }),
      el('span', { class: 'chip', text: '레벨 ' + r.level }),
      el('span', { class: 'chip', text: r.size + 'B' + (r.extended ? ' · 확장 헤더' : '') }),
      el('span', { class: 'chip', text: '머리 ' + U.hex(r.raw, 8) })
    ]));
    heroDetail.appendChild(el('p', { style: { margin: 0 }, text: info.desc }));
    var body = heroStream.data.subarray(r.payloadOffset, r.payloadOffset + Math.min(r.size, 96));
    var line = '';
    for (var k = 0; k < body.length; k++) line += U.printable(body[k]);
    heroDetail.appendChild(el('div', { class: 'readout', style: { marginTop: '.3rem' }, text: line || '(빈 내용)' }));
  }

  function describe(cfb, hwp, s) {
    U.clear(heroDetail);
    if (s === null || s === undefined) {
      var recs = hwp.recordStreams.reduce(function (a, x) { return a + x.records.length; }, 0);
      heroDetail.appendChild(el('div', { class: 'pill-row', style: { marginBottom: '.4rem' } }, [
        el('span', { class: 'chip', text: '스트림 ' + hwp.streams.length + '개' }),
        el('span', { class: 'chip', text: '레코드 ' + recs + '개' }),
        el('span', { class: 'chip', text: '문단 ' + hwp.paragraphs.length + '개' }),
        el('span', { class: 'chip', text: '글자 ' + U.num(hwp.text.length) + '자' }),
        el('span', { class: 'chip', text: '최대 레벨 ' + hwp.maxLevel })
      ]));
      heroDetail.appendChild(el('p', { style: { margin: 0 } },
        '위 그림의 칸 하나가 레코드 하나다. 세로로 내려갈수록 깊은 레벨이고, ' +
        '위 칸이 아래 칸들을 품는다 — 표 안의 문단이 세 칸 아래에 있는 것을 볼 수 있다. ' +
        '아무 칸이나 눌러 보자.'));
      return;
    }
    var role = cfb.roles[s], own = cfb.owner[s] || C.ROLE_LABEL[role];
    heroDetail.appendChild(el('div', { class: 'pill-row', style: { marginBottom: '.4rem' } }, [
      el('span', { class: 'chip', text: '섹터 ' + s }),
      el('span', { class: 'chip', text: own }),
      el('span', { class: 'chip', text: U.hex(cfb.sectOff(s), 6) })
    ]));
    var line = '';
    for (var i = 0; i < 96; i++) line += U.printable(cfb.bytes[cfb.sectOff(s) + i]);
    heroDetail.appendChild(el('div', { class: 'readout', text: line }));
    if (/압축/.test(own)) {
      heroDetail.appendChild(el('p', { class: 'note', style: { margin: '.4rem 0 0' },
        text: '압축된 바이트라 아무 구조도 읽히지 않는다. 03장에서 이 스트림의 압축을 풀어 볼 수 있다.' }));
    } else if (role === 'mini') {
      heroDetail.appendChild(el('p', { class: 'note', style: { margin: '.4rem 0 0' },
        text: '미니 스트림이다. HWP 파일은 스트림이 작아서 대부분 여기 몰려 들어간다 — ' +
              'FileHeader, DocInfo, 본문까지 한 덩어리에 이어 붙어 있다.' }));
    }
  }

  function boot() {
    U.initTheme(document.getElementById('theme'));
    ribbonEl = document.getElementById('ribbon');
    heroDetail = document.getElementById('hero-detail');
    heroStat = document.getElementById('hero-stat');
    heroName = document.getElementById('hero-name');
    toggleBtn = document.getElementById('hero-toggle');

    heroMap = root.SectorMap.make(document.getElementById('hero-map'), {
      onSelect: function (s) {
        describe(U.State.parsed, U.State.hwp, s);
        heroMap.paint({ current: s, sectors: [s] });
      }
    });
    heroRec = root.HWPPanels.recordMap(document.getElementById('hero-recmap'), {
      onSelect: function (i) { describeRecord(i); heroRec.paint(i); }
    });

    panels.header = root.HWPPanels.headerPanel(document.getElementById('hwp-header-panel'));
    panels.streams = root.HWPPanels.streamPanel(document.getElementById('hwp-stream-panel'));
    panels.zip = root.HWPPanels.zipPanel(document.getElementById('hwp-zip-panel'),
      document.getElementById('zip-stat'));
    panels.bits = root.HWPPanels.bitsPanel(document.getElementById('hwp-bits-panel'));
    panels.tree = root.HWPPanels.treePanel(document.getElementById('hwp-tree-panel'));
    panels.records = root.HWPPanels.recordPanel(document.getElementById('hwp-record-panel'));
    panels.text = root.HWPPanels.textPanel(document.getElementById('hwp-text-panel'));
    panels.walk = root.HWPPanels.walkPanel(document.getElementById('hwp-walk-panel'));
    panels.edge = root.HWPPanels.edgePanel(document.getElementById('hwp-edge-panel'));
    panels.write = root.HWPPanels.writeLab(document.getElementById('hwp-write-lab'), function (opts) {
      /* 실습실이 파일을 실제로 다시 만든다. 압축 여부는 현재 설정을 따른다. */
      var bytes = root.HWPBuild.compose(Object.assign({
        compressed: compressed, timestamp: Date.UTC(2024, 2, 14, 10, 0, 0)
      }, opts)).bytes;
      var cfb = root.CFBParse.parse(bytes);
      var hwp = root.HWPParse.parse(cfb);
      if (!hwp.ok) return null;
      annotate(cfb, hwp);
      U.set({ bytes: cfb.bytes, parsed: cfb, hwp: hwp });
      ['header', 'streams', 'zip', 'bits', 'tree', 'records', 'text', 'walk'].forEach(function (k) {
        try { panels[k].render(hwp); } catch (e) { console.error(k, e); }
      });
      heroMap.render(cfb, {});
      heroStream = hwp.recordStreams.filter(function (x) { return /Section/.test(x.path); })[0];
      if (heroStream) heroRec.render(heroStream, null);
      buildRibbon(cfb); paintRibbon(null);
      return hwp;
    });

    U.subscribe(function (S) {
      if (!S.parsed) return;
      paintRibbon(S.sel);
      heroMap.paint({ sectors: S.sel.sectors, current: S.sel.current });
    });

    toggleBtn.onclick = function () {
      compressed = !compressed;
      toggleBtn.textContent = compressed ? '압축 끄고 다시 만들기' : '압축 켜고 다시 만들기';
      distribute(root.CFBParse.parse(makeSample()),
        '샘플 문서.hwp' + (compressed ? '' : ' (압축 없음)'));
    };

    root.Story.fileLoader(document.getElementById('hwp-file-loader'), function (cfb, name) {
      if (!distribute(cfb, name)) return;
      document.getElementById('header').scrollIntoView({ behavior: 'smooth' });
    });
    document.getElementById('back-to-sample').onclick = function () {
      compressed = true;
      toggleBtn.textContent = '압축 끄고 다시 만들기';
      distribute(root.CFBParse.parse(makeSample()), '샘플 문서.hwp');
    };

    distribute(root.CFBParse.parse(makeSample()), '샘플 문서.hwp');
    U.initNav();

    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { if (U.State.parsed) heroMap.render(U.State.parsed, {}); }, 180);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
