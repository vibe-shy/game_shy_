/* index.html 이 참조하는 CSS/JS 를 전부 인라인해 파일 한 장으로 묶는다.
   저장소가 원본이고 이 결과물은 파생물이라 dist/ 는 커밋하지 않는다.

     node tools/build-artifact.js              → dist/arrowfall.html (감싸기용 조각)
     node tools/build-artifact.js --standalone → dist/arrowfall-standalone.html

   아티팩트용 조각에는 <!doctype>/<html>/<head>/<body> 를 넣지 않는다.
   게시할 때 감싸주기 때문에 직접 넣으면 중첩된다. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');
const standalone = process.argv.includes('--standalone');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// index.html 에 적힌 순서를 그대로 따른다. 스크립트 순서가 곧 의존 순서다.
const cssFiles = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map(m => m[1]);
const jsFiles = [...html.matchAll(/<script src="([^"]+\.js)"><\/script>/g)].map(m => m[1]);

if (!cssFiles.length || !jsFiles.length) {
  console.error('index.html 에서 css/js 참조를 찾지 못했다. 정규식과 마크업이 어긋났는지 확인할 것.');
  process.exit(1);
}

const read = f => {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) { console.error('없는 파일: ' + f); process.exit(1); }
  return fs.readFileSync(p, 'utf8');
};

const css = cssFiles.map(f => '/* ' + f + ' */\n' + read(f)).join('\n\n');
const js = jsFiles.map(f => '/* ' + f + ' */\n' + read(f)).join('\n\n');

/* 임베드 전용 조정.
   1) iframe 안에서는 클릭 전까지 키 입력이 오지 않는다. 첫 입력 전까지만 안내한다.
   2) height:100% 는 조상 높이에 기대는데 임베드 문맥에서는 보장되지 않아 dvh 로 받친다. */
const EMBED_CSS = `
/* --- 임베드(아티팩트) 전용 --- */
body { min-height: 100dvh; }

#focusnote {
  flex: 0 0 auto;
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--accent);
  opacity: 0.85;
  transition: opacity 220ms ease;
}
#focusnote[hidden] { display: none !important; }

@media (prefers-reduced-motion: reduce) {
  #focusnote { transition: none; }
}
`;

const EMBED_JS = `
/* 첫 입력이 들어오면(=iframe 이 포커스를 받으면) 안내를 지운다. */
(function () {
  var note = document.getElementById('focusnote');
  if (!note) return;
  function dismiss() {
    note.style.opacity = '0';
    setTimeout(function () { note.hidden = true; }, 240);
    window.removeEventListener('keydown', dismiss);
    window.removeEventListener('pointerdown', dismiss);
  }
  window.addEventListener('keydown', dismiss);
  window.addEventListener('pointerdown', dismiss);
  try { window.focus(); } catch (e) { /* 크로스 오리진이면 무시 */ }
})();
`;

let body = html.split('<body>')[1].split('</body>')[0]
  .replace(/^\s*<script src="[^"]+"><\/script>\s*$/gm, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const bodyEmbed = body.replace('<p id="hint">',
  '<p id="focusnote">화면을 한 번 클릭하면 키보드가 연결됩니다</p>\n\n  <p id="hint">');

fs.mkdirSync(OUT, { recursive: true });

if (standalone) {
  const file = path.join(OUT, 'arrowfall-standalone.html');
  fs.writeFileSync(file,
`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="theme-color" content="#14121c">
<title>ARROWFALL</title>
<style>
${css}
</style>
</head>
<body>
${body}
<script>
${js}
</script>
</body>
</html>
`);
  console.log('written: ' + path.relative(ROOT, file) + '  (' + (fs.statSync(file).size / 1024).toFixed(1) + ' KB)');
} else {
  const file = path.join(OUT, 'arrowfall.html');
  fs.writeFileSync(file,
`<title>ARROWFALL</title>
<style>
${css}
${EMBED_CSS}</style>

${bodyEmbed}

<script>
${js}
${EMBED_JS}</script>
`);
  console.log('written: ' + path.relative(ROOT, file) + '  (' + (fs.statSync(file).size / 1024).toFixed(1) + ' KB)');
  console.log('  css: ' + cssFiles.join(', '));
  console.log('  js : ' + jsFiles.join(', '));
}
