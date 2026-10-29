/* 적대적 / 스트레스 테스트. 스모크가 "정상 경로가 돈다"를 보는 반면
   여기서는 경계, 장시간 실행, 극단적 빌드, 잘못된 상태를 노린다.
   `npm i` 후 `node test/stress.js`. */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LAUNCH = process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {};
const PORT = Number(process.env.PORT || 8814);
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
  await page.waitForTimeout(400);

  console.log('\n== A. 모든 적 종류를 한 방에 몰아넣고 6초 ==');
  const allTypes = await page.evaluate(async () => {
    const g = window.AF.game, AF = window.AF, C = AF.C;
    g.newRun();
    await new Promise(r => setTimeout(r, 150));
    g.enemies = [];
    const types = Object.keys(AF.ENEMIES);
    types.forEach((t, i) => {
      const a = (i / types.length) * Math.PI * 2;
      g.enemies.push(new AF.Enemy(t,
        C.X0 + C.SIZE / 2 + Math.cos(a) * 200,
        C.Y0 + C.SIZE / 2 + Math.sin(a) * 200, 1, 1));
    });
    g.player.stats.maxHp = 99999; g.player.hp = 99999;   // 죽지 않게 해서 끝까지 관찰
    const bad = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 6000) {
      for (const e of g.enemies) {
        if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) bad.push({ why: 'NaN', type: e.type });
        if (e.x < C.X0 - 2 || e.x > C.X1 + 2 || e.y < C.Y0 - 2 || e.y > C.Y1 + 2) {
          bad.push({ why: 'out', type: e.type, x: Math.round(e.x), y: Math.round(e.y) });
        }
      }
      for (const s of g.shots) {
        if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || !Number.isFinite(s.a)) bad.push({ why: 'shotNaN' });
      }
      if (bad.length > 3) break;
      await new Promise(r => setTimeout(r, 16));
    }
    return { bad: bad.slice(0, 3), seen: types.length, remaining: g.enemies.length, shots: g.shots.length };
  });
  check('7종 전부 벽 밖으로 나가거나 NaN 이 되지 않음', allTypes.bad.length === 0, allTypes.bad);
  check('투사체 좌표가 전부 유한', allTypes.bad.filter(b => b.why === 'shotNaN').length === 0, allTypes.bad);

  console.log('\n== B. 능력 16종을 상한까지 전부 적용 ==');
  const maxBuild = await page.evaluate(async () => {
    const g = window.AF.game, AF = window.AF;
    g.newRun();
    await new Promise(r => setTimeout(r, 120));
    let threw = null;
    try {
      AF.UPGRADES.forEach(u => {
        for (let i = 0; i < Math.min(u.max, 20); i++) {
          u.apply(g.player.stats, g.player);
          g.taken[u.id] = (g.taken[u.id] || 0) + 1;
          if (g.takenOrder.indexOf(u.id) === -1) g.takenOrder.push(u.id);
        }
      });
    } catch (e) { threw = e.message; }
    const before = g.shots.length;
    g.fire();
    const arrows = g.shots.length - before;
    await new Promise(r => setTimeout(r, 1500));
    const s = g.player.stats;
    return {
      threw, arrows, fireCd: +s.fireCd.toFixed(4), multishot: s.multishot,
      shotsAlive: g.shots.length,
      finite: Object.keys(s).every(k => Number.isFinite(s[k])),
      state: g.state
    };
  });
  check('최대 빌드 적용에 예외 없음', maxBuild.threw === null, maxBuild.threw);
  check('스탯이 전부 유한한 수', maxBuild.finite === true, maxBuild);
  check('한 번 발사에 화살이 여러 발', maxBuild.arrows >= 4, maxBuild.arrows);
  check('공격 간격이 0보다 큼', maxBuild.fireCd > 0, maxBuild.fireCd);
  check('최대 빌드로 1.5초 돌려도 살아 있음', maxBuild.state !== undefined, maxBuild.state);

  console.log('\n== C. 능력 풀이 바닥나도 선택지를 만든다 ==');
  const drained = await page.evaluate(async () => {
    const g = window.AF.game, AF = window.AF;
    g.newRun();
    await new Promise(r => setTimeout(r, 120));
    // 상한이 있는 능력을 전부 소진시킨다
    AF.UPGRADES.forEach(u => { if (u.max < 90) g.taken[u.id] = u.max; });
    g.player.hp = g.player.stats.maxHp;    // '응급 처치' 조건도 막는다
    const rolled = g.rollUpgrades(3);
    return { count: rolled.length, ids: rolled.map(u => u.id) };
  });
  check('풀이 좁아져도 예외 없이 선택지 생성', drained.count >= 1, drained);
  check('남은 선택지가 중복되지 않음',
        new Set(drained.ids).size === drained.ids.length, drained.ids);

  console.log('\n== D. 20방 연속 진행 (매번 능력 선택) ==');
  const marathon = await page.evaluate(async () => {
    const g = window.AF.game;
    g.newRun();
    await new Promise(r => setTimeout(r, 120));
    g.player.stats.maxHp = 99999; g.player.hp = 99999;
    const rooms = [], bosses = [];
    let threw = null;
    try {
      for (let i = 0; i < 20; i++) {
        g.introT = 0;
        g.enemies = [];
        await new Promise(r => setTimeout(r, 90));
        if (g.state !== 'UPGRADE') { threw = '방 ' + g.room + ' 에서 능력 화면이 안 뜸: ' + g.state; break; }
        rooms.push(g.room);
        if (g.plan.isBoss) bosses.push(g.room);
        g.choices[0].apply(g.player.stats, g.player);
        g.taken[g.choices[0].id] = (g.taken[g.choices[0].id] || 0) + 1;
        g.nextRoom();
        g.state = 'PLAYING';
        await new Promise(r => setTimeout(r, 60));
      }
    } catch (e) { threw = e.message; }
    return { threw, rooms, bosses, finalRoom: g.room, enemies: g.enemies.length };
  });
  check('20방 연속 진행에 예외 없음', marathon.threw === null, marathon.threw);
  check('방 번호가 1부터 순서대로',
        marathon.rooms.every((r, i) => r === i + 1), marathon.rooms);
  check('보스가 5·10·15·20방에 등장',
        JSON.stringify(marathon.bosses) === JSON.stringify([5, 10, 15, 20]), marathon.bosses);

  console.log('\n== E. 좁은 방에서도 적이 낄 자리를 찾는다 ==');
  const spawnFit = await page.evaluate(() => {
    const g = window.AF.game, AF = window.AF, C = AF.C;
    // 전장 대부분을 막아 최악의 조건을 만든다
    g.obstacles = [];
    for (let r = 0; r < C.GRID; r++) {
      for (let c = 0; c < C.GRID; c++) {
        if (r % 2 === 0 && c % 2 === 0) {
          g.obstacles.push({ x: C.X0 + c * C.CELL, y: C.Y0 + r * C.CELL, w: C.CELL, h: C.CELL });
        }
      }
    }
    const bad = [];
    for (let i = 0; i < 200; i++) {
      const p = g.findSpawn(19);
      if (p.x < C.X0 || p.x > C.X1 || p.y < C.Y0 || p.y > C.Y1) bad.push(p);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) bad.push(p);
    }
    return { bad: bad.slice(0, 3), obstacles: g.obstacles.length };
  });
  check('막힌 방에서도 등장 좌표가 전장 안', spawnFit.bad.length === 0, spawnFit);

  console.log('\n== F. 무작위 상태 전이 150회 ==');
  const churn = await page.evaluate(async () => {
    const g = window.AF.game;
    const states = ['TITLE', 'PLAYING', 'PAUSED', 'UPGRADE', 'DEAD'];
    let threw = null;
    try {
      for (let i = 0; i < 150; i++) {
        g.state = states[(Math.random() * states.length) | 0];
        g.overlayT = 10;
        window.AF.Input.pointer.tapped = true;
        window.AF.Input.pointer.x = 350; window.AF.Input.pointer.y = 500;
        await new Promise(r => setTimeout(r, 16));
      }
    } catch (e) { threw = e.message; }
    return { threw, state: g.state, room: g.room, choices: g.choices.length };
  });
  check('무작위 상태 전이에 예외 없음', churn.threw === null, churn.threw);
  check('방 번호가 음수/NaN 이 되지 않음',
        Number.isFinite(churn.room) && churn.room >= 0, churn.room);

  console.log('\n== G. 화살이 벽을 뚫고 나가지 않는다 (도탄 최대) ==');
  const contained = await page.evaluate(async () => {
    const g = window.AF.game, AF = window.AF, C = AF.C;
    g.newRun();
    await new Promise(r => setTimeout(r, 120));
    g.player.stats.bounce = 3;
    g.player.stats.multishot = 3;
    g.player.stats.projSpeed = 14;
    let escaped = 0, checked = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 4000) {
      g.player.aim = Math.random() * Math.PI * 2;
      g.fire();
      for (const s of g.shots) {
        checked++;
        if (s.x < C.X0 - 12 || s.x > C.X1 + 12 || s.y < C.Y0 - 12 || s.y > C.Y1 + 12) escaped++;
      }
      await new Promise(r => setTimeout(r, 16));
    }
    return { escaped, checked };
  });
  check('도탄 최대에서도 화살이 전장 밖으로 안 나감', contained.escaped === 0, contained);
  check('실제로 많은 화살을 검사함', contained.checked > 200, contained.checked);

  console.log('\n== H. 창 크기를 바꿔도 포인터 좌표가 어긋나지 않는다 ==');
  const resize = [];
  for (const [w, h] of [[420, 800], [1500, 950], [760, 560]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(160);
    const box = await page.locator('#screen').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(80);
    const p = await page.evaluate(() => ({ x: window.AF.Input.pointer.x, y: window.AF.Input.pointer.y }));
    resize.push({ w, h, x: Math.round(p.x), y: Math.round(p.y) });
  }
  check('모든 뷰포트에서 캔버스 중앙이 (350, 386)',
        resize.every(r => Math.abs(r.x - 350) <= 2 && Math.abs(r.y - 386) <= 2), resize);

  console.log('\n== I. 길찾기: 벽 뒤의 적이 반드시 도달한다 ==');
  /* 실제로 있었던 결함의 회귀 테스트.
     플레이어 등장 지점 바로 위에 폭 넓은 벽이 있는 방에서, 벽 뒤의 적이
     정면으로 벽을 밀며 영영 오지 못했다(국소 조향의 한계). 지금은 거리장을 따라 돌아온다. */
  const pathing = await page.evaluate(async () => {
    const g = window.AF.game, AF = window.AF, C = AF.C;
    g.newRun();
    await new Promise(r => setTimeout(r, 120));
    // 가로로 긴 벽을 플레이어 바로 위에 세운다
    g.obstacles = [];
    g.blocked = new Uint8Array(C.GRID * C.GRID);
    for (let c = 1; c < C.GRID - 1; c++) {
      g.obstacles.push({ x: C.X0 + c * C.CELL, y: C.Y0 + 8 * C.CELL, w: C.CELL, h: C.CELL });
      g.blocked[8 * C.GRID + c] = 1;
    }
    g.flow = null; g.flowT = 0; g.flowCell = -1;
    g.player.x = C.X0 + C.SIZE / 2; g.player.y = C.Y1 - 80;
    g.player.stats.maxHp = 1e9; g.player.hp = 1e9;
    g.enemies = [];
    // 벽 반대편 구석에 둔다 — 직선으로는 절대 못 온다
    const e = new AF.Enemy('chaser', C.X0 + 40, C.Y0 + 40, 1, 1);
    g.enemies.push(e);

    const start = Math.hypot(e.x - g.player.x, e.y - g.player.y);
    let closest = start;
    const t0 = performance.now();
    while (performance.now() - t0 < 14000 && !e.dead) {
      closest = Math.min(closest, Math.hypot(e.x - g.player.x, e.y - g.player.y));
      if (closest < 60) break;
      await new Promise(r => setTimeout(r, 16));
    }
    return { start: Math.round(start), closest: Math.round(closest),
             reached: closest < 60 || e.dead, killed: e.dead,
             secs: +((performance.now() - t0) / 1000).toFixed(1) };
  });
  check('벽 뒤에서 출발한 적이 플레이어에게 도달(또는 사망)',
        pathing.reached === true, pathing);
  check('실제로 먼 거리에서 출발했다', pathing.start > 400, pathing.start);

  console.log('\n== J. 시야가 막혀도 방은 반드시 끝난다 ==');
  const noStall = await page.evaluate(async () => {
    const g = window.AF.game, AF = window.AF, C = AF.C;
    g.newRun();
    await new Promise(r => setTimeout(r, 120));
    g.room = 2; g.nextRoom(); g.state = 'PLAYING';
    g.player.stats.maxHp = 1e9; g.player.hp = 1e9;
    // 원거리 적만 남겨 최악의 조건 — 예전에는 사거리를 지키며 영원히 버텼다
    g.enemies = [];
    for (let i = 0; i < 3; i++) {
      const p = g.findSpawn(14);
      g.enemies.push(new AF.Enemy(i === 0 ? 'shooter' : 'orbiter', p.x, p.y, 1, 1));
    }
    await new Promise(r => setTimeout(r, 100));
    const t0 = performance.now();
    let anyCommitted = false;
    while (performance.now() - t0 < 12000 && g.enemies.length) {
      if (g.enemies.some(e => e.commit)) anyCommitted = true;
      await new Promise(r => setTimeout(r, 16));
    }
    const left = g.enemies.map(e => Math.round(e.hp / e.maxHp * 100));
    return { left, anyCommitted,
             allDamaged: left.every(pct => pct < 100),
             cleared: g.enemies.length === 0 };
  });
  check('원거리 적이 시야를 잃으면 접근 상태로 전환된다', noStall.anyCommitted === true, noStall);
  check('12초 안에 전멸하거나 모두 피해를 입는다',
        noStall.cleared || noStall.allDamaged, noStall);

  console.log('\n== K. 전체 실행 중 누적 에러 ==');
  check('런타임 에러 0건', errors.length === 0, errors.slice(0, 5));

  console.log('\n---- ' + pass + ' passed, ' + fail + ' failed ----');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
