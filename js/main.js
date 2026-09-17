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
      game.pause(false);
    }
    last = 0; acc = 0;
  });

  /* 포커스를 잃었을 때도 멈춘다.
     iframe(아티팩트) 안에서는 프레임이 포커스를 잃으면 키 이벤트가 끊긴다.
     그대로 두면 적은 계속 오는데 조작만 죽어, 게임이 고장난 것처럼 보인다. */
  AF.Input.onBlur(function () {
    if (game.state === AF.Game.STATE.PLAYING) game.pause(true);
    last = 0; acc = 0;
  });

  /* 서체와 스프라이트가 준비되면 시작한다.
     - 캔버스는 서체가 준비되기 전에 그리면 조용히 대체 서체로 떨어진다.
     - 스프라이트도 마찬가지로 로딩 전에는 그려지지 않는다.
     둘 다 data URI 라 네트워크를 타지 않지만 디코딩은 비동기다.

     어느 쪽이 안 끝나도 1.2초 뒤에는 그냥 시작한다. 대체 서체와 도형으로 도는 게
     검은 화면보다 낫다. */
  var started = false;
  function start() {
    if (started) return;
    started = true;
    requestAnimationFrame(frame);
  }

  var waits = [];
  if (document.fonts && document.fonts.load) {
    waits.push(Promise.all([
      document.fonts.load('16px Pretendard'),
      document.fonts.load('bold 16px Pretendard')
    ]));
  }
  waits.push(new Promise(function (resolve) { AF.Sprites.load(resolve); }));

  var timeout = setTimeout(start, 1200);
  Promise.all(waits)
    .catch(function () { /* 서체나 스프라이트가 없어도 게임은 돌아야 한다 */ })
    .then(function () { clearTimeout(timeout); start(); });
})();
