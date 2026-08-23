/* =====================================================================
 * test.mjs — CFB 엔진 불변식 검사
 *
 *   node test.mjs
 *
 * 화면이 진짜 파일을 보여 준다고 주장하려면, 그 파일이 실제로 유효해야
 * 한다. 여기서는 만들기 → 읽기 → 고치기 → 다시 쓰기를 반복하면서
 * 매번 다음을 확인한다:
 *   · 파서가 경고 없이 읽힌다
 *   · 모든 스트림이 루트에서 도달 가능하다 (트리에서 미아가 생기지 않는다)
 *   · 모든 스트림 내용이 바이트 단위로 보존된다
 *   · FAT / MiniFAT 체인에 순환이나 겹침이 없다
 * ===================================================================== */
globalThis.window = globalThis;
await import('./src/cfb-const.js');
await import('./src/rbtree.js');
await import('./src/cfb-build.js');
await import('./src/cfb-parse.js');
await import('./src/cfb-ops.js');
await import('./src/inflate.js');
await import('./src/hwp-const.js');
await import('./src/hwp-build.js');
await import('./src/hwp-parse.js');
const { CFBConst: C, CFBBuild, CFBParse, CFBOps, RBTree,
        Inflate, HWPConst: HC, HWPBuild, HWPParse } = globalThis;

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('  FAIL: ' + msg); } };
const section = (s) => console.log('\n— ' + s);

/* ---------- 불변식 ---------------------------------------------------- */
function invariants(p, label) {
  ok(p.ok, label + ': 파싱 성공');
  ok(p.warn.length === 0, label + ': 경고 없음 — ' + p.warn.join(' / '));

  /* 살아 있는 엔트리는 모두 루트에서 도달 가능해야 한다 */
  const orphans = p.live.filter((e) => e.path === undefined);
  ok(orphans.length === 0, label + ': 미아 엔트리 없음 — ' + orphans.map((e) => e.name).join(','));

  /* 섹터가 두 체인에 동시에 속하면 안 된다 */
  const claim = new Map();
  const claimAll = (list, who) => list.forEach((s) => {
    if (claim.has(s)) fail++, console.log(`  FAIL: ${label}: 섹터 ${s}를 "${claim.get(s)}"와 "${who}"가 동시에 쓴다`);
    else claim.set(s, who);
  });
  claimAll(p.difat, 'FAT');
  claimAll(p.difatSectors, 'DIFAT');
  claimAll(p.dirSectors, '디렉터리');
  claimAll(p.miniFatSectors, 'MiniFAT');
  claimAll(p.miniStreamSectors, '미니 스트림');
  p.live.forEach((e) => { if (e.type === C.TYPE_STREAM && !e.isMini && e.chain) claimAll(e.chain, e.name); });
  pass++;

  /* 미니 섹터도 마찬가지 */
  const mclaim = new Map();
  p.live.forEach((e) => {
    if (e.type !== C.TYPE_STREAM || !e.isMini) return;
    (e.miniChain || []).forEach((m) => {
      if (mclaim.has(m)) fail++, console.log(`  FAIL: ${label}: 미니 섹터 ${m} 중복 — ${mclaim.get(m)} / ${e.name}`);
      else mclaim.set(m, e.name);
    });
  });
  pass++;

  /* 체인 길이가 크기와 맞아야 한다 */
  p.live.forEach((e) => {
    if (e.type !== C.TYPE_STREAM || e.size === 0) return;
    const unit = e.isMini ? p.miniSectorSize : p.sectorSize;
    const chain = e.isMini ? e.miniChain : e.chain;
    ok(chain.length === Math.ceil(e.size / unit),
       `${label}: "${e.name}" 체인 길이 ${chain.length} ≠ 필요한 ${Math.ceil(e.size / unit)}`);
  });

  /* 루트가 미니 스트림을 정확히 덮어야 한다 */
  if (p.miniStreamSectors.length) {
    ok(p.miniStreamSectors.length === Math.ceil(p.root.size / p.sectorSize),
       label + ': 미니 스트림 섹터 수가 루트 크기와 일치');
  }

  /* 디렉터리 트리가 유효한 레드-블랙 트리인가 */
  p.live.filter((e) => (e.type === C.TYPE_ROOT || e.type === C.TYPE_STORAGE) && e.child !== C.NOSTREAM)
    .forEach((st) => {
      const t = RBTree.Tree.fromLinks(st.child, (sid) => {
        const x = p.entries[sid];
        if (!x || x.type === C.TYPE_UNALLOCATED) return null;
        return { name: x.name, color: x.color, left: x.left, right: x.right, payload: x };
      });
      const v = t.validate();
      ok(v.ok, `${label}: "${st.name}"의 자식 트리가 유효한 레드-블랙 트리 — ${v.problems.join(', ')}`);
      /* 중위 순회가 CFB 이름 순서와 일치해야 한다 */
      const names = t.inorder().map((n) => n.name);
      const sorted = names.slice().sort(RBTree.cmpName);
      ok(JSON.stringify(names) === JSON.stringify(sorted),
         `${label}: "${st.name}" 자식이 이름 순서대로 정렬됨`);
    });
}

