/* 입력: 키보드 / 마우스 / 터치를 한 곳에서 정규화한다.
   포인터 좌표는 캔버스의 CSS 크기가 아니라 내부 해상도(640x760) 기준으로 돌려준다. */
var NB = window.NB || (window.NB = {});

NB.Input = (function () {
  var keys = Object.create(null);
  var pressed = Object.create(null);   // 이번 프레임에 새로 눌린 키
  var canvas = null;

  var pointer = { x: 320, active: false, down: false, tapped: false };

  var TRACKED = {
    ArrowLeft: 1, ArrowRight: 1, KeyA: 1, KeyD: 1,
    Space: 1, KeyP: 1, KeyM: 1, KeyR: 1, Escape: 1, Enter: 1
  };

  function toLocalX(clientX) {
    var r = canvas.getBoundingClientRect();
    if (!r.width) return pointer.x;
    return (clientX - r.left) * (canvas.width / r.width);
  }

  function onKeyDown(e) {
    if (TRACKED[e.code]) e.preventDefault();
    if (!keys[e.code]) pressed[e.code] = true;
    keys[e.code] = true;
    NB.Audio.unlock();
  }

  function onKeyUp(e) {
    keys[e.code] = false;
  }

  function attach(cv) {
    canvas = cv;

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    // 탭 전환 중 눌린 키가 남아 패들이 혼자 달리는 걸 막는다.
    window.addEventListener('blur', function () { keys = Object.create(null); });

    canvas.addEventListener('mousemove', function (e) {
      pointer.x = toLocalX(e.clientX);
      pointer.active = true;
    });
    canvas.addEventListener('mouseleave', function () { pointer.active = false; });
    canvas.addEventListener('mousedown', function (e) {
      e.preventDefault();
      pointer.x = toLocalX(e.clientX);
      pointer.active = true;
      pointer.down = true;
      pointer.tapped = true;
      NB.Audio.unlock();
    });
    window.addEventListener('mouseup', function () { pointer.down = false; });

    function touch(e) {
      var t = e.changedTouches[0];
      if (!t) return;
      e.preventDefault();
      pointer.x = toLocalX(t.clientX);
      pointer.active = true;
      NB.Audio.unlock();
    }
    canvas.addEventListener('touchstart', function (e) {
      touch(e);
      pointer.down = true;
      pointer.tapped = true;
    }, { passive: false });
    canvas.addEventListener('touchmove', touch, { passive: false });
    canvas.addEventListener('touchend', function (e) {
      touch(e);
      pointer.down = false;
      pointer.active = false;
    }, { passive: false });

    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  return {
    attach: attach,
    held: function (code) { return !!keys[code]; },
    /* 눌린 순간만 true. 프레임 끝의 endFrame() 에서 비워진다. */
    hit: function (code) { return !!pressed[code]; },
    axis: function () {
      var v = 0;
      if (keys.ArrowLeft || keys.KeyA) v -= 1;
      if (keys.ArrowRight || keys.KeyD) v += 1;
      return v;
    },
    pointer: pointer,
    /* 화면 아무 데나 눌러 넘기는 용도 — 키보드/포인터 공용 */
    confirm: function () {
      return !!pressed.Space || !!pressed.Enter || pointer.tapped;
    },
    endFrame: function () {
      pressed = Object.create(null);
      pointer.tapped = false;
    }
  };
})();
