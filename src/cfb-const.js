/* =====================================================================
 * cfb-const.js — MS-CFB 포맷 상수 정의
 *
 * 출처: [MS-CFB] Compound File Binary File Format (Microsoft Open Specs)
 * 모든 정수는 리틀엔디언(little-endian)이다.
 * ===================================================================== */
(function (root) {
  'use strict';

  var C = {};

  /* --- 파일 시그니처 (헤더 0x00, 8바이트) --------------------------- */
  C.SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

  /* --- 특수 섹터 번호 (SECT) ---------------------------------------
   * FAT 엔트리 4바이트에 들어갈 수 있는 "진짜 섹터 번호"의 최댓값 위로
   * 다섯 개의 예약값이 있다. 이 값들이 FAT을 자기서술적으로 만든다.       */
  C.MAXREGSECT = 0xfffffffa; // 정상 섹터 번호의 최댓값
  C.RESERVED   = 0xfffffffb; // 예약 (사용 금지)
  C.DIFSECT    = 0xfffffffc; // 이 섹터는 DIFAT 섹터다
  C.FATSECT    = 0xfffffffd; // 이 섹터는 FAT 섹터다
  C.ENDOFCHAIN = 0xfffffffe; // 체인의 끝
  C.FREESECT   = 0xffffffff; // 비어 있는(할당되지 않은) 섹터

  /* --- 특수 디렉터리 엔트리 번호 (SID / Stream ID) ------------------ */
  C.MAXREGSID  = 0xfffffffa;
  C.NOSTREAM   = 0xffffffff; // 자식/형제가 없음

  /* --- 객체 타입 (디렉터리 엔트리 +0x42) ----------------------------- */
  C.TYPE_UNALLOCATED = 0x00;
  C.TYPE_STORAGE     = 0x01; // 폴더
  C.TYPE_STREAM      = 0x02; // 파일
  C.TYPE_ROOT        = 0x05; // 루트 (폴더 + 미니 스트림 보관자)

  /* --- 레드-블랙 트리 색상 (디렉터리 엔트리 +0x43) -------------------- */
  C.COLOR_RED   = 0x00;
  C.COLOR_BLACK = 0x01;

  /* --- 크기 상수 ---------------------------------------------------- */
  C.HEADER_SIZE      = 512; // 헤더는 버전과 무관하게 항상 512바이트
  C.DIR_ENTRY_SIZE   = 128; // 디렉터리 엔트리 1개
  C.HEADER_DIFAT_LEN = 109; // 헤더에 인라인으로 들어가는 DIFAT 엔트리 수
  C.HEADER_DIFAT_OFF = 0x4c; // = 76. 512 - 76 = 436, 436/4 = 109
  C.DEFAULT_MINI_CUTOFF = 4096;
  C.MINI_SECTOR_SHIFT   = 6;   // 2^6 = 64
  C.MINI_SECTOR_SIZE    = 64;

  /* --- 헤더 필드 맵 -------------------------------------------------
   * 시각화가 그대로 읽어 쓰는 단일 진실 원천(single source of truth).
   * off: 바이트 오프셋, len: 길이, kind: 렌더링 방식                   */
  C.HEADER_FIELDS = [
    { off: 0x00, len: 8,  id: 'sig',        name: 'Header Signature', short: 'Signature',
      kind: 'bytes',
      expect: 'D0 CF 11 E0 A1 B1 1A E1',
      desc: '"매직 넘버". 이 8바이트가 아니면 CFB 파일이 아니다. 우연히 D0CF11E0이 "DOCFILE0"처럼 읽히도록 고른 값이라고 알려져 있다.' },
    { off: 0x08, len: 16, id: 'clsid',      name: 'Header CLSID', short: 'Header CLSID',
      kind: 'guid',
      expect: '모두 0',
      desc: '사용하지 않는다. 반드시 0으로 채워야 하고, 읽는 쪽은 무시해야 한다.' },
    { off: 0x18, len: 2,  id: 'minorVer',   name: 'Minor Version', short: 'Minor Ver',
      kind: 'u16', expect: '0x003E',
      desc: '부 버전. 실무에서는 검사하지 않는다.' },
    { off: 0x1a, len: 2,  id: 'majorVer',   name: 'Major Version', short: 'Major Ver',
      kind: 'u16', expect: '0x0003 또는 0x0004',
      desc: '3이면 섹터 512바이트, 4면 섹터 4096바이트. 이 한 필드가 파일 전체의 주소 계산을 바꾼다.' },
    { off: 0x1c, len: 2,  id: 'byteOrder',  name: 'Byte Order', short: 'Byte Order',
      kind: 'u16', expect: '0xFFFE',
      desc: '리틀엔디언 표식. 0xFFFE를 리틀엔디언으로 쓰면 FE FF가 되어, 바이트 순서를 눈으로 확인할 수 있다.' },
    { off: 0x1e, len: 2,  id: 'sectorShift', name: 'Sector Shift', short: 'Sector Shift',
      kind: 'u16', expect: '0x0009 (v3) / 0x000C (v4)',
      desc: '섹터 크기 = 2^SectorShift. 9 → 512, 12 → 4096. 크기를 직접 쓰지 않고 지수를 쓰는 이유는 2의 거듭제곱만 허용하기 위해서다.' },
    { off: 0x20, len: 2,  id: 'miniShift', name: 'Mini Sector Shift', short: 'Mini Shift',
      kind: 'u16', expect: '0x0006',
      desc: '미니 섹터 크기 = 2^6 = 64바이트. 작은 스트림 전용의 더 잘게 쪼갠 단위다.' },
    { off: 0x22, len: 6,  id: 'reserved',  name: 'Reserved', short: 'Reserved',
      kind: 'bytes', expect: '모두 0',
      desc: '예약 영역. 0으로 채우고 읽을 때는 무시한다.' },
    { off: 0x28, len: 4,  id: 'numDirSect', name: 'Number of Directory Sectors', short: '# Dir Sect',
      kind: 'u32', expect: 'v3에서는 0',
      desc: 'v3에서는 반드시 0이다. 디렉터리 섹터 개수는 FAT 체인을 끝까지 따라가서 세라는 뜻. v4에서만 실제 개수가 들어간다.' },
    { off: 0x2c, len: 4,  id: 'numFatSect', name: 'Number of FAT Sectors', short: '# FAT Sect',
      kind: 'u32',
      desc: 'FAT을 담고 있는 섹터의 개수. DIFAT에서 읽어야 할 항목 수와 같다.' },
    { off: 0x30, len: 4,  id: 'firstDirSect', name: 'First Directory Sector Location', short: '1st Dir Sect',
      kind: 'sect',
      desc: '디렉터리 체인의 첫 섹터. 여기서부터 FAT을 따라가면 모든 디렉터리 엔트리를 모을 수 있다.' },
    { off: 0x34, len: 4,  id: 'txSig', name: 'Transaction Signature Number', short: 'Tx Signature',
      kind: 'u32', expect: '보통 0',
      desc: '트랜잭션(안전 저장)을 지원하는 구현이 저장할 때마다 증가시키도록 의도된 필드. 실무 구현 대부분은 0으로 둔다.' },
    { off: 0x38, len: 4,  id: 'miniCutoff', name: 'Mini Stream Cutoff Size', short: 'Mini Cutoff',
      kind: 'u32', expect: '0x00001000 (4096)',
      desc: '이 크기보다 "작은" 스트림은 미니 스트림에 넣는다. 정확히 4096바이트인 스트림은 미니가 아니라 일반 섹터로 간다.' },
    { off: 0x3c, len: 4,  id: 'firstMiniFat', name: 'First Mini FAT Sector Location', short: '1st MiniFAT',
      kind: 'sect',
      desc: 'MiniFAT 체인의 첫 섹터. MiniFAT 자체는 일반 FAT을 따라 이어진다.' },
    { off: 0x40, len: 4,  id: 'numMiniFat', name: 'Number of Mini FAT Sectors', short: '# MiniFAT',
      kind: 'u32',
      desc: 'MiniFAT이 차지하는 섹터 개수.' },
    { off: 0x44, len: 4,  id: 'firstDifat', name: 'First DIFAT Sector Location', short: '1st DIFAT',
      kind: 'sect', expect: '작은 파일에서는 ENDOFCHAIN',
      desc: 'FAT 섹터가 109개를 넘을 때만 쓰인다. 그 전까지는 ENDOFCHAIN(0xFFFFFFFE).' },
    { off: 0x48, len: 4,  id: 'numDifat', name: 'Number of DIFAT Sectors', short: '# DIFAT',
      kind: 'u32', expect: '작은 파일에서는 0',
      desc: '추가 DIFAT 섹터의 개수. 대략 7MB 이하 파일에서는 0이다.' },
    { off: 0x4c, len: 436, id: 'difat', name: 'DIFAT (109 entries)', short: 'DIFAT (109칸)',
      kind: 'difat',
      desc: '헤더 안에 박혀 있는 FAT 섹터 목록. 436 / 4 = 109개. 이 덕분에 작은 파일은 헤더 한 장만 읽으면 FAT의 위치를 전부 알 수 있다.' }
  ];

  /* --- 디렉터리 엔트리 필드 맵 (128바이트) --------------------------- */
  C.DIR_FIELDS = [
    { off: 0x00, len: 64, id: 'name', name: 'Directory Entry Name', short: 'Name', kind: 'utf16',
      desc: 'UTF-16LE 문자열. 최대 31자 + NULL. 64바이트 고정이라 남는 자리는 0으로 채운다.' },
    { off: 0x40, len: 2,  id: 'nameLen', name: 'Name Length', short: 'Name Len', kind: 'u16',
      desc: '이름의 "바이트" 길이이며 끝의 NULL 2바이트를 포함한다. "Root Entry"(10자) → 22. 글자 수로 착각하기 쉬운 대표적인 함정.' },
    { off: 0x42, len: 1,  id: 'type', name: 'Object Type', short: 'Object Type', kind: 'u8',
      desc: '0 = 미할당, 1 = 저장소(폴더), 2 = 스트림(파일), 5 = 루트 저장소.' },
    { off: 0x43, len: 1,  id: 'color', name: 'Color Flag', short: 'Color', kind: 'u8',
      desc: '레드-블랙 트리의 색. 0 = red, 1 = black.' },
    { off: 0x44, len: 4,  id: 'left', name: 'Left Sibling ID', short: 'Left', kind: 'sid',
      desc: '형제 트리의 왼쪽 자식. 없으면 NOSTREAM(0xFFFFFFFF).' },
    { off: 0x48, len: 4,  id: 'right', name: 'Right Sibling ID', short: 'Right', kind: 'sid',
      desc: '형제 트리의 오른쪽 자식. 없으면 NOSTREAM.' },
    { off: 0x4c, len: 4,  id: 'child', name: 'Child ID', short: 'Child', kind: 'sid',
      desc: '이 저장소 안에 든 자식들의 레드-블랙 트리의 "루트". 스트림이면 NOSTREAM.' },
    { off: 0x50, len: 16, id: 'clsid', name: 'CLSID', short: 'CLSID', kind: 'guid',
      desc: '저장소의 클래스 ID. 루트 엔트리의 CLSID가 곧 "이 문서가 무엇인가"를 말해 준다.' },
    { off: 0x60, len: 4,  id: 'state', name: 'State Bits', short: 'State', kind: 'u32',
      desc: 'IStorage::SetStateBits로 설정하는 사용자 정의 플래그.' },
    { off: 0x64, len: 8,  id: 'ctime', name: 'Creation Time', short: 'Created', kind: 'filetime',
      desc: 'FILETIME (1601-01-01 UTC부터 100나노초 단위). 스트림에서는 보통 0.' },
    { off: 0x6c, len: 8,  id: 'mtime', name: 'Modified Time', short: 'Modified', kind: 'filetime',
      desc: 'FILETIME. 스트림에서는 보통 0.' },
    { off: 0x74, len: 4,  id: 'start', name: 'Starting Sector Location', short: 'Start Sector', kind: 'sect',
      desc: '이 스트림의 첫 섹터(또는 미니 섹터). 루트 엔트리에서는 "미니 스트림"의 첫 섹터를 가리킨다.' },
    { off: 0x78, len: 8,  id: 'size', name: 'Stream Size', short: 'Stream Size', kind: 'u64',
      desc: '스트림의 정확한 바이트 길이. v3에서는 상위 4바이트를 0으로 두어야 하며, 읽는 쪽도 무시하는 것이 안전하다.' }
  ];

  /* --- 섹터 역할 (시각화용 색상 분류) -------------------------------- */
  C.ROLE = {
    HEADER:  'header',
    DIFAT:   'difat',
    FAT:     'fat',
    DIR:     'dir',
    MINIFAT: 'minifat',
    MINI:    'mini',    // 미니 스트림을 담고 있는 일반 섹터
    STREAM:  'stream',
    FREE:    'free'
  };

  C.ROLE_LABEL = {
    header:  '헤더',
    difat:   'DIFAT 섹터',
    fat:     'FAT 섹터',
    dir:     '디렉터리 섹터',
    minifat: 'MiniFAT 섹터',
    mini:    '미니 스트림',
    stream:  '스트림 데이터',
    free:    '빈 섹터'
  };

  /* --- 특수값 이름 조회 --------------------------------------------- */
  C.sectName = function (v) {
    switch (v >>> 0) {
      case C.DIFSECT:    return 'DIFSECT';
      case C.FATSECT:    return 'FATSECT';
      case C.ENDOFCHAIN: return 'ENDOFCHAIN';
      case C.FREESECT:   return 'FREESECT';
      case C.RESERVED:   return 'RESERVED';
      default:           return null;
    }
  };

  C.sidName = function (v) {
    return (v >>> 0) === C.NOSTREAM ? 'NOSTREAM' : null;
  };

  root.CFBConst = C;
})(typeof window !== 'undefined' ? window : globalThis);