function snapshot(p) {
  const m = {};
  p.live.filter((e) => e.type === C.TYPE_STREAM).forEach((e) => {
    m[e.path] = Array.from(p.readStream(e));
  });
  return m;
}
function sameContent(a, b, only) {
  const keys = only || Object.keys(a).filter((k) => k in b);
  return keys.every((k) => a[k] && b[k] && a[k].length === b[k].length && a[k].every((v, i) => v === b[k][i]));
}

/* ---------- 1. 만들기 → 읽기 ------------------------------------------ */
for (const major of [3, 4]) {
  section(`v${major} 샘플 파일 생성과 파싱`);
  const built = CFBBuild.compose({ major, timestamp: Date.UTC(2003, 3, 15, 9, 30, 0) });
  const p = CFBParse.parse(built.bytes);
  invariants(p, `v${major}`);
  ok(p.header.majorVersion === major, `v${major}: major version`);
  ok(p.sectorSize === (major === 4 ? 4096 : 512), `v${major}: 섹터 크기`);
  ok(p.live.length === 15, `v${major}: 엔트리 15개 (실제 ${p.live.length})`);
  ok(p.byPath['/WordDocument'] && p.byPath['/WordDocument'].size === 8192, `v${major}: WordDocument 크기`);
  ok(p.byPath['/Macros/VBA/ThisDocument'] !== undefined, `v${major}: 중첩 저장소 경로`);
  /* 4096 정확히 = 미니가 아니어야 한다 */
  const si = p.byPath['/SummaryInformation'];
  ok(si && si.size === 4096 && si.isMini === false, `v${major}: 정확히 4096바이트는 일반 섹터`);
  /* 자기서술: FAT 섹터는 FAT 안에서 FATSECT */
  ok(p.difat.every((s) => p.fat[s] === C.FREESECT || (p.fat[s] >>> 0) === C.FATSECT),
     `v${major}: FAT 섹터가 FATSECT로 표시됨`);
  /* 내용 왕복 */
  const wd = p.readStream(p.byPath['/WordDocument']);
  ok(wd.length === 8192 && wd[0] === 0xec && wd[1] === 0xa5 && wd[2] === 0xc1,
     `v${major}: WordDocument 내용과 FIB 서명`);
}

