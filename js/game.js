/* 게임 본체: 상태 기계 + 고정 스텝 물리 + 렌더링. */
var NB = window.NB || (window.NB = {});

NB.Game = (function () {
  var C = NB.C;
  var P = NB.Particles;
  var A = NB.Audio;
  var I = NB.Input;

  var STATE = {
    TITLE: 'TITLE',
    PLAYING: 'PLAYING',
    PAUSED: 'PAUSED',
    CLEAR: 'CLEAR',
    OVER: 'OVER',
    WIN: 'WIN'
  };

  var HIGH_KEY = 'nb_high_v1';

  function loadHigh() {
    try { return parseInt(localStorage.getItem(HIGH_KEY), 10) || 0; } catch (e) { return 0; }
  }
  function saveHigh(v) {
    try { localStorage.setItem(HIGH_KEY, String(v)); } catch (e) { /* 사생활 보호 모드 등 — 무시 */ }
  }

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function Game(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = STATE.TITLE;
    this.high = loadHigh();
    this.savedHigh = this.high;
    this.time = 0;
    this.shake = 0;
    this.flash = 0;
    this.flashColor = '#ffffff';
    this.aimX = C.W / 2;
    this.paddle = new NB.Paddle();
    this.bricks = [];
    this.balls = [];
    this.powerups = [];
    this.lasers = [];
    this.timers = {};
    this.score = 0;
    this.lives = C.LIVES;
    this.levelIndex = 0;
    this.combo = 0;
    this.laserCd = 0;
    this.overlayT = 0;
    this.levelBonus = 0;
    this.newHigh = false;
    this.loadLevel(0);   // 타이틀 화면 배경으로 1레벨을 미리 깔아 둔다
  }

  // ------------------------------------------------------------ 흐름 제어

  Game.prototype.newGame = function () {
    this.score = 0;
    this.lives = C.LIVES;
    this.levelIndex = 0;
    this.newHigh = false;
    P.clear();
    this.loadLevel(0);
    this.state = STATE.PLAYING;
  };

  Game.prototype.loadLevel = function (i) {
    // 범위를 벗어난 요청은 잘라낸다. 여기서 undefined 를 그대로 쓰면
    // lv.map 에서 터지면서 게임 전체가 멈춘다.
    i = NB.clamp(i | 0, 0, NB.Levels.count - 1);
    var lv = NB.Levels.get(i);
    this.levelIndex = i;
    this.bricks = [];
    for (var r = 0; r < lv.map.length; r++) {
      var row = lv.map[r];
      for (var c = 0; c < row.length; c++) {
        if (row[c] === '.') continue;
        this.bricks.push(new NB.Brick(c, r, row[c]));
      }
    }
    this.baseSpeed = lv.speed;
    this.powerups = [];
    this.lasers = [];
    this.timers = {};
    this.combo = 0;
    this.paddle = new NB.Paddle();
    this.aimX = C.W / 2;
    this.resetBall();
    this.overlayT = 0;
  };

  /* 공을 패들 위에 올려 두고 발사 대기 상태로. */
  Game.prototype.resetBall = function () {
    this.balls = [];
    var b = new NB.Ball(this.paddle.cx(), C.PADDLE_Y - C.BALL_R - 2, this.ballSpeed(), 0);
    b.stuck = true;
    b.stickOffset = 0;
    this.balls.push(b);
  };

  Game.prototype.ballSpeed = function () {
    var s = this.baseSpeed || 6;
    if (this.timers.SLOW > 0) s *= 0.72;
    if (this.timers.FAST > 0) s *= 1.28;
    return s;
  };

  Game.prototype.bricksLeft = function () {
    var n = 0;
    for (var i = 0; i < this.bricks.length; i++) {
      if (this.bricks[i].alive && !this.bricks[i].solid) n++;
    }
    return n;
  };

  Game.prototype.addScore = function (n) {
    this.score += n;
    if (this.score > this.high) {
      this.high = this.score;
      this.newHigh = true;
      // 저장은 여기서 하지 않는다. localStorage 쓰기는 동기 디스크 I/O 라
      // 벽돌마다 부르면 연타 구간에서 프레임이 튄다. 국면이 끝날 때만 넘긴다.
    }
  };

  /* 레벨 클리어 / 게임오버처럼 국면이 끝나는 시점에만 기록을 넘긴다. */
  Game.prototype.persistHigh = function () {
    if (this.high > this.savedHigh) {
      saveHigh(this.high);
      this.savedHigh = this.high;
    }
  };

  Game.prototype.comboMult = function () {
    return Math.min(1 + this.combo * 0.2, 5);
  };

  // -------------------------------------------------------------- 업데이트

  Game.prototype.step = function () {
    this.time += C.STEP;
    if (this.shake > 0) this.shake *= 0.88;
    if (this.flash > 0) this.flash -= 0.06;
    this.overlayT += C.STEP;

    if (I.hit('KeyM')) A.toggleMute();

    switch (this.state) {
      case STATE.TITLE:
        if (I.confirm()) { A.launch(); this.newGame(); }
        break;

      case STATE.PLAYING:
        if (I.hit('KeyP') || I.hit('Escape')) { this.state = STATE.PAUSED; break; }
        this.stepPlay();
        break;

      case STATE.PAUSED:
        if (I.hit('KeyP') || I.hit('Escape') || I.confirm()) this.state = STATE.PLAYING;
        break;

      case STATE.CLEAR:
        if (this.overlayT > 0.6 && I.confirm()) {
          if (this.levelIndex + 1 >= NB.Levels.count) {
            // 정상 흐름에서는 clearLevel 이 이미 WIN 으로 보내므로 오지 않는다.
            // 그래도 여기서 다음 레벨을 믿고 읽으면 마지막 판에서 터진다.
            this.state = STATE.WIN;
            this.overlayT = 0;
          } else {
            this.loadLevel(this.levelIndex + 1);
            this.state = STATE.PLAYING;
          }
        }
        break;

      case STATE.OVER:
      case STATE.WIN:
        if (this.overlayT > 0.9 && I.confirm()) this.state = STATE.TITLE;
        break;
    }

    P.update();
  };

  Game.prototype.stepPlay = function () {
    var i;

    // 파워업 지속시간
    for (var k in this.timers) {
      if (this.timers[k] > 0) {
        this.timers[k] -= C.STEP;
        if (this.timers[k] <= 0) this.onPowerExpire(k);
      }
    }

    // ---- 패들 조작: 포인터가 살아 있으면 포인터, 아니면 방향키
    var axis = I.axis();
    if (axis !== 0) {
      this.aimX += axis * C.PADDLE_KEY_SPEED;
    } else if (I.pointer.active) {
      this.aimX = I.pointer.x;
    }
    this.aimX = NB.clamp(this.aimX, 0, C.W);
    this.paddle.targetW = NB.clamp(
      C.PADDLE_W * (this.timers.EXPAND > 0 ? 1.55 : 1) * (this.timers.SHRINK > 0 ? 0.62 : 1),
      C.PADDLE_MIN, C.PADDLE_MAX
    );
    this.paddle.update(this.aimX);

    // ---- 발사 / 레이저 (Space, 또는 화면 탭)
    var fireKey = I.hit('Space') || I.pointer.tapped;
    var anyStuck = false;
    for (i = 0; i < this.balls.length; i++) if (this.balls[i].stuck) anyStuck = true;

    if (fireKey && anyStuck) {
      for (i = 0; i < this.balls.length; i++) {
        var b = this.balls[i];
        if (!b.stuck) continue;
        b.stuck = false;
        // 패들 위 어디에 붙어 있었는지에 따라 발사 각도가 갈린다.
        var rel = NB.clamp(b.stickOffset / (this.paddle.w / 2), -1, 1);
        var ang = rel * C.BALL_MAX_ANGLE * 0.8;
        var sp = this.ballSpeed();
        b.speed = sp;
        b.vx = Math.sin(ang) * sp;
        b.vy = -Math.cos(ang) * sp;
        b.unvertical();
      }
      A.launch();
    }

    if (this.laserCd > 0) this.laserCd -= C.STEP;
    if (this.timers.LASER > 0 && (I.held('Space') || I.pointer.down) && !anyStuck && this.laserCd <= 0) {
      this.lasers.push(new NB.Laser(this.paddle.x + 6, this.paddle.y));
      this.lasers.push(new NB.Laser(this.paddle.x + this.paddle.w - 6, this.paddle.y));
      this.laserCd = 0.17;
      A.laser();
    }

    this.stepBalls();
    this.stepLasers();
    this.stepPowerups();

    for (i = 0; i < this.bricks.length; i++) {
      if (this.bricks[i].flash > 0) this.bricks[i].flash -= 0.08;
    }

    // ---- 클리어 / 목숨 판정
    // 클리어를 먼저 본다. 마지막 벽돌을 부순 공이 그대로 바닥으로 빠지면
    // 두 조건이 같은 스텝에 성립하는데, 그때 목숨을 깎는 건 부당하다.
    if (this.bricksLeft() === 0) this.clearLevel();
    else if (this.balls.length === 0) this.loseLife();
  };

  Game.prototype.stepBalls = function () {
    var speed = this.ballSpeed();

    for (var i = this.balls.length - 1; i >= 0; i--) {
      var b = this.balls[i];

      if (b.stuck) {
        b.x = NB.clamp(this.paddle.cx() + b.stickOffset, this.paddle.x + b.r, this.paddle.x + this.paddle.w - b.r);
        b.y = this.paddle.y - b.r - 2;
        b.pushTrail();
        continue;
      }

      if (Math.abs(b.speed - speed) > 0.01) b.setSpeed(speed);

      // 한 스텝의 이동을 잘게 쪼갠다. 빠른 공이 벽돌을 뚫고 지나가는 걸 막는 가장 싼 방법.
      var sub = Math.max(1, Math.ceil(b.speed / (b.r * 0.8)));
      for (var s = 0; s < sub; s++) {
        b.x += b.vx / sub;
        b.y += b.vy / sub;
        this.collideWalls(b);
        this.collideBricks(b);
        this.collidePaddle(b);
      }
      b.unflatten();
      b.pushTrail();

      if (b.y - b.r > C.H) {
        P.spawn(b.x, C.H - 6, '#ff5470', 14, { dir: -Math.PI / 2, spread: 1.6, speed: 3.6 });
        this.balls.splice(i, 1);
      }
    }
  };

  Game.prototype.collideWalls = function (b) {
    var hit = false;
    if (b.x - b.r < C.WALL) { b.x = C.WALL + b.r; b.vx = Math.abs(b.vx); hit = true; }
    if (b.x + b.r > C.W - C.WALL) { b.x = C.W - C.WALL - b.r; b.vx = -Math.abs(b.vx); hit = true; }
    if (b.y - b.r < C.HUD_H) { b.y = C.HUD_H + b.r; b.vy = Math.abs(b.vy); hit = true; }
    if (hit) {
      A.wall();
      P.spawn(b.x, b.y, '#6fd7ff', 3, { speed: 1.6, life: 14, gravity: 0.02 });
    }
  };

  Game.prototype.collideBricks = function (b) {
    for (var i = 0; i < this.bricks.length; i++) {
      var br = this.bricks[i];
      if (!br.alive) continue;

      var hit = NB.circleRect(b.x, b.y, b.r, br.x, br.y, br.w, br.h);
      if (!hit) continue;

      b.x += hit.nx * hit.depth;
      b.y += hit.ny * hit.depth;
      var dot = b.vx * hit.nx + b.vy * hit.ny;
      if (dot < 0) {
        b.vx -= 2 * dot * hit.nx;
        b.vy -= 2 * dot * hit.ny;
      }
      this.damageBrick(br, b.x, b.y);
      return;   // 한 스텝에 벽돌 하나만 — 모서리에서 두 번 튕기는 걸 방지
    }
  };

  Game.prototype.damageBrick = function (br, hx, hy) {
    var cols = br.colors();

    if (br.solid) {
      br.flash = 1;
      A.solid();
      P.spawn(hx, hy, '#9fb3d9', 4, { speed: 2, life: 14 });
      return;
    }

    br.hp--;
    br.flash = 1;

    if (br.hp > 0) {
      A.hard();
      P.spawn(hx, hy, cols[0], 5, { speed: 2.2, life: 16 });
      this.addScore(10);
      return;
    }

    br.alive = false;
    this.combo++;
    A.brick(this.combo);
    this.shake = Math.min(this.shake + 2.2, 12);

    var pts = Math.round(br.points() * this.comboMult());
    this.addScore(pts);
    P.spawn(br.x + br.w / 2, br.y + br.h / 2, cols[0], 16, { speed: 3.4, life: 30 });
    P.spawn(br.x + br.w / 2, br.y + br.h / 2, '#ffffff', 5, { speed: 4.2, life: 18 });
    P.float(br.x + br.w / 2, br.y + br.h / 2, '+' + pts, cols[0]);

    if (br.forcePower || Math.random() < C.DROP_CHANCE) {
      this.powerups.push(new NB.PowerUp(br.x + br.w / 2 - 20, br.y + br.h / 2 - 10, NB.rollPower()));
    }
  };

  Game.prototype.collidePaddle = function (b) {
    var p = this.paddle;
    if (b.vy < 0) return;                       // 올라가는 중이면 통과 (패들 안쪽에서 끼는 것 방지)
    var hit = NB.circleRect(b.x, b.y, b.r, p.x, p.y, p.w, p.h);
    if (!hit) return;

    b.y = p.y - b.r - 0.5;
    this.combo = 0;

    if (this.timers.STICKY > 0) {
      b.stuck = true;
      b.stickOffset = NB.clamp(b.x - p.cx(), -p.w / 2 + b.r, p.w / 2 - b.r);
      A.paddle();
      return;
    }

    var rel = NB.clamp((b.x - p.cx()) / (p.w / 2), -1, 1);
    var ang = rel * C.BALL_MAX_ANGLE;
    var sp = this.ballSpeed();
    b.speed = sp;
    b.vx = Math.sin(ang) * sp + p.vx * 0.22;    // 패들을 밀면서 받으면 그만큼 옆으로 실린다
    b.vy = -Math.abs(Math.cos(ang) * sp);
    b.setSpeed(sp);
    b.unflatten();
    b.unvertical();

    A.paddle();
    P.spawn(b.x, p.y, '#35e0ff', 6, { dir: -Math.PI / 2, spread: 1.4, speed: 2.4, life: 16, gravity: 0.05 });
  };

  Game.prototype.stepLasers = function () {
    for (var i = this.lasers.length - 1; i >= 0; i--) {
      var l = this.lasers[i];
      l.y += l.vy;
      if (l.y < C.HUD_H) { this.lasers.splice(i, 1); continue; }

      for (var j = 0; j < this.bricks.length; j++) {
        var br = this.bricks[j];
        if (!br.alive) continue;
        if (l.x >= br.x && l.x <= br.x + br.w && l.y >= br.y && l.y <= br.y + br.h) {
          this.damageBrick(br, l.x, l.y);
          l.dead = true;
          break;
        }
      }
      if (l.dead) this.lasers.splice(i, 1);
    }
  };

  Game.prototype.stepPowerups = function () {
    for (var i = this.powerups.length - 1; i >= 0; i--) {
      var pu = this.powerups[i];
      pu.y += pu.vy;
      pu.t += C.STEP;

      if (pu.y > C.H) { this.powerups.splice(i, 1); continue; }

      var p = this.paddle;
      if (pu.y + pu.h >= p.y && pu.y <= p.y + p.h &&
          pu.x + pu.w >= p.x && pu.x <= p.x + p.w) {
        this.applyPower(pu.type, pu.x + pu.w / 2, pu.y);
        this.powerups.splice(i, 1);
      }
    }
  };

  Game.prototype.applyPower = function (type, x, y) {
    var def = NB.POWERS[type];
    P.spawn(x, y, def.color, 18, { speed: 3.2, life: 26 });
    P.float(x, y - 14, def.label, def.color);

    if (def.dur > 0) {
      this.timers[type] = def.dur;
      // 서로 반대되는 효과는 동시에 켜지지 않게 정리한다.
      if (type === 'EXPAND') this.timers.SHRINK = 0;
      if (type === 'SHRINK') this.timers.EXPAND = 0;
      if (type === 'SLOW') this.timers.FAST = 0;
      if (type === 'FAST') this.timers.SLOW = 0;
    }

    switch (type) {
      case 'MULTI': this.splitBalls(); break;
      case 'BONUS': this.addScore(500); break;
      case 'LIFE':
        this.lives++;
        A.life();
        this.flash = 0.5;
        this.flashColor = NB.POWERS.LIFE.color;
        return;
      case 'STICKY': break;
    }

    if (def.good) A.good(); else { A.bad(); this.shake = 8; }
  };

  Game.prototype.onPowerExpire = function (type) {
    this.timers[type] = 0;
    // 끈끈이가 풀렸는데 공이 붙어 있으면 그대로 굳어버리므로 놓아준다.
    if (type === 'STICKY') {
      for (var i = 0; i < this.balls.length; i++) {
        var b = this.balls[i];
        if (!b.stuck) continue;
        b.stuck = false;
        var sp = this.ballSpeed();
        b.vx = Math.sin(0.3) * sp;
        b.vy = -Math.cos(0.3) * sp;
      }
    }
  };

  Game.prototype.splitBalls = function () {
    var extra = [];
    for (var i = 0; i < this.balls.length && this.balls.length + extra.length < 9; i++) {
      var b = this.balls[i];
      for (var k = 0; k < 2; k++) {
        var nb = new NB.Ball(b.x, b.y, b.speed, 0);
        var a = Math.atan2(b.vy, b.vx) + (k === 0 ? 0.42 : -0.42);
        nb.vx = Math.cos(a) * b.speed;
        nb.vy = Math.sin(a) * b.speed;
        nb.stuck = false;
        extra.push(nb);
      }
      if (b.stuck) {   // 붙어 있던 공도 같이 출발시킨다
        b.stuck = false;
        b.vx = 0;
        b.vy = -b.speed;
      }
    }
    this.balls = this.balls.concat(extra);
  };

  Game.prototype.loseLife = function () {
    this.lives--;
    this.combo = 0;
    this.timers = {};
    this.powerups = [];
    this.lasers = [];
    this.shake = 14;
    this.flash = 0.75;
    this.flashColor = '#ff5470';

    if (this.lives <= 0) {
      A.over();
      this.persistHigh();
      this.state = STATE.OVER;
      this.overlayT = 0;
      return;
    }
    A.lose();
    this.paddle.targetW = C.PADDLE_W;
    this.resetBall();
  };

  Game.prototype.clearLevel = function () {
    this.levelBonus = 500 + this.lives * 250;
    this.addScore(this.levelBonus);
    A.clear();
    this.overlayT = 0;
    this.balls = [];
    this.powerups = [];
    this.lasers = [];
    for (var i = 0; i < 30; i++) {
      P.spawn(Math.random() * C.W, C.HUD_H + Math.random() * 300, '#ffd84d', 3, { speed: 3, life: 40 });
    }
    this.persistHigh();
    this.state = (this.levelIndex + 1 >= NB.Levels.count) ? STATE.WIN : STATE.CLEAR;
  };

  // ---------------------------------------------------------------- 렌더

  Game.prototype.render = function () {
    var ctx = this.ctx;
    ctx.save();
    ctx.clearRect(0, 0, C.W, C.H);
    this.drawBackground(ctx);

    if (this.shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }

    this.drawWalls(ctx);
    this.drawBricks(ctx);
    this.drawPowerups(ctx);
    this.drawLasers(ctx);
    this.drawPaddle(ctx);
    this.drawBalls(ctx);
    P.draw(ctx);
    ctx.restore();

    this.drawHud(ctx);

    if (this.flash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.32, this.flash);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, C.HUD_H, C.W, C.H - C.HUD_H);   // HUD 는 가리지 않는다
      ctx.restore();
    }

    if (this.state !== STATE.PLAYING) this.drawOverlay(ctx);
  };

  Game.prototype.drawBackground = function (ctx) {
    ctx.fillStyle = '#05060f';
    ctx.fillRect(0, 0, C.W, C.H);

    // 천천히 흐르는 격자 — 정지 화면처럼 보이지 않게 하는 최소한의 장치
    var g = 40;
    var off = (this.time * 14) % g;
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = '#2a3d6b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = 0; x <= C.W; x += g) { ctx.moveTo(x + 0.5, C.HUD_H); ctx.lineTo(x + 0.5, C.H); }
    for (var y = C.HUD_H + off; y <= C.H; y += g) { ctx.moveTo(0, y + 0.5); ctx.lineTo(C.W, y + 0.5); }
    ctx.stroke();
    ctx.restore();

    var grad = ctx.createRadialGradient(C.W / 2, C.H * 0.2, 20, C.W / 2, C.H * 0.2, C.W * 0.9);
    grad.addColorStop(0, 'rgba(53,224,255,0.09)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, C.HUD_H, C.W, C.H - C.HUD_H);
  };

  Game.prototype.drawWalls = function (ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(53,224,255,0.10)';
    ctx.fillRect(0, C.HUD_H, C.WALL, C.H - C.HUD_H);
    ctx.fillRect(C.W - C.WALL, C.HUD_H, C.WALL, C.H - C.HUD_H);
    ctx.fillStyle = 'rgba(53,224,255,0.55)';
    ctx.fillRect(C.WALL - 2, C.HUD_H, 2, C.H - C.HUD_H);
    ctx.fillRect(C.W - C.WALL, C.HUD_H, 2, C.H - C.HUD_H);
    ctx.fillRect(0, C.HUD_H, C.W, 2);

    // 바닥(=놓치는 선)은 위험을 알리도록 붉게
    ctx.fillStyle = 'rgba(255,84,112,0.35)';
    ctx.fillRect(0, C.H - 3, C.W, 3);
    ctx.restore();
  };

  Game.prototype.drawBricks = function (ctx) {
    for (var i = 0; i < this.bricks.length; i++) {
      var br = this.bricks[i];
      if (!br.alive) continue;
      var cols = br.colors();
      var x = br.x + 2, y = br.y + 2, w = br.w - 4, h = br.h - 4;

      ctx.fillStyle = cols[1];
      rr(ctx, x, y, w, h, 5);
      ctx.fill();

      ctx.fillStyle = cols[0];
      rr(ctx, x, y, w, h * 0.5, 5);
      ctx.fill();

      ctx.strokeStyle = cols[0];
      ctx.lineWidth = 1.5;
      rr(ctx, x, y, w, h, 5);
      ctx.stroke();

      if (br.solid) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 6, y + h - 5); ctx.lineTo(x + w - 6, y + 5);
        ctx.stroke();
        ctx.restore();
      } else if (br.forcePower) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', x + w / 2, y + h / 2 + 1);
        ctx.restore();
      }

      if (br.flash > 0) {
        ctx.save();
        ctx.globalAlpha = br.flash * 0.8;
        ctx.fillStyle = '#ffffff';
        rr(ctx, x, y, w, h, 5);
        ctx.fill();
        ctx.restore();
      }
    }
  };

  Game.prototype.drawPaddle = function (ctx) {
    var p = this.paddle;
    ctx.save();
    ctx.shadowColor = '#35e0ff';
    ctx.shadowBlur = 18;

    var grad = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
    grad.addColorStop(0, '#9df3ff');
    grad.addColorStop(0.5, '#35e0ff');
    grad.addColorStop(1, '#1585a8');
    ctx.fillStyle = this.timers.SHRINK > 0 ? '#ff8a9c' : grad;
    rr(ctx, p.x, p.y, p.w, p.h, 7);
    ctx.fill();
    ctx.restore();

    if (this.timers.STICKY > 0) {
      ctx.save();
      ctx.strokeStyle = NB.POWERS.STICKY.color;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(p.x + 3, p.y - 3);
      ctx.lineTo(p.x + p.w - 3, p.y - 3);
      ctx.stroke();
      ctx.restore();
    }

    if (this.timers.LASER > 0) {
      ctx.fillStyle = NB.POWERS.LASER.color;
      ctx.fillRect(p.x + 3, p.y - 7, 5, 7);
      ctx.fillRect(p.x + p.w - 8, p.y - 7, 5, 7);
    }
  };

  Game.prototype.drawBalls = function (ctx) {
    for (var i = 0; i < this.balls.length; i++) {
      var b = this.balls[i];

      ctx.save();
      ctx.lineCap = 'round';
      for (var t = 0; t + 3 < b.trail.length; t += 2) {
        var a = (t / b.trail.length) * 0.35;
        ctx.globalAlpha = a;
        ctx.strokeStyle = '#35e0ff';
        ctx.lineWidth = b.r * (t / b.trail.length) * 1.6;
        ctx.beginPath();
        ctx.moveTo(b.trail[t], b.trail[t + 1]);
        ctx.lineTo(b.trail[t + 2], b.trail[t + 3]);
        ctx.stroke();
      }
      ctx.restore();

      ctx.save();
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };

  Game.prototype.drawPowerups = function (ctx) {
    for (var i = 0; i < this.powerups.length; i++) {
      var pu = this.powerups[i];
      var def = NB.POWERS[pu.type];
      var wob = Math.sin(pu.t * 6) * 2;

      ctx.save();
      ctx.translate(pu.x + pu.w / 2 + wob, pu.y + pu.h / 2);
      ctx.shadowColor = def.color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = def.good ? 'rgba(6,12,24,0.92)' : 'rgba(40,6,14,0.92)';
      rr(ctx, -pu.w / 2, -pu.h / 2, pu.w, pu.h, 6);
      ctx.fill();
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 2;
      rr(ctx, -pu.w / 2, -pu.h / 2, pu.w, pu.h, 6);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = def.color;
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.label, 0, 1);
      ctx.restore();
    }
  };

  Game.prototype.drawLasers = function (ctx) {
    ctx.save();
    ctx.shadowColor = NB.POWERS.LASER.color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = NB.POWERS.LASER.color;
    for (var i = 0; i < this.lasers.length; i++) {
      ctx.fillRect(this.lasers[i].x - 1.5, this.lasers[i].y - 14, 3, 14);
    }
    ctx.restore();
  };

  // ------------------------------------------------------------------ HUD

  Game.prototype.drawHud = function (ctx) {
    var lv = NB.Levels.get(this.levelIndex);

    ctx.save();
    ctx.fillStyle = 'rgba(5,8,20,0.92)';
    ctx.fillRect(0, 0, C.W, C.HUD_H);

    ctx.textBaseline = 'alphabetic';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = '#5c6f96';
    ctx.textAlign = 'left';
    ctx.fillText('SCORE', 24, 30);
    ctx.textAlign = 'center';
    ctx.fillText('BEST', C.W / 2, 30);
    ctx.textAlign = 'right';
    ctx.fillText('LEVEL', C.W - 24, 30);

    ctx.font = 'bold 26px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#e8f4ff';
    ctx.textAlign = 'left';
    ctx.fillText(pad(this.score, 6), 24, 56);

    ctx.textAlign = 'center';
    ctx.fillStyle = this.newHigh ? '#ffd84d' : '#9fb3d9';
    ctx.fillText(pad(this.high, 6), C.W / 2, 56);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#e8f4ff';
    ctx.fillText((this.levelIndex + 1) + '/' + NB.Levels.count, C.W - 24, 56);

    // 남은 목숨
    ctx.textAlign = 'left';
    var shown = Math.min(this.lives, 6);
    for (var i = 0; i < shown; i++) {
      ctx.beginPath();
      ctx.fillStyle = '#35e0ff';
      ctx.arc(30 + i * 16, 76, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (this.lives > 6) {
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = '#9fb3d9';
      ctx.fillText('+' + (this.lives - 6), 30 + shown * 16, 80);
    }

    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#5c6f96';
    ctx.textAlign = 'center';
    ctx.fillText(lv.name, C.W / 2, 80);

    // 콤보 배수
    if (this.combo >= 2) {
      ctx.textAlign = 'right';
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.fillStyle = '#ffd84d';
      ctx.fillText('COMBO x' + this.comboMult().toFixed(1), C.W - 24, 80);
    }

    if (A.isMuted()) {
      ctx.textAlign = 'left';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = '#5c6f96';
      ctx.fillText('MUTED', 24, 16);
    }
    ctx.restore();

    this.drawPowerChips(ctx);
  };

  /* 켜져 있는 파워업을 필드 왼쪽 아래에 남은 시간과 함께 세로로 쌓는다. */
  Game.prototype.drawPowerChips = function (ctx) {
    var y = C.H - 34;
    ctx.save();
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (var k in this.timers) {
      if (!(this.timers[k] > 0)) continue;
      var def = NB.POWERS[k];
      var w = 54;
      var x = C.WALL + 8;
      var ratio = this.timers[k] / def.dur;

      ctx.globalAlpha = this.timers[k] < 3 && Math.floor(this.time * 6) % 2 === 0 ? 0.35 : 1;
      ctx.fillStyle = 'rgba(6,12,24,0.85)';
      rr(ctx, x, y, w, 16, 4);
      ctx.fill();
      ctx.fillStyle = def.color;
      ctx.globalAlpha *= 0.30;
      rr(ctx, x, y, w * ratio, 16, 4);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 1;
      rr(ctx, x, y, w, 16, 4);
      ctx.stroke();
      ctx.fillStyle = def.color;
      ctx.textAlign = 'left';
      ctx.fillText(def.label + ' ' + Math.ceil(this.timers[k]) + 's', x + 5, y + 8);
      y -= 20;
    }
    ctx.restore();
  };

  // -------------------------------------------------------------- 오버레이

  function pad(n, len) {
    var s = String(Math.max(0, Math.floor(n)));
    while (s.length < len) s = '0' + s;
    return s;
  }

  Game.prototype.drawOverlay = function (ctx) {
    var title, lines, hint, color;

    switch (this.state) {
      case STATE.TITLE:
        title = 'NEON BREAKER';
        color = '#35e0ff';
        lines = [
          '마우스 · 터치 · ←/→ 로 패들을 움직이고',
          'Space 로 공을 쏜다. 벽돌을 전부 부수면 다음 층.',
          '',
          '\'?\' 벽돌은 아이템 확정 · 빨간 아이템은 함정',
          this.high > 0 ? 'BEST  ' + pad(this.high, 6) : ''
        ];
        hint = 'Space / 화면 터치 로 시작';
        break;

      case STATE.PAUSED:
        title = 'PAUSED';
        color = '#9fb3d9';
        lines = ['P · Esc · 화면 터치로 계속'];
        hint = '';
        break;

      case STATE.CLEAR:
        var next = NB.Levels.get(this.levelIndex + 1);
        title = 'LEVEL ' + (this.levelIndex + 1) + ' CLEAR';
        color = '#5dff9b';
        lines = [
          NB.Levels.get(this.levelIndex).name + ' 돌파',
          '클리어 보너스  +' + this.levelBonus,
          '남은 목숨 ' + this.lives + '개',
          '',
          next ? '다음: ' + next.name : ''
        ];
        hint = 'Space / 터치 로 계속';
        break;

      case STATE.OVER:
        title = 'GAME OVER';
        color = '#ff5470';
        lines = [
          '최종 점수  ' + pad(this.score, 6),
          '도달 레벨  ' + (this.levelIndex + 1) + '/' + NB.Levels.count,
          this.newHigh ? '★ 최고 기록 갱신 ★' : 'BEST  ' + pad(this.high, 6)
        ];
        hint = 'Space / 터치 로 타이틀';
        break;

      case STATE.WIN:
        title = 'ALL CLEAR!';
        color = '#ffd84d';
        lines = [
          '8개 레벨을 전부 부쉈다.',
          '최종 점수  ' + pad(this.score, 6),
          this.newHigh ? '★ 최고 기록 갱신 ★' : 'BEST  ' + pad(this.high, 6)
        ];
        hint = 'Space / 터치 로 타이틀';
        break;

      default:
        return;
    }

    ctx.save();
    ctx.fillStyle = 'rgba(3,5,14,0.82)';
    ctx.fillRect(0, C.HUD_H, C.W, C.H - C.HUD_H);

    var cy = C.H * 0.44;
    ctx.textAlign = 'center';

    ctx.shadowColor = color;
    ctx.shadowBlur = 24;
    ctx.fillStyle = color;
    ctx.font = 'bold 46px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(title, C.W / 2, cy);
    ctx.shadowBlur = 0;

    ctx.font = '16px system-ui, sans-serif';
    ctx.fillStyle = '#9fb3d9';
    for (var i = 0; i < lines.length; i++) {
      if (!lines[i]) continue;
      ctx.fillText(lines[i], C.W / 2, cy + 46 + i * 26);
    }

    if (hint) {
      // 깜빡여서 "여기서 입력을 기다린다"는 걸 알린다
      ctx.globalAlpha = 0.55 + Math.sin(this.time * 4) * 0.35;
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.fillStyle = '#e8f4ff';
      ctx.fillText(hint, C.W / 2, cy + 56 + lines.length * 26 + 20);
    }
    ctx.restore();
  };

  Game.STATE = STATE;
  return Game;
})();
