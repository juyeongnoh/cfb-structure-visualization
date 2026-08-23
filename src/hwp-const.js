/* =====================================================================
 * hwp-const.js — HWP 5.0 상수와 필드 맵
 *
 * HWP 5.0은 그 자체로 CFB(컴파운드 파일)다. 그래서 섹터·FAT·디렉터리는
 * 앞 페이지의 것이 그대로 적용된다. 여기 있는 것은 HWP가 CFB "위에"
 * 얹은 두 번째 구조다:
 *
 *   CFB 스트림  →  (배포용이면 복호화)  →  (압축이면 풀기)  →  레코드 트리
 *
 * 출처: 한글문서파일형식 5.0 (한컴), 그리고 pyhwp · hwp.js · hwplib
 * ===================================================================== */
(function (root) {
  'use strict';

  var H = {};

  /* --- FileHeader 스트림 ---------------------------------------------- */
  H.FILEHEADER_SIZE = 256;
  /* "HWP Document File" (17자) 뒤를 0으로 채워 32바이트를 만든다 */
  H.SIGNATURE_TEXT = 'HWP Document File';
  H.SIGNATURE = (function () {
    var a = new Uint8Array(32);
    for (var i = 0; i < H.SIGNATURE_TEXT.length; i++) a[i] = H.SIGNATURE_TEXT.charCodeAt(i);
    return a;
  })();

  /* 속성 비트 (FileHeader +0x24) */
  H.PROP_BITS = [
    { bit: 0,  name: '압축', desc: 'DocInfo·BodyText·BinData 스트림이 raw deflate로 압축되어 있다. 실제 파일은 거의 항상 켜져 있다.' },
    { bit: 1,  name: '암호 설정', desc: '암호가 걸린 문서.' },
    { bit: 2,  name: '배포용 문서', desc: '읽기 전용 배포본. BodyText 대신 ViewText를 쓰고, 복호화에 필요한 것이 파일 안에 들어 있다.' },
    { bit: 3,  name: '스크립트 저장', desc: 'Scripts 스토리지에 JScript가 들어 있다.' },
    { bit: 4,  name: 'DRM 보안 문서', desc: 'DRM이 적용된 문서.' },
    { bit: 5,  name: 'XMLTemplate 존재', desc: 'XMLTemplate 스토리지가 있다.' },
    { bit: 6,  name: '문서 이력 관리 존재', desc: 'DocHistory 스토리지가 있다 — 예전 판본이 통째로 남아 있을 수 있다.' },
    { bit: 7,  name: '전자 서명 정보 존재', desc: '' },
    { bit: 8,  name: '공인 인증서 암호화', desc: '' },
    { bit: 9,  name: '전자 서명 예비 저장', desc: '' },
    { bit: 10, name: '공인 인증서 DRM 보안', desc: '' },
    { bit: 11, name: 'CCL 문서', desc: '크리에이티브 커먼즈 라이선스 표시.' },
    { bit: 12, name: '모바일 최적화', desc: '명세 개정 1.3(2018) 문서에 실려 있는 비트. 그 이전 개정에도 있었는지는 확인하지 못했다.' },
    { bit: 13, name: '개인 정보 보안 문서', desc: '개정 1.3 문서에 실려 있다.' },
    { bit: 14, name: '변경 추적 문서', desc: '개정 1.3 문서에 실려 있다.' },
    { bit: 15, name: '공공누리(KOGL) 저작권 문서', desc: '개정 1.3 문서에 실려 있다.' },
    { bit: 16, name: '비디오 컨트롤 포함', desc: '개정 1.3 문서에 실려 있다.' },
    { bit: 17, name: '차례 필드 컨트롤 포함', desc: '개정 1.3 문서에 실려 있다. 18번부터 31번까지는 예약.' }
  ];

  H.FILEHEADER_FIELDS = [
    { off: 0x00, len: 32, id: 'sig', name: 'Signature', short: 'Signature', kind: 'text',
      expect: '"HWP Document File" + 0 채움',
      desc: 'HWP 5.0 파일임을 알리는 32바이트. CFB 시그니처(D0 CF 11 E0)와는 별개다 — 그건 바깥 껍데기의 것이고, 이건 그 안에 든 FileHeader 스트림의 첫 바이트다.' },
    { off: 0x20, len: 4, id: 'version', name: 'Version', short: 'Version', kind: 'version',
      desc: '파일 형식 버전. 4바이트를 MM.nn.PP.rr로 읽는데, 디스크에 리틀엔디언으로 적히므로 바이트 순서가 뒤집혀 보인다.' },
    { off: 0x24, len: 4, id: 'props', name: 'Properties', short: 'Properties', kind: 'bits',
      desc: '압축·암호·배포용 여부 등을 담은 비트 모음. 이 4바이트가 파일을 어떻게 읽어야 하는지를 결정한다.' },
    { off: 0x28, len: 4, id: 'props2', name: 'Properties 2', short: 'Properties 2', kind: 'u32',
      desc: '추가 속성 (CCL/공공누리 관련).' },
    { off: 0x2c, len: 4, id: 'encVer', name: 'EncryptVersion', short: 'EncryptVersion', kind: 'u32',
      desc: '암호화 방식 버전. 0 = 없음, 1~4가 정의되어 있다.' },
    { off: 0x30, len: 1, id: 'kogl', name: 'KOGL 국가', short: 'KOGL', kind: 'u8',
      desc: '공공누리(KOGL) 저작권 지원 국가. 명세에 열거된 값은 6 = 한국, 15 = 미국 둘뿐이다. DWORD가 아니라 1바이트라는 점이 함정.' },
    { off: 0x31, len: 207, id: 'reserved', name: 'Reserved', short: 'Reserved', kind: 'bytes',
      desc: '예약 영역. 0으로 채운다. FileHeader가 256바이트인 이유는 대부분 이 여백이다.' }
  ];

  /* --- 레코드 헤더 -----------------------------------------------------
   * 4바이트 하나에 세 값을 우겨넣는다 (리틀엔디언 uint32):
   *   비트  0–9   태그 ID  (10비트, 0 – 1023)
   *   비트 10–19  레벨     (10비트)
   *   비트 20–31  크기     (12비트, 0 – 4095)
   * 크기가 0xFFF면 "12비트로는 모자람" 이라는 뜻이고,
   * 뒤에 4바이트 실제 크기가 따라온다.                                    */
  H.TAG_MASK = 0x3ff;
  H.LEVEL_SHIFT = 10;
  H.LEVEL_MASK = 0x3ff;
  H.SIZE_SHIFT = 20;
  H.SIZE_MASK = 0xfff;
  H.SIZE_ESCAPE = 0xfff;

  H.unpack = function (v) {
    return {
      tag: v & H.TAG_MASK,
      level: (v >>> H.LEVEL_SHIFT) & H.LEVEL_MASK,
      size: (v >>> H.SIZE_SHIFT) & H.SIZE_MASK
    };
  };
  H.pack = function (tag, level, size) {
    return ((size & H.SIZE_MASK) << H.SIZE_SHIFT |
            (level & H.LEVEL_MASK) << H.LEVEL_SHIFT |
            (tag & H.TAG_MASK)) >>> 0;
  };

  /* --- 태그 이름표 ------------------------------------------------------ */
  H.TAG_BEGIN = 0x010;
  var B = H.TAG_BEGIN;

  H.TAGS = {};
  function tag(off, name, where, desc) {
    H.TAGS[B + off] = { id: B + off, name: name, where: where, desc: desc || '' };
  }
  /* DocInfo — 문서 전체가 공유하는 정의들 */
  tag(0,  'DOCUMENT_PROPERTIES', 'DocInfo', '구역 개수, 시작 쪽 번호, 캐럿 위치.');
  tag(1,  'ID_MAPPINGS',         'DocInfo', '뒤따라올 정의들이 각각 몇 개인지 미리 세어 둔 표. 이 개수가 곧 배열 길이가 된다.');
  tag(2,  'BIN_DATA',            'DocInfo', '그림 등 삽입된 이진 데이터가 BinData 스토리지의 어느 항목인지.');
  tag(3,  'FACE_NAME',           'DocInfo', '글꼴 하나의 정의. 나오는 순서가 곧 번호다.');
  tag(4,  'BORDER_FILL',         'DocInfo', '테두리·배경 한 벌.');
  tag(5,  'CHAR_SHAPE',          'DocInfo', '글자 모양 한 벌. 글자 크기·색·굵기 등.');
  tag(6,  'TAB_DEF',             'DocInfo', '탭 설정.');
  tag(7,  'NUMBERING',           'DocInfo', '문단 번호 매기기.');
  tag(8,  'BULLET',              'DocInfo', '글머리표.');
  tag(9,  'PARA_SHAPE',          'DocInfo', '문단 모양 한 벌. 정렬·여백·줄 간격.');
  tag(10, 'STYLE',               'DocInfo', '스타일(글자 모양 + 문단 모양의 이름 붙은 조합).');
  tag(11, 'DOC_DATA',            'DocInfo', '문서 임의 데이터.');
  tag(12, 'DISTRIBUTE_DOC_DATA', 'ViewText', '배포용 문서의 복호화 정보 256바이트. ' +
      '명세의 표에는 DocInfo 레코드로 적혀 있지만, 실제로는 ViewText/SectionN의 맨 앞에 평문으로 놓인다.');
  tag(14, 'COMPATIBLE_DOCUMENT', 'DocInfo', '호환 문서 종류.');
  tag(15, 'LAYOUT_COMPATIBILITY','DocInfo', '레이아웃 호환성 옵션.');
  tag(16, 'TRACKCHANGE',         'DocInfo', '변경 추적 정보.');
  /* BodyText / ViewText — 실제 내용 */
  tag(50, 'PARA_HEADER',         'BodyText', '문단 하나의 시작. 글자 수와 뒤따를 조각들의 개수를 알려 준다.');
  tag(51, 'PARA_TEXT',           'BodyText', '문단의 글자들. UTF-16LE에 제어 문자가 섞여 있다.');
  tag(52, 'PARA_CHAR_SHAPE',     'BodyText', '(위치, 글자모양 번호) 쌍의 배열. 어디부터 어떤 서식인지.');
  tag(53, 'PARA_LINE_SEG',       'BodyText', '줄 배치 정보. 화면에 그릴 때 쓰고, 글자만 뽑을 때는 건너뛴다.');
  tag(54, 'PARA_RANGE_TAG',      'BodyText', '문단 안 영역 태그.');
  tag(55, 'CTRL_HEADER',         'BodyText', '표·그림·각주 같은 "컨트롤"의 머리. 종류를 4바이트 ID로 적는다.');
  tag(56, 'LIST_HEADER',         'BodyText', '컨트롤 안에 든 문단 목록의 머리. 표의 각 칸이 여기서 시작한다.');
  tag(57, 'PAGE_DEF',            'BodyText', '용지 설정.');
  tag(58, 'FOOTNOTE_SHAPE',      'BodyText', '각주/미주 모양.');
  tag(59, 'PAGE_BORDER_FILL',    'BodyText', '쪽 테두리·배경.');
  tag(60, 'SHAPE_COMPONENT',     'BodyText', '그리기 개체.');
  tag(61, 'TABLE',               'BodyText', '표의 구조 — 행·열 개수와 칸 정보.');
  tag(62, 'SHAPE_COMPONENT_LINE', 'BodyText', '선.');
  tag(63, 'SHAPE_COMPONENT_RECTANGLE', 'BodyText', '사각형.');
  tag(64, 'SHAPE_COMPONENT_ELLIPSE', 'BodyText', '타원.');
  tag(65, 'SHAPE_COMPONENT_ARC', 'BodyText', '호.');
  tag(66, 'SHAPE_COMPONENT_POLYGON', 'BodyText', '다각형.');
  tag(67, 'SHAPE_COMPONENT_CURVE', 'BodyText', '곡선.');
  tag(68, 'SHAPE_COMPONENT_OLE', 'BodyText', 'OLE 개체 — 이 안에 또 다른 문서가 통째로 들어갈 수 있다.');
  tag(69, 'SHAPE_COMPONENT_PICTURE', 'BodyText', '그림.');
  tag(70, 'SHAPE_COMPONENT_CONTAINER', 'BodyText', '묶음 개체.');
  tag(71, 'CTRL_DATA',           'BodyText', '컨트롤 임의 데이터.');
  tag(72, 'EQEDIT',              'BodyText', '수식.');
  tag(74, 'SHAPE_COMPONENT_TEXTART', 'BodyText', '글맵시.');
  tag(75, 'FORM_OBJECT',         'BodyText', '양식 개체.');
  tag(76, 'MEMO_SHAPE',          '공통', '메모 모양.');
  tag(77, 'MEMO_LIST',           'BodyText', '메모 목록.');
  tag(78, 'FORBIDDEN_CHAR',      '공통', '금칙 문자.');
  tag(79, 'CHART_DATA',          '공통', '차트 데이터.');
  tag(80, 'TRACK_CHANGE',        'DocInfo', '변경 추적 내용.');
  tag(81, 'TRACK_CHANGE_AUTHOR', 'DocInfo', '변경 추적 작성자.');
  tag(82, 'VIDEO_DATA',          'BodyText', '동영상 데이터.');
  tag(99, 'SHAPE_COMPONENT_UNKNOWN', 'BodyText', '알 수 없는 그리기 개체.');

  H.tagName = function (id) {
    var t = H.TAGS[id];
    return t ? t.name : (id < B ? '(예약 ' + id + ')' : 'UNKNOWN_' + id);
  };
  H.tagInfo = function (id) {
    return H.TAGS[id] || { id: id, name: H.tagName(id), where: '?', desc: '이 문서 형식 버전에서 새로 생겼거나 문서화되지 않은 태그다.' };
  };

  /* --- PARA_TEXT 안의 제어 문자 ----------------------------------------
   * 이 표가 "HWP에서 글자만 뽑아내기"가 간단하지 않은 이유다.
   * kind:
   *   'char'     — 1글자 자리만 차지한다
   *   'inline'   — 8글자(16바이트) 자리를 차지한다
   *   'extended' — 8글자 자리를 차지하고, 양 끝이 같은 제어 문자로 감싸인다
   */
  H.CTRL_CHARS = {
    0:  { kind: 'char',     name: '사용 안 함' },
    1:  { kind: 'extended', name: '예약' },
    2:  { kind: 'extended', name: '구역/단 정의' },
    3:  { kind: 'extended', name: '필드 시작', note: '누름틀·하이퍼링크·블록 책갈피가 여기서 시작한다' },
    4:  { kind: 'inline',   name: '필드 끝' },
    5:  { kind: 'inline',   name: '예약' },
    6:  { kind: 'inline',   name: '예약' },
    7:  { kind: 'inline',   name: '예약' },
    8:  { kind: 'inline',   name: '제목 표시' },
    9:  { kind: 'inline',   name: '탭', text: '\t' },
    10: { kind: 'char',     name: '강제 줄 나눔', text: '\n' },
    11: { kind: 'extended', name: '그리기 개체 / 표', note: '표와 그림이 본문에 끼어드는 자리' },
    12: { kind: 'extended', name: '예약' },
    13: { kind: 'char',     name: '문단 끝', text: '\n' },
    14: { kind: 'extended', name: '예약' },
    15: { kind: 'extended', name: '숨은 설명' },
    16: { kind: 'extended', name: '머리말 / 꼬리말' },
    17: { kind: 'extended', name: '각주 / 미주' },
    18: { kind: 'extended', name: '자동 번호' },
    19: { kind: 'inline',   name: '예약' },
    20: { kind: 'inline',   name: '예약' },
    21: { kind: 'extended', name: '페이지 컨트롤', note: '쪽 감추기 등' },
    22: { kind: 'extended', name: '책갈피 / 찾아보기 표식' },
    23: { kind: 'extended', name: '덧말 / 글자 겹침' },
    24: { kind: 'char',     name: '하이픈' },
    25: { kind: 'char',     name: '예약' },
    26: { kind: 'char',     name: '예약' },
    27: { kind: 'char',     name: '예약' },
    28: { kind: 'char',     name: '예약' },
    29: { kind: 'char',     name: '예약' },
    30: { kind: 'char',     name: '묶음 빈칸', text: ' ' },
    31: { kind: 'char',     name: '고정폭 빈칸', text: ' ' }
  };
  /* 제어 문자가 차지하는 WCHAR 수 */
  H.ctrlWidth = function (code) {
    var c = H.CTRL_CHARS[code];
    if (!c) return 1;
    return c.kind === 'char' ? 1 : 8;
  };

  /* --- HWP가 쓰는 스트림들 ---------------------------------------------- */
  H.STREAMS = [
    { path: 'FileHeader', req: true, comp: false,
      desc: '256바이트. 시그니처와 속성 비트. 절대 압축하지 않는다 — 압축 여부를 여기서 읽어야 하니까.' },
    { path: 'DocInfo', req: true, comp: true,
      desc: '문서 전체가 공유하는 정의들(글꼴·글자 모양·문단 모양·스타일). 레코드 스트림.' },
    { path: 'BodyText/Section0', req: true, comp: true,
      desc: '본문. 구역마다 Section0, Section1 … 로 나뉜다. 레코드 스트림.' },
    { path: 'ViewText/Section0', req: false, comp: true,
      desc: '배포용 문서에서 BodyText를 대신한다. 추가로 암호화되어 있다.' },
    { path: 'BinData/BIN0001.png', req: false, comp: true,
      desc: '삽입된 그림 등. 이름은 BIN + 네 자리 대문자 16진수 + 확장자다 (BIN%04X.ext). ' +
            'DocInfo의 BIN_DATA 레코드가 이 번호를 가리킨다.' },
    { path: 'PrvText', req: false, comp: false,
      desc: '미리보기 텍스트. UTF-16LE 평문이라 압축도 암호화도 없다. 본문과 어긋나 있을 수 있다.' },
    { path: 'PrvImage', req: false, comp: false,
      desc: '미리보기 그림.' },
    { path: 'HwpSummaryInformation', req: false, comp: false,
      desc: '제목·작성자 등 속성 집합. Office의 SummaryInformation과 같은 형식이다.' },
    { path: 'DocOptions/_LinkDoc', req: false, comp: false, desc: '문서 연결 정보.' },
    { path: 'Scripts/DefaultJScript', req: false, comp: true, desc: '문서에 붙은 자바스크립트.' },
    { path: 'XMLTemplate/Schema', req: false, comp: true, desc: 'XML 서식 문서용.' },
    { path: 'DocHistory/VersionLog0', req: false, comp: true, desc: '문서 이력. 예전 판본이 통째로 들어 있을 수 있다.' }
  ];

  root.HWPConst = H;
})(typeof window !== 'undefined' ? window : globalThis);
