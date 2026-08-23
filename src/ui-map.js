/* =====================================================================
 * ui-map.js — 섹터 지도
 *
 * 파일 전체를 한 화면에 담는 그림. 색은 세 계열뿐이다:
 *   파랑 = 주소표 · 주황 = 이름표 · 청록 = 내용 · 회색 = 빈 섹터
 * 계열 안의 구분(FAT/DIFAT/MiniFAT, 일반/미니)은 무늬로 한다.
 * 색만으로 뜻을 전달하지 않도록, 구역마다 이름표를 직접 붙인다.
 * ===================================================================== */
(function (root) {
  'use strict';
  var U = root.UI, el = U.el, C = root.CFBConst;

  var FAMILY = {
    fat: '주소표', difat: '주소표', minifat: '주소표',
    dir: '이름표', stream: '내용', mini: '내용', free: '빈 곳', header: '헤더'
  };

  function make(container, opts) {
    opts = opts || {};
    var rulerEl = el('div', { class: 'map-ruler' });
    var gridEl = el('div', { class: 'map-grid', role: 'grid', 'aria-label': '섹터 지도' });
    var scroll = el('div', { class: 'map-scroll' }, [rulerEl, gridEl]);
    var legendEl = el('div', { class: 'legend', style: { marginTop: '.8rem' } });
    var regionsEl = el('div', { style: { marginTop: '.6rem' } });
    container.appendChild(scroll);
    container.appendChild(legendEl);
    if (opts.regions !== false) container.appendChild(regionsEl);

    var cells = [];
    var onSelect = opts.onSelect || function () {};
    var lastSig = '';

    function regionsOf(p) {
      var out = [], cur = null;
      for (var s = 0; s < p.totalSectors; s++) {
        var role = p.roles[s], own = p.owner[s] || '';
        if (cur && cur.role === role && cur.owner === own && cur.end === s - 1) { cur.end = s; cur.n++; }
        else { cur = { role: role, owner: own, start: s, end: s, n: 1 }; out.push(cur); }
      }
      return out;
    }

    function render(p, sel) {
      sel = sel || {};
      var total = p.totalSectors;
      var avail = Math.max(280, scroll.clientWidth || container.clientWidth || 900);
      /* 리본(한 줄) 모드 — 파일이 한눈에 들어올 때만. 그 외에는 격자. */
      var ribbon = total <= 110 && (avail / total) >= 11;
      var cols = ribbon ? total : Math.min(total, 64);
      var cell = Math.max(7, Math.min(28, Math.floor(avail / cols) - 2));
      gridEl.style.setProperty('--cell', cell + 'px');
      gridEl.style.width = ribbon ? 'max-content' : (cols * (cell + 2)) + 'px';
      rulerEl.style.display = ribbon ? 'flex' : 'none';

      var sig = total + ':' + cell + ':' + ribbon + ':' + p.roles.join(',');
      if (sig !== lastSig) {
        lastSig = sig;
        U.clear(gridEl); U.clear(rulerEl); cells = [];
        var regions = regionsOf(p);
        if (ribbon) {
          regions.forEach(function (r) {
            var label = r.role === 'free' ? '빈 섹터' : (r.owner || C.ROLE_LABEL[r.role]);
            rulerEl.appendChild(el('div', {
              class: 'map-region', 'data-role': r.role,
              style: { width: (r.n * (cell + 2) - 2) + 'px' },
              title: label + ' · 섹터 ' + r.start + (r.n > 1 ? '–' + r.end : '') + ' (' + r.n + '개)'
            }, r.n * (cell + 2) >= 34 ? label : ''));
          });
        }
        for (var s = 0; s < total; s++) {
          (function (s) {
            var role = p.roles[s];
            var b = el('button', {
              class: 'sector', 'data-role': role, 'data-sect': s,
              type: 'button',
              title: '섹터 ' + s + ' — ' + (p.owner[s] || C.ROLE_LABEL[role]) +
                     ' · 파일 오프셋 ' + U.hex(p.sectOff(s), 6),
              'aria-label': '섹터 ' + s + ', ' + (p.owner[s] || C.ROLE_LABEL[role]),
              onclick: function () { onSelect(s); }
            }, cell >= 20 ? String(s) : '');
            cells.push(b);
            gridEl.appendChild(b);
          })(s);
        }
        renderLegend(p);
        renderRegions(p, regions);
      }
      paint(sel);
    }

    function paint(sel) {
      var lit = new Set(sel.sectors || []);
      var ghosts = new Set(sel.ghosts || []);
      var dim = (sel.sectors && sel.sectors.length) || sel.current !== null && sel.current !== undefined;
      cells.forEach(function (b, s) {
        b.classList.toggle('is-lit', lit.has(s));
        b.classList.toggle('is-current', sel.current === s);
        b.classList.toggle('is-ghost', ghosts.has(s));
        b.classList.toggle('is-dim', !!dim && !lit.has(s) && sel.current !== s);
      });
    }

    function renderLegend(p) {
      U.clear(legendEl);
      var groups = [
        { label: '주소표', items: [
          { role: 'fat', name: 'FAT' },
          { role: 'difat', name: 'DIFAT' },
          { role: 'minifat', name: 'MiniFAT' }
        ] },
        { label: '이름표', items: [{ role: 'dir', name: '디렉터리' }] },
        { label: '내용', items: [
          { role: 'stream', name: '스트림' },
          { role: 'mini', name: '미니 스트림' }
        ] },
        { label: '', items: [{ role: 'free', name: '빈 섹터' }] }
      ];
      groups.forEach(function (g) {
        var used = g.items.filter(function (it) { return p.roles.indexOf(it.role) >= 0; });
        if (!used.length) return;
        if (g.label) legendEl.appendChild(el('span', { class: 'legend-group', text: g.label }));
        used.forEach(function (it) {
          legendEl.appendChild(el('span', { class: 'legend-item' }, [
            el('span', { class: 'legend-sw sector', 'data-role': it.role, style: { cursor: 'default' } }),
            it.name
          ]));
        });
      });
    }

    /* 색만으로 뜻을 전달하지 않기 위한 구역 표 (동시에 파일 배치의 요약이기도 하다) */
    function renderRegions(p, regions) {
      U.clear(regionsEl);
      var t = el('table', { class: 'data' });
      t.appendChild(el('thead', {}, el('tr', {}, [
        el('th', { text: '섹터' }), el('th', { text: '개수' }),
        el('th', { text: '계열' }), el('th', { text: '무엇이 들어 있나' }),
        el('th', { class: 'mono', text: '파일 오프셋' })
      ])));
      var tb = el('tbody');
      regions.forEach(function (r) {
        tb.appendChild(el('tr', {
          class: 'clickable',
          onclick: function () { onSelect(r.start, r); }
        }, [
          el('td', { class: 'mono', text: r.n > 1 ? r.start + '–' + r.end : String(r.start) }),
          el('td', { class: 'mono num', text: String(r.n) }),
          el('td', {}, [
            el('span', { class: 'legend-sw sector', 'data-role': r.role,
              style: { display: 'inline-block', verticalAlign: '-2px', marginRight: '.4rem' } }),
            FAMILY[r.role] || r.role
          ]),
          el('td', { text: r.role === 'free' ? '아무것도 (또는 지워진 데이터의 잔해)' : (r.owner || C.ROLE_LABEL[r.role]) }),
          el('td', { class: 'mono', text: U.hex(p.sectOff(r.start), 6) })
        ]));
      });
      t.appendChild(tb);
      var det = el('details', { style: { marginTop: '.4rem' } }, [
        el('summary', { class: 'note', style: { cursor: 'pointer' },
          text: '구역 표로 보기 (' + regions.length + '개 구역)' }),
        el('div', { class: 'tablewrap', style: { maxHeight: '18rem', overflowY: 'auto', marginTop: '.5rem' } }, t)
      ]);
      regionsEl.appendChild(det);
    }

    return { render: render, paint: paint, node: scroll, regionsOf: regionsOf };
  }

  root.SectorMap = { make: make, FAMILY: FAMILY };
})(window);
