/* =====================================================================
 * ui-hex.js — 실제 파일 바이트를 그대로 보여 주는 hex 뷰어
 *
 * 이 시각화의 신뢰성은 전부 여기에 걸려 있다. 다른 패널이 "이 값은
 * 0x2C 위치에 있다"고 말하면, 여기서 그 바이트를 직접 볼 수 있어야 한다.
 * ===================================================================== */
(function (root) {
  'use strict';
  var U = root.UI, el = U.el;

  function make(container, opts) {
    opts = opts || {};
    var wrap = el('div', { class: 'hex', role: 'region', 'aria-label': 'hex 덤프' });
    container.appendChild(wrap);
    var lastKey = '';

    /* ranges: [{ start, len, tone }] — tone 1=잉크, 2=파랑, 3=주황, 4=청록 */
    function render(bytes, o) {
      o = o || {};
      var from = Math.max(0, o.from | 0);
      var to = Math.min(bytes.length, o.to !== undefined ? o.to : from + 512);
      var ranges = o.ranges || [];
      var key = from + ':' + to + ':' + bytes.length + ':' + JSON.stringify(ranges) + ':' + (o.labels ? 1 : 0);
      if (key === lastKey && !o.force) return;
      lastKey = key;

      /* 오프셋 → 강조 톤 */
      var tone = new Uint8Array(to - from);
      ranges.forEach(function (r) {
        var s = Math.max(from, r.start), e = Math.min(to, r.start + r.len);
        for (var i = s; i < e; i++) tone[i - from] = r.tone || 1;
      });

      U.clear(wrap);
      var frag = document.createDocumentFragment();
      if (o.label) frag.appendChild(el('div', { class: 'hex-label', text: o.label }));

      for (var off = from; off < to; off += 16) {
        var row = el('div', { class: 'hex-row' });
        row.appendChild(el('span', { class: 'hex-off', text: ('00000000' + off.toString(16).toUpperCase()).slice(-8) }));
        var hb = el('span', { class: 'hex-bytes' });
        var ab = el('span', { class: 'hex-ascii' });
        for (var i = 0; i < 16; i++) {
          var p = off + i;
          if (p >= to) {
            hb.appendChild(document.createTextNode('   '));
            continue;
          }
          var t = tone[p - from];
          var cls = 'hx' + (t ? (t === 1 ? ' on' : ' on-' + t) : '');
          hb.appendChild(el('span', { class: cls, text: U.hexb(bytes[p]) }));
          hb.appendChild(document.createTextNode(i === 7 ? '  ' : ' '));
          ab.appendChild(el('span', { class: cls, text: U.printable(bytes[p]) }));
        }
        row.appendChild(hb);
        row.appendChild(ab);
        frag.appendChild(row);
      }
      wrap.appendChild(frag);
    }

    function scrollToOffset(off, from) {
      var rows = wrap.querySelectorAll('.hex-row');
      if (!rows.length) return;
      var line = Math.floor((off - (from || 0)) / 16);
      var target = rows[Math.max(0, line - 2)];
      /* offsetTop 은 wrap 기준이 아니므로, 첫 행과의 차이로 계산한다 */
      wrap.scrollTop = target ? Math.max(0, target.offsetTop - rows[0].offsetTop) : 0;
    }

    return { render: render, scrollToOffset: scrollToOffset, node: wrap };
  }

  root.HexView = { make: make };
})(window);
