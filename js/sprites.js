/* 스프라이트 매니페스트와 로더.

   설계 원칙: **스프라이트는 선택 사항이다.**
   파일이 있으면 쓰고, 없으면 draw() 가 false 를 돌려줘 호출한 쪽이 기존 도형으로
   그린다. 덕분에 진짜 그림을 한 장씩 갈아 끼워도 중간 상태에서 화면이 깨지지 않는다.

   이미지 자체는 js/sprite-data.js 에 data URI 로 들어 있다(생성물).
   외부 파일로 두지 않는 이유는 서체와 같다 — 저장소는 네트워크 없이 file:// 로
   열려야 하고, 아티팩트 CSP 는 외부 이미지를 전부 막는다. */
var AF = window.AF || (window.AF = {});

/* scale : 그리기 크기 = 히트박스 지름 x scale. 그림이 히트박스 밖으로 삐져나와도
           되도록 1보다 크게 잡는다(모자·활·날개 등).
   face  : 'rotate' 진행/조준 방향으로 회전  — 삼각형처럼 방향이 뚜렷한 것
           'flip'   좌우 반전만              — 옆을 보는 캐릭터 그림
           'none'   그대로                   — 위에서 본 것, 타일 */
AF.SPRITES = {
  'player':         { scale: 2.15, face: 'flip'   },
  'enemy-chaser':   { scale: 2.15, face: 'rotate' },
  'enemy-shooter':  { scale: 2.15, face: 'flip'   },
  'enemy-orbiter':  { scale: 2.15, face: 'none'   },
  'enemy-charger':  { scale: 2.15, face: 'rotate' },
  'enemy-splitter': { scale: 2.15, face: 'none'   },
  'enemy-shard':    { scale: 2.15, face: 'rotate' },
  'enemy-boss':     { scale: 2.05, face: 'none'   },
  'arrow':          { face: 'rotate' },
  'bolt':           { face: 'none'   },
  'floor':          { face: 'none'   },
  'wall':           { face: 'none'   }
};

AF.spriteKeyFor = function (enemyType) { return 'enemy-' + enemyType; };

AF.Sprites = (function () {
  var imgs = Object.create(null);
  var ready = false;

  /* 있는 것만 띄운다. 하나가 실패해도 나머지는 살리고 계속 간다 —
     스프라이트는 선택 사항이므로 로딩 실패가 게임을 막으면 안 된다. */
  function load(done) {
    var data = AF.SPRITE_DATA || {};
    var keys = Object.keys(AF.SPRITES).filter(function (k) { return data[k]; });
    var left = keys.length;

    if (!left) { ready = true; done && done(0); return; }

    keys.forEach(function (k) {
      var im = new Image();
      im.onload = function () { imgs[k] = im; if (--left === 0) { ready = true; done && done(Object.keys(imgs).length); } };
      im.onerror = function () { if (--left === 0) { ready = true; done && done(Object.keys(imgs).length); } };
      im.src = data[k];
    });
  }

  function has(key) { return !!imgs[key]; }

  /* 중심(x, y)에 size x size 로 그린다. 그릴 수 없으면 false — 호출한 쪽이 도형으로 대체.
       angle : face 'rotate' 일 때 회전 각(라디안)
       flip  : face 'flip'   일 때 좌우 반전 여부 */
  function draw(ctx, key, x, y, size, angle, flip) {
    var im = imgs[key];
    if (!im) return false;
    var spec = AF.SPRITES[key] || {};
    var h = size / 2;

    ctx.save();
    ctx.translate(x, y);
    if (spec.face === 'rotate' && angle) ctx.rotate(angle);
    else if (spec.face === 'flip' && flip) ctx.scale(-1, 1);
    ctx.drawImage(im, -h, -h, size, size);
    ctx.restore();
    return true;
  }

  /* 피격 섬광. 스프라이트를 'lighter' 로 한 번 더 겹쳐 밝힌다.
     ctx.filter 는 브라우저마다 지원이 갈리지만 'lighter' 는 어디서나 된다. */
  function flash(ctx, key, x, y, size, amount, angle, flip) {
    var im = imgs[key];
    if (!im || amount <= 0) return false;
    var spec = AF.SPRITES[key] || {};
    var h = size / 2;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, amount) * 0.85;
    ctx.translate(x, y);
    if (spec.face === 'rotate' && angle) ctx.rotate(angle);
    else if (spec.face === 'flip' && flip) ctx.scale(-1, 1);
    ctx.drawImage(im, -h, -h, size, size);
    ctx.restore();
    return true;
  }

  return {
    load: load,
    has: has,
    draw: draw,
    flash: flash,
    isReady: function () { return ready; },
    count: function () { return Object.keys(imgs).length; }
  };
})();
