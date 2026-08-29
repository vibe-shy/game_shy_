/* 적대적 / 스트레스 테스트. 스모크 테스트가 "정상 경로가 돈다"를 보는 반면
   여기서는 경계와 동시성(같은 스텝에 두 사건이 겹치는 경우)을 노린다.
   `npm i` 후 `node test/stress.js`. PW_CHROME 으로 다른 크로미움 지정 가능. */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LAUNCH = process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {};
const PORT = Number(process.env.PORT || 8733);
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'text/plain' });
  res.end(fs.readFileSync(f));
});

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

  await page.goto('http://localhost:' + PORT + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  console.log('\n== A. 마지막 벽돌과 마지막 공이 같은 스텝에 사라질 때 ==');
  // 클리어와 목숨 상실 조건이 동시에 성립한다. 클리어가 이겨야 한다.
  const race = await page.evaluate(async () => {
    const g = window.NB.game;
    g.newGame();
    await new Promise(r => setTimeout(r, 120));
    const lives = g.lives;
    g.bricks.forEach(b => { if (!b.solid) b.alive = false; });   // 벽돌 전멸
    g.balls.forEach(b => { b.stuck = false; b.y = 99999; });     // 공도 전부 낙하
    await new Promise(r => setTimeout(r, 250));
    return { before: lives, after: g.lives, state: g.state };
  });
  check('클리어가 목숨 상실보다 우선', race.state === 'CLEAR' || race.state === 'WIN', race);
  check('목숨이 깎이지 않음', race.after === race.before, race);

  console.log('\n== B. 점수 저장은 국면이 끝날 때만 (프레임마다 쓰지 않는다) ==');
  const writes = await page.evaluate(async () => {
    const g = window.NB.game;
    let n = 0;
    const orig = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k, v) => { if (k === 'nb_high_v1') n++; return orig(k, v); };
    g.newGame();
    await new Promise(r => setTimeout(r, 100));
    for (let i = 0; i < 300; i++) g.addScore(100);   // 벽돌 300개 부순 셈
    await new Promise(r => setTimeout(r, 100));
    const during = n;
    g.persistHigh();
    const after = n;
    localStorage.setItem = orig;
    return { during, after, high: g.high, stored: Number(localStorage.getItem('nb_high_v1')) };
  });
  check('득점 300회 동안 저장 0회', writes.during === 0, writes);
  check('국면 종료 시 1회 저장', writes.after === 1, writes);
  check('저장값이 최고점과 일치', writes.stored === writes.high, writes);

  console.log('\n== C. 오디오 초기화 전에 음소거를 눌러도 유지된다 ==');
  const mute = await page.evaluate(() => {
    // 새 오디오 컨텍스트를 흉내내기 어려우니 모듈 계약만 확인한다
    const A = window.NB.Audio;
    const was = A.isMuted();
    const now = A.toggleMute();
    const back = A.toggleMute();
    return { was, now, back };
  });
  check('음소거 토글이 상태를 반전', mute.now === !mute.was && mute.back === mute.was, mute);

  console.log('\n== D. 자동 플레이 45초 — 공을 쫓는 완벽한 패들 ==');
  const auto = await page.evaluate(async () => {
    const g = window.NB.game, C = window.NB.C;
    g.newGame();
    await new Promise(r => setTimeout(r, 100));

    const bad = [];
    let maxBalls = 0, levelsSeen = new Set(), launches = 0, destroyed = 0;
    let prevAlive = g.bricks.filter(b => b.alive).length;
    const t0 = performance.now();

    while (performance.now() - t0 < 45000) {
      if (g.state === 'PLAYING') {
        // 가장 낮은 공을 따라간다
        let low = null;
        for (const b of g.balls) if (!low || b.y > low.y) low = b;
        if (low) { g.aimX = low.x; }
        if (g.balls.some(b => b.stuck)) { window.NB.Input.pointer.tapped = true; launches++; }

        maxBalls = Math.max(maxBalls, g.balls.length);
        levelsSeen.add(g.levelIndex);
        const alive = g.bricks.filter(b => b.alive).length;
        if (alive < prevAlive) destroyed += prevAlive - alive;
        prevAlive = alive;

        for (const b of g.balls) {
          if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx) || !Number.isFinite(b.vy)) {
            bad.push({ why: 'NaN', b: { x: b.x, y: b.y, vx: b.vx, vy: b.vy } });
          }
          if (b.x < C.WALL - 2 || b.x > C.W - C.WALL + 2 || b.y < C.HUD_H - 2) {
            bad.push({ why: 'out', x: b.x, y: b.y });
          }
          const sp = Math.hypot(b.vx, b.vy);
          if (!b.stuck && sp > 0 && (sp < 2 || sp > 20)) bad.push({ why: 'speed', sp });
        }
        if (g.paddle.x < C.WALL - 0.5 || g.paddle.x + g.paddle.w > C.W - C.WALL + 0.5) {
          bad.push({ why: 'paddle', x: g.paddle.x, w: g.paddle.w });
        }
        if (g.paddle.w < C.PADDLE_MIN - 1 || g.paddle.w > C.PADDLE_MAX + 1) {
          bad.push({ why: 'paddleW', w: g.paddle.w });
        }
      } else if (g.state === 'CLEAR') {
        g.overlayT = 10; window.NB.Input.pointer.tapped = true;
      } else if (g.state === 'OVER' || g.state === 'WIN') {
        g.overlayT = 10; window.NB.Input.pointer.tapped = true;
        await new Promise(r => setTimeout(r, 60));
        if (g.state === 'TITLE') { window.NB.Input.pointer.tapped = true; }
      }
      if (bad.length > 3) break;
      await new Promise(r => setTimeout(r, 16));
    }
    return { bad: bad.slice(0, 3), score: g.score, maxBalls, launches, destroyed,
             levels: [...levelsSeen].sort((a, b) => a - b), state: g.state };
  });
  check('45초 자동 플레이 중 이상 상태 없음', auto.bad.length === 0, auto.bad);
  check('실제로 진행됨 (벽돌 10개 이상 파괴)', auto.destroyed >= 10, auto);
  // 완벽 수비면 공을 놓치지 않으므로 45초 내내 살아 있어야 한다.
  // (레벨 전환 자체는 스모크 테스트 8번이 8단계 전부 확인한다)
  check('완벽 수비 중 게임오버 없음', auto.state !== 'OVER', auto.state);

  console.log('\n== E. 아이템 난사 (200회 무작위) ==');
  const spam = await page.evaluate(async () => {
    const g = window.NB.game, NB = window.NB;
    const types = Object.keys(NB.POWERS);
    let threw = null;
    g.newGame();
    await new Promise(r => setTimeout(r, 80));
    for (let i = 0; i < 200; i++) {
      try { g.applyPower(types[(Math.random() * types.length) | 0], 320, 600); }
      catch (e) { threw = e.message; break; }
    }
    await new Promise(r => setTimeout(r, 300));
    return { threw, balls: g.balls.length, paddleW: g.paddle.w,
             timers: Object.entries(g.timers).filter(([, v]) => v > 0).map(([k]) => k) };
  });
  check('아이템 난사에도 예외 없음', spam.threw === null, spam.threw);
  check('공 개수 상한이 지켜짐 (<=9)', spam.balls <= 9, spam.balls);
  check('상반된 효과가 동시에 켜지지 않음',
        !(spam.timers.includes('EXPAND') && spam.timers.includes('SHRINK')) &&
        !(spam.timers.includes('SLOW') && spam.timers.includes('FAST')), spam.timers);

  console.log('\n== F. 최고 속도(레벨8 + 가속)에서 패들/벽돌을 뚫지 않는다 ==');
  const fastest = await page.evaluate(async () => {
    const g = window.NB.game, C = window.NB.C;
    g.newGame(); g.loadLevel(7); g.state = 'PLAYING';
    g.timers.FAST = 999;
    await new Promise(r => setTimeout(r, 80));
    let escaped = 0, below = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 12000) {
      let low = null;
      for (const b of g.balls) if (!low || b.y > low.y) low = b;
      if (low) g.aimX = low.x;                       // 완벽 수비
      if (g.balls.some(b => b.stuck)) window.NB.Input.pointer.tapped = true;
      for (const b of g.balls) {
        if (b.x < C.WALL - 2 || b.x > C.W - C.WALL + 2 || b.y < C.HUD_H - 2) escaped++;
        if (b.y > C.PADDLE_Y + 40) below++;          // 패들을 통과해 버린 공
      }
      await new Promise(r => setTimeout(r, 16));
    }
    return { escaped, below, speed: g.ballSpeed(), lives: g.lives };
  });
  check('최고 속도에서도 벽 관통 없음', fastest.escaped === 0, fastest);
  check('완벽 수비 시 패들 관통 없음', fastest.below === 0, fastest);

  console.log('\n== G. 상태 전이 난사 ==');
  const churn = await page.evaluate(async () => {
    const g = window.NB.game;
    let threw = null;
    const states = ['TITLE', 'PLAYING', 'PAUSED', 'CLEAR', 'OVER', 'WIN'];
    try {
      for (let i = 0; i < 120; i++) {
        g.state = states[(Math.random() * states.length) | 0];
        g.overlayT = 10;
        window.NB.Input.pointer.tapped = true;
        await new Promise(r => setTimeout(r, 20));
      }
    } catch (e) { threw = e.message; }
    return { threw, state: g.state, level: g.levelIndex };
  });
  check('무작위 상태 전이에도 예외 없음', churn.threw === null, churn.threw);
  check('레벨 인덱스가 범위 안', churn.level >= 0 && churn.level < 8, churn.level);

  console.log('\n== H. 창 크기를 바꿔도 포인터 좌표가 어긋나지 않는다 ==');
  const resize = [];
  for (const [w, h] of [[420, 780], [1400, 900], [700, 500]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);
    const box = await page.locator('#screen').boundingBox();
    // 캔버스 가로 중앙을 누르면 게임 좌표로도 중앙(320)이어야 한다
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(80);
    const px = await page.evaluate(() => window.NB.Input.pointer.x);
    resize.push({ w, h, px: Math.round(px) });
  }
  check('모든 뷰포트에서 중앙 클릭이 게임 좌표 320',
        resize.every(r => Math.abs(r.px - 320) <= 2), resize);

  console.log('\n== I. 전체 실행 중 누적 에러 ==');
  check('런타임 에러 0건', errors.length === 0, errors.slice(0, 5));

  console.log('\n---- ' + pass + ' passed, ' + fail + ' failed ----');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
