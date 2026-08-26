/* 게임 오브젝트와 상수. 모든 좌표는 캔버스 내부 해상도(640x760) 기준. */
var NB = window.NB || (window.NB = {});

NB.C = {
  W: 640,
  H: 760,
  HUD_H: 96,          // 위쪽 HUD 띠 (여기 아래가 실제 플레이 필드)
  WALL: 16,           // 좌우 벽 두께
  MARGIN: 20,         // 벽돌 영역 좌우 여백
  BRICK_TOP: 136,
  BRICK_W: 60,
  BRICK_H: 26,
  PADDLE_Y: 676,
  PADDLE_W: 108,
  PADDLE_H: 14,
  PADDLE_MIN: 62,
  PADDLE_MAX: 188,
  PADDLE_KEY_SPEED: 9.5,
  BALL_R: 8,
  BALL_MAX_ANGLE: Math.PI / 3,   // 패들 끝을 맞혔을 때의 최대 각도(수직 기준 60°)
  DROP_CHANCE: 0.18,
  LIVES: 3,
  STEP: 1 / 60
};

NB.POWERS = {
  EXPAND: { label: 'W+',  color: '#5dff9b', good: true,  dur: 20 },
  SHRINK: { label: 'W-',  color: '#ff5470', good: false, dur: 12 },
  MULTI:  { label: '3x',  color: '#35e0ff', good: true,  dur: 0 },
  SLOW:   { label: 'SLO', color: '#7aa8ff', good: true,  dur: 12 },
  FAST:   { label: 'FST', color: '#ff8a3d', good: false, dur: 10 },
  LASER:  { label: 'LZR', color: '#ffd84d', good: true,  dur: 14 },
  STICKY: { label: 'GLU', color: '#c77dff', good: true,  dur: 15 },
  LIFE:   { label: '1UP', color: '#ff7ad9', good: true,  dur: 0 },
  BONUS:  { label: '500', color: '#ffe58a', good: true,  dur: 0 }
};

/* 뽑기 가중치. 나쁜 아이템도 섞여야 "무조건 먹는" 게임이 안 된다. */
NB.POWER_TABLE = [
  ['MULTI', 16], ['EXPAND', 15], ['LASER', 13], ['SLOW', 11],
  ['STICKY', 10], ['BONUS', 12], ['LIFE', 4], ['SHRINK', 10], ['FAST', 9]
];

NB.rollPower = function () {
  var total = 0, i;
  for (i = 0; i < NB.POWER_TABLE.length; i++) total += NB.POWER_TABLE[i][1];
  var r = Math.random() * total;
  for (i = 0; i < NB.POWER_TABLE.length; i++) {
    r -= NB.POWER_TABLE[i][1];
    if (r <= 0) return NB.POWER_TABLE[i][0];
  }
  return 'EXPAND';
};

NB.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };

// ---------------------------------------------------------------- Paddle

NB.Paddle = function () {
  var C = NB.C;
  this.w = C.PADDLE_W;
  this.h = C.PADDLE_H;
  this.x = C.W / 2 - this.w / 2;
  this.y = C.PADDLE_Y;
  this.vx = 0;
  this.targetW = C.PADDLE_W;
};

NB.Paddle.prototype.cx = function () { return this.x + this.w / 2; };

NB.Paddle.prototype.update = function (desiredCx) {
  var C = NB.C;
  // 폭 변화는 한 프레임에 튀지 않게 부드럽게 따라간다.
  this.w += (this.targetW - this.w) * 0.18;
  var prev = this.x;
  this.x = NB.clamp(desiredCx - this.w / 2, C.WALL, C.W - C.WALL - this.w);
  this.vx = this.x - prev;
};

// ------------------------------------------------------------------ Ball

NB.Ball = function (x, y, speed, angle) {
  this.x = x;
  this.y = y;
  this.r = NB.C.BALL_R;
  this.speed = speed;
  this.vx = Math.sin(angle) * speed;
  this.vy = -Math.cos(angle) * speed;
  this.stuck = false;
  this.stickOffset = 0;
  this.trail = [];
};

NB.Ball.prototype.setSpeed = function (s) {
  var len = Math.hypot(this.vx, this.vy) || 1;
  this.speed = s;
  this.vx = (this.vx / len) * s;
  this.vy = (this.vy / len) * s;
};

/* 공이 거의 수평이 되면 벽 사이를 하염없이 오가므로 최소 수직 성분을 강제한다. */
NB.Ball.prototype.unflatten = function () {
  var minVy = this.speed * 0.28;
  if (Math.abs(this.vy) < minVy) {
    this.vy = (this.vy < 0 ? -1 : 1) * minVy;
    var sign = this.vx < 0 ? -1 : 1;
    var vx2 = this.speed * this.speed - this.vy * this.vy;
    this.vx = sign * Math.sqrt(Math.max(0, vx2));
  }
};

