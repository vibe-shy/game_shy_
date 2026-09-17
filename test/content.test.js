/* 의존성 없는 데이터 검증. `node test/content.test.js`
   방 배치 · 능력 목록 · 적 정의는 전부 손으로 적는 데이터라 오타가 나기 쉽고,
   틀려도 런타임에 조용히 이상한 게임이 될 뿐 예외가 나지 않는다. 여기서 잡는다. */
const path = require('path');
require(path.join(__dirname, '..', 'js', 'util.js'));
const AF = require(path.join(__dirname, '..', 'js', 'content.js'));

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('  PASS  ' + name);
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}

console.log('데이터 검증\n');

// ---- 방 배치
check('방 배치 문법 오류 없음', AF.validateRooms().length === 0, AF.validateRooms());
check('방이 2개 이상 (일반 + 보스)', AF.ROOMS.length >= 2, AF.ROOMS.length);
check('보스 방 인덱스가 범위 안',
      AF.BOSS_ROOM >= 0 && AF.BOSS_ROOM < AF.ROOMS.length, AF.BOSS_ROOM);

// 엄폐물이 너무 많으면 움직일 곳이 없다
AF.ROOMS.forEach(function (room, i) {
  const blocks = room.join('').split('#').length - 1;
  const total = AF.C.GRID * AF.C.GRID;
  check('방 ' + i + ': 엄폐물이 전체의 30% 미만 (' + blocks + '/' + total + ')',
        blocks / total < 0.3, blocks / total);
});

// ---- 전장 좌표가 캔버스 안에 들어가는가
check('전장이 캔버스 안', AF.C.X1 <= AF.C.W && AF.C.Y1 <= AF.C.H,
      { X1: AF.C.X1, Y1: AF.C.Y1, W: AF.C.W, H: AF.C.H });
check('격자 크기가 전장과 맞음', AF.C.GRID * AF.C.CELL === AF.C.SIZE,
      { grid: AF.C.GRID, cell: AF.C.CELL, size: AF.C.SIZE });

// ---- 능력
const ids = AF.UPGRADES.map(u => u.id);
check('능력 id 중복 없음', new Set(ids).size === ids.length, ids);
AF.UPGRADES.forEach(function (u) {
  check('능력 ' + u.id + ': 이름·설명·아이콘 있음',
        !!u.name && !!u.desc && !!u.icon, u);
  check('능력 ' + u.id + ': max/weight 가 양수', u.max > 0 && u.weight > 0, u);
  check('능력 ' + u.id + ': apply 가 함수', typeof u.apply === 'function');
});

// 모든 능력을 상한까지 쌓아도 스탯이 망가지지 않아야 한다
(function () {
  const stats = {
    maxHp: 100, damage: 10, fireCd: 0.42, moveSpeed: 3.1, projSpeed: 8.5, projSize: 5,
    multishot: 1, pierce: 0, bounce: 0, homing: 0, rearShot: 0, sideShot: 0,
    lifesteal: 0, critChance: 0, slow: 0, knockback: 1
  };
  const p = { hp: 100 };
  let threw = null;
  try {
    AF.UPGRADES.forEach(u => { for (let i = 0; i < Math.min(u.max, 20); i++) u.apply(stats, p); });
  } catch (e) { threw = e.message; }
  check('모든 능력을 상한까지 적용해도 예외 없음', threw === null, threw);
  const finite = Object.keys(stats).every(k => Number.isFinite(stats[k]));
  check('적용 후 모든 스탯이 유한한 수', finite, stats);
  check('공격 간격이 0보다 큼 (0이면 무한 발사)', stats.fireCd > 0, stats.fireCd);
  check('화살 수가 상식 범위', stats.multishot <= 8, stats.multishot);
})();

// ---- 적
Object.keys(AF.ENEMIES).forEach(function (k) {
  const e = AF.ENEMIES[k];
  check('적 ' + k + ': hp/speed/r 가 양수', e.hp > 0 && e.speed > 0 && e.r > 0, e);
  check('적 ' + k + ': 이름과 색 있음', !!e.name && !!e.color && !!e.dark, e);
});

