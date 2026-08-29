/* 오디오: 에셋 파일 없이 WebAudio 로 즉석 합성한다. 파일 하나로 굴러가는 게 목표라
   샘플을 두지 않고 오실레이터 + 노이즈 버퍼만 쓴다. */
var NB = window.NB || (window.NB = {});

NB.Audio = (function () {
  var ctx = null;
  var master = null;
  var muted = false;
  var noiseBuf = null;

  function ensure() {
    if (ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
      master = ctx.createGain();
      // 오디오 초기화 전에 M 을 눌러 둔 경우가 있으니 현재 muted 상태를 반영한다
      master.gain.value = muted ? 0 : 0.35;
      master.connect(ctx.destination);
    } catch (e) {
      ctx = null;
      return false;
    }
    return true;
  }

  // 브라우저는 사용자 제스처 전에는 오디오를 막는다. 첫 입력에서 깨워준다.
  function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
  }

  function noise() {
    if (noiseBuf) return noiseBuf;
    var len = Math.floor(ctx.sampleRate * 0.4);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  /* 한 음. from -> to 로 피치를 훑으며 감쇠시킨다. */
  function tone(opts) {
    if (muted || !ensure() || ctx.state !== 'running') return;
    var t = ctx.currentTime;
    var dur = opts.dur || 0.12;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = opts.type || 'square';
    osc.frequency.setValueAtTime(opts.from, t);
    if (opts.to && opts.to !== opts.from) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.vol || 0.25, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function hiss(dur, vol, freq) {
    if (muted || !ensure() || ctx.state !== 'running') return;
    var t = ctx.currentTime;
    var src = ctx.createBufferSource();
    src.buffer = noise();
    var f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq || 1400;
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur);
  }

  return {
    unlock: unlock,
    isMuted: function () { return muted; },
    toggleMute: function () {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.35;
      return muted;
    },
    // combo 가 쌓일수록 벽돌 소리가 반음씩 올라가서 연타가 귀로도 느껴진다.
    brick: function (combo) {
      var step = Math.min(combo || 0, 12);
      var base = 320 * Math.pow(1.0595, step);
      tone({ from: base, to: base * 1.5, dur: 0.07, type: 'square', vol: 0.18 });
    },
    hard:    function () { tone({ from: 160, to: 110, dur: 0.09, type: 'sawtooth', vol: 0.16 }); },
    solid:   function () { hiss(0.05, 0.10, 800); },
    paddle:  function () { tone({ from: 220, to: 380, dur: 0.08, type: 'triangle', vol: 0.22 }); },
    wall:    function () { tone({ from: 300, to: 300, dur: 0.04, type: 'triangle', vol: 0.10 }); },
    launch:  function () { tone({ from: 260, to: 720, dur: 0.16, type: 'square', vol: 0.20 }); },
    laser:   function () { tone({ from: 1200, to: 300, dur: 0.09, type: 'sawtooth', vol: 0.12 }); },
    good:    function () { tone({ from: 520, to: 1040, dur: 0.18, type: 'square', vol: 0.20 }); },
    bad:     function () { tone({ from: 300, to: 90,  dur: 0.28, type: 'sawtooth', vol: 0.20 }); },
    life:    function () { tone({ from: 660, to: 990, dur: 0.30, type: 'triangle', vol: 0.24 }); },
    lose:    function () { tone({ from: 400, to: 60,  dur: 0.55, type: 'sawtooth', vol: 0.26 }); hiss(0.4, 0.12, 500); },
    clear:   function () {
      [523, 659, 784, 1047].forEach(function (f, i) {
        setTimeout(function () { tone({ from: f, to: f, dur: 0.16, type: 'square', vol: 0.20 }); }, i * 90);
      });
    },
    over:    function () {
      [392, 330, 262, 196].forEach(function (f, i) {
        setTimeout(function () { tone({ from: f, to: f, dur: 0.26, type: 'sawtooth', vol: 0.20 }); }, i * 150);
      });
    }
  };
})();
