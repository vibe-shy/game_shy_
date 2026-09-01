/* 입력: 키보드 · 마우스 · 멀티터치를 한 곳에서 정규화한다.
   좌표는 캔버스 CSS 크기가 아니라 내부 해상도(700x772) 기준으로 돌려준다.

   터치는 화면을 좌우로 나눠 가상 스틱 두 개를 만든다.
     왼쪽 절반 = 이동 스틱, 오른쪽 절반 = 조준 스틱(움직이면 발사).
   자동 발사 모드에서는 왼쪽 스틱만 있으면 된다. */
var AF = window.AF || (window.AF = {});

AF.Input = (function () {
  var keys = Object.create(null);
  var pressed = Object.create(null);
  var canvas = null;

  var STICK_R = 62;   // 스틱을 최대로 기울였다고 보는 거리

  var pointer = { x: 350, y: 400, down: false, active: false, tapped: false };
  var moveStick = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
  var aimStick = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };

  var TRACKED = {
    ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1,
    KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1,
    Space: 1, KeyP: 1, KeyM: 1, KeyR: 1, Escape: 1, Enter: 1,
    Digit1: 1, Digit2: 1, Digit3: 1
  };

  function toLocal(clientX, clientY) {
    var r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return { x: pointer.x, y: pointer.y };
    return {
      x: (clientX - r.left) * (canvas.width / r.width),
      y: (clientY - r.top) * (canvas.height / r.height)
    };
  }

  function setStick(st, p) {
    var dx = p.x - st.ox, dy = p.y - st.oy;
    var len = Math.hypot(dx, dy);
    if (len > STICK_R) { dx = dx / len * STICK_R; dy = dy / len * STICK_R; len = STICK_R; }
    // 아주 작은 흔들림은 무시한다. 손가락을 얹기만 해도 캐릭터가 미끄러지는 걸 막는다.
    if (len < 8) { st.dx = 0; st.dy = 0; return; }
    st.dx = dx / STICK_R;
    st.dy = dy / STICK_R;
  }

  function releaseStick(st) { st.active = false; st.id = null; st.dx = 0; st.dy = 0; }

  function attach(cv) {
    canvas = cv;

    window.addEventListener('keydown', function (e) {
      if (TRACKED[e.code]) e.preventDefault();
      if (!keys[e.code]) pressed[e.code] = true;
      keys[e.code] = true;
      AF.Audio.unlock();
    });
    window.addEventListener('keyup', function (e) { keys[e.code] = false; });
    // 탭을 벗어나면 눌린 키가 남아 캐릭터가 혼자 걸어가는 걸 막는다
    window.addEventListener('blur', function () {
      keys = Object.create(null);
      releaseStick(moveStick); releaseStick(aimStick);
      pointer.down = false;
    });

    canvas.addEventListener('mousemove', function (e) {
      var p = toLocal(e.clientX, e.clientY);
      pointer.x = p.x; pointer.y = p.y; pointer.active = true;
    });
    canvas.addEventListener('mouseleave', function () { pointer.active = false; pointer.down = false; });
    canvas.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var p = toLocal(e.clientX, e.clientY);
      pointer.x = p.x; pointer.y = p.y;
      pointer.active = true; pointer.down = true; pointer.tapped = true;
      AF.Audio.unlock();
    });
    window.addEventListener('mouseup', function () { pointer.down = false; });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    canvas.addEventListener('touchstart', function (e) {
      e.preventDefault();
      AF.Audio.unlock();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        var p = toLocal(t.clientX, t.clientY);
        // 메뉴 조작을 위해 마지막 터치 위치는 항상 포인터로도 알린다
        pointer.x = p.x; pointer.y = p.y;
        pointer.tapped = true; pointer.down = true; pointer.active = true;

        var left = p.x < canvas.width / 2;
        var st = left ? moveStick : aimStick;
        if (st.active) continue;
        st.active = true; st.id = t.identifier;
        st.ox = p.x; st.oy = p.y; st.dx = 0; st.dy = 0;
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', function (e) {
      e.preventDefault();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        var p = toLocal(t.clientX, t.clientY);
        if (moveStick.active && moveStick.id === t.identifier) setStick(moveStick, p);
        else if (aimStick.active && aimStick.id === t.identifier) setStick(aimStick, p);
        pointer.x = p.x; pointer.y = p.y;
      }
    }, { passive: false });

    function endTouch(e) {
      e.preventDefault();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var id = e.changedTouches[i].identifier;
        if (moveStick.id === id) releaseStick(moveStick);
        if (aimStick.id === id) releaseStick(aimStick);
      }
      if (!moveStick.active && !aimStick.active) pointer.down = false;
    }
    canvas.addEventListener('touchend', endTouch, { passive: false });
    canvas.addEventListener('touchcancel', endTouch, { passive: false });
  }

  /* 이동 입력. 키보드와 스틱 중 들어온 쪽을 쓴다. 길이는 최대 1 로 정규화. */
  function moveVec() {
    var x = 0, y = 0;
    if (keys.ArrowLeft || keys.KeyA) x -= 1;
    if (keys.ArrowRight || keys.KeyD) x += 1;
    if (keys.ArrowUp || keys.KeyW) y -= 1;
    if (keys.ArrowDown || keys.KeyS) y += 1;
    if (x === 0 && y === 0 && moveStick.active) { x = moveStick.dx; y = moveStick.dy; }
    var len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x: x, y: y, len: Math.min(len, 1) };
  }

  return {
    attach: attach,
    STICK_R: STICK_R,
    held: function (c) { return !!keys[c]; },
    hit: function (c) { return !!pressed[c]; },
    moveVec: moveVec,
    pointer: pointer,
    moveStick: moveStick,
    aimStick: aimStick,
    confirm: function () { return !!pressed.Space || !!pressed.Enter || pointer.tapped; },
    endFrame: function () {
      pressed = Object.create(null);
      pointer.tapped = false;
    }
  };
})();
