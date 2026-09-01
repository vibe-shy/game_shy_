/* 플레이어 · 적 · 투사체. 적 AI 도 여기 있다.
   AI 가 투사체를 만들어야 해서 update 는 game 을 받는다. */
var AF = window.AF || (window.AF = {});

var C = AF.C, P = AF.Particles;

/* 엄폐물과 벽에 부딪히면 밀어낸다. 지나가는 게 아니라 미끄러지도록. */
AF.collideWorld = function (e, obstacles) {
  var i, hit;
  for (i = 0; i < obstacles.length; i++) {
    var o = obstacles[i];
    hit = AF.circleRect(e.x, e.y, e.r, o.x, o.y, o.w, o.h);
    if (hit) { e.x += hit.nx * hit.depth; e.y += hit.ny * hit.depth; }
  }
  e.x = AF.clamp(e.x, C.X0 + e.r, C.X1 - e.r);
  e.y = AF.clamp(e.y, C.Y0 + e.r, C.Y1 - e.r);
};

/* 엄폐물을 돌아가는 아주 단순한 조향.
   목표 방향으로 한 걸음 앞을 짚어 보고 막혀 있으면 좌우로 조금씩 틀어 뚫린 쪽을 찾는다.
   길찾기라고 부를 만한 물건은 아니지만, 이 방 크기에서는 충분하고
   없으면 적이 벽에 정면으로 막혀 영영 오지 못한다(= 방이 끝나지 않는다).

   좌우 중 어느 쪽을 먼저 볼지는 적마다 고정한다. 매번 바꾸면 벽 앞에서 좌우로 떤다. */
AF.steerAround = function (e, tx, ty, obstacles) {
  var base = Math.atan2(ty - e.y, tx - e.x);
  var probe = e.r + 26;
  var side = e.orbitDir >= 0 ? 1 : -1;
  var offsets = [0, 0.45, 0.9, 1.35, 1.85];

  for (var i = 0; i < offsets.length; i++) {
    for (var k = 0; k < (i === 0 ? 1 : 2); k++) {
      var a = base + offsets[i] * (k === 0 ? side : -side);
      var px = e.x + Math.cos(a) * probe;
      var py = e.y + Math.sin(a) * probe;
      if (px < C.X0 + e.r || px > C.X1 - e.r || py < C.Y0 + e.r || py > C.Y1 - e.r) continue;
      var hit = false;
      for (var j = 0; j < obstacles.length; j++) {
        var o = obstacles[j];
        if (AF.circleRect(px, py, e.r, o.x, o.y, o.w, o.h)) { hit = true; break; }
      }
      if (!hit) return { x: Math.cos(a), y: Math.sin(a) };
    }
  }
  return { x: Math.cos(base), y: Math.sin(base) };
};

// ---------------------------------------------------------------- 플레이어

AF.Player = function (x, y) {
  var d = AF.PLAYER;
  this.x = x; this.y = y;
  this.r = d.r;
  this.hp = d.hp;
  this.fireT = 0;
  this.inv = 0;
  this.aim = -Math.PI / 2;    // 화면 위쪽을 본다
  this.stillT = 0;
  this.walkT = 0;
  this.hurtFlash = 0;
  this.target = null;      // 자동 조준이 붙잡고 있는 적
  this.targetT = 0;

  this.stats = {
    maxHp: d.hp,
    damage: d.damage,
    fireCd: d.fireCd,
    moveSpeed: d.moveSpeed,
    projSpeed: d.projSpeed,
    projSize: d.projSize,
    multishot: 1,
    pierce: 0,
    bounce: 0,
    homing: 0,
    rearShot: 0,
    sideShot: 0,
    lifesteal: 0,
    critChance: 0,
    slow: 0,
    knockback: 1
  };
};

AF.Player.prototype.alive = function () { return this.hp > 0; };

AF.Player.prototype.hurt = function (dmg, g) {
  if (this.inv > 0 || this.hp <= 0) return false;
  this.hp -= dmg;
  this.inv = AF.PLAYER.iframes;
  this.hurtFlash = 1;
  g.shake = Math.min(g.shake + 9, 18);
  AF.Audio.hurt();
  P.spawn(this.x, this.y, '#ff5a5f', 16, { speed: 3.4, life: 26 });
  P.float(this.x, this.y - 22, '-' + Math.round(dmg), '#ff5a5f');
  if (this.hp <= 0) { this.hp = 0; g.onPlayerDeath(); }
  return true;
};

// ------------------------------------------------------------------ 투사체

