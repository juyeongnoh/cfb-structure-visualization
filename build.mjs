/* =====================================================================
 * build.mjs — index.html + src/*.js + assets/styles.css 를
 *             자체 완결적인 단일 HTML 파일로 묶는다.
 *
 *   node build.mjs            → dist/cfb-visualizer.html
 *
 * 외부 요청은 Google Fonts 하나만 남긴다 (Artifact CSP가 허용하는 유일한 호스트).
 * ===================================================================== */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const PAGES = [
  ['index.html', 'dist/cfb-visualizer.html'],
  ['hwp.html', 'dist/hwp-visualizer.html'],
];

mkdirSync(join(ROOT, 'dist'), { recursive: true });

for (const [src, out] of PAGES) {
  let html = read(src);

  /* --- <link rel="stylesheet" href="assets/..."> → 인라인 <style> --- */
  html = html.replace(
    /<link rel="stylesheet" href="((?!https?:)[^"]+)">/g,
    (_, href) => `<style>\n${read(href).trim()}\n</style>`
  );

  /* --- <script src="src/..."> → 인라인 <script> --- */
  html = html.replace(
    /<script src="((?!https?:)[^"]+)"><\/script>/g,
    (_, s) => `<script>\n${read(s).trim()}\n</script>`
  );

  /* 남은 로컬 참조가 없는지 확인 */
  const leftover = [...html.matchAll(/(?:src|href)="(?!https?:|#|data:)([^"]+)"/g)].map((m) => m[1]);
  if (leftover.length) {
    console.error(`${src}: 인라인되지 않은 로컬 참조가 남았다:`, leftover);
    process.exit(1);
  }

  writeFileSync(join(ROOT, out), html);
  console.log(`${out} — ${(html.length / 1024).toFixed(1)} KB, 외부 요청: Google Fonts만`);
}
