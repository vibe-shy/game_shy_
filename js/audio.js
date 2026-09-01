/* 효과음은 전부 WebAudio 로 즉석 합성한다. 오디오 파일을 두지 않는다. */
var AF = window.AF || (window.AF = {});

AF.Audio = (function () {
  var ctx = null, master = null, muted = false, noiseBuf = null;

  function ensure() {
    if (ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
      master = ctx.createGain();
      // 초기화 전에 M 을 눌러 뒀을 수 있으니 현재 muted 를 반영한다
      master.gain.value = muted ? 0 : 0.3;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; return false; }
    return true;
  }

  function live() { return !muted && ensure() && ctx.state === 'running'; }

  function noise() {
    if (noiseBuf) return noiseBuf;
    var len = Math.floor(ctx.sampleRate * 0.5);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  function tone(o) {
    if (!live()) return;
    var t = ctx.currentTime, dur = o.dur || 0.12;
    var osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.from, t);
    if (o.to && o.to !== o.from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.2, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  function hiss(dur, vol, freq, q) {
    if (!live()) return;
    var t = ctx.currentTime;
    var src = ctx.createBufferSource(); src.buffer = noise();
    var f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq || 1200; f.Q.value = q || 1;
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur);
  }

  return {
    unlock: function () { if (ensure() && ctx.state === 'suspended') ctx.resume(); },
    isMuted: function () { return muted; },
    toggleMute: function () {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.3;
      return muted;
    },

    shoot:    function () { hiss(0.05, 0.07, 2600, 3); tone({ from: 680, to: 300, dur: 0.06, type: 'triangle', vol: 0.07 }); },
    hit:      function () { tone({ from: 420, to: 240, dur: 0.05, type: 'square', vol: 0.10 }); },
    crit:     function () { tone({ from: 900, to: 380, dur: 0.09, type: 'square', vol: 0.16 }); },
    kill:     function () { hiss(0.14, 0.14, 700, 1.5); tone({ from: 200, to: 70, dur: 0.14, type: 'sawtooth', vol: 0.13 }); },
    hurt:     function () { tone({ from: 240, to: 90, dur: 0.24, type: 'sawtooth', vol: 0.24 }); hiss(0.2, 0.12, 400); },
    enemyShot:function () { tone({ from: 300, to: 520, dur: 0.07, type: 'sawtooth', vol: 0.08 }); },
    dash:     function () { hiss(0.16, 0.12, 900, 2); },
    pickup:   function () { tone({ from: 620, to: 1240, dur: 0.16, type: 'square', vol: 0.16 }); },
    heal:     function () { [660, 880, 1100].forEach(function (f, i) {
                  setTimeout(function () { tone({ from: f, to: f, dur: 0.13, type: 'triangle', vol: 0.16 }); }, i * 70); }); },
    upgrade:  function () { [523, 784, 1047].forEach(function (f, i) {
                  setTimeout(function () { tone({ from: f, to: f, dur: 0.15, type: 'square', vol: 0.17 }); }, i * 80); }); },
    roomClear:function () { [440, 587, 880].forEach(function (f, i) {
                  setTimeout(function () { tone({ from: f, to: f, dur: 0.14, type: 'triangle', vol: 0.15 }); }, i * 90); }); },
    bossIn:   function () { tone({ from: 90, to: 55, dur: 0.9, type: 'sawtooth', vol: 0.26 }); hiss(0.7, 0.16, 260, 0.7); },
    death:    function () { [330, 262, 196, 131].forEach(function (f, i) {
                  setTimeout(function () { tone({ from: f, to: f * 0.85, dur: 0.3, type: 'sawtooth', vol: 0.2 }); }, i * 160); }); }
  };
})();