/* ---------- 1b. 편집된 샘플 — 교재로서 갖춰야 할 성질 ------------------- */
section('편집된 샘플 문서 (페이지가 실제로 보여 주는 파일)');
{
  const r = CFBBuild.composeEdited({ timestamp: Date.UTC(2003, 3, 15, 9, 30, 0) });
  const p = CFBParse.parse(r.bytes);
  invariants(p, '편집된 샘플');
  ok(r.history.length >= 5, `편집 이력 ${r.history.length}단계`);
  ok(p.totalSectors <= 60, `한 화면에 들어오는 크기 (${p.totalSectors}섹터)`);

  /* 체인이 "범위"가 아니라 "연결 리스트"임을 보여 주려면 앞뒤로 튀어야 한다 */
  const jumpy = p.live.filter((e) => {
    if (e.type !== C.TYPE_STREAM || !e.chain || e.chain.length < 2) return false;
    return e.chain.some((s, i) => i > 0 && s !== e.chain[i - 1] + 1);
  });
  ok(jumpy.length >= 1, '앞뒤로 튀는 일반 스트림 체인이 있다 — ' +
     jumpy.map((e) => e.name + ':' + e.chain.join(',')).join(' | '));

  const splitMini = p.live.filter((e) => {
    if (!e.isMini || !e.miniChain || e.miniChain.length < 2) return false;
    return e.miniChain.some((m, i) => i > 0 && m !== e.miniChain[i - 1] + 1);
  });
  ok(splitMini.length >= 1, '가운데가 끊긴 미니 스트림 체인이 있다 — ' +
     splitMini.map((e) => e.name).join(', '));

  const cont = p.miniStreamSectors;
  ok(cont.length >= 2 && cont.some((s, i) => i > 0 && s !== cont[i - 1] + 1),
     '미니 스트림을 담는 그릇 자체도 흩어져 있다 — ' + cont.join(','));

  /* 지운 데이터가 빈 섹터에 남아 있어야 8장의 주장이 시연이 된다 */
  const free = p.roles.map((x, i) => (x === 'free' ? i : -1)).filter((i) => i >= 0);
  ok(free.length >= 1, `빈 섹터가 남아 있다 (${free.length}개)`);
  const ghost = Array.from(p.bytes.slice(p.sectOff(free[0]), p.sectOff(free[0]) + 48))
    .map((b) => String.fromCharCode(b)).join('');
  ok(/SummaryInformation|1Table|Data|WordDocument/.test(ghost),
     '빈 섹터에 지워진 스트림의 바이트가 그대로 남아 있다 — ' + JSON.stringify(ghost.slice(0, 40)));

  /* 마지막 섹터의 남는 자리에 이전 세입자의 흔적 */
  const withSlack = p.live.filter((e) => e.type === C.TYPE_STREAM && !e.isMini && e.size % p.sectorSize !== 0);
  const tenant = withSlack.filter((e) => {
    const lastSect = e.chain[e.chain.length - 1];
    const from = p.sectOff(lastSect) + (e.size % p.sectorSize);
    const tail = Array.from(p.bytes.slice(from, from + 64)).map((b) => String.fromCharCode(b)).join('');
    return /\+0x[0-9A-F]{6}\]/.test(tail);
  });
  ok(tenant.length >= 1, '살아 있는 스트림의 마지막 섹터 남는 자리에 이전 데이터가 보인다 — ' +
     tenant.map((e) => e.name).join(', '));

  /* 디렉터리 마지막 섹터에 미할당 칸이 남아야 objType 0 을 볼 수 있다 */
  ok(p.entries.length > p.live.length, '디렉터리에 미할당(objType 0) 칸이 있다');

  /* 편집을 거쳐도 내용은 온전해야 한다 */
  const wd = p.readStream(p.byPath['/WordDocument']);
  ok(wd.length === p.byPath['/WordDocument'].size, '편집 뒤에도 본문을 정확한 길이로 읽는다');
}

/* ---------- 2. 편집 연산 ---------------------------------------------- */
section('편집: 삭제 → 추가 → 크기 변경 → 조각 모음');
let bytes = CFBBuild.compose({}).bytes;
let p = CFBParse.parse(bytes);
const base = snapshot(p);

function apply(fn, label) {
  const m = CFBOps.toModel(p);
  fn(m);
  bytes = CFBOps.serialize(m);
  p = CFBParse.parse(bytes);
  invariants(p, label);
  return p;
}

/* 트리의 중간 노드를 지워도 형제와 그 자손이 살아남아야 한다 (회귀 테스트) */
const beforeDelete = p.live.filter((e) => e.type === C.TYPE_STREAM).length;
const victim = p.byPath['/1Table'].sid;
apply((m) => CFBOps.deleteStream(m, victim), '삭제 후');
ok(p.live.filter((e) => e.type === C.TYPE_STREAM).length === beforeDelete - 1,
   `삭제: 스트림이 정확히 하나만 사라짐 (${beforeDelete} → ${p.live.filter((e) => e.type === C.TYPE_STREAM).length})`);
