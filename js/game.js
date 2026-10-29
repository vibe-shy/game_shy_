/* 게임 본체: 상태 기계 · 방 진행 · 충돌 · 렌더링. */
var AF = window.AF || (window.AF = {});

AF.Game = (function () {
  var C = AF.C, P = AF.Particles, A = AF.Audio, I = AF.Input, COL = AF.COLOR;
  var rr = AF.rr, pad = AF.pad;

  var STATE = {
    TITLE: 'TITLE',
    PLAYING: 'PLAYING',
    PAUSED: 'PAUSED',
    UPGRADE: 'UPGRADE',
    DEAD: 'DEAD'
  };

  var BEST_KEY = 'af_best_v1';
  var MODE_KEY = 'af_mode_v1';

  function load(k, dflt) { try { var v = localStorage.getItem(k); return v === null ? dflt : v; } catch (e) { return dflt; } }
  function save(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { /* 사생활 보호 모드 */ } }

  function Game(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = STATE.TITLE;

    this.best = parseInt(load(BEST_KEY, '0'), 10) || 0;
    this.savedBest = this.best;
    this.mode = load(MODE_KEY, 'auto') === 'manual' ? 'manual' : 'auto';

    this.time = 0;
    this.shake = 0;
    this.flash = 0;
    this.flashColor = '#ffffff';

    this.player = new AF.Player(C.X0 + C.SIZE / 2, C.Y1 - 90);
    this.enemies = [];
    this.shots = [];
    this.obstacles = [];
    this.taken = {};          // 능력 id -> 중첩 수
    this.takenOrder = [];
    this.choices = [];
    this.room = 0;
    this.score = 0;
    this.kills = 0;
    this.plan = { hpMul: 1, dmgMul: 1 };
    this.overlayT = 0;
    this.introT = 0;
    this.newBest = false;
    this.pausedByBlur = false;

    this.buildRoom(0);        // 타이틀 뒤에 깔 배경
  }

  // ------------------------------------------------------------- 실행 흐름

  Game.prototype.newRun = function () {
    this.player = new AF.Player(C.X0 + C.SIZE / 2, C.Y1 - 90);
    this.enemies = [];
    this.shots = [];
    this.taken = {};
    this.takenOrder = [];
    this.room = 0;
    this.score = 0;
    this.kills = 0;
    this.newBest = false;
    P.clear();
    this.nextRoom();
    this.state = STATE.PLAYING;
  };

  Game.prototype.nextRoom = function () {
    this.room++;
    this.plan = AF.roomPlan(this.room);
    var layout = this.plan.isBoss ? AF.BOSS_ROOM : (this.room - 1) % (AF.ROOMS.length - 1);
    this.buildRoom(layout);

    this.shots = [];
    this.enemies = [];
    this.player.x = C.X0 + C.SIZE / 2;
    this.player.y = C.Y1 - 90;
    this.player.inv = 1.0;                    // 입장 직후 잠깐 무적
    this.introT = 1.1;

    this.spawnWave();
    if (this.plan.isBoss) A.bossIn();
  };

  Game.prototype.buildRoom = function (idx) {
    var map = AF.ROOMS[idx];
    this.obstacles = [];
    this.blocked = new Uint8Array(C.GRID * C.GRID);
    for (var r = 0; r < map.length; r++) {
      for (var c = 0; c < map[r].length; c++) {
        if (map[r][c] !== '#') continue;
        this.obstacles.push({
          x: C.X0 + c * C.CELL, y: C.Y0 + r * C.CELL, w: C.CELL, h: C.CELL
        });
        this.blocked[r * C.GRID + c] = 1;
      }
    }
    this.flow = null;
    this.flowT = 0;
    this.flowCell = -1;
  };

  Game.prototype.cellOf = function (x, y) {
    var c = AF.clamp(Math.floor((x - C.X0) / C.CELL), 0, C.GRID - 1);
    var r = AF.clamp(Math.floor((y - C.Y0) / C.CELL), 0, C.GRID - 1);
    return r * C.GRID + c;
  };

  /* 플레이어 칸에서 너비 우선 탐색으로 거리장을 만든다.
     국소 조향만으로는 폭이 넓은 벽을 돌아갈 수 없어 적이 벽에 붙어 멈춘다.
     격자가 12x12(144칸)뿐이라 매번 새로 구해도 부담이 없다. */
  Game.prototype.updateFlow = function () {
    var G = C.GRID, n = G * G;
    var start = this.cellOf(this.player.x, this.player.y);
    // 플레이어가 같은 칸에 있고 얼마 지나지 않았으면 재사용한다
    if (this.flow && this.flowCell === start && this.flowT > 0) { this.flowT -= C.STEP; return; }

    var dist = this.flow && this.flow.length === n ? this.flow : new Int16Array(n);
    dist.fill(-1);
    var queue = new Int16Array(n);
    var head = 0, tail = 0;
    dist[start] = 0;
    queue[tail++] = start;

    while (head < tail) {
      var cur = queue[head++];
      var cr = (cur / G) | 0, cc = cur % G;
      var d = dist[cur] + 1;
      for (var k = 0; k < 4; k++) {
        var nr = cr + (k === 0 ? -1 : k === 1 ? 1 : 0);
        var nc = cc + (k === 2 ? -1 : k === 3 ? 1 : 0);
        if (nr < 0 || nr >= G || nc < 0 || nc >= G) continue;
        var ni = nr * G + nc;
        if (this.blocked[ni] || dist[ni] !== -1) continue;
        dist[ni] = d;
        queue[tail++] = ni;
      }
    }
    this.flow = dist;
    this.flowCell = start;
    this.flowT = 0.15;
  };

  /* 적이 나아갈 방향.
     플레이어가 보이면 그냥 직진한다(격자를 따라가면 움직임이 각져 보인다).
     안 보이면 거리장을 따라 내려간다. */
  Game.prototype.flowDir = function (e) {
    var p = this.player;
    if (e.canSee || !this.flow) {
      var dx = p.x - e.x, dy = p.y - e.y;
      var d = Math.hypot(dx, dy) || 1;
      return { x: dx / d, y: dy / d };
    }
    var G = C.GRID;
    var cur = this.cellOf(e.x, e.y);
    var cr = (cur / G) | 0, cc = cur % G;
    var best = -1, bd = this.flow[cur] >= 0 ? this.flow[cur] : 1e9;

    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        var nr = cr + dr, nc = cc + dc;
        if (nr < 0 || nr >= G || nc < 0 || nc >= G) continue;
        var ni = nr * G + nc;
        if (this.blocked[ni] || this.flow[ni] < 0) continue;
        // 대각선은 양옆이 다 뚫려 있을 때만 (모서리를 파고들지 않도록)
        if (dr && dc && (this.blocked[cr * G + nc] || this.blocked[nr * G + cc])) continue;
        if (this.flow[ni] < bd) { bd = this.flow[ni]; best = ni; }
      }
    }
    if (best < 0) {
      var ex = p.x - e.x, ey = p.y - e.y;
      var el = Math.hypot(ex, ey) || 1;
      return { x: ex / el, y: ey / el };
    }
    var tx = C.X0 + (best % G) * C.CELL + C.CELL / 2;
    var ty = C.Y0 + (((best / G) | 0)) * C.CELL + C.CELL / 2;
    var vx = tx - e.x, vy = ty - e.y;
    var vl = Math.hypot(vx, vy) || 1;
    return { x: vx / vl, y: vy / vl };
  };

  /* 적은 플레이어에게서 충분히 떨어지고 엄폐물과 겹치지 않는 자리에 놓는다. */
  Game.prototype.findSpawn = function (radius) {
    var p = this.player;
    for (var tries = 0; tries < 120; tries++) {
      var x = AF.rand(C.X0 + radius + 8, C.X1 - radius - 8);
      var y = AF.rand(C.Y0 + radius + 8, C.Y1 - radius - 8);
      if (AF.dist2(x, y, p.x, p.y) < 210 * 210) continue;
      var blocked = false;
      for (var i = 0; i < this.obstacles.length; i++) {
        var o = this.obstacles[i];
        if (AF.circleRect(x, y, radius + 6, o.x, o.y, o.w, o.h)) { blocked = true; break; }
      }
      if (!blocked) return { x: x, y: y };
    }
    return { x: C.X0 + C.SIZE / 2, y: C.Y0 + 90 };   // 최후의 수단
  };

  Game.prototype.spawnWave = function () {
    for (var i = 0; i < this.plan.spawns.length; i++) {
      var type = this.plan.spawns[i][0];
      var def = AF.ENEMIES[type];
      var pos = this.findSpawn(def.r);
      var e = new AF.Enemy(type, pos.x, pos.y, this.plan.hpMul, this.plan.dmgMul);
      this.enemies.push(e);
      P.spawn(pos.x, pos.y, def.color, 12, { speed: 2.6, life: 24 });
    }
  };

  Game.prototype.addScore = function (n) {
    this.score += n;
    if (this.score > this.best) { this.best = this.score; this.newBest = true; }
  };

  Game.prototype.persistBest = function () {
    if (this.best > this.savedBest) { save(BEST_KEY, this.best); this.savedBest = this.best; }
  };

  // ------------------------------------------------------------- 업데이트

  Game.prototype.step = function () {
    this.time += C.STEP;
    if (this.shake > 0.2) this.shake *= 0.86; else this.shake = 0;
    if (this.flash > 0) this.flash -= 0.05;
    this.overlayT += C.STEP;

    if (I.hit('KeyM')) A.toggleMute();

    switch (this.state) {
      case STATE.TITLE:
        // 좌우로 모드 전환, 확인으로 시작
        if (I.hit('ArrowLeft') || I.hit('KeyA')) this.setMode('auto');
        if (I.hit('ArrowRight') || I.hit('KeyD')) this.setMode('manual');
        if (I.pointer.tapped) {
          var half = I.pointer.y > C.Y0 + 250 && I.pointer.y < C.Y0 + 350;
          if (half) { this.setMode(I.pointer.x < C.W / 2 ? 'auto' : 'manual'); break; }
        }
        if (I.hit('Space') || I.hit('Enter') ||
            (I.pointer.tapped && I.pointer.y > C.Y0 + 380)) { this.newRun(); }
        break;

      case STATE.PLAYING:
        if (I.hit('KeyP') || I.hit('Escape')) { this.pause(false); break; }
        this.stepPlay();
        break;

      case STATE.PAUSED:
        if (I.hit('KeyP') || I.hit('Escape') || I.confirm()) {
          this.state = STATE.PLAYING;
          this.pausedByBlur = false;
        }
        break;

      case STATE.UPGRADE:
        this.stepUpgrade();
        break;

      case STATE.DEAD:
        if (this.overlayT > 0.8 && I.confirm()) { this.state = STATE.TITLE; this.buildRoom(0); }
        break;
    }

    P.update();
  };

  /* byBlur: 포커스를 잃어 멈춘 경우. 안내 문구가 달라진다. */
  Game.prototype.pause = function (byBlur) {
    if (this.state !== STATE.PLAYING) return;
    this.pausedByBlur = !!byBlur;
    this.state = STATE.PAUSED;
  };

  Game.prototype.setMode = function (m) {
    if (this.mode === m) return;
    this.mode = m;
    save(MODE_KEY, m);
    A.pickup();
  };

  Game.prototype.stepPlay = function () {
    var p = this.player, s = p.stats, i;
    if (this.introT > 0) this.introT -= C.STEP;
    if (p.inv > 0) p.inv -= C.STEP;
    if (p.hurtFlash > 0) p.hurtFlash -= 0.06;
    if (p.fireT > 0) p.fireT -= C.STEP;

    // ---- 이동
    var mv = I.moveVec();
    var moving = mv.len > 0.15;
    p.x += mv.x * s.moveSpeed;
    p.y += mv.y * s.moveSpeed;
    AF.collideWorld(p, this.obstacles);
    if (moving) { p.stillT = 0; p.walkT += C.STEP; } else { p.stillT += C.STEP; }

    // ---- 조준과 발사: 모드가 여기서 갈린다
    var wantFire = false;
    if (this.mode === 'auto') {
      // 궁수의 전설식 — 멈춰 있을 때만 쏜다.
      // 대상은 "사선이 트인" 가장 가까운 적. 벽 뒤를 겨누면 화살이 전부 엄폐물에 박힌다.
      if (p.targetT > 0) p.targetT -= C.STEP;
      var t = this.autoTarget(p);
      if (t) p.aim = this.leadAim(p, t);
      else if (moving) p.aim = Math.atan2(mv.y, mv.x);
      wantFire = !moving && !!t;
    } else {
      // 브롤스타즈식 — 움직이면서도 쏜다. 마우스 또는 오른쪽 스틱으로 조준.
      if (I.aimStick.active && (I.aimStick.dx || I.aimStick.dy)) {
        p.aim = Math.atan2(I.aimStick.dy, I.aimStick.dx);
        wantFire = true;
      } else if (I.pointer.active) {
        p.aim = Math.atan2(I.pointer.y - p.y, I.pointer.x - p.x);
        wantFire = I.pointer.down || I.held('Space');
      }
      if (I.held('Space')) wantFire = true;
    }

    if (wantFire && p.fireT <= 0 && this.enemies.length > 0) {
      this.fire();
      p.fireT = s.fireCd;
    }

    // ---- 투사체
    for (i = this.shots.length - 1; i >= 0; i--) {
      var sh = this.shots[i];
      sh.step(this);
      if (!sh.dead) this.hitCheck(sh);
      if (sh.dead) this.shots.splice(i, 1);
    }

    // ---- 적
    this.updateFlow();
    for (i = this.enemies.length - 1; i >= 0; i--) {
      var e = this.enemies[i];
      if (e.dead) { this.enemies.splice(i, 1); continue; }
      e.step(this);
      // 접촉 피해
      if (AF.dist2(e.x, e.y, p.x, p.y) < (e.r + p.r) * (e.r + p.r)) {
        p.hurt(e.def.contact * e.dmgMul, this);
      }
    }

    // ---- 적끼리 겹치지 않게 살짝 밀어낸다 (한 점에 뭉쳐 보이는 것 방지)
    this.separate();

    if (!p.alive()) return;

    if (this.enemies.length === 0 && this.introT <= 0) this.roomClear();
  };

  Game.prototype.separate = function () {
    var es = this.enemies;
    for (var i = 0; i < es.length; i++) {
      for (var j = i + 1; j < es.length; j++) {
        var a = es[i], b = es[j];
        var dx = b.x - a.x, dy = b.y - a.y;
        var min = a.r + b.r;
        var d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 0.001) continue;
        var d = Math.sqrt(d2);
        var push = (min - d) * 0.5;
        var nx = dx / d, ny = dy / d;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
      }
    }
  };

  Game.prototype.fire = function () {
    var p = this.player, s = p.stats;
    var modeMul = this.mode === 'auto' ? 1.15 : 1.0;   // 멈춰야 쏘는 위험에 대한 보상

    var angles = [];
    var n = s.multishot;
    for (var i = 0; i < n; i++) angles.push(p.aim + (i - (n - 1) / 2) * 0.20);
    if (s.rearShot) angles.push(p.aim + Math.PI);
    if (s.sideShot) { angles.push(p.aim + Math.PI / 2); angles.push(p.aim - Math.PI / 2); }

    for (var k = 0; k < angles.length; k++) {
      var crit = Math.random() < s.critChance;
      var sh = new AF.Shot(
        p.x + Math.cos(angles[k]) * (p.r + 4),
        p.y + Math.sin(angles[k]) * (p.r + 4),
        angles[k],
        {
          friendly: true, speed: s.projSpeed, size: s.projSize,
          dmg: s.damage * modeMul * (crit ? 2 : 1), crit: crit,
          pierce: s.pierce, bounce: s.bounce, homing: s.homing,
          slow: s.slow, knockback: s.knockback,
          color: crit ? '#fff2c4' : COL.arrow, range: AF.PLAYER.projRange
        }
      );
      this.shots.push(sh);
    }
    A.shoot();
    P.spawn(p.x + Math.cos(p.aim) * 14, p.y + Math.sin(p.aim) * 14, COL.arrow, 3,
            { dir: p.aim, spread: 0.7, speed: 1.6, life: 10 });
  };

  Game.prototype.enemyShot = function (x, y, angle, dmg, speed) {
    this.shots.push(new AF.Shot(x, y, angle, {
      friendly: false, speed: speed, size: 6, dmg: dmg, color: COL.enemyShot, range: 1500
    }));
    A.enemyShot();
  };

  /* 두 점 사이가 엄폐물로 막혔는지. 선분을 일정 간격으로 찍어 본다.
     정확한 선분-사각형 교차보다 싸고, 이 격자 크기에서는 충분히 정확하다. */
  Game.prototype.hasLOS = function (x1, y1, x2, y2) {
    if (!this.obstacles.length) return true;
    var dx = x2 - x1, dy = y2 - y1;
    var steps = Math.ceil(Math.hypot(dx, dy) / 18);
    for (var s = 1; s < steps; s++) {
      var t = s / steps;
      var px = x1 + dx * t, py = y1 + dy * t;
      for (var i = 0; i < this.obstacles.length; i++) {
        var o = this.obstacles[i];
        if (px >= o.x && px <= o.x + o.w && py >= o.y && py <= o.y + o.h) return false;
      }
    }
    return true;
  };

  /* 자동 조준 대상. 사선이 트인 적 중 가장 가까운 쪽을 고르고,
     전부 막혀 있으면 그냥 가장 가까운 적을 겨눈다(가만히 서 있는 것보다 낫다).

     매 프레임 다시 고르면 조준이 떨리고 계산도 아까우니 잠깐 붙잡아 둔다. */
  Game.prototype.autoTarget = function (p) {
    if (p.target && !p.target.dead && p.targetT > 0) return p.target;

    var best = null, bd = Infinity, fallback = null, fd = Infinity;
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (e.dead) continue;
      var d = AF.dist2(p.x, p.y, e.x, e.y);
      if (d < fd) { fd = d; fallback = e; }
      if (d < bd && this.hasLOS(p.x, p.y, e.x, e.y)) { bd = d; best = e; }
    }
    p.target = best || fallback;
    p.targetT = 0.12;
    return p.target;
  };

  /* 예측 사격. 화살이 날아가는 동안 적이 움직이므로 도착 지점을 겨눈다.
     이게 없으면 옆으로 도는 적(사수)에게 영원히 빗나가 방이 끝나지 않는다. */
  Game.prototype.leadAim = function (p, e) {
    var dx = e.x - p.x, dy = e.y - p.y;
    var steps = Math.hypot(dx, dy) / Math.max(1, p.stats.projSpeed);
    steps = Math.min(steps, 45);   // 너무 멀리 내다보면 오히려 빗나간다
    var tx = e.x + (e.vx || 0) * steps;
    var ty = e.y + (e.vy || 0) * steps;
    return Math.atan2(ty - p.y, tx - p.x);
  };

  Game.prototype.nearestEnemy = function (x, y, maxDist) {
    var best = null, bd = maxDist * maxDist;
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (e.dead) continue;
      var d = AF.dist2(x, y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  };

  Game.prototype.hitCheck = function (sh) {
    var p = this.player;

    if (!sh.friendly) {
      var rr2 = (sh.r + p.r) * (sh.r + p.r);
      if (AF.dist2(sh.x, sh.y, p.x, p.y) < rr2) {
        if (p.hurt(sh.dmg, this)) sh.dead = true;
        else if (p.inv > 0) sh.dead = true;   // 무적 중이라도 탄은 사라진다
      }
      return;
    }

    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (e.dead) continue;
      var rad = sh.r + e.r;
      if (AF.dist2(sh.x, sh.y, e.x, e.y) > rad * rad) continue;
      if (sh.hitIds && sh.hitIds.indexOf(e.id) !== -1) continue;

      e.hurt(sh.dmg, this, sh.crit);
      if (sh.slow > 0) e.slowT = 1.6;
      var kb = 3.2 * sh.knockback / Math.max(1, e.r / 13);
      e.kx += Math.cos(sh.a) * kb;
      e.ky += Math.sin(sh.a) * kb;

      if (p.stats.lifesteal > 0 && p.hp > 0) {
        var heal = sh.dmg * p.stats.lifesteal;
        p.hp = Math.min(p.stats.maxHp, p.hp + heal);
      }

      if (sh.pierce > 0) {
        sh.pierce--;
        if (!sh.hitIds) sh.hitIds = [];
        sh.hitIds.push(e.id);
      } else {
        sh.dead = true;
      }
      break;
    }
  };

  // ------------------------------------------------------------- 방 클리어

  Game.prototype.roomClear = function () {
    var bonus = 50 + this.room * 25;
    this.addScore(bonus);
    A.roomClear();

    if (this.plan.isBoss) {
      // 보스를 잡으면 숨을 돌릴 만큼 회복시킨다
      var heal = this.player.stats.maxHp * 0.3;
      this.player.hp = Math.min(this.player.stats.maxHp, this.player.hp + heal);
      P.float(this.player.x, this.player.y - 30, '+' + Math.round(heal), COL.hp, true);
      A.heal();
    }

    this.persistBest();
    this.choices = this.rollUpgrades(3);
    this.overlayT = 0;
    this.state = STATE.UPGRADE;
  };

  /* 상한에 닿지 않았고 조건을 만족하는 능력 중 가중치로 n 개를 겹치지 않게 뽑는다. */
  Game.prototype.rollUpgrades = function (n) {
    var self = this;
    var pool = AF.UPGRADES.filter(function (u) {
      if ((self.taken[u.id] || 0) >= u.max) return false;
      if (u.need && !u.need(self)) return false;
      return true;
    });
    var out = [];
    while (out.length < n && pool.length) {
      var table = pool.map(function (u) { return [u, u.weight]; });
      var picked = AF.weighted(table);
      out.push(picked);
      pool = pool.filter(function (u) { return u !== picked; });
    }
    return out;
  };

  Game.prototype.cardRects = function () {
    var w = 176, h = 232, gap = 18;
    var total = this.choices.length * w + (this.choices.length - 1) * gap;
    var x0 = C.W / 2 - total / 2;
    var y = C.Y0 + C.SIZE / 2 - h / 2 + 20;
    var out = [];
    for (var i = 0; i < this.choices.length; i++) {
      out.push({ x: x0 + i * (w + gap), y: y, w: w, h: h });
    }
    return out;
  };

  Game.prototype.stepUpgrade = function () {
    var rects = this.cardRects();
    var pick = -1;
    if (I.hit('Digit1')) pick = 0;
    if (I.hit('Digit2')) pick = 1;
    if (I.hit('Digit3')) pick = 2;
    if (I.pointer.tapped) {
      for (var i = 0; i < rects.length; i++) {
        var r = rects[i];
        if (I.pointer.x >= r.x && I.pointer.x <= r.x + r.w &&
            I.pointer.y >= r.y && I.pointer.y <= r.y + r.h) { pick = i; break; }
      }
    }
    if (pick < 0 || pick >= this.choices.length) return;

    var u = this.choices[pick];
    u.apply(this.player.stats, this.player);
    this.player.hp = Math.min(this.player.hp, this.player.stats.maxHp);
    this.taken[u.id] = (this.taken[u.id] || 0) + 1;
    if (this.takenOrder.indexOf(u.id) === -1) this.takenOrder.push(u.id);
    A.upgrade();
    this.flash = 0.4;
    this.flashColor = COL.accent;

    this.nextRoom();
    this.state = STATE.PLAYING;
  };

  Game.prototype.onPlayerDeath = function () {
    A.death();
    this.shake = 22;
    this.flash = 0.7;
    this.flashColor = '#ff5a5f';
    this.persistBest();
    this.overlayT = 0;
    this.state = STATE.DEAD;
  };

  // ---------------------------------------------------------------- 렌더

  Game.prototype.render = function () {
    var ctx = this.ctx;
    ctx.save();
    ctx.clearRect(0, 0, C.W, C.H);
    ctx.fillStyle = COL.floor;
    ctx.fillRect(0, 0, C.W, C.H);

    if (this.shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }

    this.drawFloor(ctx);
    this.drawObstacles(ctx);
    this.drawShots(ctx, false);
    this.drawEnemies(ctx);
    if (this.state !== STATE.TITLE) this.drawPlayer(ctx);
    this.drawShots(ctx, true);
    P.draw(ctx);
    ctx.restore();

    this.drawHud(ctx);
    this.drawSticks(ctx);

    if (this.flash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.3, this.flash);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, C.HUD_H, C.W, C.H - C.HUD_H);
      ctx.restore();
    }

    if (this.state === STATE.PLAYING && this.introT > 0) this.drawIntro(ctx);
    if (this.state === STATE.TITLE) this.drawTitle(ctx);
    if (this.state === STATE.PAUSED) {
      // 포커스를 잃어 멈춘 경우엔 "키가 안 먹는" 이유를 알려 준다
      this.drawPanel(ctx, '일시정지',
        this.pausedByBlur
          ? ['키보드 입력이 이 화면으로 오지 않고 있다', '화면을 한 번 클릭하면 이어서 진행된다']
          : ['P · Esc · 화면 클릭으로 계속'],
        this.pausedByBlur ? '화면 클릭' : '');
    }
    if (this.state === STATE.UPGRADE) this.drawUpgrade(ctx);
    if (this.state === STATE.DEAD) this.drawDead(ctx);
  };

  Game.prototype.drawFloor = function (ctx) {
    // 격자 바닥. 스프라이트가 있으면 타일로 깔고, 없으면 두 톤을 번갈아 칠한다.
    // (두 톤을 쓰는 이유는 이동 거리가 눈에 들어오게 하려는 것)
    var tiled = AF.Sprites.has('floor');
    for (var r = 0; r < C.GRID; r++) {
      for (var c = 0; c < C.GRID; c++) {
        var tx = C.X0 + c * C.CELL, ty = C.Y0 + r * C.CELL;
        if (tiled) {
          AF.Sprites.draw(ctx, 'floor', tx + C.CELL / 2, ty + C.CELL / 2, C.CELL);
          // 타일 한 장만으로는 격자 리듬이 죽으니 한 칸 걸러 살짝 어둡게
          if ((r + c) % 2) {
            ctx.fillStyle = 'rgba(0,0,0,0.16)';
            ctx.fillRect(tx, ty, C.CELL, C.CELL);
          }
        } else {
          ctx.fillStyle = (r + c) % 2 ? COL.floor : COL.floorAlt;
          ctx.fillRect(tx, ty, C.CELL, C.CELL);
        }
      }
    }
    // 방 테두리
    ctx.strokeStyle = 'rgba(255,179,71,0.22)';
    ctx.lineWidth = 2;
    ctx.strokeRect(C.X0 - 1, C.Y0 - 1, C.SIZE + 2, C.SIZE + 2);

    var g = ctx.createRadialGradient(C.X0 + C.SIZE / 2, C.Y0 + C.SIZE / 2, 40,
                                     C.X0 + C.SIZE / 2, C.Y0 + C.SIZE / 2, C.SIZE * 0.75);
    g.addColorStop(0, 'rgba(255,170,90,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(C.X0, C.Y0, C.SIZE, C.SIZE);
  };

  Game.prototype.drawObstacles = function (ctx) {
    for (var i = 0; i < this.obstacles.length; i++) {
      var o = this.obstacles[i];
      if (AF.Sprites.draw(ctx, 'wall', o.x + o.w / 2, o.y + o.h / 2, o.w)) continue;
      ctx.fillStyle = COL.wall;
      rr(ctx, o.x + 2, o.y + 2, o.w - 4, o.h - 4, 6);
      ctx.fill();
      // 윗면을 밝게 해 입체로 보이게
      ctx.fillStyle = COL.wallTop;
      rr(ctx, o.x + 2, o.y + 2, o.w - 4, (o.h - 4) * 0.42, 6);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      rr(ctx, o.x + 2, o.y + 2, o.w - 4, o.h - 4, 6);
      ctx.stroke();
    }
  };

  Game.prototype.drawShots = function (ctx, friendly) {
    for (var i = 0; i < this.shots.length; i++) {
      var s = this.shots[i];
      if (!!s.friendly !== friendly) continue;

      // 화살은 길쭉해서 스프라이트를 반지름의 6배로 그린다(촉과 깃이 다 들어가게)
      var key = s.friendly ? 'arrow' : 'bolt';
      if (AF.Sprites.draw(ctx, key, s.x, s.y, s.r * (s.friendly ? 6 : 3.4), s.a)) continue;

      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.a);
      if (s.friendly) {
        // 화살: 길쭉한 몸통 + 밝은 촉
        ctx.shadowColor = s.color; ctx.shadowBlur = 8;
        ctx.fillStyle = s.color;
        rr(ctx, -s.r * 2.2, -s.r * 0.34, s.r * 3.4, s.r * 0.68, s.r * 0.34);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(s.r * 1.9, 0);
        ctx.lineTo(s.r * 0.7, -s.r * 0.8);
        ctx.lineTo(s.r * 0.7, s.r * 0.8);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.shadowColor = s.color; ctx.shadowBlur = 10;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(0, 0, s.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath();
        ctx.arc(-s.r * 0.25, -s.r * 0.25, s.r * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  };

  Game.prototype.drawEnemies = function (ctx) {
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      var d = e.def;

      // 돌진병이 힘을 모을 때는 조준선을 보여 준다 — 안 보이면 불공평하다
      if (e.type === 'charger' && e.phase === 'windup') {
        ctx.save();
        ctx.globalAlpha = 0.28 + Math.sin(this.time * 26) * 0.2;
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 3;
        ctx.setLineDash([9, 7]);
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.x + Math.cos(e.dashA) * 300, e.y + Math.sin(e.dashA) * 300);
        ctx.stroke();
        ctx.restore();
      }

      var spriteKey = AF.spriteKeyFor(e.type);
      if (AF.Sprites.has(spriteKey)) {
        var toP = Math.atan2(this.player.y - e.y, this.player.x - e.x);
        var size = e.r * 2 * (AF.SPRITES[spriteKey].scale || 2.15);

        // 둔화는 색을 바꾸는 대신 발밑 링으로 알린다.
        // 스프라이트를 물들이려면 오프스크린 캔버스가 필요한데, 그만한 값이 없다.
        if (e.slowT > 0) {
          ctx.save();
          ctx.strokeStyle = 'rgba(126,200,255,0.75)';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.r + 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        AF.Sprites.draw(ctx, spriteKey, e.x, e.y, size, toP, Math.cos(toP) < 0);
        if (e.flash > 0) AF.Sprites.flash(ctx, spriteKey, e.x, e.y, size, e.flash, toP, Math.cos(toP) < 0);
        this.drawEnemyBar(ctx, e);
        continue;
      }

      ctx.save();
      ctx.translate(e.x, e.y);
      var wob = d.shape === 'blob' ? 1 + Math.sin(e.t * 6) * 0.06 : 1;
      ctx.scale(wob, 2 - wob);

      ctx.shadowColor = d.color;
      ctx.shadowBlur = d.shape === 'boss' ? 26 : 10;
      ctx.fillStyle = e.slowT > 0 ? '#7ec8ff' : d.color;
      ctx.strokeStyle = d.dark;
      ctx.lineWidth = 3;

      var r = e.r;
      ctx.beginPath();
      if (d.shape === 'tri') {
        var a0 = Math.atan2(this.player.y - e.y, this.player.x - e.x);
        for (var k = 0; k < 3; k++) {
          var ang = a0 + k * (Math.PI * 2 / 3);
          var px = Math.cos(ang) * r * (k === 0 ? 1.25 : 1);
          var py = Math.sin(ang) * r * (k === 0 ? 1.25 : 1);
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
      } else if (d.shape === 'square') {
        var q = r * 0.88;
        ctx.rect(-q, -q, q * 2, q * 2);
      } else if (d.shape === 'diamond') {
        ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath();
      } else if (d.shape === 'boss') {
        for (var b = 0; b < 6; b++) {
          var ba = (b / 6) * Math.PI * 2 + e.t * 0.4;
          var bx = Math.cos(ba) * r, by = Math.sin(ba) * r;
          if (b === 0) ctx.moveTo(bx, by); else ctx.lineTo(bx, by);
        }
        ctx.closePath();
      } else {
        ctx.arc(0, 0, r, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();

      if (e.flash > 0) {
        ctx.globalAlpha = e.flash * 0.85;
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      this.drawEnemyBar(ctx, e);
    }
  };

  /* 피해를 입은 적만 체력 막대를 보여 준다 (평소엔 화면이 지저분해진다).
     보스는 화면 위쪽에 따로 큰 막대가 있으니 생략. */
  Game.prototype.drawEnemyBar = function (ctx, e) {
    if (e.hp >= e.maxHp || e.def.shape === 'boss') return;
    var bw = e.r * 2.2, bx = e.x - bw / 2, by = e.y - e.r - 11;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx, by, bw, 4);
    ctx.fillStyle = e.def.color;
    ctx.fillRect(bx, by, bw * (e.hp / e.maxHp), 4);
  };

  Game.prototype.drawPlayer = function (ctx) {
    var p = this.player;
    if (p.hp <= 0) return;

    // 무적 시간에는 깜빡인다
    var blink = p.inv > 0 && Math.floor(this.time * 20) % 2 === 0;
    ctx.save();
    ctx.globalAlpha = blink ? 0.45 : 1;

    // 자동 발사 모드에서 멈춰 있으면 발밑에 링을 띄워 "쏘는 중"을 알린다
    if (this.mode === 'auto' && p.stillT > 0.05 && this.enemies.length) {
      ctx.strokeStyle = 'rgba(255,212,121,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 8 + Math.sin(this.time * 9) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (AF.Sprites.has('player')) {
      var psize = p.r * 2 * (AF.SPRITES.player.scale || 2.15);
      AF.Sprites.draw(ctx, 'player', p.x, p.y, psize, p.aim, Math.cos(p.aim) < 0);
      ctx.restore();
      if (p.hurtFlash > 0) {
        AF.Sprites.flash(ctx, 'player', p.x, p.y, psize, p.hurtFlash, p.aim, Math.cos(p.aim) < 0);
      }
      return;
    }

    ctx.translate(p.x, p.y);
    ctx.shadowColor = COL.player;
    ctx.shadowBlur = 16;
    ctx.fillStyle = COL.player;
    ctx.beginPath();
    ctx.arc(0, 0, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = COL.playerIn;
    ctx.beginPath();
    ctx.arc(0, 0, p.r * 0.5, 0, Math.PI * 2);
    ctx.fill();

    // 활: 조준 방향으로 호를 그린다
    ctx.rotate(p.aim);
    ctx.strokeStyle = COL.player;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(p.r * 0.5, 0, p.r * 0.95, -1.05, 1.05);
    ctx.stroke();
    ctx.restore();

    if (p.hurtFlash > 0) {
      ctx.save();
      ctx.globalAlpha = p.hurtFlash * 0.7;
      ctx.fillStyle = '#ff5a5f';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };

  Game.prototype.drawSticks = function (ctx) {
    var sticks = [I.moveStick, I.aimStick];
    for (var i = 0; i < sticks.length; i++) {
      var st = sticks[i];
      if (!st.active) continue;
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = i === 0 ? COL.accent : COL.enemyShot;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(st.ox, st.oy, I.STICK_R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = i === 0 ? COL.accent : COL.enemyShot;
      ctx.beginPath();
      ctx.arc(st.ox + st.dx * I.STICK_R, st.oy + st.dy * I.STICK_R, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };

  // ------------------------------------------------------------------ HUD

  Game.prototype.drawHud = function (ctx) {
    var p = this.player, s = p.stats;
    ctx.save();
    ctx.fillStyle = 'rgba(12,10,18,0.94)';
    ctx.fillRect(0, 0, C.W, C.HUD_H);

    // 체력 막대
    var bw = 258, bx = 20, by = 20;
    var ratio = AF.clamp(p.hp / s.maxHp, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    rr(ctx, bx, by, bw, 20, 10); ctx.fill();
    ctx.fillStyle = ratio > 0.3 ? COL.hp : COL.hpLow;
    rr(ctx, bx, by, Math.max(6, bw * ratio), 20, 10); ctx.fill();
    ctx.font = AF.font(12, 'bold');
    ctx.fillStyle = '#0b0a10';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.ceil(p.hp) + ' / ' + Math.round(s.maxHp), bx + 10, by + 11);

    // 획득한 능력을 아이콘으로 나열
    ctx.textAlign = 'left';
    ctx.font = AF.font(13);
    var ix = bx, iy = by + 32;
    for (var i = 0; i < this.takenOrder.length && i < 14; i++) {
      var id = this.takenOrder[i];
      var u = null;
      for (var j = 0; j < AF.UPGRADES.length; j++) if (AF.UPGRADES[j].id === id) u = AF.UPGRADES[j];
      if (!u) continue;
      var n = this.taken[id];
      ctx.fillStyle = 'rgba(255,179,71,0.16)';
      rr(ctx, ix, iy, n > 1 ? 30 : 22, 18, 5); ctx.fill();
      ctx.fillStyle = COL.accent;
      ctx.fillText(u.icon + (n > 1 ? n : ''), ix + 5, iy + 10);
      ix += (n > 1 ? 34 : 26);
    }

    // 방 / 처치 / 점수
    ctx.textAlign = 'right';
    ctx.font = AF.font(11);
    ctx.fillStyle = COL.inkDim;
    ctx.fillText('방', C.W - 268, 22);
    ctx.fillText('처치', C.W - 186, 22);
    ctx.fillText('점수', C.W - 20, 22);

    ctx.font = AF.font(24, 'bold');
    ctx.fillStyle = this.plan && this.plan.isBoss ? COL.hpLow : '#f0e6dc';
    ctx.fillText(String(this.room), C.W - 268, 46);
    ctx.fillStyle = '#f0e6dc';
    ctx.fillText(String(this.kills), C.W - 186, 46);
    ctx.fillStyle = this.newBest ? COL.accent : '#f0e6dc';
    ctx.fillText(pad(this.score, 5), C.W - 20, 46);

    ctx.font = AF.font(10);
    ctx.fillStyle = COL.inkDim;
    ctx.textAlign = 'right';
    ctx.fillText('최고 ' + pad(this.best, 5), C.W - 20, 62);

    ctx.textAlign = 'left';
    ctx.fillStyle = COL.inkDim;
    ctx.fillText(this.mode === 'auto' ? '자동 발사' : '수동 조준', bx, 12);
    if (A.isMuted()) ctx.fillText('음소거', bx + 70, 12);
    ctx.restore();

    // 보스 체력은 화면 위쪽에 크게
    var boss = null;
    for (var b = 0; b < this.enemies.length; b++) if (this.enemies[b].type === 'boss') boss = this.enemies[b];
    if (boss) {
      ctx.save();
      var w2 = C.SIZE - 80, x2 = C.X0 + 40, y2 = C.Y0 + 12;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      rr(ctx, x2, y2, w2, 14, 7); ctx.fill();
      ctx.fillStyle = COL.hpLow;
      rr(ctx, x2, y2, Math.max(4, w2 * (boss.hp / boss.maxHp)), 14, 7); ctx.fill();
      ctx.font = AF.font(11, 'bold');
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('수호자', C.W / 2, y2 + 7);
      ctx.restore();
    }
  };

  Game.prototype.drawIntro = function (ctx) {
    var a = Math.min(1, this.introT / 0.5);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.font = AF.font(40, 'bold');
    ctx.fillStyle = this.plan.isBoss ? COL.hpLow : COL.accent;
    ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 20;
    ctx.fillText(this.plan.isBoss ? '보스' : '방 ' + this.room, C.W / 2, C.Y0 + C.SIZE / 2);
    ctx.restore();
  };

  // -------------------------------------------------------------- 오버레이

  Game.prototype.dim = function (ctx, alpha) {
    ctx.fillStyle = 'rgba(8,6,14,' + alpha + ')';
    ctx.fillRect(0, C.HUD_H, C.W, C.H - C.HUD_H);
  };

  Game.prototype.drawPanel = function (ctx, title, lines, hint, color) {
    this.dim(ctx, 0.82);
    var cy = C.Y0 + C.SIZE * 0.4;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = color || COL.accent;
    ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 22;
    ctx.font = AF.font(44, 'bold');
    ctx.fillText(title, C.W / 2, cy);
    ctx.shadowBlur = 0;
    ctx.font = AF.font(16);
    ctx.fillStyle = COL.ink;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i]) ctx.fillText(lines[i], C.W / 2, cy + 44 + i * 26);
    }
    if (hint) {
      ctx.globalAlpha = 0.55 + Math.sin(this.time * 4) * 0.35;
      ctx.font = AF.font(15, 'bold');
      ctx.fillStyle = '#f0e6dc';
      ctx.fillText(hint, C.W / 2, cy + 60 + lines.length * 26 + 16);
    }
    ctx.restore();
  };

  Game.prototype.drawTitle = function (ctx) {
    this.dim(ctx, 0.84);
    var ctxW = C.W / 2;
    ctx.save();
    ctx.textAlign = 'center';

    ctx.fillStyle = COL.accent;
    ctx.shadowColor = COL.accent; ctx.shadowBlur = 26;
    ctx.font = AF.font(58, 'bold');
    ctx.fillText('ARROWFALL', ctxW, C.Y0 + 150);
    ctx.shadowBlur = 0;

    ctx.font = AF.font(15);
    ctx.fillStyle = COL.ink;
    ctx.fillText('방을 하나씩 돌파하며 능력을 쌓는 로그라이트', ctxW, C.Y0 + 186);
    ctx.fillText('5방마다 보스가 기다린다', ctxW, C.Y0 + 210);

    // 조작 모드 선택
    ctx.font = AF.font(12);
    ctx.fillStyle = COL.inkDim;
    ctx.fillText('조작 방식', ctxW, C.Y0 + 244);

    var modes = [
      { id: 'auto', name: '자동 발사', sub: '멈추면 자동으로 쏜다', bonus: '피해 +15%' },
      { id: 'manual', name: '수동 조준', sub: '움직이며 직접 조준', bonus: '자유로운 조준' }
    ];
    for (var i = 0; i < 2; i++) {
      var m = modes[i];
      var w = 208, h = 88, gap = 16;
      var x = ctxW - (w * 2 + gap) / 2 + i * (w + gap);
      var y = C.Y0 + 258;
      var on = this.mode === m.id;
      ctx.fillStyle = on ? 'rgba(255,179,71,0.16)' : 'rgba(255,255,255,0.04)';
      rr(ctx, x, y, w, h, 12); ctx.fill();
      ctx.strokeStyle = on ? COL.accent : 'rgba(255,255,255,0.14)';
      ctx.lineWidth = on ? 2.5 : 1.5;
      rr(ctx, x, y, w, h, 12); ctx.stroke();

      ctx.fillStyle = on ? COL.accent : COL.ink;
      ctx.font = AF.font(19, 'bold');
      ctx.fillText(m.name, x + w / 2, y + 32);
      ctx.font = AF.font(12);
      ctx.fillStyle = COL.inkDim;
      ctx.fillText(m.sub, x + w / 2, y + 54);
      ctx.fillStyle = on ? COL.accent : COL.inkDim;
      ctx.fillText(m.bonus, x + w / 2, y + 73);
    }

    ctx.font = AF.font(12);
    ctx.fillStyle = COL.inkDim;
    ctx.fillText('← → 또는 클릭으로 선택', ctxW, C.Y0 + 368);

    ctx.globalAlpha = 0.55 + Math.sin(this.time * 4) * 0.35;
    ctx.font = AF.font(17, 'bold');
    ctx.fillStyle = '#f0e6dc';
    ctx.fillText('Space · Enter · 아래쪽 터치로 시작', ctxW, C.Y0 + 410);
    ctx.globalAlpha = 1;

    if (this.best > 0) {
      ctx.font = AF.font(13);
      ctx.fillStyle = COL.inkDim;
      ctx.fillText('최고 점수  ' + pad(this.best, 5), ctxW, C.Y0 + 452);
    }
    ctx.restore();
  };

  Game.prototype.drawUpgrade = function (ctx) {
    this.dim(ctx, 0.86);
    var rects = this.cardRects();
    ctx.save();
    ctx.textAlign = 'center';

    ctx.fillStyle = COL.accent;
    ctx.font = AF.font(34, 'bold');
    ctx.shadowColor = COL.accent; ctx.shadowBlur = 18;
    ctx.fillText('방 ' + this.room + ' 돌파', C.W / 2, rects[0].y - 78);
    ctx.shadowBlur = 0;
    ctx.font = AF.font(15);
    ctx.fillStyle = COL.ink;
    ctx.fillText('능력 하나를 고른다', C.W / 2, rects[0].y - 48);

    for (var i = 0; i < this.choices.length; i++) {
      var u = this.choices[i], r = rects[i];
      var hover = I.pointer.x >= r.x && I.pointer.x <= r.x + r.w &&
                  I.pointer.y >= r.y && I.pointer.y <= r.y + r.h;
      var stacks = this.taken[u.id] || 0;

      ctx.fillStyle = hover ? 'rgba(255,179,71,0.18)' : 'rgba(255,255,255,0.05)';
      rr(ctx, r.x, r.y, r.w, r.h, 14); ctx.fill();
      ctx.strokeStyle = hover ? COL.accent : 'rgba(255,255,255,0.16)';
      ctx.lineWidth = hover ? 2.5 : 1.5;
      rr(ctx, r.x, r.y, r.w, r.h, 14); ctx.stroke();

      ctx.fillStyle = COL.accent;
      ctx.font = AF.font(40);
      ctx.fillText(u.icon, r.x + r.w / 2, r.y + 66);

      ctx.fillStyle = '#f0e6dc';
      ctx.font = AF.font(20, 'bold');
      ctx.fillText(u.name, r.x + r.w / 2, r.y + 112);

      ctx.fillStyle = COL.ink;
      ctx.font = AF.font(13);
      wrapText(ctx, u.desc, r.x + r.w / 2, r.y + 142, r.w - 24, 19);

      if (stacks > 0) {
        ctx.fillStyle = COL.inkDim;
        ctx.font = AF.font(12);
        ctx.fillText('보유 ' + stacks + (u.max < 90 ? ' / ' + u.max : ''), r.x + r.w / 2, r.y + r.h - 34);
      }
      ctx.fillStyle = COL.inkDim;
      ctx.font = AF.font(13, 'bold');
      ctx.fillText('[' + (i + 1) + ']', r.x + r.w / 2, r.y + r.h - 14);
    }
    ctx.restore();
  };

  function wrapText(ctx, text, cx, y, maxW, lh) {
    var words = text.split(' '), line = '', lines = [];
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = words[i]; }
      else line = test;
    }
    if (line) lines.push(line);
    for (var j = 0; j < lines.length; j++) ctx.fillText(lines[j], cx, y + j * lh);
  }

  Game.prototype.drawDead = function (ctx) {
    this.drawPanel(ctx, '쓰러졌다', [
      '도달한 방  ' + this.room,
      '처치  ' + this.kills + '  ·  점수  ' + pad(this.score, 5),
      '획득한 능력  ' + this.takenOrder.length + '종',
      this.newBest ? '★ 최고 기록 갱신 ★' : '최고  ' + pad(this.best, 5)
    ], 'Space · 화면 터치로 타이틀', COL.hpLow);
  };

  Game.STATE = STATE;
  return Game;
})();
