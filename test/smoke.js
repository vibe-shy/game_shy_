/* 브라우저에서 실제로 게임을 돌려 보는 스모크 테스트 — 정상 경로를 본다.
   `npm i` 후 `node test/smoke.js`. PW_CHROME 으로 다른 크로미움 지정 가능.
   SHOTS=./shots 를 붙이면 단계별 스크린샷을 남긴다. */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS;
const LAUNCH = process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {};
const PORT = Number(process.env.PORT || 8811);
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
  const page = await browser.newPage({ viewport: { width: 900, height: 950 } });

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

  await page.goto('http://localhost:' + PORT + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(450);
  const shot = n => SHOTS ? page.locator('#screen').screenshot({ path: SHOTS + '/' + n + '.png' }) : Promise.resolve();

  const snap = () => page.evaluate(() => {
    const g = window.AF.game;
    return {
      state: g.state, room: g.room, kills: g.kills, score: g.score,
      hp: Math.round(g.player.hp), maxHp: Math.round(g.player.stats.maxHp),
      enemies: g.enemies.length, shots: g.shots.length,
      obstacles: g.obstacles.length, mode: g.mode,
      choices: g.choices.map(c => c.id), taken: Object.keys(g.taken).length
    };
  });

  console.log('\n== 1. 로드 ==');
  check('페이지 에러 없음', errors.length === 0, errors);
  let s = await snap();
  check('타이틀 상태로 시작', s.state === 'TITLE', s.state);
  check('타이틀 배경에 방이 깔려 있음', s.obstacles > 0, s.obstacles);
  await shot('01-title');

  console.log('\n== 2. 조작 모드 전환 ==');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  check('→ 로 수동 조준 선택', (await snap()).mode === 'manual');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(100);
  check('← 로 자동 발사 선택', (await snap()).mode === 'auto');

  console.log('\n== 3. 시작 ==');
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  s = await snap();
  check('PLAYING 진입', s.state === 'PLAYING', s.state);
  check('방 1 에서 시작', s.room === 1, s.room);
  check('적이 등장함', s.enemies > 0, s.enemies);
  check('체력이 가득', s.hp === s.maxHp, s);

  console.log('\n== 3b. 실제 키보드로 이동 ==');
  // 가상 스틱만 검증하면 키 입력 경로가 깨져도 통과한다. 진짜 키 이벤트로 본다.
  const before = await snap();
  const at = () => page.evaluate(() => ({
    x: Math.round(window.AF.game.player.x), y: Math.round(window.AF.game.player.y)
  }));
  const p0 = await at();
  await page.keyboard.down('w');
  await page.waitForTimeout(600);
  const pW = await at();
  await page.keyboard.up('w');
  await page.keyboard.down('d');
  await page.waitForTimeout(600);
  const pD = await at();
  await page.keyboard.up('d');
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(600);
  const pL = await at();
  await page.keyboard.up('ArrowLeft');

  check('W 로 위로 이동', pW.y < p0.y - 20, { p0, pW });
  check('D 로 오른쪽 이동', pD.x > pW.x + 20, { pW, pD });
  check('방향키(←)로 왼쪽 이동', pL.x < pD.x - 20, { pD, pL });
  check('키를 떼면 멈춘다', await (async () => {
    const a = await at(); await page.waitForTimeout(400); const b = await at();
    return Math.abs(a.x - b.x) < 3 && Math.abs(a.y - b.y) < 3;
  })());

  console.log('\n== 3c. 포커스를 잃으면 멈추고 이유를 알린다 ==');
  // 아티팩트는 iframe 안에서 돈다. 포커스가 없으면 키가 안 오는데
  // 그대로 계속 돌면 "조작이 죽은 게임"으로 보인다.
  const blurred = await page.evaluate(async () => {
    const g = window.AF.game;
    g.state = 'PLAYING';
    window.dispatchEvent(new Event('blur'));
    await new Promise(r => setTimeout(r, 150));
    return { state: g.state, byBlur: g.pausedByBlur };
  });
  check('포커스를 잃으면 일시정지', blurred.state === 'PAUSED', blurred);
  check('포커스 상실로 멈췄음을 구분해 기록', blurred.byBlur === true, blurred);
  const canvasFocusable = await page.evaluate(() =>
    document.getElementById('screen').getAttribute('tabindex'));
  check('캔버스가 포커스를 받을 수 있음 (tabindex)', canvasFocusable === '0', canvasFocusable);

  // 클릭으로 재개
  const cbox = await page.locator('#screen').boundingBox();
  await page.mouse.click(cbox.x + cbox.width / 2, cbox.y + cbox.height * 0.85);
  await page.waitForTimeout(200);
  check('클릭하면 다시 진행된다', (await snap()).state === 'PLAYING');

  console.log('\n== 4. 자동 발사 — 멈추면 쏘고 움직이면 안 쏜다 ==');
  const autoFire = await page.evaluate(async () => {
    const g = window.AF.game, I = window.AF.Input;
    let stillShots = 0, movingShots = 0;
    const orig = g.fire.bind(g);
    let phase = 'still';
    g.fire = function () { (phase === 'still' ? stillShots++ : movingShots++); return orig(); };

    // 1) 가만히 서 있기
    phase = 'still';
    await new Promise(r => setTimeout(r, 1600));
    // 2) 계속 움직이기
    phase = 'moving';
    I.moveStick.active = true; I.moveStick.dx = 0.9; I.moveStick.dy = 0;
    await new Promise(r => setTimeout(r, 1600));
    I.moveStick.active = false; I.moveStick.dx = 0; I.moveStick.dy = 0;
    g.fire = orig;
    return { stillShots, movingShots };
  });
  check('멈춰 있으면 발사한다', autoFire.stillShots > 0, autoFire);
  check('움직이는 동안에는 쏘지 않는다', autoFire.movingShots === 0, autoFire);

  console.log('\n== 5. 수동 조준 — 움직이면서도 쏜다 ==');
  const manualFire = await page.evaluate(async () => {
    const g = window.AF.game, I = window.AF.Input, AF = window.AF;
    // 앞 구간에서 적이 전멸해 방이 끝났을 수 있다. 이 검사에 필요한 상태를 직접 만든다.
    if (g.state !== 'PLAYING') { g.state = 'PLAYING'; g.introT = 0; }
    if (!g.enemies.length) {
      const pos = g.findSpawn(13);
      g.enemies.push(new AF.Enemy('chaser', pos.x, pos.y, 1, 1));
    }
    g.mode = 'manual';
    let shots = 0;
    const orig = g.fire.bind(g);
    g.fire = function () { shots++; return orig(); };
    I.pointer.active = true; I.pointer.down = true;
    I.pointer.x = g.player.x + 100; I.pointer.y = g.player.y;
    I.moveStick.active = true; I.moveStick.dx = 0.9; I.moveStick.dy = 0;
    await new Promise(r => setTimeout(r, 1600));
    I.pointer.down = false; I.moveStick.active = false; I.moveStick.dx = 0;
    g.fire = orig; g.mode = 'auto';
    return { shots };
  });
  check('이동 중에도 발사한다', manualFire.shots > 0, manualFire);
  await shot('02-play');

  console.log('\n== 6. 방 클리어 → 능력 선택 → 다음 방 ==');
  await page.evaluate(() => { window.AF.game.introT = 0; window.AF.game.enemies = []; });
  await page.waitForTimeout(300);
  s = await snap();
  check('적을 전멸시키면 능력 선택 화면', s.state === 'UPGRADE', s.state);
  check('선택지가 3개', s.choices.length === 3, s.choices);
  check('선택지가 서로 다름', new Set(s.choices).size === s.choices.length, s.choices);
  await shot('03-upgrade');

  await page.keyboard.press('Digit1');
  await page.waitForTimeout(300);
  s = await snap();
  check('선택하면 다음 방으로', s.state === 'PLAYING' && s.room === 2, s);
  check('능력이 기록됨', s.taken === 1, s.taken);
  check('새 방에 적이 등장', s.enemies > 0, s.enemies);

  console.log('\n== 7. 보스 방 (5방) ==');
  const boss = await page.evaluate(async () => {
    const g = window.AF.game;
    g.room = 4;
    g.nextRoom();
    g.state = 'PLAYING';
    await new Promise(r => setTimeout(r, 250));
    return {
      room: g.room, isBoss: g.plan.isBoss,
      types: g.enemies.map(e => e.type),
      bossHp: g.enemies[0] ? g.enemies[0].maxHp : 0
    };
  });
  check('5방이 보스 방', boss.room === 5 && boss.isBoss === true, boss);
  check('보스가 등장', boss.types.indexOf('boss') !== -1, boss.types);
  check('보스 체력이 일반 적보다 훨씬 많음', boss.bossHp > 300, boss.bossHp);
  await page.waitForTimeout(900);
  await shot('04-boss');

  console.log('\n== 8. 사망 ==');
  const dead = await page.evaluate(async () => {
    const g = window.AF.game;
    g.player.inv = 0;
    g.player.hurt(99999, g);
    await new Promise(r => setTimeout(r, 250));
    return { state: g.state, hp: g.player.hp };
  });
  check('체력이 0 이면 사망 화면', dead.state === 'DEAD', dead);
  check('체력이 음수로 내려가지 않음', dead.hp === 0, dead.hp);
  await shot('05-dead');

  console.log('\n== 9. 최고 점수 저장 ==');
  const best = await page.evaluate(() => ({
    best: window.AF.game.best,
    stored: Number(localStorage.getItem('af_best_v1'))
  }));
  check('localStorage 에 최고 점수 기록', best.stored === best.best && best.best > 0, best);

  console.log('\n== 10. 타이틀 복귀 ==');
  // 사망 화면은 0.8초간 입력을 막는다(실수로 넘기지 않도록). 그만큼 기다린다.
  const early = await page.evaluate(() => window.AF.game.overlayT);
  await page.keyboard.press('Space');
  await page.waitForTimeout(150);
  check('잠금 시간 안에는 넘어가지 않음',
        early > 0.8 || (await snap()).state === 'DEAD', { early, state: (await snap()).state });
  await page.waitForTimeout(900);
  await page.keyboard.press('Space');
  await page.waitForTimeout(250);
  check('잠금이 풀리면 타이틀로', (await snap()).state === 'TITLE', (await snap()).state);

  console.log('\n== 11. 전체 실행 중 누적 에러 ==');
  check('런타임 에러 0건', errors.length === 0, errors.slice(0, 5));

  console.log('\n---- ' + pass + ' passed, ' + fail + ' failed ----');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
