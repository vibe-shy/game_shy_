/* 상수 · 적 정의 · 능력 목록 · 방 배치. 튜닝은 전부 이 파일에서 한다. */
var AF_ROOT = typeof window !== 'undefined' ? window : globalThis;   // node 로 데이터 검증만 돌릴 수 있게
var AF = AF_ROOT.AF || (AF_ROOT.AF = {});

AF.C = {
  W: 700,
  H: 772,
  HUD_H: 72,
  WALL: 14,
  GRID: 12,             // 방은 12x12 격자
  CELL: 56,             // 격자 한 칸 = 56px → 672x672 전장
  STEP: 1 / 60,
  BOSS_EVERY: 5         // 5방마다 보스
};
AF.C.X0 = AF.C.WALL;                       // 전장 왼쪽
AF.C.Y0 = AF.C.HUD_H + AF.C.WALL;          // 전장 위쪽
AF.C.SIZE = AF.C.GRID * AF.C.CELL;         // 672
AF.C.X1 = AF.C.X0 + AF.C.SIZE;
AF.C.Y1 = AF.C.Y0 + AF.C.SIZE;

/* 색은 던전 횃불 톤으로 통일한다. 아군은 금색, 적은 붉은 계열. */
AF.COLOR = {
  floor:    '#1e1b28',
  floorAlt: '#221e2e',
  wall:     '#3a3350',
  wallTop:  '#544a72',
  player:   '#ffd479',
  playerIn: '#ff9d3d',
  arrow:    '#ffe9a8',
  enemyShot:'#ff5f9e',
  hp:       '#4ade80',
  hpLow:    '#ff5a5f',
  accent:   '#ffb347',
  ink:      '#b8a99a',
  inkDim:   '#6f6479'
};

AF.PLAYER = {
  r: 13,
  hp: 100,
  damage: 10,
  fireCd: 0.42,      // 발사 간격(초)
  moveSpeed: 3.1,
  projSpeed: 8.5,
  projSize: 5,
  projRange: 900,    // 화살이 날아가는 최대 거리(px)
  iframes: 0.85      // 피격 후 무적 시간(초)
};

// ------------------------------------------------------------------- 적

AF.ENEMIES = {
  chaser: {
    name: '돌격병', hp: 22, speed: 1.55, r: 13, contact: 10, score: 10,
    color: '#ff5a5f', dark: '#7d1d2a', shape: 'tri'
  },
  shooter: {
    name: '사수', hp: 18, speed: 1.05, r: 13, contact: 8, score: 14,
    color: '#ff9f43', dark: '#7d4a12', shape: 'square',
    range: 240, fireCd: 1.7, shotDmg: 10, shotSpeed: 4.0
  },
  orbiter: {
    name: '선회자', hp: 26, speed: 1.5, r: 14, contact: 9, score: 18,
    color: '#a06cd5', dark: '#4a2a70', shape: 'diamond',
    orbit: 155, fireCd: 2.2, shotDmg: 9, shotSpeed: 3.4, spread: 3
  },
  charger: {
    name: '돌진병', hp: 34, speed: 0.85, r: 16, contact: 16, score: 22,
    color: '#ff4d6d', dark: '#7a1a33', shape: 'tri',
    windup: 0.7, dashSpeed: 6.4, dashTime: 0.5, restTime: 0.9
  },
  splitter: {
    name: '분열체', hp: 32, speed: 0.95, r: 19, contact: 10, score: 20,
    color: '#5fd6a0', dark: '#1c6249', shape: 'blob', splits: 2
  },
  shard: {   // 분열체가 죽으며 남기는 조각
    name: '조각', hp: 10, speed: 2.1, r: 9, contact: 7, score: 5,
    color: '#8affc9', dark: '#1c6249', shape: 'tri'
  },
  boss: {
    name: '수호자', hp: 460, speed: 0.9, r: 34, contact: 22, score: 250,
    color: '#ff3d5a', dark: '#5c1020', shape: 'boss',
    shotDmg: 12, shotSpeed: 3.6
  }
};

