/* 브라우저에서 실제로 게임을 돌려 보는 스모크 테스트.
   `npm i` 로 playwright 를 설치한 뒤 `node test/smoke.js` (또는 npm run test:browser).
   기본 브라우저 경로 대신 다른 크로미움을 쓰려면 PW_CHROME 환경변수로 지정한다. */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS;   // 지정하면 단계별 스크린샷을 남긴다
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'text/plain' });
  res.end(fs.readFileSync(f));
});

const LAUNCH = process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {};
const PORT = Number(process.env.PORT || 8731);

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 1000, height: 950 } });

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

  await page.goto('http://localhost:' + PORT + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const snap = () => page.evaluate(() => {
    const g = window.NB.game;
    return {
      state: g.state, score: g.score, lives: g.lives, level: g.levelIndex,
      balls: g.balls.length, aliveBricks: g.bricks.filter(b => b.alive).length,
      bricksLeft: g.bricksLeft(), powerups: g.powerups.length,
      ball0: g.balls[0] ? { x: g.balls[0].x, y: g.balls[0].y, stuck: g.balls[0].stuck } : null,
      paddle: { x: g.paddle.x, w: g.paddle.w }
    };
  });

  console.log('\n== 1. 로드 ==');
  check('페이지 에러 없음', errors.length === 0, errors);
  let s = await snap();
  check('타이틀 상태로 시작', s.state === 'TITLE', s.state);
  if (SHOTS) await page.screenshot({ path: SHOTS + '/01-title.png' });

  console.log('\n== 2. 시작 & 발사 ==');
  await page.keyboard.press('Space');
  await page.waitForTimeout(120);
  s = await snap();
  check('PLAYING 진입', s.state === 'PLAYING', s.state);
  check('레벨1 벽돌 로드됨', s.aliveBricks > 0, s.aliveBricks);
  check('공이 패들에 붙어 대기', s.ball0 && s.ball0.stuck === true, s.ball0);

  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  s = await snap();
  check('발사 후 공이 자유 상태', s.ball0 && s.ball0.stuck === false, s.ball0);

  console.log('\n== 3. 물리: 공이 실제로 움직이고 벽돌이 깎인다 ==');
  const before = await snap();
  // 스냅샷 2장 비교는 왕복 주기와 겹치면 흔들리니, 구간 내 이동 범위를 본다
  const travel = await page.evaluate(async () => {
    const g = window.NB.game;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    const t0 = performance.now();
    while (performance.now() - t0 < 2500) {
      for (const b of g.balls) {
        minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x);
        minY = Math.min(minY, b.y); maxY = Math.max(maxY, b.y);
      }
      await new Promise(r => setTimeout(r, 16));
    }
    return { dx: maxX - minX, dy: maxY - minY };
  });
  const after = await snap();
  check('공이 세로로 움직임', travel.dy > 50, travel);
  check('공이 가로로도 움직임 (수직 교착 없음)', travel.dx > 20, travel);
  check('벽돌이 줄어듦 or 점수 상승', after.aliveBricks < before.aliveBricks || after.score > 0,
        { bricks: [before.aliveBricks, after.aliveBricks], score: after.score });
  if (SHOTS) await page.screenshot({ path: SHOTS + '/02-play.png' });

  console.log('\n== 4. 공이 필드를 벗어나지 않는다 (5초 추적) ==');
  const escaped = await page.evaluate(async () => {
    const g = window.NB.game, C = window.NB.C;
    let bad = null;
    const t0 = performance.now();
    while (performance.now() - t0 < 5000) {
      for (const b of g.balls) {
        if (b.x < C.WALL - 2 || b.x > C.W - C.WALL + 2 || b.y < C.HUD_H - 2) {
          bad = { x: b.x, y: b.y }; break;
        }
      }
      if (bad) break;
      await new Promise(r => setTimeout(r, 16));
    }
    return bad;
  });
  check('공이 벽/천장을 뚫지 않음', escaped === null, escaped);

  console.log('\n== 5. 패들이 벽 안에 갇힌다 ==');
  const paddleBounds = await page.evaluate(() => {
    const g = window.NB.game, C = window.NB.C;
    g.aimX = -9999; g.paddle.update(g.aimX);
    const left = g.paddle.x;
    g.aimX = 99999; g.paddle.update(g.aimX);
    const right = g.paddle.x + g.paddle.w;
    return { left, right, wall: C.WALL, W: C.W };
  });
  check('왼쪽 벽 안', paddleBounds.left >= paddleBounds.wall - 0.01, paddleBounds);
  check('오른쪽 벽 안', paddleBounds.right <= paddleBounds.W - paddleBounds.wall + 0.01, paddleBounds);

  console.log('\n== 6. 파워업 9종 전부 적용해도 터지지 않는다 ==');
  const powerResult = await page.evaluate(() => {
    const g = window.NB.game;
    const out = {};
    let lifeDelta = null;
    for (const k of Object.keys(window.NB.POWERS)) {
      const before = g.lives;
      try { g.applyPower(k, 320, 700); out[k] = 'ok'; }
      catch (e) { out[k] = 'THREW: ' + e.message; }
      if (k === 'LIFE') lifeDelta = g.lives - before;   // 그 사이 목숨을 잃었을 수 있으니 델타로 본다
    }
    return { out, lifeDelta, balls: g.balls.length, timers: Object.keys(g.timers) };
  });
  check('모든 파워업 적용 성공',
        Object.values(powerResult.out).every(v => v === 'ok'), powerResult.out);
  check('MULTI 로 공이 늘어남', powerResult.balls > 1, powerResult.balls);
  check('LIFE 로 목숨 +1', powerResult.lifeDelta === 1, powerResult.lifeDelta);

  console.log('\n== 7. 일시정지 ==');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(100);
  check('P 로 일시정지', (await snap()).state === 'PAUSED');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(100);
  check('P 로 재개', (await snap()).state === 'PLAYING');

  console.log('\n== 8. 레벨 클리어 전이 (8레벨 연속) ==');
  const levelWalk = await page.evaluate(async () => {
    const g = window.NB.game;
    const seen = [];
    for (let i = 0; i < window.NB.Levels.count; i++) {
      g.bricks.forEach(b => { if (!b.solid) b.alive = false; });   // 남은 벽돌 강제 파괴
      await new Promise(r => setTimeout(r, 200));
      seen.push({ lv: i, state: g.state, score: g.score });
      if (g.state === 'CLEAR') {
        g.overlayT = 10;
        g.loadLevel(g.levelIndex + 1);
        g.state = 'PLAYING';
      }
    }
    return { seen, final: g.state, level: g.levelIndex, score: g.score };
  });
  check('마지막 레벨에서 WIN', levelWalk.final === 'WIN', levelWalk);
  check('중간 레벨은 CLEAR', levelWalk.seen.slice(0, -1).every(x => x.state === 'CLEAR'),
        levelWalk.seen.map(x => x.state));
  check('클리어 보너스로 점수 누적', levelWalk.score > 0, levelWalk.score);
  if (SHOTS) await page.screenshot({ path: SHOTS + '/03-win.png' });

  console.log('\n== 9. 목숨 소진 -> GAME OVER ==');
  const over = await page.evaluate(async () => {
    const g = window.NB.game;
    g.state = 'TITLE';
    await new Promise(r => setTimeout(r, 100));
    g.newGame();
    await new Promise(r => setTimeout(r, 100));
    const start = g.lives;
    for (let i = 0; i < 5 && g.state === 'PLAYING'; i++) {
      g.balls.forEach(b => { b.stuck = false; b.y = 5000; });   // 전부 바닥으로
      await new Promise(r => setTimeout(r, 250));
    }
    return { start, lives: g.lives, state: g.state };
  });
  check('목숨 3개에서 시작', over.start === 3, over);
  check('전부 놓치면 GAME OVER', over.state === 'OVER', over);
  if (SHOTS) await page.screenshot({ path: SHOTS + '/04-over.png' });

  console.log('\n== 10. 하이스코어 저장 ==');
  const hs = await page.evaluate(() => ({ high: window.NB.game.high, stored: localStorage.getItem('nb_high_v1') }));
  check('localStorage 에 최고점 기록', hs.stored !== null && Number(hs.stored) === hs.high, hs);

  console.log('\n== 11. 전체 실행 중 누적 에러 ==');
  check('런타임 에러 0건', errors.length === 0, errors);

  console.log('\n---- ' + pass + ' passed, ' + fail + ' failed ----');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
