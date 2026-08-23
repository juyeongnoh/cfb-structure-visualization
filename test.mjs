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
const { CFBConst: C, CFBBuild, CFBParse, CFBOps, RBTree } = globalThis;

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

/* ---------- 결과 -------------------------------------------------------- */
console.log(`\n${fail === 0 ? '통과' : '실패'}: ${pass}개 성공, ${fail}개 실패`);
process.exit(fail === 0 ? 0 : 1);
