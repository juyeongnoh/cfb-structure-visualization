/* =====================================================================
 * cfb-ops.js — 쓰기/편집 시뮬레이터
 *
 * 읽기는 절반의 이야기일 뿐이다. 스트림을 지우고, 새로 만들고, 키울 때
 * 파일 안에서 실제로 무슨 일이 벌어지는가 — 단편화는 왜 생기고, 지운
 * 데이터는 왜 그 자리에 남아 있는가 — 를 진짜 바이트로 보여 준다.
 *
 * 모든 연산은 모델을 고친 뒤 실제 파일 바이트를 다시 만들어 낸다.
 * 그 바이트를 파서가 다시 읽으므로, 화면은 언제나 "진짜 파일"을 비춘다.
 * ===================================================================== */
(function (root) {
  'use strict';

  var C = root.CFBConst;
  var RB = root.RBTree;

  /* ---------- 파싱 결과 → 편집 가능한 모델 ----------------------------- */
  function toModel(p) {
    var SS = p.sectorSize, MSS = p.miniSectorSize;
    var sectors = [];
    for (var s = 0; s < p.totalSectors; s++) {
      var o = p.sectOff(s);
      sectors.push(p.bytes.slice(o, o + SS));
    }
    var fat = Array.from(p.fat).slice(0, Math.max(p.totalSectors, p.fat.length));
    /* FAT 배열은 항상 "FAT 섹터 수 × 섹터당 칸수" 만큼이다 */
    var fatCap = p.difat.length * (SS / 4);
    while (fat.length < fatCap) fat.push(C.FREESECT);

    var miniStreamLen = p.miniStreamSize;
    var miniData = new Uint8Array(Math.ceil(miniStreamLen / MSS) * MSS);
    p.miniStreamSectors.forEach(function (sec, i) {
      var src = p.sectOff(sec);
      var n = Math.min(SS, miniData.length - i * SS);
      if (n > 0) miniData.set(p.bytes.subarray(src, src + n), i * SS);
    });

    var entries = p.entries.map(function (e) {
      return {
        sid: e.sid, name: e.name, type: e.type, color: e.color,
        left: e.left, right: e.right, child: e.child,
        clsid: e.clsid, state: e.state,
        ctimeLo: 0, ctimeHi: 0,
        start: e.start, size: e.size
      };
    });
    /* 원본의 시간 값을 바이트 그대로 보존 (slice 는 범위를 벗어나도 안전하다) */
    p.entries.forEach(function (e, i) {
      entries[i].timeBytes = p.bytes.slice(e.offset + 0x64, e.offset + 0x74);
    });

    return {
      major: p.header.majorVersion,
      SS: SS, MSS: MSS, cutoff: p.header.miniCutoff,
      sectors: sectors,
      fat: fat,
      minifat: Array.from(p.minifat),
      miniData: miniData,
      entries: entries,
      fatSectors: p.difat.slice(),
      difatSectors: p.difatSectors.slice(),
      dirSectors: p.dirSectors.slice(),
      miniFatSectors: p.miniFatSectors.slice(),
      miniStreamSectors: p.miniStreamSectors.slice(),
      log: []
    };
  }

  function say(m, kind, text, extra) {
    m.log.push(Object.assign({ kind: kind, text: text }, extra || {}));
  }

  /* ---------- 할당기 --------------------------------------------------
   * 실제 작성기가 하는 일 그대로: 먼저 빈 섹터를 찾고(재사용),
   * 없으면 파일 끝에 새 섹터를 덧붙인다. 이 "먼저 재사용" 규칙이
   * 곧 단편화의 원인이다.                                              */
  function allocSector(m, why) {
    for (var i = 0; i < m.fat.length && i < m.sectors.length; i++) {
      if (m.fat[i] === C.FREESECT) {
        m.fat[i] = C.ENDOFCHAIN;
        say(m, 'reuse', '빈 섹터 ' + i + '을(를) 재사용한다 — ' + why +
            '. 파일 끝이 아니라 중간의 구멍을 메우므로 체인이 앞뒤로 튄다.', { sector: i });
        return i;
      }
    }
    var n = m.sectors.length;
    m.sectors.push(new Uint8Array(m.SS));
    while (m.fat.length <= n) m.fat.push(C.FREESECT);
    m.fat[n] = C.ENDOFCHAIN;
    say(m, 'grow', '빈 섹터가 없어 파일 끝에 섹터 ' + n + '을(를) 새로 만든다 — ' + why +
        '. 파일 크기가 ' + m.SS + '바이트 늘어난다.', { sector: n });
    ensureFatCapacity(m);
    return n;
  }

  /* FAT 자체가 모자라면 FAT 섹터를 늘리고, 그러다 109개를 넘으면
   * DIFAT 섹터까지 늘어난다. 3단 간접 참조가 실제로 자라나는 순간이다. */
  function ensureFatCapacity(m) {
    var per = m.SS / 4;
    while (m.sectors.length > m.fatSectors.length * per) {
      var ns = m.sectors.length;
      m.sectors.push(new Uint8Array(m.SS));
      while (m.fat.length <= ns) m.fat.push(C.FREESECT);
      m.fat[ns] = C.FATSECT;
      m.fatSectors.push(ns);
      while (m.fat.length < m.fatSectors.length * per) m.fat.push(C.FREESECT);
      say(m, 'fatgrow', 'FAT 한 장으로는 섹터 ' + ns + '까지 관리할 수 없어 FAT 섹터를 하나 더 만든다 (섹터 ' + ns + '). ' +
          'FAT 섹터 자신은 FAT 안에서 FATSECT(0xFFFFFFFD)로 표시된다.', { sector: ns });
      if (m.fatSectors.length > C.HEADER_DIFAT_LEN) {
        var need = Math.ceil((m.fatSectors.length - C.HEADER_DIFAT_LEN) / (per - 1));
        while (m.difatSectors.length < need) {
          var d = m.sectors.length;
          m.sectors.push(new Uint8Array(m.SS));
          while (m.fat.length <= d) m.fat.push(C.FREESECT);
          m.fat[d] = C.DIFSECT;
          m.difatSectors.push(d);
          say(m, 'difatgrow', 'FAT 섹터가 109개를 넘었다. 헤더에 더 적을 자리가 없어 DIFAT 섹터(섹터 ' + d + ')를 만든다. ' +
              '여기서부터 3단 간접 참조가 시작된다.', { sector: d });
        }
      }
    }
  }

  function chainOf(table, start) {
    var out = [], seen = new Set(), s = start;
    while (s !== C.ENDOFCHAIN && s !== C.FREESECT && s <= C.MAXREGSECT && !seen.has(s)) {
      if (s >= table.length) break;
      seen.add(s); out.push(s); s = table[s];
    }
    return out;
  }

  function link(table, list) {
    for (var i = 0; i < list.length; i++) {
      table[list[i]] = i === list.length - 1 ? C.ENDOFCHAIN : list[i + 1];
    }
  }

  /* ---------- 미니 섹터 할당 ------------------------------------------- */
  function allocMiniSector(m, why) {
    for (var i = 0; i < m.minifat.length; i++) {
      if (m.minifat[i] === C.FREESECT && (i + 1) * m.MSS <= m.miniData.length) {
        m.minifat[i] = C.ENDOFCHAIN;
        say(m, 'reuse-mini', '빈 미니 섹터 ' + i + '을(를) 재사용한다 — ' + why + '.', { mini: i });
        return i;
      }
    }
    /* 미니 스트림을 64바이트 늘린다. 필요하면 미니 스트림이 쓰는
       일반 섹터도 한 장 더 붙는다. */
    var idx = Math.floor(m.miniData.length / m.MSS);
    var grown = new Uint8Array(m.miniData.length + m.MSS);
    grown.set(m.miniData);
    m.miniData = grown;
    while (m.minifat.length <= idx) m.minifat.push(C.FREESECT);
    m.minifat[idx] = C.ENDOFCHAIN;
    say(m, 'grow-mini', '미니 스트림을 64바이트 늘려 미니 섹터 ' + idx + '을(를) 만든다 — ' + why + '.', { mini: idx });

    var needSect = Math.ceil(m.miniData.length / m.SS);
    while (m.miniStreamSectors.length < needSect) {
      var s = allocSector(m, '미니 스트림이 커져서 담을 곳이 더 필요하다');
      m.miniStreamSectors.push(s);
      link(m.fat, m.miniStreamSectors);
      say(m, 'note', '미니 스트림 자체도 결국 일반 스트림이다. 그래서 일반 FAT에 체인이 하나 더 생긴다.', { sector: s });
    }
    /* MiniFAT 섹터도 모자라면 늘린다 */
    var needMf = Math.ceil((m.minifat.length * 4) / m.SS);
    while (m.miniFatSectors.length < needMf) {
      var mf = allocSector(m, 'MiniFAT이 한 섹터를 넘었다');
      m.fat[mf] = C.ENDOFCHAIN;
      m.miniFatSectors.push(mf);
      link(m.fat, m.miniFatSectors);
    }
    while (m.minifat.length < m.miniFatSectors.length * (m.SS / 4)) m.minifat.push(C.FREESECT);
    return idx;
  }

  /* ---------- 스트림 내용 읽기/쓰기 ------------------------------------- */
  function readEntry(m, e) {
    if (!e.size) return new Uint8Array(0);
    var out = new Uint8Array(e.size), p = 0;
    if (isMini(m, e)) {
      chainOf(m.minifat, e.start).forEach(function (mi) {
        var n = Math.min(m.MSS, e.size - p);
        if (n <= 0) return;
        out.set(m.miniData.subarray(mi * m.MSS, mi * m.MSS + n), p); p += n;
      });
    } else {
      chainOf(m.fat, e.start).forEach(function (s) {
        var n = Math.min(m.SS, e.size - p);
        if (n <= 0) return;
        out.set(m.sectors[s].subarray(0, n), p); p += n;
      });
    }
    return out;
  }

  function isMini(m, e) { return e.size > 0 && e.size < m.cutoff; }

  function writeMini(m, content, why) {
    var need = Math.ceil(content.length / m.MSS);
    var list = [];
    for (var i = 0; i < need; i++) list.push(allocMiniSector(m, why));
    link(m.minifat, list);
    list.forEach(function (mi, i) {
      var slice = content.subarray(i * m.MSS, Math.min((i + 1) * m.MSS, content.length));
      m.miniData.set(slice, mi * m.MSS);
      /* 남는 자리는 그대로 둔다 — 실제 파일도 여기에 옛 데이터가 남는다 */
    });
    return list;
  }

  function writeBig(m, content, why) {
    var need = Math.ceil(content.length / m.SS);
    var list = [];
    for (var i = 0; i < need; i++) list.push(allocSector(m, why));
    link(m.fat, list);
    list.forEach(function (s, i) {
      var slice = content.subarray(i * m.SS, Math.min((i + 1) * m.SS, content.length));
      /* 섹터를 먼저 비우지 않는다. 실제 작성기도 가진 바이트만 쓰고,
         남는 자리는 건드리지 않는다 — 그래서 재사용된 섹터의 꼬리에는
         이전 세입자의 데이터가 그대로 남는다. */
      if (!m.sectors[s]) m.sectors[s] = new Uint8Array(m.SS);
      m.sectors[s].set(slice);
    });
    return list;
  }

  /* ---------- 부모 저장소의 트리 다시 묶기 -------------------------------- */
  function childrenOf(m, parentSid) {
    /* 부모의 child 포인터에서 출발한 트리 전체를 모은다 */
    var out = [];
    var seen = new Set();
    (function walk(sid) {
      if (sid === C.NOSTREAM || sid >= m.entries.length || seen.has(sid)) return;
      seen.add(sid);
      var e = m.entries[sid];
      if (!e || e.type === C.TYPE_UNALLOCATED) return;
      walk(e.left); out.push(e); walk(e.right);
    })(m.entries[parentSid].child);
    return out;
  }

  function relinkTree(m, parentSid, kids) {
    if (!kids.length) { m.entries[parentSid].child = C.NOSTREAM; return null; }
    var t = RB.Tree.rebuild(kids.map(function (k) { return { name: k.name, payload: k }; }));
    m.entries[parentSid].child = t.root.payload.sid;
    kids.forEach(function (k) { k.left = C.NOSTREAM; k.right = C.NOSTREAM; });
    t.all().forEach(function (n) {
      var e = n.payload;
      e.color = n.color === RB.BLACK ? C.COLOR_BLACK : C.COLOR_RED;
      e.left = n.left ? n.left.payload.sid : C.NOSTREAM;
      e.right = n.right ? n.right.payload.sid : C.NOSTREAM;
    });
    return t;
  }

  function parentOf(m, sid) {
    for (var i = 0; i < m.entries.length; i++) {
      var e = m.entries[i];
      if (e.type !== C.TYPE_STORAGE && e.type !== C.TYPE_ROOT) continue;
      var found = false;
      (function walk(s) {
        if (s === C.NOSTREAM || s >= m.entries.length || found) return;
        if (s === sid) { found = true; return; }
        walk(m.entries[s].left); walk(m.entries[s].right);
      })(e.child);
      if (found) return i;
    }
    return -1;
  }

  /* ---------- 연산 1: 스트림 삭제 ---------------------------------------- */
  function deleteStream(m, sid) {
    m.log = [];
    var e = m.entries[sid];
    if (!e || e.type !== C.TYPE_STREAM) return m;
    var name = e.name;
    say(m, 'op', '"' + name + '" 스트림을 삭제한다.');

    if (isMini(m, e)) {
      var mc = chainOf(m.minifat, e.start);
      mc.forEach(function (mi) { m.minifat[mi] = C.FREESECT; });
      say(m, 'free', '미니 섹터 ' + mc.join(', ') + '을(를) MiniFAT에서 FREESECT로 표시했다. ' +
          '하지만 미니 스트림 안의 바이트는 하나도 지우지 않았다.', { minis: mc });
    } else {
      var cc = chainOf(m.fat, e.start);
      cc.forEach(function (s) { m.fat[s] = C.FREESECT; });
      say(m, 'free', '섹터 ' + cc.join(', ') + '을(를) FAT에서 FREESECT(0xFFFFFFFF)로 표시했다. ' +
          '이게 "삭제"의 전부다 — 섹터 안의 바이트는 그대로 남아 있다.', { sectors: cc });
    }

    var pSid = parentOf(m, sid);
    /* 형제 목록은 링크를 지우기 "전에" 모아야 한다.
       지울 엔트리가 트리의 중간 노드라면, 링크를 먼저 끊는 순간 그 아래가 통째로 미아가 된다. */
    var siblings = pSid >= 0 ? childrenOf(m, pSid) : [];
    e.type = C.TYPE_UNALLOCATED;
    e.name = ''; e.start = C.FREESECT; e.size = 0;
    e.left = C.NOSTREAM; e.right = C.NOSTREAM; e.child = C.NOSTREAM;
    say(m, 'dir', '디렉터리 엔트리 SID ' + sid + '의 타입을 0(미할당)으로 바꾼다. 128바이트 칸 자체는 그대로 남는다.',
        { dirEntries: [sid] });

    if (pSid >= 0) {
      relinkTree(m, pSid, siblings.filter(function (k) { return k.sid !== sid; }));
      say(m, 'tree', '"' + m.entries[pSid].name + '" 저장소의 자식 트리를 다시 묶었다. ' +
          '레드-블랙 삭제는 까다로워서, 실제 구현들도 대개 이렇게 다시 세운다.');
    }
    say(m, 'warn', '중요: 지운 스트림의 내용은 여전히 파일 안에 있다. FAT이 "비었다"고 말할 뿐이다. ' +
        '포렌식이 옛 문서 내용을 복구해 내는 이유가 바로 이것이다.');
    return m;
  }

  /* ---------- 연산 2: 스트림 추가 ---------------------------------------- */
  function addStream(m, parentSid, name, content) {
    m.log = [];
    say(m, 'op', '"' + name + '" 스트림(' + content.length + '바이트)을 새로 만든다.');

    var mini = content.length > 0 && content.length < m.cutoff;
    say(m, 'decide', content.length + (mini ? ' < ' : ' >= ') + m.cutoff + ' 이므로 ' +
        (mini ? '미니 스트림' : '일반 섹터') + '에 넣는다.');

    var start = C.ENDOFCHAIN, list = [];
    if (content.length) {
      list = mini ? writeMini(m, content, '"' + name + '"의 내용')
                  : writeBig(m, content, '"' + name + '"의 내용');
      start = list[0];
      say(m, 'chain', (mini ? '미니 ' : '') + '체인: ' + list.join(' → ') + ' → ENDOFCHAIN');
    }

    /* 빈 디렉터리 칸 찾기 (없으면 디렉터리 체인을 늘린다) */
    var slot = -1;
    for (var i = 0; i < m.entries.length; i++) if (m.entries[i].type === C.TYPE_UNALLOCATED) { slot = i; break; }
    if (slot < 0) {
      var s = allocSector(m, '디렉터리에 빈 칸이 없다');
      m.fat[s] = C.ENDOFCHAIN;
      m.dirSectors.push(s);
      link(m.fat, m.dirSectors);
      var per = Math.floor(m.SS / C.DIR_ENTRY_SIZE);
      slot = m.entries.length;
      for (var k = 0; k < per; k++) {
        m.entries.push({ sid: m.entries.length, name: '', type: C.TYPE_UNALLOCATED, color: C.COLOR_BLACK,
          left: C.NOSTREAM, right: C.NOSTREAM, child: C.NOSTREAM, clsid: null, state: 0,
          start: C.FREESECT, size: 0 });
      }
      say(m, 'dirgrow', '디렉터리 섹터를 한 장 더 붙였다 (섹터 ' + s + '). 한 섹터에 ' + per + '칸이 더 생긴다.',
          { sector: s });
    }
    var e = m.entries[slot];
    e.name = name; e.type = C.TYPE_STREAM; e.start = start; e.size = content.length;
    e.left = C.NOSTREAM; e.right = C.NOSTREAM; e.child = C.NOSTREAM; e.color = C.COLOR_RED;
    say(m, 'dir', '비어 있던 디렉터리 칸 SID ' + slot + '에 새 엔트리를 적었다.', { dirEntries: [slot] });

    /* 부모 트리에 삽입 — 회전 과정을 그대로 기록 */
    var tree = RB.Tree.fromLinks(m.entries[parentSid].child, function (sid) {
      var x = m.entries[sid];
      if (!x || x.type === C.TYPE_UNALLOCATED) return null;
      return { name: x.name, color: x.color, left: x.left, right: x.right, payload: x };
    });
    tree.steps = [];
    tree.insert(name, e);
    tree.steps.forEach(function (st) { say(m, 'rb-' + st.kind, st.text, { rb: st }); });
    m.entries[parentSid].child = tree.root.payload.sid;
    tree.all().forEach(function (n) {
      var x = n.payload;
      x.color = n.color === RB.BLACK ? C.COLOR_BLACK : C.COLOR_RED;
      x.left = n.left ? n.left.payload.sid : C.NOSTREAM;
      x.right = n.right ? n.right.payload.sid : C.NOSTREAM;
    });
    return m;
  }

  /* ---------- 연산 3: 스트림 키우기 (경계를 넘으면 이사한다) ---------------- */
  function resizeStream(m, sid, newSize) {
    m.log = [];
    var e = m.entries[sid];
    if (!e || e.type !== C.TYPE_STREAM) return m;
    var wasMini = isMini(m, e);
    var old = readEntry(m, e);
    say(m, 'op', '"' + e.name + '"의 크기를 ' + e.size + ' → ' + newSize + '바이트로 바꾼다.');

    var content = new Uint8Array(newSize);
    content.set(old.subarray(0, Math.min(old.length, newSize)));
    for (var i = old.length; i < newSize; i++) content[i] = 0x2b; /* 새로 붙는 부분: '+' */

    /* 옛 자리 반납 */
    if (wasMini) chainOf(m.minifat, e.start).forEach(function (mi) { m.minifat[mi] = C.FREESECT; });
    else chainOf(m.fat, e.start).forEach(function (s) { m.fat[s] = C.FREESECT; });

    var nowMini = newSize > 0 && newSize < m.cutoff;
    if (wasMini !== nowMini) {
      say(m, 'migrate', '기준선(' + m.cutoff + '바이트)을 넘었다! ' +
          (nowMini ? '일반 섹터에서 미니 스트림으로' : '미니 스트림에서 일반 섹터로') +
          ' 통째로 옮겨야 한다. 스트림이 "이사"하는 유일한 경우다.');
    }
    var list = newSize ? (nowMini ? writeMini(m, content, '"' + e.name + '"의 새 내용')
                                  : writeBig(m, content, '"' + e.name + '"의 새 내용')) : [];
    e.start = list.length ? list[0] : C.ENDOFCHAIN;
    e.size = newSize;
    say(m, 'chain', '새 체인: ' + (list.length ? list.join(' → ') + ' → ENDOFCHAIN' : '(없음)'));
    return m;
  }

  /* ---------- 연산 4: 정리 저장 (조각 모음) -------------------------------- */
  function repack(m) {
    m.log = [];
    say(m, 'op', '파일을 처음부터 다시 쓴다 ("다른 이름으로 저장"에 해당). 모든 스트림을 순서대로 새로 배치한다.');
    var streams = m.entries.filter(function (e) { return e.type === C.TYPE_STREAM && e.size > 0; })
                           .map(function (e) { return { e: e, data: readEntry(m, e) }; });

    var per = m.SS / 4;
    var nDir = m.dirSectors.length;
    var next = 0;
    var fatSectors = [], dirSectors = [], miniFatSectors = [], miniSectors = [];

    /* 미니 스트림 다시 조립 */
    var miniList = streams.filter(function (x) { return x.data.length < m.cutoff; });
    var bigList = streams.filter(function (x) { return x.data.length >= m.cutoff; });
    var miniCount = 0;
    miniList.forEach(function (x) { x.miniStart = miniCount; miniCount += Math.ceil(x.data.length / m.MSS); });
    var miniData = new Uint8Array(miniCount * m.MSS);
    miniList.forEach(function (x) { miniData.set(x.data, x.miniStart * m.MSS); });

    var nMiniFat = miniCount ? Math.ceil(miniCount * 4 / m.SS) : 0;
    var nMiniSect = Math.ceil(miniData.length / m.SS);
    var bigTotal = bigList.reduce(function (a, x) { return a + Math.ceil(x.data.length / m.SS); }, 0);
    var nonFat = nDir + nMiniFat + nMiniSect + bigTotal;
    var nFat = 1;
    for (var it = 0; it < 32; it++) {
      var need = Math.max(1, Math.ceil((nonFat + nFat) / per));
      if (need === nFat) break; nFat = need;
    }
    var total = nonFat + nFat;

    for (var i = 0; i < nFat; i++) fatSectors.push(next++);
    for (i = 0; i < nDir; i++) dirSectors.push(next++);
    for (i = 0; i < nMiniFat; i++) miniFatSectors.push(next++);
    for (i = 0; i < nMiniSect; i++) miniSectors.push(next++);

    var sectors = [];
    for (i = 0; i < total; i++) sectors.push(new Uint8Array(m.SS));
    var fat = new Array(nFat * per).fill(C.FREESECT);
    fatSectors.forEach(function (s) { fat[s] = C.FATSECT; });
    link(fat, dirSectors); link(fat, miniFatSectors); link(fat, miniSectors);

    bigList.forEach(function (x) {
      var list = [];
      var n = Math.ceil(x.data.length / m.SS);
      for (var j = 0; j < n; j++) {
        var s = next++;
        list.push(s);
        sectors[s] = new Uint8Array(m.SS);
        sectors[s].set(x.data.subarray(j * m.SS, Math.min((j + 1) * m.SS, x.data.length)));
      }
      link(fat, list);
      x.e.start = list[0];
    });
    var minifat = new Array(nMiniFat * per).fill(C.FREESECT);
    miniList.forEach(function (x) {
      var n = Math.ceil(x.data.length / m.MSS), list = [];
      for (var j = 0; j < n; j++) list.push(x.miniStart + j);
      link(minifat, list);
      x.e.start = list[0];
    });

    m.sectors = sectors; m.fat = fat; m.minifat = minifat; m.miniData = miniData;
    m.fatSectors = fatSectors; m.difatSectors = [];
    m.dirSectors = dirSectors; m.miniFatSectors = miniFatSectors; m.miniStreamSectors = miniSectors;
    say(m, 'done', '빈 섹터가 하나도 없이 다시 배치되었다. 총 ' + total + '섹터. ' +
        '이것이 Office가 "다른 이름으로 저장"을 할 때 파일이 갑자기 작아지는 이유다.');
    return m;
  }

  /* ---------- 모델 → 바이트 ------------------------------------------- */
  function serialize(m) {
    var SS = m.SS, per = SS / 4;
    var total = m.sectors.length;
    var buf = new Uint8Array(SS + total * SS);   /* 헤더가 차지한 섹터 한 장 + 데이터 섹터들 */
    var dv = new DataView(buf.buffer);
    /* 손상된 파일에서 온 섹터 번호가 버퍼 밖을 가리킬 수 있다. 조용히 버린다. */
    var u16 = function (o, v) { if (o >= 0 && o + 2 <= buf.length) dv.setUint16(o, v, true); };
    var u32 = function (o, v) { if (o >= 0 && o + 4 <= buf.length) dv.setUint32(o, v >>> 0, true); };
    var off = function (s) { return (s + 1) * SS; };
    var fits = function (s) { return s >= 0 && s < total; };

    /* 데이터 섹터부터 그대로 복사 */
    m.sectors.forEach(function (b, i) { if (fits(i)) buf.set(b.subarray(0, SS), off(i)); });

    /* 미니 스트림을 자기 섹터 체인에 흩뿌린다 */
    m.miniStreamSectors.forEach(function (s, i) {
      var n = Math.min(SS, m.miniData.length - i * SS);
      if (n > 0 && fits(s)) buf.set(m.miniData.subarray(i * SS, i * SS + n), off(s));
    });

    /* 헤더 */
    C.SIGNATURE.forEach(function (v, i) { buf[i] = v; });
    u16(0x18, 0x003e); u16(0x1a, m.major); u16(0x1c, 0xfffe);
    u16(0x1e, m.SS === 4096 ? 12 : 9); u16(0x20, 6);
    u32(0x28, m.major >= 4 ? m.dirSectors.length : 0);
    u32(0x2c, m.fatSectors.length);
    u32(0x30, m.dirSectors.length ? m.dirSectors[0] : C.ENDOFCHAIN);
    u32(0x34, 0);
    u32(0x38, m.cutoff);
    u32(0x3c, m.miniFatSectors.length ? m.miniFatSectors[0] : C.ENDOFCHAIN);
    u32(0x40, m.miniFatSectors.length);
    u32(0x44, m.difatSectors.length ? m.difatSectors[0] : C.ENDOFCHAIN);
    u32(0x48, m.difatSectors.length);
    for (var i = 0; i < C.HEADER_DIFAT_LEN; i++) {
      u32(C.HEADER_DIFAT_OFF + i * 4, i < Math.min(m.fatSectors.length, C.HEADER_DIFAT_LEN)
        ? m.fatSectors[i] : C.FREESECT);
    }
    m.difatSectors.forEach(function (d, idx) {
      var base = off(d);
      for (var k = 0; k < per - 1; k++) {
        var fi = C.HEADER_DIFAT_LEN + idx * (per - 1) + k;
        u32(base + k * 4, fi < m.fatSectors.length ? m.fatSectors[fi] : C.FREESECT);
      }
      u32(base + (per - 1) * 4, idx + 1 < m.difatSectors.length ? m.difatSectors[idx + 1] : C.ENDOFCHAIN);
    });

    /* FAT */
    m.fatSectors.forEach(function (fs, idx) {
      var base = off(fs);
      for (var k = 0; k < per; k++) {
        var v = m.fat[idx * per + k];
        u32(base + k * 4, v === undefined ? C.FREESECT : v);
      }
    });
    /* MiniFAT */
    m.miniFatSectors.forEach(function (ms, idx) {
      var base = off(ms);
      for (var k = 0; k < per; k++) {
        var v = m.minifat[idx * per + k];
        u32(base + k * 4, v === undefined ? C.FREESECT : v);
      }
    });
    /* 루트 엔트리의 미니 스트림 정보 갱신 */
    if (m.entries[0]) {
      m.entries[0].start = m.miniStreamSectors.length ? m.miniStreamSectors[0] : C.ENDOFCHAIN;
      m.entries[0].size = m.miniData.length;
    }
    /* 디렉터리 */
    var perDir = Math.floor(SS / C.DIR_ENTRY_SIZE);
    m.dirSectors.forEach(function (sec, si) {
      var base = off(sec);
      for (var k = 0; k < perDir; k++) {
        var o = base + k * C.DIR_ENTRY_SIZE;
        var e = m.entries[si * perDir + k];
        if (!fits(sec)) continue;
        for (var z = 0; z < C.DIR_ENTRY_SIZE; z++) buf[o + z] = 0;
        if (!e) { u32(o + 0x44, C.NOSTREAM); u32(o + 0x48, C.NOSTREAM); u32(o + 0x4c, C.NOSTREAM); continue; }
        for (var c = 0; c < e.name.length && c < 31; c++) u16(o + c * 2, e.name.charCodeAt(c));
        u16(o + 0x40, e.type === C.TYPE_UNALLOCATED ? 0 : (e.name.length + 1) * 2);
        buf[o + 0x42] = e.type; buf[o + 0x43] = e.color;
        u32(o + 0x44, e.left); u32(o + 0x48, e.right); u32(o + 0x4c, e.child);
        if (e.clsid && e.clsid !== '00000000-0000-0000-0000-000000000000') {
          var hh = e.clsid.replace(/-/g, ''), gb = [];
          for (var g = 0; g < 16; g++) gb.push(parseInt(hh.substr(g * 2, 2), 16));
          /* parse 단계에서 이미 사람이 읽는 순서로 바꿔 두었으므로 되돌린다 */
          [gb[3], gb[2], gb[1], gb[0], gb[5], gb[4], gb[7], gb[6],
           gb[8], gb[9], gb[10], gb[11], gb[12], gb[13], gb[14], gb[15]]
            .forEach(function (v, ix) { buf[o + 0x50 + ix] = v; });
        }
        u32(o + 0x60, e.state || 0);
        if (e.timeBytes) buf.set(e.timeBytes, o + 0x64);
        u32(o + 0x74, e.start);
        u32(o + 0x78, e.size >>> 0); u32(o + 0x7c, 0);
      }
    });
    return buf;
  }

  root.CFBOps = {
    toModel: toModel, serialize: serialize,
    deleteStream: deleteStream, addStream: addStream,
    resizeStream: resizeStream, repack: repack,
    readEntry: readEntry, chainOf: chainOf, parentOf: parentOf
  };
})(typeof window !== 'undefined' ? window : globalThis);