/* 방 번호에 따라 적 구성과 배율을 정한다. roomIndex 는 1부터. */
AF.roomPlan = function (roomIndex) {
  var isBoss = roomIndex % AF.C.BOSS_EVERY === 0;
  var hpMul = 1 + (roomIndex - 1) * 0.15;
  var dmgMul = 1 + (roomIndex - 1) * 0.07;

  if (isBoss) {
    return { isBoss: true, hpMul: hpMul, dmgMul: dmgMul, spawns: [['boss', 1]] };
  }

  // 방이 진행될수록 종류가 열리고 수가 는다
  var pool = [['chaser', 10]];
  if (roomIndex >= 2) pool.push(['shooter', 8]);
  if (roomIndex >= 3) pool.push(['orbiter', 7]);
  if (roomIndex >= 4) pool.push(['charger', 6]);
  if (roomIndex >= 6) pool.push(['splitter', 6]);

  var count = Math.min(3 + Math.floor(roomIndex * 0.6), 10);
  var spawns = [];
  for (var i = 0; i < count; i++) spawns.push([AF.weighted(pool), 1]);
  return { isBoss: false, hpMul: hpMul, dmgMul: dmgMul, spawns: spawns };
};

// --------------------------------------------------------------- 능력

/* max 는 중첩 상한. 상한에 닿은 능력은 선택지에 다시 나오지 않는다.
   need(g) 가 있으면 그 조건을 만족할 때만 후보가 된다. */
AF.UPGRADES = [
  { id: 'dmg', name: '강궁', desc: '공격력 +25%', icon: '⚔', max: 99, weight: 12,
    apply: function (s) { s.damage *= 1.25; } },
  { id: 'rate', name: '속사', desc: '공격 속도 +18%', icon: '⚡', max: 8, weight: 12,
    apply: function (s) { s.fireCd *= 0.82; } },
  { id: 'multi', name: '다중 사격', desc: '앞으로 화살 +1', icon: '↟', max: 3, weight: 9,
    apply: function (s) { s.multishot += 1; } },
  { id: 'pierce', name: '관통', desc: '적을 1명 더 뚫는다', icon: '⤳', max: 3, weight: 8,
    apply: function (s) { s.pierce += 1; } },
  { id: 'bounce', name: '도탄', desc: '벽에 1회 더 튕긴다', icon: '⤾', max: 3, weight: 7,
    apply: function (s) { s.bounce += 1; } },
  { id: 'homing', name: '추적 화살', desc: '화살이 적을 따라간다', icon: '◎', max: 2, weight: 7,
    apply: function (s) { s.homing += 0.055; } },
  { id: 'rear', name: '배후 사격', desc: '뒤로도 화살을 쏜다', icon: '↕', max: 1, weight: 6,
    apply: function (s) { s.rearShot = 1; } },
  { id: 'side', name: '측면 사격', desc: '좌우로도 화살을 쏜다', icon: '↔', max: 1, weight: 6,
    apply: function (s) { s.sideShot = 1; } },
  { id: 'speed', name: '경보', desc: '이동 속도 +14%', icon: '»', max: 6, weight: 10,
    apply: function (s) { s.moveSpeed *= 1.14; } },
  { id: 'hp', name: '강인함', desc: '최대 체력 +25 · 즉시 회복', icon: '♥', max: 99, weight: 10,
    apply: function (s, p) { s.maxHp += 25; p.hp += 25; } },
  { id: 'heal', name: '응급 처치', desc: '체력 50% 회복', icon: '✚', max: 99, weight: 9,
    need: function (g) { return g.player.hp < g.player.stats.maxHp * 0.85; },
    apply: function (s, p) { p.hp = Math.min(s.maxHp, p.hp + s.maxHp * 0.5); } },
  { id: 'vamp', name: '흡혈', desc: '준 피해의 10%를 회복', icon: '❥', max: 3, weight: 6,
    apply: function (s) { s.lifesteal += 0.10; } },
  { id: 'crit', name: '급소', desc: '치명타 확률 +15%', icon: '✖', max: 4, weight: 8,
    apply: function (s) { s.critChance += 0.15; } },
  { id: 'frost', name: '서리 화살', desc: '맞은 적이 35% 느려진다', icon: '❄', max: 1, weight: 6,
    apply: function (s) { s.slow = 0.35; } },
  { id: 'big', name: '큰 화살', desc: '화살 크기 +35% · 피해 +10%', icon: '●', max: 2, weight: 7,
    apply: function (s) { s.projSize *= 1.35; s.damage *= 1.1; } },
  { id: 'knock', name: '강타', desc: '넉백 +80%', icon: '➤', max: 2, weight: 5,
    apply: function (s) { s.knockback *= 1.8; } }
];