AF.Shot = function (x, y, angle, o) {
  this.x = x; this.y = y;
  this.a = angle;
  this.speed = o.speed;
  this.r = o.size;
  this.dmg = o.dmg;
  this.friendly = !!o.friendly;
  this.pierce = o.pierce || 0;
  this.bounce = o.bounce || 0;
  this.homing = o.homing || 0;
  this.slow = o.slow || 0;
  this.knockback = o.knockback || 1;
  this.crit = !!o.crit;
  this.color = o.color;
  this.traveled = 0;
  this.range = o.range || 1400;
  this.hitIds = null;      // 관통 시 같은 적을 두 번 때리지 않도록
  this.dead = false;
  this.trail = [];
};

AF.Shot.prototype.step = function (g) {
  // 유도: 가장 가까운 적 쪽으로 진행 방향을 조금씩 튼다
  if (this.homing > 0 && this.friendly) {
    var t = g.nearestEnemy(this.x, this.y, 420);
    if (t) {
      var want = Math.atan2(t.y - this.y, t.x - this.x);
      this.a += AF.clamp(AF.wrapAngle(want - this.a), -this.homing, this.homing);
    }
  }

  var vx = Math.cos(this.a) * this.speed;
  var vy = Math.sin(this.a) * this.speed;

  this.trail.push(this.x, this.y);
  if (this.trail.length > 8) this.trail.splice(0, 2);

  this.x += vx; this.y += vy;
  this.traveled += this.speed;
  if (this.traveled > this.range) { this.dead = true; return; }

  // 벽 / 엄폐물에서 튕기거나 사라진다
  var bounced = false;
  if (this.x - this.r < C.X0) { this.x = C.X0 + this.r; this.a = Math.PI - this.a; bounced = true; }
  else if (this.x + this.r > C.X1) { this.x = C.X1 - this.r; this.a = Math.PI - this.a; bounced = true; }
  if (this.y - this.r < C.Y0) { this.y = C.Y0 + this.r; this.a = -this.a; bounced = true; }
  else if (this.y + this.r > C.Y1) { this.y = C.Y1 - this.r; this.a = -this.a; bounced = true; }

  for (var i = 0; i < g.obstacles.length && !bounced; i++) {
    var o = g.obstacles[i];
    var hit = AF.circleRect(this.x, this.y, this.r, o.x, o.y, o.w, o.h);
    if (!hit) continue;
    this.x += hit.nx * hit.depth;
    this.y += hit.ny * hit.depth;
    // 법선으로 반사
    var dot = Math.cos(this.a) * hit.nx + Math.sin(this.a) * hit.ny;
    var rx = Math.cos(this.a) - 2 * dot * hit.nx;
    var ry = Math.sin(this.a) - 2 * dot * hit.ny;
    this.a = Math.atan2(ry, rx);
    bounced = true;
  }

  if (bounced) {
    if (this.bounce > 0) {
      this.bounce--;
      this.hitIds = null;       // 튕긴 뒤에는 같은 적을 다시 때릴 수 있다
      P.spawn(this.x, this.y, this.color, 4, { speed: 1.8, life: 12 });
    } else {
      this.dead = true;
      P.spawn(this.x, this.y, this.color, 5, { speed: 2.2, life: 14 });
    }
  }
};

// ---------------------------------------------------------------------- 적

var nextEnemyId = 1;

AF.Enemy = function (type, x, y, hpMul, dmgMul) {
  var d = AF.ENEMIES[type];
  this.id = nextEnemyId++;
  this.type = type;
  this.def = d;
  this.x = x; this.y = y;
  this.r = d.r;
  this.maxHp = Math.round(d.hp * hpMul);
  this.hp = this.maxHp;
  this.dmgMul = dmgMul;
  this.speed = d.speed;
  this.kx = 0; this.ky = 0;      // 넉백 속도
  this.vx = 0; this.vy = 0;      // 직전 프레임의 실제 이동량 — 자동 조준의 예측에 쓴다
  this.fireT = AF.rand(0.4, 1.4);
  this.slowT = 0;
  this.flash = 0;
  this.t = AF.rand(0, 10);
  this.orbitDir = Math.random() < 0.5 ? 1 : -1;
  this.strafeFlip = AF.rand(1.0, 2.2);
  this.canSee = true;            // 플레이어가 보이는가 (원거리 적의 판단 근거)
  this.losT = AF.rand(0, 0.15);
  this.blindT = 0;               // 안 보인 채로 흐른 시간
  this.commit = false;           // 사거리를 버리고 접근하는 중인가
  this.phase = 'rest';           // 돌진병 / 보스 상태
  this.phaseT = AF.rand(0.3, 1.0);
  this.dashA = 0;
  this.pattern = 0;
  this.dead = false;
};

