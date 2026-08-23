/* =====================================================================
 * main.js — 조립
 *
 * 샘플 CFB 파일을 만들고 → 파싱하고 → 모든 패널에 나눠 준다.
 * 사용자가 자기 파일을 열면 같은 경로로 다시 흐른다.
 * ===================================================================== */
(function (root) {
  'use strict';
  var U = root.UI, el = U.el, C = root.CFBConst;

  var panels = {};
  var heroMap, heroDetail, heroStat, verBtn, ribbonEl;
  var fatMap;
  var currentMajor = 3;
  var ribbonCells = [];

  /* 상단 리본 — 어느 장을 읽고 있든 파일 전체가 늘 보인다.
     섹터가 많은 파일에서는 한 칸이 여러 섹터를 대표한다. */
  function buildRibbon(p) {
    U.clear(ribbonEl);
    ribbonCells = [];
    var MAX = 240;
    var step = Math.max(1, Math.ceil(p.totalSectors / MAX));
    for (var s = 0; s < p.totalSectors; s += step) {
      var role = p.roles[s];
      var cell = el('i', { 'data-role': role,
        title: '섹터 ' + s + (step > 1 ? '–' + Math.min(s + step - 1, p.totalSectors - 1) : '') +
               ' · ' + (p.owner[s] || C.ROLE_LABEL[role]) });
      ribbonEl.appendChild(cell);
      ribbonCells.push({ node: cell, from: s, to: Math.min(s + step - 1, p.totalSectors - 1) });
    }
  }
  function paintRibbon(sel) {
    var lit = sel && sel.sectors && sel.sectors.length ? sel.sectors : null;
    var cur = sel ? sel.current : null;
    var any = !!lit || cur !== null && cur !== undefined;
    ribbonEl.classList.toggle('has-sel', any);
    ribbonCells.forEach(function (c) {
      var on = false;
      if (cur !== null && cur !== undefined && cur >= c.from && cur <= c.to) on = true;
      if (!on && lit) {
        for (var i = 0; i < lit.length; i++) { if (lit[i] >= c.from && lit[i] <= c.to) { on = true; break; } }
      }
      c.node.classList.toggle('on', on);
    });
  }

  function makeSample(major) {
    return root.CFBBuild.compose({ major: major, timestamp: Date.UTC(2003, 3, 15, 9, 30, 0) }).bytes;
  }

  function distribute(p, name) {
    U.set({ bytes: p.bytes, parsed: p, fileName: name || U.State.fileName });
    Object.keys(panels).forEach(function (k) {
      try { panels[k].render(p); } catch (e) { console.error('패널 ' + k + ' 렌더 실패', e); }
    });
    heroMap.render(p, {});
    fatMap.render(p, {});
    buildRibbon(p);
    paintRibbon(null);
    U.clear(heroStat);
    heroStat.textContent = U.bytesLabel(p.bytes.length) + ' · 섹터 ' + p.totalSectors + '개 · v' +
      p.header.majorVersion + ' (' + p.sectorSize + 'B)';
    describeSector(p, null);
  }

  function describeSector(p, s) {
    U.clear(heroDetail);
    if (s === null || s === undefined) {
      heroDetail.appendChild(document.createTextNode(
        '칸 하나가 ' + p.sectorSize + '바이트 섹터 하나다. 색은 세 계열뿐이다 — ' +
        '파랑은 주소표, 주황은 이름표, 청록은 내용. 아무 칸이나 눌러 보자.'));
      return;
    }
    var role = p.roles[s], own = p.owner[s] || C.ROLE_LABEL[role];
    var head = el('div', { class: 'pill-row', style: { marginBottom: '.4rem' } }, [
      el('span', { class: 'chip', text: '섹터 ' + s }),
      el('span', { class: 'chip', text: own }),
      el('span', { class: 'chip', text: '파일 오프셋 ' + U.hex(p.sectOff(s), 6) + ' – ' + U.hex(p.sectOff(s) + p.sectorSize - 1, 6) }),
      el('span', { class: 'chip', text: 'FAT[' + s + '] = ' + U.sect(p.fat[s]) })
    ]);
    heroDetail.appendChild(head);
    var line = '';
    for (var i = 0; i < 96; i++) line += U.printable(p.bytes[p.sectOff(s) + i]);
    heroDetail.appendChild(el('div', { class: 'readout', style: { marginTop: '.3rem' }, text: line }));
    var why = {
      fat: 'FAT 섹터다. 4바이트씩 128칸이 들어 있고, 각 칸은 "그 번호의 섹터 다음에 오는 섹터"를 뜻한다.',
      difat: 'DIFAT 섹터다. FAT 섹터들의 주소 목록이며, 마지막 칸은 다음 DIFAT 섹터를 가리킨다.',
      dir: '디렉터리 섹터다. 128바이트짜리 엔트리 4개가 들어 있다.',
      minifat: 'MiniFAT 섹터다. 64바이트 미니 섹터들의 연결 순서를 담는다.',
      mini: '미니 스트림의 일부다. 여기에 작은 스트림 여러 개가 64바이트 단위로 이어 붙어 있다.',
      stream: '스트림 데이터다. 위 아스키를 보면 어느 스트림의 몇 번째 바이트인지 그대로 읽힌다.',
      free: '비어 있는 섹터다. FAT이 FREESECT라고 말한다 — 하지만 안의 바이트는 남아 있을 수 있다.'
    }[role];
    if (why) heroDetail.appendChild(el('p', { class: 'note', style: { margin: '.4rem 0 0' }, text: why }));
  }

  function boot() {
    U.initTheme(document.getElementById('theme'));

    ribbonEl = document.getElementById('ribbon');
    heroDetail = document.getElementById('hero-detail');
    heroStat = document.getElementById('hero-stat');
    verBtn = document.getElementById('hero-version');

    heroMap = root.SectorMap.make(document.getElementById('hero-map'), {
      onSelect: function (s) {
        var p = U.State.parsed;
        describeSector(p, s);
        heroMap.paint({ current: s, sectors: [s] });
      }
    });
    fatMap = root.SectorMap.make(document.getElementById('fat-map'), { regions: false });

    panels.header = root.Panels.headerPanel(document.getElementById('header-panel'));
    panels.fat = root.Panels.fatPanel(document.getElementById('fat-panel'));
    panels.difat = root.Panels.difatPanel(document.getElementById('difat-panel'));
    panels.dir = root.Panels.dirPanel(document.getElementById('dir-panel'));
    panels.tree = root.Panels.treePanel(document.getElementById('tree-panel'));
    panels.mini = root.Panels.miniPanel(document.getElementById('mini-panel'));
    panels.walk = root.Story.walkPanel(document.getElementById('walk-panel'));
    panels.write = root.Story.writeLab(document.getElementById('write-lab'));

    /* FAT 장의 지도는 체인 따라가기와 연동된다 */
    U.subscribe(function (S) {
      if (!S.parsed) return;
      fatMap.paint({ sectors: S.sel.sectors, current: S.sel.current });
      paintRibbon(S.sel);
    });

    /* 버전 전환 — v3와 v4의 차이를 파일째로 비교해 볼 수 있다 */
    verBtn.textContent = 'v4(4096B)로 다시 만들기';
    verBtn.onclick = function () {
      currentMajor = currentMajor === 3 ? 4 : 3;
      verBtn.textContent = currentMajor === 3 ? 'v4(4096B)로 다시 만들기' : 'v3(512B)로 되돌리기';
      panels.write.reset();
      var bytes = makeSample(currentMajor);
      distribute(root.CFBParse.parse(bytes), '샘플 문서.doc (v' + currentMajor + ')');
    };

    root.Story.fileLoader(document.getElementById('file-loader'), function (p, name) {
      panels.write.reset();
      distribute(p, name);
      document.getElementById('why').scrollIntoView({ behavior: 'smooth' });
    });
    document.getElementById('back-to-sample').onclick = function () {
      panels.write.reset();
      currentMajor = 3;
      verBtn.textContent = 'v4(4096B)로 다시 만들기';
      distribute(root.CFBParse.parse(makeSample(3)), '샘플 문서.doc');
    };

    distribute(root.CFBParse.parse(makeSample(3)), '샘플 문서.doc');
    U.initNav();

    /* 창 크기가 바뀌면 지도의 칸 크기를 다시 계산한다 */
    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        if (!U.State.parsed) return;
        heroMap.render(U.State.parsed, {});
        fatMap.render(U.State.parsed, {});
      }, 180);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
