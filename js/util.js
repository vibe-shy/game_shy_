/* 수학 · 충돌 헬퍼. 다른 모듈이 전부 여기에 기댄다. */
var AF_ROOT = typeof window !== 'undefined' ? window : globalThis;   // node 로 검증만 돌릴 수 있게
var AF = AF_ROOT.AF || (AF_ROOT.AF = {});

AF.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
AF.lerp = function (a, b, t) { return a + (b - a) * t; };
AF.rand = function (a, b) { return a + Math.random() * (b - a); };
AF.randInt = function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); };
AF.pick = function (arr) { return arr[(Math.random() * arr.length) | 0]; };

/* 가중치 뽑기. [[값, 무게], ...] */
AF.weighted = function (table) {
  var total = 0, i;
  for (i = 0; i < table.length; i++) total += table[i][1];
  var r = Math.random() * total;
  for (i = 0; i < table.length; i++) {
    r -= table[i][1];
    if (r <= 0) return table[i][0];
  }
  return table[table.length - 1][0];
};

/* 각도를 -PI..PI 로 정규화. 유도 화살이 먼 길로 도는 걸 막는다. */
AF.wrapAngle = function (a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

AF.dist2 = function (ax, ay, bx, by) {
  var dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};

/* 원 vs 축 정렬 사각형. 겹치면 밀어낼 법선과 침투 깊이. */
AF.circleRect = function (cx, cy, r, rx, ry, rw, rh) {
  var nx = AF.clamp(cx, rx, rx + rw);
  var ny = AF.clamp(cy, ry, ry + rh);
  var dx = cx - nx, dy = cy - ny;
  var d2 = dx * dx + dy * dy;
  if (d2 > r * r) return null;

  if (d2 > 0.0001) {
    var d = Math.sqrt(d2);
    return { nx: dx / d, ny: dy / d, depth: r - d };
  }
  // 중심이 사각형 안: 가장 얕게 빠져나갈 축을 고른다
  var left = cx - rx, right = rx + rw - cx;
  var top = cy - ry, bottom = ry + rh - cy;
  var min = Math.min(left, right, top, bottom);
  if (min === left) return { nx: -1, ny: 0, depth: left + r };
  if (min === right) return { nx: 1, ny: 0, depth: right + r };
  if (min === top) return { nx: 0, ny: -1, depth: top + r };
  return { nx: 0, ny: 1, depth: bottom + r };
};

/* 둥근 사각형 경로. ctx.roundRect 없는 환경도 있어 직접 그린다. */
AF.rr = function (ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

AF.pad = function (n, len) {
  var s = String(Math.max(0, Math.floor(n)));
  while (s.length < len) s = '0' + s;
  return s;
};

if (typeof module !== 'undefined' && module.exports) module.exports = AF;