AF.Enemy.prototype.speedNow = function () {
  return this.speed * (this.slowT > 0 ? 0.65 : 1);
};

AF.Enemy.prototype.hurt = function (dmg, g, crit) {
  this.hp -= dmg;
  this.flash = 1;
  P.float(this.x, this.y - this.r - 6, String(Math.round(dmg)),
          crit ? '#ffd479' : '#ffffff', crit);
  P.spawn(this.x, this.y, this.def.color, crit ? 10 : 5, { speed: 2.6, life: 18 });
  if (crit) AF.Audio.crit(); else AF.Audio.hit();
  if (this.hp <= 0) this.die(g);
};

AF.Enemy.prototype.die = function (g) {
  if (this.dead) return;
  this.dead = true;
  AF.Audio.kill();
  P.spawn(this.x, this.y, this.def.color, this.def.shape === 'boss' ? 60 : 18,
          { speed: this.def.shape === 'boss' ? 6 : 3.6, life: 34 });
  g.score += this.def.score;
  g.kills++;
  g.shake = Math.min(g.shake + (this.def.shape === 'boss' ? 20 : 3), 20);

  if (this.def.splits) {
    for (var i = 0; i < this.def.splits; i++) {
      var a = (i / this.def.splits) * Math.PI * 2 + Math.random();
      g.enemies.push(new AF.Enemy('shard',
        this.x + Math.cos(a) * 18, this.y + Math.sin(a) * 18, g.plan.hpMul, g.plan.dmgMul));
    }
  }
};

/* 이동 + 벽 충돌 + 실제 이동량 기록. 모든 분기가 이걸 거친다.
   vx/vy 는 벽에 막힌 것까지 반영한 값이라, 자동 조준이 벽에 붙은 적을 앞질러 쏘지 않는다. */
AF.Enemy.prototype.move = function (g, vx, vy) {
  var px = this.x, py = this.y;
  // 넉백은 속도에 더해지고 빠르게 잦아든다
  this.x += vx + this.kx;
  this.y += vy + this.ky;
  this.kx *= 0.82; this.ky *= 0.82;
  AF.collideWorld(this, g.obstacles);
  this.vx = this.x - px;
  this.vy = this.y - py;
};