/* 반대로 완전히 수직이 되면 패들 정중앙 ↔ 천장을 영원히 왕복한다.
   공을 놓칠 수도 없고 진행도 안 되는 교착이라 최소 수평 성분도 강제한다. */
NB.Ball.prototype.unvertical = function () {
  var minVx = this.speed * 0.14;
  if (Math.abs(this.vx) >= minVx) return;
  var sign = this.vx === 0 ? (Math.random() < 0.5 ? -1 : 1) : (this.vx < 0 ? -1 : 1);
  this.vx = sign * minVx;
  var sy = this.vy < 0 ? -1 : 1;
  this.vy = sy * Math.sqrt(Math.max(0, this.speed * this.speed - this.vx * this.vx));
};

NB.Ball.prototype.pushTrail = function () {
  this.trail.push(this.x, this.y);
  if (this.trail.length > 20) this.trail.splice(0, 2);
};

// ----------------------------------------------------------------- Brick

NB.Brick = function (col, row, ch) {
  var C = NB.C;
  this.row = row;
  this.w = C.BRICK_W;
  this.h = C.BRICK_H;
  this.x = C.MARGIN + col * C.BRICK_W;
  this.y = C.BRICK_TOP + row * C.BRICK_H;
  this.alive = true;
  this.flash = 0;
  this.forcePower = (ch === 'P');
  this.solid = (ch === 'X');
  this.hp = this.solid ? Infinity : (ch === 'P' ? 1 : parseInt(ch, 10));
  this.maxHp = this.hp;
};

/* 1히트 벽돌은 내구도를 색으로 구분할 필요가 없으니, 행마다 다른 색을 줘서
   화면이 한 가지 청록으로 뭉개지지 않게 한다. 2/3히트는 노랑/빨강으로 고정. */
NB.ROW_COLORS = [
  ['#5dff9b', '#12613a'],
  ['#7aa8ff', '#1d3a7a'],
  ['#c77dff', '#4d2470'],
  ['#ff9ad5', '#7a2a5c'],
  ['#8affe0', '#166b5c'],
  ['#ffb46b', '#7a4415']
];

NB.BRICK_COLORS = {
  1: ['#35e0ff', '#0e6a86'],
  2: ['#ffd84d', '#8a6b0d'],
  3: ['#ff5470', '#7d1d31'],
  P: ['#c77dff', '#5b2a80'],
  X: ['#5a6480', '#2b3145']
};

NB.Brick.prototype.colors = function () {
  if (this.solid) return NB.BRICK_COLORS.X;
  if (this.forcePower) return NB.BRICK_COLORS.P;
  if (this.maxHp === 1) return NB.ROW_COLORS[this.row % NB.ROW_COLORS.length];
  return NB.BRICK_COLORS[Math.max(1, Math.min(3, this.hp))];
};

NB.Brick.prototype.points = function () {
  return this.solid ? 0 : this.maxHp * 50 + 30;
};

// -------------------------------------------------------------- PowerUp

NB.PowerUp = function (x, y, type) {
  this.x = x;
  this.y = y;
  this.w = 40;
  this.h = 20;
  this.type = type;
  this.vy = 2.3;
  this.t = 0;
};

// ---------------------------------------------------------------- Laser

NB.Laser = function (x, y) {
  this.x = x;
  this.y = y;
  this.vy = -13;
  this.dead = false;
};

/* 원 vs 사각형. 충돌하면 밀어낼 방향(법선)과 침투 깊이를 돌려준다. */
NB.circleRect = function (cx, cy, r, rx, ry, rw, rh) {
  var nx = NB.clamp(cx, rx, rx + rw);
  var ny = NB.clamp(cy, ry, ry + rh);
  var dx = cx - nx;
  var dy = cy - ny;
  var d2 = dx * dx + dy * dy;

  if (d2 > r * r) return null;

  if (d2 > 0.0001) {
    var d = Math.sqrt(d2);
    return { nx: dx / d, ny: dy / d, depth: r - d };
  }

  // 중심이 사각형 안에 들어간 경우: 가장 얕게 빠져나갈 수 있는 축을 고른다.
  var left = cx - rx, right = rx + rw - cx;
  var top = cy - ry, bottom = ry + rh - cy;
  var min = Math.min(left, right, top, bottom);
  if (min === left)  return { nx: -1, ny: 0, depth: left + r };
  if (min === right) return { nx: 1,  ny: 0, depth: right + r };
  if (min === top)   return { nx: 0, ny: -1, depth: top + r };
  return { nx: 0, ny: 1, depth: bottom + r };
};
