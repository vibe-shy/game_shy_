/* 부팅 + 고정 스텝 루프.
   렌더는 화면 주사율대로, 물리는 항상 1/60초 단위로 돈다.
   (120Hz 모니터에서 적이 두 배로 빨라지는 일을 막는다.) */
(function () {
  var AF = window.AF;
  var canvas = document.getElementById('screen');

  var problems = AF.validateRooms();
  if (problems.length) console.warn('방 배치 문제:\n' + problems.join('\n'));

  AF.Input.attach(canvas);
  var game = new AF.Game(canvas);
  AF.game = game;   // 콘솔/테스트에서 상태를 들여다볼 수 있게 열어 둔다

  var last = 0, acc = 0;
  var MAX_FRAME = 0.25;   // 탭이 백그라운드에 있다 돌아왔을 때 몰아 도는 것 방지

  function frame(now) {
    var t = now / 1000;
    var dt = last ? t - last : 0;
    last = t;
    if (dt > MAX_FRAME) dt = MAX_FRAME;

    acc += dt;
    var guard = 0;
    while (acc >= AF.C.STEP && guard < 8) {
      guard++;
      game.step();
      AF.Input.endFrame();
      acc -= AF.C.STEP;
    }
    // 8스텝으로도 못 따라잡았으면 밀린 시간은 버린다.
    // 그대로 두면 다음 프레임에 더 밀리고 영영 슬로모션으로 굳는다.
    if (guard >= 8) acc = 0;

    game.render();
    requestAnimationFrame(frame);
  }

  // 탭을 벗어나면 자동 일시정지 — 돌아왔을 때 죽어 있지 않도록
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && game.state === AF.Game.STATE.PLAYING) {
      game.state = AF.Game.STATE.PAUSED;
    }
    last = 0; acc = 0;
  });

  /* 캔버스는 서체가 준비되기 전에 그리면 조용히 대체 서체로 떨어진다.
     Pretendard 는 data URI 라 네트워크를 타지 않지만 파싱은 비동기다.
     준비될 때까지 기다리되, 어떤 이유로든 안 끝나면 그냥 시작한다 —
     대체 서체로 도는 게 검은 화면보다 낫다. */
  function start() {
    if (started) return;
    started = true;
    requestAnimationFrame(frame);
  }
  var started = false;

  if (document.fonts && document.fonts.load) {
    var timeout = setTimeout(start, 1200);
    Promise.all([
      document.fonts.load('16px Pretendard'),
      document.fonts.load('bold 16px Pretendard')
    ]).catch(function () { /* 서체가 없어도 게임은 돌아야 한다 */ })
      .then(function () { clearTimeout(timeout); start(); });
  } else {
    start();
  }
})();
