/* =====================================================================
 * ui-core.js — DOM 도우미, 공유 상태, 포맷터
 * ===================================================================== */
(function (root) {
  'use strict';

  /* ---------- DOM ---------------------------------------------------- */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (Array.isArray(kids) ? kids : kids ? [kids] : []).forEach(function (k) {
      if (k === null || k === undefined || k === false) return;
      n.appendChild(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(String(k)) : k);
    });
    return n;
  }
  function svg(tag, attrs, kids) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (attrs[k] === null || attrs[k] === undefined || attrs[k] === false) return;
      n.setAttribute(k, attrs[k]);
    });
    (Array.isArray(kids) ? kids : kids ? [kids] : []).forEach(function (k) {
      n.appendChild(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(String(k)) : k);
    });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  /* ---------- 포맷 ---------------------------------------------------- */
  function hex(n, w) { return '0x' + ('00000000' + (n >>> 0).toString(16).toUpperCase()).slice(-(w || 2)); }
  function hexb(n) { return ('0' + (n & 0xff).toString(16).toUpperCase()).slice(-2); }
  function bytesLabel(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KiB';
    if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(2) + ' MiB';
    return (n / 1073741824).toFixed(2) + ' GiB';
  }
  function num(n) { return n.toLocaleString('ko-KR'); }
  /* 특수값이면 이름을, 아니면 숫자를 보여 준다 */
  function sect(v) {
    var C = root.CFBConst;
    var s = C.sectName(v);
    return s ? s : String(v >>> 0);
  }
  function sid(v) {
    var C = root.CFBConst;
    return (v >>> 0) === C.NOSTREAM ? 'NOSTREAM' : String(v >>> 0);
  }
  function printable(b) { return b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'; }

  /* ---------- 공유 상태 ------------------------------------------------ */
  var subs = [];
  var State = {
    bytes: null,      // Uint8Array — 현재 파일
    parsed: null,     // CFBParse.parse 결과
    source: 'sample', // 'sample' | 'user'
    fileName: '샘플 문서.doc',
    sel: {
      sectors: [],    // 강조할 섹터
      current: null,  // 지금 보고 있는 섹터
      ranges: [],     // hex 강조 [start,len,tone]
      sid: null,      // 선택된 디렉터리 엔트리
      ghosts: [],     // 지워졌지만 데이터가 남은 섹터
      focus: null     // hex 뷰가 스크롤할 오프셋
    }
  };
  function subscribe(fn) { subs.push(fn); return function () { subs = subs.filter(function (f) { return f !== fn; }); }; }
  function set(patch) {
    Object.assign(State, patch);
    subs.forEach(function (f) { try { f(State); } catch (e) { console.error(e); } });
  }
  function select(patch) {
    State.sel = Object.assign({ sectors: [], current: null, ranges: [], sid: null, ghosts: [], focus: null }, patch);
    subs.forEach(function (f) { try { f(State); } catch (e) { console.error(e); } });
  }

  /* ---------- 테마 ----------------------------------------------------- */
  function initTheme(btn) {
    var stored = null;
    try { stored = localStorage.getItem('cfb-theme'); } catch (e) { /* 저장 불가 — 무시 */ }
    if (stored === 'dark' || stored === 'light') document.documentElement.setAttribute('data-theme', stored);
    function label() {
      var t = document.documentElement.getAttribute('data-theme');
      btn.textContent = t === 'dark' ? '☾' : t === 'light' ? '☀' : '◐';
      btn.setAttribute('aria-label',
        t === 'dark' ? '어두운 테마 (누르면 시스템 설정으로)' :
        t === 'light' ? '밝은 테마 (누르면 어두운 테마로)' : '시스템 테마 (누르면 밝은 테마로)');
    }
    btn.addEventListener('click', function () {
      var t = document.documentElement.getAttribute('data-theme');
      var next = t === 'light' ? 'dark' : t === 'dark' ? null : 'light';
      if (next) document.documentElement.setAttribute('data-theme', next);
      else document.documentElement.removeAttribute('data-theme');
      try { next ? localStorage.setItem('cfb-theme', next) : localStorage.removeItem('cfb-theme'); } catch (e) { /* 무시 */ }
      label();
      subs.forEach(function (f) { try { f(State); } catch (e) { /* 무시 */ } });
    });
    label();
  }

  /* ---------- 목차 하이라이트 ------------------------------------------- */
  function initNav() {
    var links = $$('.topnav a');
    var pairs = links.map(function (a) {
      return { a: a, sec: document.getElementById(a.getAttribute('href').slice(1)) };
    }).filter(function (p) { return p.sec; });
    var raf = null;
    function update() {
      raf = null;
      var y = window.scrollY + 120;
      var best = pairs[0];
      pairs.forEach(function (p) { if (p.sec.offsetTop <= y) best = p; });
      links.forEach(function (x) { x.removeAttribute('aria-current'); });
      if (best) best.a.setAttribute('aria-current', 'true');
    }
    window.addEventListener('scroll', function () { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
    update();
  }

  root.UI = {
    el: el, svg: svg, clear: clear, $: $, $$: $$,
    hex: hex, hexb: hexb, bytesLabel: bytesLabel, num: num,
    sect: sect, sid: sid, printable: printable,
    State: State, subscribe: subscribe, set: set, select: select,
    initTheme: initTheme, initNav: initNav
  };
})(window);