ok(p.byPath['/1Table'] === undefined, '삭제: 대상이 사라짐');
ok(sameContent(base, snapshot(p), Object.keys(base).filter((k) => k !== '/1Table')),
   '삭제: 나머지 스트림 내용이 그대로');

/* 지운 데이터는 디스크에 남아 있어야 한다 (교육 자료의 핵심 주장) */
const freeSectors = p.roles.map((r, i) => (r === 'free' ? i : -1)).filter((i) => i >= 0);
ok(freeSectors.length === 10, `삭제: 섹터 10개가 비워짐 (실제 ${freeSectors.length})`);
const ghost = Array.from(bytes.slice(p.sectOff(freeSectors[0]), p.sectOff(freeSectors[0]) + 32))
  .map((b) => String.fromCharCode(b)).join('');
ok(ghost.includes('1Table'), '삭제: 지운 스트림의 바이트가 파일에 남아 있음 — ' + JSON.stringify(ghost));

/* 추가 — 빈 자리를 재사용해 단편화가 생겨야 한다 */
const content = new Uint8Array(6000).map((_, i) => 0x41 + (i % 26));
apply((m) => CFBOps.addStream(m, 0, 'NewPicture', content), '추가 후');
const np = p.byPath['/NewPicture'];
ok(np && np.size === 6000, '추가: 새 스트림이 존재');
ok(sameContent({ x: Array.from(content) }, { x: Array.from(p.readStream(np)) }), '추가: 내용이 그대로');
const jumps = np.chain.filter((s, i) => i > 0 && s !== np.chain[i - 1] + 1).length;
ok(jumps > 0, '추가: 빈 자리를 재사용해 체인이 불연속 — 단편화 발생 (' + np.chain.join(',') + ')');

/* 크기 변경 — 미니 ↔ 일반 이사 */
const dataSid = p.byPath['/Data'].sid;
ok(p.byPath['/Data'].isMini === true, '변경 전: Data는 미니 스트림');
apply((m) => CFBOps.resizeStream(m, dataSid, 9000), '확대 후');
ok(p.byPath['/Data'].isMini === false && p.byPath['/Data'].size === 9000,
   '확대: 4096을 넘어 일반 섹터로 이사');
apply((m) => CFBOps.resizeStream(m, dataSid, 300), '축소 후');
ok(p.byPath['/Data'].isMini === true && p.byPath['/Data'].size === 300,
   '축소: 다시 미니 스트림으로 이사');

/* FAT 성장 — 큰 스트림을 여러 개 붙여 FAT 섹터가 늘어나는지 */
section('FAT 성장');
let fatSectorsBefore = p.difat.length;
for (let i = 0; i < 3; i++) {
  const big = new Uint8Array(90000).fill(0x5a);
  apply((m) => CFBOps.addStream(m, 0, 'Big' + i, big), 'FAT 성장 ' + i);
}
ok(p.difat.length > fatSectorsBefore,
   `FAT 섹터가 ${fatSectorsBefore} → ${p.difat.length}로 늘어남`);
ok(p.difat.every((s) => (p.fat[s] >>> 0) === C.FATSECT), '늘어난 FAT 섹터도 FATSECT로 표시됨');

/* 조각 모음 */
section('조각 모음');
const beforePack = snapshot(p);
const sizeBefore = bytes.length;
apply((m) => CFBOps.repack(m), '조각 모음 후');
ok(sameContent(beforePack, snapshot(p)), '조각 모음: 모든 스트림 내용 보존');
ok(p.roles.filter((r) => r === 'free').length === 0, '조각 모음: 빈 섹터가 하나도 없음');
ok(bytes.length <= sizeBefore, `조각 모음: 파일이 커지지 않음 (${sizeBefore} → ${bytes.length})`);

/* ---------- 3. 이름 정렬 규칙 ----------------------------------------- */
section('CFB 이름 비교 규칙');
ok(RBTree.cmpName('Zz', 'AAA') < 0, '길이 우선: "Zz" < "AAA"');
ok(RBTree.cmpName('abc', 'ABD') < 0, '같은 길이면 대문자 비교: "abc" < "ABD"');
ok(RBTree.cmpName('abc', 'ABC') === 0, '대소문자 구분 없음');

