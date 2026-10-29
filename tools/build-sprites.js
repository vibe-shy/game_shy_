/* assets/*.png 를 js/sprite-data.js 로 인라인한다.

     node tools/build-sprites.js

   왜 파일이 아니라 data URI 인가 (서체와 같은 이유):
   - 저장소는 네트워크 없이 file:// 로 열려야 한다. 상대 경로 이미지는 file:// 에서
     브라우저에 따라 막힌다.
   - 아티팩트 CSP 는 외부 이미지를 전부 차단한다. data URI 만 통과한다.

   js/sprites.js 의 AF.SPRITES 에 있는 키만 담는다. assets/ 에 있어도 매니페스트에
   없으면 무시하고, 매니페스트에 있어도 파일이 없으면 그냥 빠진다(그 스프라이트는
   게임에서 도형으로 대체된다). */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const OUT = path.join(ROOT, 'js', 'sprite-data.js');

// 매니페스트에서 키 목록을 읽는다. 여기 없는 파일은 넣어도 쓰이지 않는다.
const manifest = fs.readFileSync(path.join(ROOT, 'js', 'sprites.js'), 'utf8');
const block = manifest.match(/AF\.SPRITES = \{([\s\S]*?)\n\};/);
if (!block) {
  console.error('js/sprites.js 에서 AF.SPRITES 를 찾지 못했다.');
  process.exit(1);
}
const keys = [...block[1].matchAll(/'([\w-]+)':\s*\{/g)].map(m => m[1]);

const entries = [];
const missing = [];
let bytes = 0;

for (const key of keys) {
  const file = path.join(ASSETS, key + '.png');
  if (!fs.existsSync(file)) { missing.push(key); continue; }
  const buf = fs.readFileSync(file);
  bytes += buf.length;
  entries.push('  ' + JSON.stringify(key) + ': "data:image/png;base64,' + buf.toString('base64') + '"');
}

const kb = n => (n / 1024).toFixed(1) + 'KB';
const header =
`/* 스프라이트 이미지 — 생성물이다. 손으로 고치지 말 것:  node tools/build-sprites.js
   원본은 assets/*.png. 키 목록은 js/sprites.js 의 AF.SPRITES 가 정한다.

   ${entries.length}개, 원본 합계 ${kb(bytes)}.${missing.length ? '\n   빠진 스프라이트(도형으로 대체됨): ' + missing.join(', ') : ''} */
var AF = window.AF || (window.AF = {});

AF.SPRITE_DATA = {
${entries.join(',\n')}
};
`;

fs.writeFileSync(OUT, header, 'utf8');
console.log('written: js/sprite-data.js  (' + kb(fs.statSync(OUT).size) + ')');
console.log('  담은 스프라이트 ' + entries.length + '개, 원본 ' + kb(bytes));
if (missing.length) console.log('  빠짐(도형으로 대체): ' + missing.join(', '));