/* 적 AI. 종류마다 다른 이동/사격을 하지만 벽 충돌 처리는 공통이다. */
AF.Enemy.prototype.step = function (g) {
  var p = g.player;
  var dx = p.x - this.x, dy = p.y - this.y;
  var dist = Math.hypot(dx, dy) || 1;
  var toP = Math.atan2(dy, dx);
  var sp = this.speedNow();
  var vx = 0, vy = 0;

  this.t += C.STEP;
  // 시야 판정은 비싸니 0.15초마다만 갱신한다
  this.losT -= C.STEP;
  if (this.losT <= 0) { this.canSee = g.hasLOS(this.x, this.y, p.x, p.y); this.losT = 0.15; }
  if (this.slowT > 0) this.slowT -= C.STEP;
  if (this.flash > 0) this.flash -= 0.09;
  if (this.fireT > 0) this.fireT -= C.STEP;

  /* 방이 반드시 끝나게 하는 안전장치.
     원거리 적은 사거리를 지키려다 엄폐물 경계에서 진동하며 영영 안 보이는 자리에
     머물 수 있다. 그러면 플레이어도 못 쏘고 적도 못 쏘는 교착이 된다.
     일정 시간 안 보이면 종류를 불문하고 보일 때까지 다가온다. */
  if (this.canSee) {
    this.blindT = 0;
    // 충분히 붙었을 때만 평소 행동으로. 문턱이 높으면 사선 경계에서 왔다갔다만 한다.
    if (this.commit && dist < 190) this.commit = false;
  } else {
    this.blindT += C.STEP;
    if (this.blindT > 0.8) this.commit = true;
  }

  if (this.commit && this.type !== 'boss') {
    var fdir = g.flowDir(this);
    this.move(g, fdir.x * sp * 1.2, fdir.y * sp * 1.2);
    return;
  }

  switch (this.type) {
    case 'chaser':
    case 'shard':
    case 'splitter': {
      var dir = g.flowDir(this);
      vx = dir.x * sp;
      vy = dir.y * sp;
      break;
    }

    case 'shooter': {
      var want = this.def.range;
      // 엄폐물 뒤에 자리 잡으면 서로 아무것도 못 하는 교착이 된다.
      // 안 보이면 사거리를 무시하고 보일 때까지 다가간다.
      if (!this.canSee || dist > want * 1.1) {
        var sdir = g.flowDir(this);
        var boost = this.canSee ? 1 : 1.15;
        vx = sdir.x * sp * boost; vy = sdir.y * sp * boost;
      }
      else if (dist < want * 0.7) { vx = -dx / dist * sp; vy = -dy / dist * sp; }
      else {
        // 한 방향으로만 계속 돌면 예측 사격에 100% 맞거나 100% 빗나간다.
        // 가끔 방향을 뒤집어 둘 다 아니게 만든다.
        if (this.t > this.strafeFlip) {
          this.orbitDir *= -1;
          this.strafeFlip = this.t + AF.rand(1.2, 2.4);
        }
        vx = -dy / dist * sp * 0.62 * this.orbitDir;
        vy = dx / dist * sp * 0.62 * this.orbitDir;
      }
      if (this.fireT <= 0 && dist < want * 1.3 && this.canSee) {
        this.fireT = this.def.fireCd;
        g.enemyShot(this.x, this.y, toP, this.def.shotDmg * this.dmgMul, this.def.shotSpeed);
      }
      break;
    }

    case 'orbiter': {
      if (!this.canSee) {
        var odir = g.flowDir(this);
        vx = odir.x * sp * 1.15; vy = odir.y * sp * 1.15;
        break;
      }
      var radial = (dist - this.def.orbit) / this.def.orbit;
      var tx = -dy / dist * this.orbitDir + (dx / dist) * radial * 2;
      var ty = dx / dist * this.orbitDir + (dy / dist) * radial * 2;
      var tl = Math.hypot(tx, ty) || 1;
      vx = tx / tl * sp; vy = ty / tl * sp;
      if (this.fireT <= 0) {
        this.fireT = this.def.fireCd;
        for (var k = 0; k < this.def.spread; k++) {
          var off = (k - (this.def.spread - 1) / 2) * 0.28;
          g.enemyShot(this.x, this.y, toP + off, this.def.shotDmg * this.dmgMul, this.def.shotSpeed);
        }
      }
      break;
    }

    case 'charger': {
      this.phaseT -= C.STEP;
      if (this.phase === 'rest') {
        var cdir = g.flowDir(this);
        vx = cdir.x * sp; vy = cdir.y * sp;
        if (this.phaseT <= 0) { this.phase = 'windup'; this.phaseT = this.def.windup; }
      } else if (this.phase === 'windup') {
        this.dashA = toP;                       // 돌진 직전까지만 조준한다
        if (this.phaseT <= 0) {
          this.phase = 'dash'; this.phaseT = this.def.dashTime;
          AF.Audio.dash();
        }
      } else {                                   // dash
        vx = Math.cos(this.dashA) * this.def.dashSpeed;
        vy = Math.sin(this.dashA) * this.def.dashSpeed;
        P.spawn(this.x, this.y, this.def.color, 2, { speed: 1.2, life: 14 });
        if (this.phaseT <= 0) { this.phase = 'rest'; this.phaseT = this.def.restTime; }
      }
      break;
    }

    case 'boss': {
      this.phaseT -= C.STEP;
      if (this.phase === 'rest') {
        var bdir = g.flowDir(this);
        vx = bdir.x * sp; vy = bdir.y * sp;
        if (this.phaseT <= 0) {
          this.phase = 'attack';
          this.phaseT = 0.9;
          this.pattern = (this.pattern + 1) % 3;
          if (this.pattern === 0) {              // 전방위 탄막
            for (var b = 0; b < 14; b++) {
              g.enemyShot(this.x, this.y, (b / 14) * Math.PI * 2 + this.t,
                          this.def.shotDmg * this.dmgMul, this.def.shotSpeed);
            }
          } else if (this.pattern === 1) {       // 부하 소환
            for (var s = 0; s < 3; s++) {
              var sa = Math.random() * Math.PI * 2;
              g.enemies.push(new AF.Enemy('chaser',
                AF.clamp(this.x + Math.cos(sa) * 70, C.X0 + 20, C.X1 - 20),
                AF.clamp(this.y + Math.sin(sa) * 70, C.Y0 + 20, C.Y1 - 20),
                g.plan.hpMul * 0.7, g.plan.dmgMul));
            }
          } else {                                // 조준 3연사
            for (var q = 0; q < 3; q++) {
              g.enemyShot(this.x, this.y, toP + (q - 1) * 0.22,
                          this.def.shotDmg * this.dmgMul, this.def.shotSpeed * 1.3);
            }
          }
        }
      } else {
        if (this.phaseT <= 0) { this.phase = 'rest'; this.phaseT = AF.rand(1.4, 2.2); }
      }
      break;
    }
  }

  this.move(g, vx, vy);
};