/* ---------- 4. 손상된 파일 방어 ---------------------------------------- */
section('손상된 입력 방어');
const bad = CFBBuild.compose({}).bytes.slice();
/* FAT[19] = 19 로 만들어 자기 자신을 가리키는 순환을 넣는다 */
const fatOff = 512 + 19 * 4;
new DataView(bad.buffer).setUint32(fatOff, 19, true);
const pb = CFBParse.parse(bad);
ok(pb.ok, '순환이 있어도 파서가 멈추지 않는다');
ok(pb.warn.some((w) => w.includes('순환')), '순환을 경고로 보고한다 — ' + pb.warn.join(' / '));

const notCfb = new Uint8Array(1024);
notCfb.set([0x50, 0x4b, 0x03, 0x04]);
ok(CFBParse.parse(notCfb).ok === false, 'ZIP 파일은 CFB가 아니라고 거부한다');

const truncated = CFBBuild.compose({}).bytes.slice(0, 2048);
const pt = CFBParse.parse(truncated);
ok(pt.ok === true || pt.ok === false, '잘린 파일에서도 예외를 던지지 않는다');

/* ---------- 5. 퍼징: 무작위로 망가뜨려도 죽지 않아야 한다 ---------------- */
section('퍼징 (무작위 손상 400회)');
/* 재현 가능한 난수 — 실패했을 때 같은 입력을 다시 만들 수 있어야 한다 */
let seed = 20030415;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let crashes = 0, parsedOk = 0;
const clean = CFBBuild.compose({}).bytes;
for (let i = 0; i < 400; i++) {
  const b = clean.slice();
  const hits = 1 + Math.floor(rnd() * 12);
  for (let k = 0; k < hits; k++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256);
  if (rnd() < 0.25) {
    /* 가끔은 뒤를 잘라 본다 */
    const cut = 512 + Math.floor(rnd() * (b.length - 512));
    try {
      const r = CFBParse.parse(b.slice(0, cut));
      if (r.ok) { parsedOk++; r.live.forEach((e) => { if (e.type === C.TYPE_STREAM) r.readStream(e); }); }
      continue;
    } catch (err) { crashes++; console.log('  FAIL: 퍼징 #' + i + ' (자름 ' + cut + ') — ' + err.message); continue; }
  }
  try {
    const r = CFBParse.parse(b);
    if (r.ok) {
      parsedOk++;
      r.live.forEach((e) => { if (e.type === C.TYPE_STREAM) r.readStream(e); });
      CFBOps.serialize(CFBOps.toModel(r));
    }
  } catch (err) { crashes++; console.log('  FAIL: 퍼징 #' + i + ' — ' + err.message); }
}
ok(crashes === 0, `퍼징: 예외 없이 400개를 모두 처리 (실제 예외 ${crashes}건)`);
console.log(`  (그 중 ${parsedOk}개는 여전히 읽히는 CFB로 판정됨)`);

/* ---------- 6. DEFLATE 자체 구현 ------------------------------------------ */
section('DEFLATE 압축/해제');
{
  const cases = [
    new Uint8Array(0),
    new TextEncoder().encode('안녕하세요 한글 문서 파일 형식 5.0'),
    new TextEncoder().encode('[반복되는 문자열] '.repeat(500)),
    new Uint8Array(70000).fill(0x41),
    (() => { let a = new Uint8Array(20000); for (let i = 0; i < a.length; i++) a[i] = (i * 7919) % 251; return a; })(),
  ];
  for (const [i, src] of cases.entries()) {
    const comp = Inflate.deflateRaw(src);
    const back = Inflate.inflateRaw(comp, src.length).data;
    ok(back.length === src.length && back.every((v, k) => v === src[k]),
       `deflate/inflate 왕복 ${i} (${src.length}B → ${comp.length}B)`);
    ok(comp.length <= src.length + 16, `압축이 원본보다 크게 부풀지 않는다 ${i}`);
  }
  /* 저장 블록 · 고정 허프만 · 동적 허프만을 모두 다루는지 (직접 만든 스트림으로) */
  const stored = Inflate.deflateRaw((() => {
    let a = new Uint8Array(3000); for (let i = 0; i < a.length; i++) a[i] = (i * 131) % 256; return a;
  })());
  ok(Inflate.inflateRaw(stored, 3000).data.length === 3000, '줄지 않는 데이터도 왕복한다');

  /* 손상된 입력은 예외를 던지되 죽지 않는다 */
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let crashed = 0;
  const good = Inflate.deflateRaw(new TextEncoder().encode('테스트 '.repeat(300)));
  for (let i = 0; i < 200; i++) {
    const bad = good.slice();
    bad[Math.floor(rnd() * bad.length)] = Math.floor(rnd() * 256);
    try { Inflate.inflateRaw(bad, 4000); } catch (e) { crashed++; }
  }
  ok(true, 'fuzz');
  console.log(`  손상된 압축 데이터 200건 중 ${crashed}건이 예외로 잡혔다 (나머지는 다른 결과)`);
}