// ---- 방 구성 스케일링
(function () {
  const plans = [];
  for (let r = 1; r <= 21; r++) plans.push(AF.roomPlan(r));
  check('5방마다 보스',
        plans.filter((p, i) => p.isBoss).length === 4 &&
        plans[4].isBoss && plans[9].isBoss, plans.map(p => p.isBoss));
  check('보스 방에는 보스만',
        plans[4].spawns.length === 1 && plans[4].spawns[0][0] === 'boss', plans[4].spawns);
  check('난이도(체력 배율)가 단조 증가',
        plans.every((p, i) => i === 0 || p.hpMul >= plans[i - 1].hpMul),
        plans.map(p => +p.hpMul.toFixed(2)));
  const counts = plans.filter(p => !p.isBoss).map(p => p.spawns.length);
  check('일반 방 적 수가 1~11', counts.every(c => c >= 1 && c <= 11), counts);
  const types = new Set();
  plans.forEach(p => p.spawns.forEach(s => types.add(s[0])));
  check('21방 안에서 모든 적 종류가 등장', types.size >= 5, [...types]);
})();

// ---- 스프라이트 매니페스트와 에셋
(function () {
  const fs = require('fs');
  const root = path.join(__dirname, '..');
  const src = fs.readFileSync(path.join(root, 'js', 'sprites.js'), 'utf8');
  const block = src.match(/AF\.SPRITES = \{([\s\S]*?)\n\};/);
  check('AF.SPRITES 매니페스트를 찾음', !!block);
  if (!block) return;

  const keys = [...block[1].matchAll(/'([\w-]+)':\s*\{([^}]*)\}/g)];
  check('스프라이트 키가 1개 이상', keys.length > 0, keys.length);
  check('키 중복 없음',
        new Set(keys.map(m => m[1])).size === keys.length, keys.map(m => m[1]));

  keys.forEach(([, key, body]) => {
    const face = (body.match(/face:\s*'(\w+)'/) || [])[1];
    check('스프라이트 ' + key + ': face 가 rotate/flip/none',
          ['rotate', 'flip', 'none'].indexOf(face) !== -1, face);
  });

  // 적 종류마다 대응하는 스프라이트 키가 있어야 한다.
  // 없으면 그 적만 조용히 도형으로 그려져 눈치채기 어렵다.
  const declared = new Set(keys.map(m => m[1]));
  Object.keys(AF.ENEMIES).forEach(t => {
    check('적 ' + t + ' 의 스프라이트 키가 선언됨', declared.has('enemy-' + t), t);
  });

  // 매니페스트 키와 assets/ 파일이 맞물리는지
  const assets = path.join(root, 'assets');
  const onDisk = fs.existsSync(assets)
    ? fs.readdirSync(assets).filter(f => f.endsWith('.png')).map(f => f.replace(/\.png$/, ''))
    : [];
  const orphan = onDisk.filter(k => !declared.has(k));
  check('assets/ 에 매니페스트가 모르는 파일이 없음', orphan.length === 0, orphan);

  // 생성물이 최신인지 — 선언한 키가 sprite-data.js 에 들어 있는가
  const dataFile = path.join(root, 'js', 'sprite-data.js');
  if (fs.existsSync(dataFile) && onDisk.length) {
    const data = fs.readFileSync(dataFile, 'utf8');
    const inData = onDisk.filter(k => declared.has(k) && data.indexOf('"' + k + '"') !== -1);
    check('sprite-data.js 가 최신 (assets 의 스프라이트를 모두 담음)',
          inData.length === onDisk.filter(k => declared.has(k)).length,
          { onDisk: onDisk.length, inData: inData.length });
  }
})();

console.log(fail ? '\n' + fail + '건 실패' : '\n전부 통과');
process.exit(fail ? 1 : 0);