// ------------------------------------------------------------- 방 배치

/* '#' 는 엄폐물, '.' 은 빈 바닥. 12글자 x 12줄.
   아래 두 줄은 플레이어가 등장하는 자리라 비워 둔다. */
AF.ROOMS = [
  [ '............',
    '............',
    '...##..##...',
    '...##..##...',
    '............',
    '............',
    '...##..##...',
    '...##..##...',
    '............',
    '............',
    '............',
    '............' ],

  [ '..##....##..',
    '..##....##..',
    '............',
    '............',
    '....####....',
    '....####....',
    '............',
    '............',
    '..##....##..',
    '..##....##..',
    '............',
    '............' ],

  [ '............',
    '.####..####.',
    '............',
    '............',
    '.##......##.',
    '.##......##.',
    '............',
    '............',
    '...######...',
    '............',
    '............',
    '............' ],

  [ '.....##.....',
    '.....##.....',
    '.....##.....',
    '............',
    '............',
    '##........##',
    '##........##',
    '............',
    '............',
    '.....##.....',
    '............',
    '............' ],

  [ '............',
    '..#......#..',
    '..##....##..',
    '...##..##...',
    '............',
    '............',
    '...##..##...',
    '..##....##..',
    '..#......#..',
    '............',
    '............',
    '............' ],

  [ '###......###',
    '............',
    '............',
    '....#..#....',
    '....#..#....',
    '............',
    '............',
    '....#..#....',
    '....#..#....',
    '............',
    '............',
    '............' ],

  [ '............',
    '............',
    '.##.####.##.',
    '.##......##.',
    '............',
    '.....##.....',
    '.....##.....',
    '............',
    '.##......##.',
    '.##......##.',
    '............',
    '............' ],

  // 보스 방은 넓게 비워 둔다 — 피할 공간이 없으면 패턴이 불공평해진다
  [ '............',
    '............',
    '..#......#..',
    '............',
    '............',
    '............',
    '............',
    '............',
    '..#......#..',
    '............',
    '............',
    '............' ]
];

AF.BOSS_ROOM = AF.ROOMS.length - 1;

/* 방 배치 검증. 줄 길이가 어긋나거나 모르는 글자가 있으면 조용히 깨진 방이 된다. */
AF.validateRooms = function () {
  var problems = [];
  AF.ROOMS.forEach(function (room, i) {
    if (room.length !== AF.C.GRID) {
      problems.push('방 ' + i + ': 줄 수 ' + room.length + ', 기대값 ' + AF.C.GRID);
    }
    room.forEach(function (row, r) {
      if (row.length !== AF.C.GRID) {
        problems.push('방 ' + i + ' ' + r + '행: 길이 ' + row.length + ', 기대값 ' + AF.C.GRID);
      }
      for (var c = 0; c < row.length; c++) {
        if ('.#'.indexOf(row[c]) === -1) {
          problems.push('방 ' + i + ' ' + r + '행 ' + c + '열: 알 수 없는 글자 "' + row[c] + '"');
        }
      }
    });
    // 플레이어 등장 자리(아래 두 줄)는 반드시 비어 있어야 한다
    for (var k = AF.C.GRID - 2; k < AF.C.GRID; k++) {
      if (room[k] && room[k].indexOf('#') !== -1) {
        problems.push('방 ' + i + ': ' + k + '행은 등장 자리라 비어 있어야 한다');
      }
    }
  });
  return problems;
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AF;
}