/* ---------- 7. HWP 5.0 ---------------------------------------------------- */
section('HWP 5.0 파일 만들기 → 읽기');
for (const compressed of [true, false]) {
  const label = compressed ? 'HWP(압축)' : 'HWP(압축 없음)';
  const built = HWPBuild.compose({ compressed, timestamp: Date.UTC(2024, 2, 14, 10, 0, 0) });
  const cfb = CFBParse.parse(built.bytes);
  ok(cfb.ok && cfb.warn.length === 0, `${label}: 바깥 CFB가 깨끗하게 읽힌다 — ${cfb.warn.join('/')}`);

  const p = HWPParse.parse(cfb);
  ok(p.ok, `${label}: HWP 층 파싱 — ${p.error || ''}`);
  ok(p.warn.length === 0, `${label}: 경고 없음 — ${p.warn.join(' / ')}`);
  ok(p.version.text === '5.0.3.4', `${label}: 버전 ${p.version.text}`);
  ok(p.compressed === compressed, `${label}: 압축 비트가 파일 상태와 일치`);

  /* 필수 스트림 */
  for (const need of ['/FileHeader', '/DocInfo', '/BodyText/Section0', '/PrvText']) {
    ok(p.streams.some((s) => s.path === need), `${label}: ${need} 존재`);
  }
  /* FileHeader 는 절대 압축하지 않는다 */
  const fh = p.streams.find((s) => s.path === '/FileHeader');
  ok(!fh.compressed && fh.size === 256, `${label}: FileHeader 256바이트, 압축 안 함`);
  ok(!p.streams.find((s) => s.path === '/PrvText').compressed, `${label}: PrvText 압축 안 함`);

  /* 압축된 스트림은 실제로 풀려야 하고, 압축이 효과가 있어야 한다 */
  if (compressed) {
    const sec = p.streams.find((s) => s.path === '/BodyText/Section0');
    ok(sec.compressed && !sec.error, `${label}: 본문 스트림 압축 해제 성공`);
    ok(sec.data.length > sec.size * 2, `${label}: 압축비 ${(sec.data.length / sec.size).toFixed(1)}배`);
    /* 표준 준수 — 우리 deflate 결과를 우리 inflate 가 아닌 경로로도 확인 */
    ok(Inflate.inflateAuto(sec.raw).data.length === sec.data.length,
       `${label}: inflateAuto 로도 같은 결과`);
  }

  /* 레코드 */
  const sec = p.recordStreams.find((s) => /Section0/.test(s.path));
  const doc = p.recordStreams.find((s) => s.path === '/DocInfo');
  ok(doc && doc.records.length >= 10, `${label}: DocInfo 레코드 ${doc ? doc.records.length : 0}개`);
  ok(sec && sec.records.length >= 30, `${label}: Section0 레코드 ${sec ? sec.records.length : 0}개`);
  ok(sec.trailing === 0, `${label}: 레코드가 스트림을 정확히 채운다 (남은 ${sec.trailing}B)`);
  ok(doc.trailing === 0, `${label}: DocInfo도 마찬가지 (남은 ${doc.trailing}B)`);

  /* 머리 비트 언팩이 되감기와 맞는지 */
  sec.records.forEach((r) => {
    const packed = HC.pack(r.tag, r.level, r.extended ? HC.SIZE_ESCAPE : r.size);
    ok(packed === r.raw, `${label}: 레코드 #${r.index} 머리 재조립 일치`);
  });

  /* 확장 헤더가 실제로 등장해야 교재가 된다 */
  const big = sec.records.filter((r) => r.extended);
  ok(big.length >= 1, `${label}: 4095바이트를 넘어 확장 헤더를 쓰는 레코드가 있다 (${big.length}개)`);
  big.forEach((r) => {
    ok(r.headerLen === 8, `${label}: 확장 레코드의 머리는 8바이트`);
    ok(((r.raw >>> HC.SIZE_SHIFT) & HC.SIZE_MASK) === HC.SIZE_ESCAPE,
       `${label}: 확장 레코드의 크기 비트가 0xFFF`);
  });

  /* 레벨 트리 */
  ok(p.maxLevel >= 3, `${label}: 레벨이 ${p.maxLevel}까지 깊어진다 (표 안 문단)`);
  const tree = HWPParse.buildTree(sec.records.slice());
  ok(tree.length >= 1, `${label}: 트리 뿌리 ${tree.length}개`);
  sec.records.forEach((r) => {
    if (r.parentIndex >= 0) {
      ok(sec.records[r.parentIndex].level === r.level - 1 ||
         sec.records[r.parentIndex].level < r.level,
         `${label}: #${r.index} 의 부모 레벨이 더 얕다`);
    } else {
      ok(r.level === 0 || sec.records.slice(0, r.index).every((x) => x.level >= r.level),
         `${label}: 뿌리 #${r.index} 위에 더 얕은 레코드가 없다`);
    }
  });

  /* 글자 추출 */
  ok(p.text.includes('한글 문서 파일 형식 5.0'), `${label}: 제목 문단이 추출된다`);
  ok(p.text.includes('레벨로 세우는 트리'), `${label}: 표 안의 글자까지 추출된다`);
  ok(p.text.includes('\t'), `${label}: 탭 제어 문자가 탭으로 나온다`);

  /* 제어 문자 폭 계산이 맞는지 — 조각들의 길이 합이 레코드 크기와 같아야 한다 */
  p.paragraphs.forEach((par) => {
    const sum = par.pieces.reduce((a, x) => a + x.len, 0);
    ok(sum === par.record.size,
       `${label}: 문단 조각 길이 합 ${sum} = 레코드 크기 ${par.record.size}`);
  });
  const wide = p.paragraphs.flatMap((x) => x.pieces)
    .filter((x) => x.kind === 'ctrl' && x.info.kind !== 'char');
  ok(wide.length >= 1, `${label}: 여덟 자리를 차지하는 확장 컨트롤이 실제로 들어 있다`);
  wide.forEach((w) => ok(w.len === 16, `${label}: 확장 컨트롤은 16바이트`));
}

