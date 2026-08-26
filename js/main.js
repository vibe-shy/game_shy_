/* 부팅 + 고정 스텝 루프.
   렌더는 화면 주사율대로, 물리는 항상 1/60초 단위로 돌린다.
   (120Hz 모니터에서 공이 두 배로 빨라지는 일을 막는다.) */
(function () {
  var NB = window.NB;
  var canvas = document.getElementById('screen');

  var problems = NB.Levels.validate();
  if (problems.length) console.warn('레벨 지도 문제:\n' + problems.join('\n'));

  NB.Input.attach(canvas);
  var game = new NB.Game(canvas);
  NB.game = game;   // 콘솔/테스트에서 상태를 들여다볼 수 있게 열어 둔다

  var last = 0;
  var acc = 0;
  var MAX_FRAME = 0.25;   // 탭이 백그라운드에 있다 돌아왔을 때 한 번에 몰아 도는 것 방지

  function frame(now) {
    var t = now / 1000;
    var dt = last ? t - last : 0;
    last = t;
    if (dt > MAX_FRAME) dt = MAX_FRAME;

    acc += dt;
    var guard = 0;
    while (acc >= NB.C.STEP && guard++ < 8) {
      game.step();
      NB.Input.endFrame();
      acc -= NB.C.STEP;
    }

    game.render();
    requestAnimationFrame(frame);
  }

  // 탭을 벗어나면 자동 일시정지 — 돌아왔을 때 목숨이 사라져 있지 않도록.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && game.state === NB.Game.STATE.PLAYING) {
      game.state = NB.Game.STATE.PAUSED;
    }
    last = 0;
    acc = 0;
  });

  requestAnimationFrame(frame);
})();
