/* =====================================================================
 * cfb-parse.js — 계측된(instrumented) CFB 리더
 *
 * 보통의 파서는 결과만 돌려준다. 이 파서는 "무엇을, 왜, 어느 바이트에서
 * 읽었는가"를 단계(trace)로 남긴다. 화면의 모든 뷰 — hex 뷰, 섹터 지도,
 * 체인 다이어그램 — 는 이 하나의 trace를 공유해서 동기화된다.
 * ===================================================================== */
(function (root) {
  'use strict';

  var C = root.CFBConst;

  /* 읽기 도우미. 파일 밖을 읽으려 하면 예외를 던지는 대신
   * "아무것도 없음"에 해당하는 값을 돌려준다. 잘린 파일이나 조작된 파일을
   * 열었을 때 파서가 죽지 않고 최대한 보여 주기 위해서다. */
  function R(buf) {
    this.b = buf;
    this.len = buf.byteLength;
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.oob = false;   // 한 번이라도 범위를 벗어났는가
  }
  R.prototype.u8  = function (o) {
    if (o < 0 || o + 1 > this.len) { this.oob = true; return 0; }
    return this.b[o];
  };
  R.prototype.u16 = function (o) {
    if (o < 0 || o + 2 > this.len) { this.oob = true; return 0; }
    return this.dv.getUint16(o, true);
  };
  R.prototype.u32 = function (o) {
    if (o < 0 || o + 4 > this.len) { this.oob = true; return 0xffffffff; }
    return this.dv.getUint32(o, true) >>> 0;
  };
  R.prototype.u64 = function (o) {
    if (o < 0 || o + 8 > this.len) { this.oob = true; return 0; }
    var lo = this.u32(o), hi = this.u32(o + 4);
    return hi * 4294967296 + lo;
  };
  R.prototype.utf16 = function (o, byteLen) {
    var s = '';
    for (var i = 0; i + 1 < byteLen; i += 2) {
      var c = this.u16(o + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  R.prototype.guid = function (o) {
    var b = this.b, h = function (n) { return ('0' + b[n].toString(16)).slice(-2).toUpperCase(); };
    return h(o + 3) + h(o + 2) + h(o + 1) + h(o) + '-' + h(o + 5) + h(o + 4) + '-' +
           h(o + 7) + h(o + 6) + '-' + h(o + 8) + h(o + 9) + '-' +
           h(o + 10) + h(o + 11) + h(o + 12) + h(o + 13) + h(o + 14) + h(o + 15);
  };
  R.prototype.filetime = function (o) {
    var lo = this.u32(o), hi = this.u32(o + 4);
    var t = hi * 4294967296 + lo;
    if (t === 0) return null;
    return new Date(t / 10000 - 11644473600000);
  };

  /* 잘 알려진 CLSID → 사람이 읽을 수 있는 이름 */
  var KNOWN_CLSID = {
    '00020906-0000-0000-C000-000000000046': 'Word.Document.8 (Word 97-2003 문서)',
    '00020820-0000-0000-C000-000000000046': 'Excel.Sheet.8 (Excel 97-2003 통합 문서)',
    '00020821-0000-0000-C000-000000000046': 'Excel.Chart.8',
    '64818D10-4F9B-11CF-86EA-00AA00B929E8': 'PowerPoint.Show.8 (PowerPoint 97-2003)',
    '000C1084-0000-0000-C000-000000000046': 'Windows Installer 패키지 (.msi)',
    '00020D0B-0000-0000-C000-000000000046': 'Outlook 메시지 (.msg)'
  };

  function parse(bytes, opts) {
    try { return parseInner(bytes, opts); }
    catch (err) {
      return { ok: false, error: '이 파일을 읽는 중 문제가 생겼다: ' + err.message +
               ' — 잘렸거나 손상된 CFB 파일일 수 있다.', trace: [] };
    }
  }

  function parseInner(bytes, opts) {
    opts = opts || {};
    if (!bytes || bytes.length < C.HEADER_SIZE) {
      return { ok: false, error: '파일이 512바이트보다 작다. CFB 헤더조차 들어가지 않는다.', trace: [] };
    }
    var r = new R(bytes);
    var trace = [];
    var warn = [];
    function step(o) { trace.push(o); return o; }

    /* ---------- 1단계: 시그니처 확인 ---------------------------------- */
    var sigOk = C.SIGNATURE.every(function (v, i) { return r.u8(i) === v; });
    step({
      id: 'sig', phase: 'header', title: '1. 시그니처 확인',
      detail: sigOk
        ? '파일의 첫 8바이트가 D0 CF 11 E0 A1 B1 1A E1 이다. CFB 파일이 맞다.'
        : 'CFB 시그니처가 아니다. 이 파일은 컴파운드 파일이 아니다.',
      bytes: [[0, 8]], ok: sigOk
    });
    if (!sigOk) return { ok: false, error: '이 파일은 CFB(컴파운드 파일)가 아닙니다.', trace: trace };

    /* ---------- 2단계: 헤더 필드 읽기 ---------------------------------- */
    var h = {
      minorVersion: r.u16(0x18),
      majorVersion: r.u16(0x1a),
      byteOrder: r.u16(0x1c),
      sectorShift: r.u16(0x1e),
      miniSectorShift: r.u16(0x20),
      numDirSectors: r.u32(0x28),
      numFatSectors: r.u32(0x2c),
      firstDirSector: r.u32(0x30),
      transactionSig: r.u32(0x34),
      miniCutoff: r.u32(0x38),
      firstMiniFatSector: r.u32(0x3c),
      numMiniFatSectors: r.u32(0x40),
      firstDifatSector: r.u32(0x44),
      numDifatSectors: r.u32(0x48)
    };
    var SS = 1 << h.sectorShift;
    var MSS = 1 << h.miniSectorShift;
    h.sectorSize = SS;
    h.miniSectorSize = MSS;
    h.clsid = r.guid(0x08);

    if (h.majorVersion !== 3 && h.majorVersion !== 4) warn.push('major version이 3도 4도 아니다: ' + h.majorVersion);
    if (h.byteOrder !== 0xfffe) warn.push('byte order 표식이 0xFFFE가 아니다');
    if (h.majorVersion === 3 && h.sectorShift !== 9) warn.push('v3인데 sector shift가 9가 아니다');
    if (h.majorVersion === 4 && h.sectorShift !== 12) warn.push('v4인데 sector shift가 12가 아니다');
    if (h.majorVersion === 3 && h.numDirSectors !== 0) warn.push('v3에서는 Number of Directory Sectors가 0이어야 한다');
    if (SS < 128 || SS > 1 << 20 || (SS & (SS - 1)) !== 0) {
      return { ok: false, error: '섹터 크기가 말이 안 된다 (2^' + h.sectorShift + ' = ' + SS + '바이트). 손상된 파일이다.', trace: trace };
    }
    if (h.miniCutoff === 0 || h.miniCutoff > (1 << 30)) {
      warn.push('Mini Stream Cutoff가 이상하다 (' + h.miniCutoff + ') — 기본값 4096으로 간주한다');
      h.miniCutoff = C.DEFAULT_MINI_CUTOFF;
    }

    step({
      id: 'sectorsize', phase: 'header', title: '2. 섹터 크기 결정',
      detail: 'Major Version = ' + h.majorVersion + ', Sector Shift = ' + h.sectorShift +
              ' → 섹터 크기 = 2^' + h.sectorShift + ' = ' + SS + '바이트. ' +
              '이 숫자 하나가 이후 모든 주소 계산의 기준이 된다.',
      bytes: [[0x1a, 2], [0x1e, 2]]
    });
    step({
      id: 'header', phase: 'header', title: '3. 나머지 헤더 필드 해석',
      detail: 'FAT 섹터 ' + h.numFatSectors + '개, 디렉터리 시작 섹터 ' + h.firstDirSector +
              ', MiniFAT 섹터 ' + h.numMiniFatSectors + '개, 미니 스트림 기준 크기 ' + h.miniCutoff + '바이트.',
      bytes: [[0x28, 0x4c - 0x28]]
    });

    var totalSectors = Math.max(0, Math.floor((bytes.length - SS) / SS));
    if (SS === 512) totalSectors = Math.max(0, Math.floor((bytes.length - 512) / 512));
    var sectOff = function (s) { return (s + 1) * SS; };

    /* ---------- 3단계: DIFAT 조립 -------------------------------------- */
    var difat = [];
    var difatSectors = [];
    /* 헤더 DIFAT을 몇 칸까지 믿을 것인가.
     * "FREESECT가 나올 때까지" 읽는 구현이 많지만, 남는 칸을 0으로 채우는
     * 작성기가 있고 0은 "섹터 0"이라는 멀쩡한 번호다. 그래서 개수는
     * Number of FAT Sectors 필드에서 가져오고, 그 필드가 미덥지 않을 때만
     * 훑어 읽기로 되돌아간다. */
    var declared = Math.min(h.numFatSectors, C.HEADER_DIFAT_LEN);
    var i;
    if (declared > 0) {
      for (i = 0; i < declared; i++) {
        var dv2 = r.u32(C.HEADER_DIFAT_OFF + i * 4);
        if (dv2 === C.FREESECT) {
          warn.push('헤더가 FAT 섹터 ' + h.numFatSectors + '개라고 하는데 DIFAT ' + i + '번째 칸이 이미 비어 있다');
          break;
        }
        difat.push(dv2);
      }
    } else {
      for (i = 0; i < C.HEADER_DIFAT_LEN; i++) {
        var dv3 = r.u32(C.HEADER_DIFAT_OFF + i * 4);
        if (dv3 === C.FREESECT) break;
        difat.push(dv3);
      }
      if (difat.length) warn.push('Number of FAT Sectors가 0이라 DIFAT을 직접 훑어 읽었다');
    }
    var headerDifatCount = difat.length;
    var ds = h.firstDifatSector, guard = 0;
    while (ds !== C.ENDOFCHAIN && ds !== C.FREESECT && guard++ < 1 << 20) {
      if (sectOff(ds) + SS > bytes.length) { warn.push('DIFAT 섹터 ' + ds + '가 파일 밖을 가리킨다'); break; }
      difatSectors.push(ds);
      var base = sectOff(ds);
      for (i = 0; i < SS / 4 - 1; i++) {
        var fv = r.u32(base + i * 4);
        if (fv !== C.FREESECT) difat.push(fv);
      }
      ds = r.u32(base + (SS / 4 - 1) * 4);
    }
    step({
      id: 'difat', phase: 'fat', title: '4. DIFAT 조립 — FAT이 어디에 있는지 알아낸다',
      detail: '헤더 안 109칸에서 ' + headerDifatCount + '개를 읽었다' +
              (difatSectors.length
                ? ', 그리고 DIFAT 섹터 ' + difatSectors.length + '개를 더 따라가 총 ' + difat.length + '개를 모았다.'
                : '. FAT 섹터가 109개 이하라 추가 DIFAT 섹터는 필요 없다.') +
              ' 결과: FAT은 섹터 ' + difat.slice(0, 8).join(', ') + (difat.length > 8 ? ' …' : '') + '에 있다.',
      bytes: [[C.HEADER_DIFAT_OFF, Math.min(headerDifatCount * 4, 436)]],
      sectors: difatSectors
    });

    /* ---------- 4단계: FAT 적재 ---------------------------------------- */
    var fat = new Uint32Array(difat.length * (SS / 4)).fill(C.FREESECT);
    difat.forEach(function (fs, idx) {
      if (sectOff(fs) + SS > bytes.length) { warn.push('FAT 섹터 ' + fs + '가 파일 밖을 가리킨다'); return; }
      var b = sectOff(fs);
      for (var k = 0; k < SS / 4; k++) fat[idx * (SS / 4) + k] = r.u32(b + k * 4);
    });
    step({
      id: 'fat', phase: 'fat', title: '5. FAT 적재 — 섹터들의 연결 리스트',
      detail: 'FAT 섹터 ' + difat.length + '개를 이어 붙여 ' + fat.length + '칸짜리 배열을 만들었다. ' +
              'FAT[n]은 "섹터 n 다음에 오는 섹터"를 뜻한다. 이제 어떤 스트림이든 시작 섹터만 알면 끝까지 따라갈 수 있다.',
      sectors: difat.slice()
    });

    /* 체인 추적 (순환 감지 포함) */
    function followChain(start, table, limit) {
      var out = [], seen = new Set(), s = start, n = 0;
      while (s !== C.ENDOFCHAIN && s !== C.FREESECT && s <= C.MAXREGSECT) {
        if (seen.has(s)) { warn.push('섹터 체인에 순환이 있다 (섹터 ' + s + ')'); break; }
        if (s >= table.length) { warn.push('체인이 표 범위를 벗어난 섹터 ' + s + '를 가리킨다'); break; }
        seen.add(s); out.push(s); s = table[s];
        if (limit && ++n > limit) break;
      }
      return { sectors: out, end: s };
    }

    /* ---------- 5단계: 디렉터리 읽기 ------------------------------------ */
    var dirChain = followChain(h.firstDirSector, fat);
    var dirSectors = dirChain.sectors;
    step({
      id: 'dirchain', phase: 'dir', title: '6. 디렉터리 체인 따라가기',
      detail: '헤더가 알려 준 섹터 ' + h.firstDirSector + '에서 출발해 FAT을 따라갔더니 섹터 ' +
              dirSectors.join(' → ') + ' 로 이어졌다. ' +
              'v3에서는 헤더에 디렉터리 섹터 "개수"가 없으므로, 이렇게 끝까지 따라가는 것 외에는 알 방법이 없다.',
      sectors: dirSectors, chain: dirSectors
    });

    var perSect = Math.floor(SS / C.DIR_ENTRY_SIZE);
    var entries = [];
    dirSectors.forEach(function (sec, si) {
      var base = sectOff(sec);
      for (var k = 0; k < perSect; k++) {
        var o = base + k * C.DIR_ENTRY_SIZE;
        if (o + C.DIR_ENTRY_SIZE > bytes.length) return;
        var nameLen = r.u16(o + 0x40);
        var type = r.u8(o + 0x42);
        var e = {
          sid: entries.length,
          offset: o,
          sector: sec,
          slot: k,
          name: r.utf16(o, Math.min(nameLen, 64)),
          nameLen: nameLen,
          type: type,
          typeName: { 0: '미할당', 1: '저장소', 2: '스트림', 5: '루트 저장소' }[type] || ('알 수 없음(' + type + ')'),
          color: r.u8(o + 0x43),
          left: r.u32(o + 0x44),
          right: r.u32(o + 0x48),
          child: r.u32(o + 0x4c),
          clsid: r.guid(o + 0x50),
          state: r.u32(o + 0x60),
          ctime: r.filetime(o + 0x64),
          mtime: r.filetime(o + 0x6c),
          start: r.u32(o + 0x74),
          size: r.u64(o + 0x78),
          sizeLo: r.u32(o + 0x78),
          sizeHi: r.u32(o + 0x7c)
        };
        if (h.majorVersion === 3 && e.sizeHi !== 0) {
          warn.push('v3인데 스트림 크기의 상위 4바이트가 0이 아니다 (' + e.name + ') — 하위 4바이트만 신뢰한다');
          e.size = e.sizeLo;
        }
        e.knownClsid = KNOWN_CLSID[e.clsid] || null;
        e.displayName = e.name.replace(/[\u0000-\u001f]/g, function (c) {
          return '‹' + ('0' + c.charCodeAt(0).toString(16).toUpperCase()).slice(-2) + '›';
        });
        entries.push(e);
      }
    });

    var live = entries.filter(function (e) { return e.type !== C.TYPE_UNALLOCATED; });
    step({
      id: 'direntries', phase: 'dir', title: '7. 디렉터리 엔트리 해석',
      detail: '디렉터리 섹터 ' + dirSectors.length + '개 = ' + entries.length + '칸. ' +
              '한 칸은 정확히 128바이트이고, 실제로 쓰이는 엔트리는 ' + live.length + '개다. ' +
              '엔트리의 번호(SID)가 곧 이 배열의 인덱스이며, 형제·자식 포인터가 이 번호를 가리킨다.',
      sectors: dirSectors,
      bytes: [[sectOff(dirSectors[0]), Math.min(entries.length * C.DIR_ENTRY_SIZE, SS)]]
    });

    /* ---------- 6단계: 루트 엔트리 = 미니 스트림의 주인 ------------------- */
    var rootEnt = entries[0];
    if (!rootEnt || rootEnt.type !== C.TYPE_ROOT) warn.push('SID 0이 루트 저장소가 아니다');
    var miniStreamChain = rootEnt ? followChain(rootEnt.start, fat) : { sectors: [] };
    step({
      id: 'root', phase: 'mini', title: '8. 루트 엔트리 — 두 가지 일을 동시에 한다',
      detail: 'SID 0의 루트 엔트리는 (1) 최상위 폴더이면서, 동시에 (2) "미니 스트림"이라는 하나의 큰 스트림의 소유자다. ' +
              '루트 엔트리의 시작 섹터 ' + (rootEnt ? rootEnt.start : '?') + ', 크기 ' + (rootEnt ? rootEnt.size : 0) +
              '바이트가 바로 미니 스트림이다. 작은 파일들은 전부 이 안에 이어 붙어 있다.' +
              (rootEnt && rootEnt.knownClsid ? ' 루트의 CLSID는 ' + rootEnt.knownClsid + '를 뜻한다.' : ''),
      bytes: rootEnt ? [[rootEnt.offset + 0x50, 16], [rootEnt.offset + 0x74, 12]] : [],
      sectors: miniStreamChain.sectors, dirEntries: [0]
    });

    /* ---------- 7단계: MiniFAT ---------------------------------------- */
    var miniFatChain = followChain(h.firstMiniFatSector, fat);
    var minifat = new Uint32Array(miniFatChain.sectors.length * (SS / 4)).fill(C.FREESECT);
    miniFatChain.sectors.forEach(function (ms, idx) {
      if (sectOff(ms) + SS > bytes.length) { warn.push('MiniFAT 섹터 ' + ms + '가 파일 밖을 가리킨다'); return; }
      var b = sectOff(ms);
      for (var k = 0; k < SS / 4; k++) minifat[idx * (SS / 4) + k] = r.u32(b + k * 4);
    });
    step({
      id: 'minifat', phase: 'mini', title: '9. MiniFAT 적재',
      detail: miniFatChain.sectors.length
        ? 'MiniFAT은 섹터 ' + miniFatChain.sectors.join(' → ') + '에 있다. FAT과 똑같이 생겼지만, ' +
          '가리키는 대상이 512바이트 섹터가 아니라 미니 스트림 안의 64바이트 미니 섹터다.'
        : '이 파일에는 미니 스트림이 없다 (작은 스트림이 하나도 없거나 전부 비어 있다).',
      sectors: miniFatChain.sectors
    });

    /* ---------- 8단계: 트리 순회로 경로 만들기 ---------------------------- */
    var byPath = {};
    var walkSteps = [];
    function walkTree(sid, parentPath, depth, out) {
      if (sid === C.NOSTREAM || sid >= entries.length || depth > 64) return;
      var e = entries[sid];
      if (!e || e.type === C.TYPE_UNALLOCATED) return;
      walkTree(e.left, parentPath, depth + 1, out);
      e.path = parentPath + '/' + e.name;
      e.displayPath = parentPath + '/' + e.displayName;
      e.depth = parentPath.split('/').length;
      byPath[e.path] = e;
      out.push(e);
      if (e.child !== C.NOSTREAM) {
        e.children = [];
        walkTree(e.child, e.path, depth + 1, e.children);
      }
      walkTree(e.right, parentPath, depth + 1, out);
    }
    if (rootEnt) {
      rootEnt.path = '/';
      rootEnt.displayPath = '/';
      rootEnt.depth = 0;
      byPath['/'] = rootEnt;
      rootEnt.children = [];
      if (rootEnt.child !== C.NOSTREAM) walkTree(rootEnt.child, '', 0, rootEnt.children);
    }
    var orphans = entries.filter(function (e) {
      return e.type !== C.TYPE_UNALLOCATED && e.path === undefined;
    });
    if (orphans.length) {
      warn.push('트리에서 닿을 수 없는 엔트리가 ' + orphans.length + '개 있다 (' +
        orphans.slice(0, 4).map(function (e) { return '"' + e.displayName + '"'; }).join(', ') +
        ') — 디스크에는 멀쩡히 있지만 어느 폴더에도 매달려 있지 않다');
    }
    step({
      id: 'tree', phase: 'dir', title: '10. 레드-블랙 트리를 중위 순회해서 폴더 목록을 얻는다',
      detail: '한 폴더의 자식들은 배열이 아니라 레드-블랙 트리로 묶여 있다. left/right를 따라 중위 순회(in-order)하면 ' +
              '정렬된 목록이 나온다. 정렬 기준은 사전순이 아니라 "이름 길이 먼저, 그다음 대문자 비교"다.',
      dirEntries: live.map(function (e) { return e.sid; })
    });

    /* ---------- 9단계: 섹터 역할 지도 ------------------------------------ */
    var roles = new Array(totalSectors).fill(C.ROLE.FREE);
    var owner = new Array(totalSectors).fill(null);
    function mark(list, role, own) {
      list.forEach(function (s) {
        if (s < 0 || s >= totalSectors) return;
        roles[s] = role; owner[s] = own;
      });
    }
    mark(difat, C.ROLE.FAT, 'FAT');
    mark(difatSectors, C.ROLE.DIFAT, 'DIFAT');
    mark(dirSectors, C.ROLE.DIR, '디렉터리');
    mark(miniFatChain.sectors, C.ROLE.MINIFAT, 'MiniFAT');
    mark(miniStreamChain.sectors, C.ROLE.MINI, '미니 스트림');

    /* 각 스트림의 체인 계산 */
    live.forEach(function (e) {
      if (e.type !== C.TYPE_STREAM) return;
      e.isMini = e.size > 0 && e.size < h.miniCutoff;
      if (e.size === 0) { e.chain = []; return; }
      if (e.isMini) {
        e.miniChain = followChain(e.start, minifat).sectors;
        e.chain = [];
      } else {
        e.chain = followChain(e.start, fat).sectors;
        mark(e.chain, C.ROLE.STREAM, e.displayName);
      }
    });

    /* 미니 섹터 → 파일 오프셋 변환 */
    function miniSectorOffset(m) {
      var byteInMini = m * MSS;
      var whichSect = Math.floor(byteInMini / SS);
      var within = byteInMini % SS;
      var sec = miniStreamChain.sectors[whichSect];
      if (sec === undefined) return null;
      return { sector: sec, offset: sectOff(sec) + within, indexInMiniStream: whichSect, within: within };
    }

    /* 스트림 내용 읽기 */
    function readStream(e) {
      if (!e || e.size === 0) return new Uint8Array(0);
      var out = new Uint8Array(e.size), p = 0;
      if (e.isMini) {
        (e.miniChain || []).forEach(function (m) {
          var loc = miniSectorOffset(m);
          if (!loc) return;
          var n = Math.min(MSS, e.size - p);
          if (n <= 0) return;
          out.set(bytes.subarray(loc.offset, loc.offset + n), p); p += n;
        });
      } else {
        (e.chain || []).forEach(function (s) {
          var n = Math.min(SS, e.size - p);
          if (n <= 0) return;
          var o = sectOff(s);
          out.set(bytes.subarray(o, o + n), p); p += n;
        });
      }
      return out;
    }

    if (r.oob) warn.push('파일이 스스로 주장하는 크기보다 짧다 — 잘린 파일일 수 있다. 없는 부분은 비어 있는 것으로 취급했다.');
    var freeCount = roles.filter(function (x) { return x === C.ROLE.FREE; }).length;
    step({
      id: 'map', phase: 'map', title: '11. 완성된 섹터 지도',
      detail: '총 ' + totalSectors + '개 섹터의 용도가 전부 밝혀졌다. ' +
              '메타데이터(FAT·디렉터리·MiniFAT) ' + (difat.length + difatSectors.length + dirSectors.length + miniFatChain.sectors.length) +
              '개, 미니 스트림 ' + miniStreamChain.sectors.length + '개, 일반 스트림 데이터 ' +
              roles.filter(function (x) { return x === C.ROLE.STREAM; }).length + '개, 빈 섹터 ' + freeCount + '개.',
      sectors: []
    });

    return {
      ok: true,
      bytes: bytes,
      header: h,
      warn: warn,
      trace: trace,
      sectorSize: SS,
      miniSectorSize: MSS,
      totalSectors: totalSectors,
      sectOff: sectOff,
      difat: difat,
      headerDifatCount: headerDifatCount,
      difatSectors: difatSectors,
      fat: fat,
      minifat: minifat,
      dirSectors: dirSectors,
      miniFatSectors: miniFatChain.sectors,
      miniStreamSectors: miniStreamChain.sectors,
      miniStreamSize: rootEnt ? rootEnt.size : 0,
      entries: entries,
      live: live,
      orphans: orphans,
      root: rootEnt,
      byPath: byPath,
      roles: roles,
      owner: owner,
      followChain: followChain,
      miniSectorOffset: miniSectorOffset,
      readStream: readStream,
      KNOWN_CLSID: KNOWN_CLSID
    };
  }

  root.CFBParse = { parse: parse };
})(typeof window !== 'undefined' ? window : globalThis);