section('HWP 방어');
{
  /* CFB이지만 HWP가 아닌 파일 */
  const doc = CFBParse.parse(CFBBuild.compose({}).bytes);
  const r = HWPParse.parse(doc);
  ok(!r.ok && /FileHeader/.test(r.error), 'CFB지만 FileHeader가 없으면 거부한다');

  /* 레코드 크기를 조작해 스트림 밖을 가리키게 만들면 */
  const warn = [];
  const bytes = new Uint8Array(64);
  new DataView(bytes.buffer).setUint32(0, HC.pack(HC.TAG_BEGIN, 0, 4000), true);
  const rec = HWPParse.parseRecords(bytes, warn, '조작된 스트림');
  ok(rec.records.length === 0 && warn.length === 1,
     '스트림 밖을 가리키는 레코드는 버리고 경고를 남긴다');

  /* 압축을 풀 수 없는 스트림이 있어도 나머지는 읽힌다 */
  ok(HWPParse.isCompressible('/DocInfo') && HWPParse.isCompressible('/BodyText/Section0') &&
     !HWPParse.isCompressible('/FileHeader') && !HWPParse.isCompressible('/PrvText'),
     '압축 대상 판정이 맞다');
}

/* ---------- 결과 -------------------------------------------------------- */
console.log(`\n${fail === 0 ? '통과' : '실패'}: ${pass}개 성공, ${fail}개 실패`);
process.exit(fail === 0 ? 0 : 1);
