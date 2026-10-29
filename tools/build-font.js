/* css/font.css 를 다시 만든다 — 이 게임이 실제로 그리는 글자만 남긴
   Pretendard 서브셋을 data URI 로 심은 @font-face.

     node tools/build-font.js

   왜 서브셋인가:
   - 원본 두 굵기가 1.5MB 다. 화면에 쓰는 글자는 300자도 안 된다.
   - 저장소는 네트워크 없이 file:// 로 열려야 하고, 아티팩트 CSP 는 외부
     스타일시트를 fonts.googleapis.com 으로만 허용한다. 둘 다 링크로는 안 된다.

   필요한 것: node(npm), python3 + fonttools + brotli
     pip install fonttools brotli

   화면에 새 문구를 추가했으면 이 스크립트를 다시 돌린다.
   서브셋에 없는 글자는 오류 없이 조용히 대체 서체로 떨어지므로 눈치채기 어렵다. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VERSION = '1.3.9';
const WEIGHTS = [['Regular', 400], ['Bold', 700]];

/* 화면에 나올 수 있는 글자를 소스에서 직접 긁는다.
   손으로 목록을 적으면 문구를 고칠 때마다 어긋난다. */
function collectChars() {
  const chars = new Set();

  for (const f of fs.readdirSync(path.join(ROOT, 'js')).sort()) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
    // 주석은 화면에 안 나오지만, 빠뜨리는 것보다 넣는 편이 안전하고 비용도 작다
    for (const m of src.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)) {
      for (const c of (m[1] ?? m[2] ?? '')) chars.add(c);
    }
  }

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const c of html.replace(/<[^>]+>/g, ' ')) chars.add(c);

  // 동적으로 조합되는 문자열 대비 — 기본 라틴/숫자/구두점은 무조건 넣는다
  for (let c = 0x20; c < 0x7f; c++) chars.add(String.fromCharCode(c));
  for (const c of '←↑↓→·×÷—–…“”‘’♥✚❥✖❄●➤⚔⚡↟⤳⤾◎↕↔»«★☆♦♣♠') chars.add(c);

  return [...chars].filter(c => c === ' ' || /\P{C}/u.test(c)).sort().join('');
}

function run(cmd, args, opts) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arrowfall-font-'));
try {
  const charset = collectChars();
  const hangul = [...charset].filter(c => c >= '가' && c <= '힣').length;
  fs.writeFileSync(path.join(tmp, 'charset.txt'), charset, 'utf8');
  console.log('수집한 글자 ' + charset.length + '자 (한글 음절 ' + hangul + '자)');

  console.log('pretendard@' + VERSION + ' 내려받는 중...');
  run('npm', ['pack', 'pretendard@' + VERSION], { cwd: tmp });
  run('tar', ['xzf', 'pretendard-' + VERSION + '.tgz',
              ...WEIGHTS.map(([w]) => 'package/dist/web/static/woff2/Pretendard-' + w + '.woff2')],
      { cwd: tmp });

  const faces = [];
  let rawTotal = 0, subTotal = 0;

  for (const [name, weight] of WEIGHTS) {
    const src = path.join(tmp, 'package/dist/web/static/woff2/Pretendard-' + name + '.woff2');
    const out = path.join(tmp, 'sub-' + name + '.woff2');
    run('pyftsubset', [
      src,
      '--text-file=' + path.join(tmp, 'charset.txt'),
      '--output-file=' + out,
      '--flavor=woff2',
      '--layout-features=',
      '--no-hinting',
      '--desubroutinize',
      '--drop-tables+=GSUB,GPOS,GDEF'
    ]);
    rawTotal += fs.statSync(src).size;
    subTotal += fs.statSync(out).size;
    faces.push({ weight, b64: fs.readFileSync(out).toString('base64') });
  }

  const kb = n => (n / 1024).toFixed(0) + 'KB';
  const header =
`/* Pretendard — 이 게임이 실제로 그리는 글자만 남긴 서브셋을 data URI 로 심는다.
   이 파일은 생성물이다. 손으로 고치지 말 것:  node tools/build-font.js

   왜 파일이나 CDN 링크가 아니라 data URI 인가:
   - 저장소는 네트워크 없이 file:// 로 열려야 한다. 외부 CDN 링크는 그 성질을 깬다.
   - 아티팩트 CSP 는 외부 스타일시트를 fonts.googleapis.com 으로만 허용하는데
     Pretendard 는 거기 없다. 링크로는 조용히 실패한다.

   서브셋 대상 ${charset.length}자 (한글 음절 ${hangul}자).
   원본 ${WEIGHTS.length}개 굵기 ${kb(rawTotal)} → ${kb(subTotal)}.

   화면에 새 문구를 추가했으면 다시 생성해야 한다.
   서브셋에 없는 글자는 오류 없이 대체 서체로 떨어져 눈치채기 어렵다. */
`;

  const css = header + faces.map(f => `
@font-face {
  font-family: 'Pretendard';
  font-style: normal;
  font-weight: ${f.weight};
  font-display: block;
  src: url(data:font/woff2;base64,${f.b64}) format('woff2');
}
`).join('');

  const dest = path.join(ROOT, 'css', 'font.css');
  fs.writeFileSync(dest, css, 'utf8');
  console.log('written: css/font.css  (' + kb(fs.statSync(dest).size) + ')');
  console.log('  원본 ' + kb(rawTotal) + ' → 서브셋 ' + kb(subTotal));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
