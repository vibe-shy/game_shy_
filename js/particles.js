/* 파티클 + 떠오르는 점수 텍스트. 매 프레임 객체를 새로 만들면 GC 가 튀니
   고정 크기 풀에서 돌려 쓴다. */
var NB = window.NB || (window.NB = {});

NB.Particles = (function () {
  var MAX = 420;
  var pool = new Array(MAX);
  var head = 0;

  for (var i = 0; i < MAX; i++) {
    pool[i] = { life: 0, max: 1, x: 0, y: 0, vx: 0, vy: 0, size: 3, color: '#fff', gravity: 0.12 };
  }

  var floaters = [];   // "+120" 처럼 떠오르는 글자

  function spawn(x, y, color, count, opts) {
    opts = opts || {};
    var spread = opts.spread === undefined ? Math.PI * 2 : opts.spread;
    var dir = opts.dir === undefined ? 0 : opts.dir;
    var speed = opts.speed === undefined ? 3.2 : opts.speed;
    for (var n = 0; n < count; n++) {
      var p = pool[head];
      head = (head + 1) % MAX;
      var a = dir + (Math.random() - 0.5) * spread;
      var s = speed * (0.35 + Math.random() * 0.9);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.max = p.life = (opts.life || 28) * (0.6 + Math.random() * 0.7);
      p.size = opts.size || (1.6 + Math.random() * 2.6);
      p.color = color;
      p.gravity = opts.gravity === undefined ? 0.14 : opts.gravity;
    }
  }

  function float(x, y, text, color) {
    floaters.push({ x: x, y: y, text: text, color: color || '#fff', life: 48, max: 48 });
  }

  function update() {
    for (var i = 0; i < MAX; i++) {
      var p = pool[i];
      if (p.life <= 0) continue;
      p.life--;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.vx *= 0.985;
    }
    for (var j = floaters.length - 1; j >= 0; j--) {
      var f = floaters[j];
      f.life--;
      f.y -= 0.9;
      if (f.life <= 0) floaters.splice(j, 1);
    }
  }

  function draw(ctx) {
    ctx.save();
    for (var i = 0; i < MAX; i++) {
      var p = pool[i];
      if (p.life <= 0) continue;
      var t = p.life / p.max;
      ctx.globalAlpha = Math.min(1, t * 1.4);
      ctx.fillStyle = p.color;
      var s = p.size * (0.4 + t * 0.6);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.font = 'bold 20px "Segoe UI", system-ui, sans-serif';
    for (var j = 0; j < floaters.length; j++) {
      var f = floaters[j];
      var a = Math.min(1, (f.life / f.max) * 1.6);
      ctx.globalAlpha = a;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }

  function clear() {
    for (var i = 0; i < MAX; i++) pool[i].life = 0;
    floaters.length = 0;
  }

  return { spawn: spawn, float: float, update: update, draw: draw, clear: clear };
})();
