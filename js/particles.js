/* 파티클 + 데미지 숫자. 고정 크기 풀을 돌려 써 GC 가 튀지 않게 한다. */
var AF = window.AF || (window.AF = {});

AF.Particles = (function () {
  var MAX = 520;
  var pool = new Array(MAX);
  var head = 0;
  for (var i = 0; i < MAX; i++) {
    pool[i] = { life: 0, max: 1, x: 0, y: 0, vx: 0, vy: 0, size: 3, color: '#fff', drag: 0.92 };
  }

  var floaters = [];

  function spawn(x, y, color, count, o) {
    o = o || {};
    var spread = o.spread === undefined ? Math.PI * 2 : o.spread;
    var dir = o.dir === undefined ? 0 : o.dir;
    var speed = o.speed === undefined ? 3 : o.speed;
    for (var n = 0; n < count; n++) {
      var p = pool[head];
      head = (head + 1) % MAX;
      var a = dir + (Math.random() - 0.5) * spread;
      var s = speed * (0.35 + Math.random() * 0.9);
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
      p.max = p.life = (o.life || 26) * (0.6 + Math.random() * 0.7);
      p.size = o.size || (1.8 + Math.random() * 2.8);
      p.color = color;
      p.drag = o.drag === undefined ? 0.9 : o.drag;
    }
  }

  /* 위로 떠오르는 글자. 데미지 숫자와 능력 이름에 쓴다. */
  function float(x, y, text, color, big) {
    floaters.push({
      x: x, y: y + (Math.random() - 0.5) * 6, text: text, color: color || '#fff',
      life: big ? 70 : 42, max: big ? 70 : 42, size: big ? 22 : 15,
      vx: (Math.random() - 0.5) * 0.8, vy: big ? -1.1 : -0.8
    });
  }

  function update() {
    for (var i = 0; i < MAX; i++) {
      var p = pool[i];
      if (p.life <= 0) continue;
      p.life--;
      p.x += p.vx; p.y += p.vy;
      p.vx *= p.drag; p.vy *= p.drag;
    }
    for (var j = floaters.length - 1; j >= 0; j--) {
      var f = floaters[j];
      f.life--;
      f.x += f.vx; f.y += f.vy;
      f.vy *= 0.96;
      if (f.life <= 0) floaters.splice(j, 1);
    }
  }

  function draw(ctx) {
    ctx.save();
    for (var i = 0; i < MAX; i++) {
      var p = pool[i];
      if (p.life <= 0) continue;
      var t = p.life / p.max;
      ctx.globalAlpha = Math.min(1, t * 1.5);
      ctx.fillStyle = p.color;
      var s = p.size * (0.35 + t * 0.65);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var j = 0; j < floaters.length; j++) {
      var f = floaters[j];
      var a = Math.min(1, (f.life / f.max) * 1.8);
      ctx.globalAlpha = a;
      ctx.font = AF.font(f.size, 'bold');
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';   // 어떤 배경에서도 읽히도록 외곽선
      ctx.strokeText(f.text, f.x, f.y);
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
