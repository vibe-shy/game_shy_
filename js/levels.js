/* 레벨은 문자 지도로 적는다. 한 줄 = 벽돌 한 행, 반드시 COLS(10)글자.
     .  빈칸
     1  일반(1히트)   2  단단(2히트)   3  강철(3히트)
     X  파괴 불가(점수 없음, 클리어 조건에서도 제외)
     P  1히트지만 아이템을 반드시 떨군다 */
var NB_ROOT = typeof window !== 'undefined' ? window : globalThis;   // node 로 지도 검증만 돌릴 수 있게
var NB = NB_ROOT.NB || (NB_ROOT.NB = {});

NB.Levels = (function () {
  var COLS = 10;

  var levels = [
    {
      name: 'WARM UP',
      speed: 6.0,
      map: [
        '1111111111',
        '1111111111',
        '11P1111P11'
      ]
    },
    {
      name: 'DOUBLE DECK',
      speed: 6.3,
      map: [
        '2222222222',
        '1111111111',
        '1P111111P1',
        '1111111111'
      ]
    },
    {
      name: 'PYRAMID',
      speed: 6.6,
      map: [
        '....11....',
        '...1111...',
        '..111111..',
        '.1122111P.',
        '1111111111'
      ]
    },
    {
      name: 'CHECKPOINT',
      speed: 6.9,
      map: [
        'X1X1X1X1X1',
        '1212121212',
        '2P2222222P',
        '.1.1.1.1.1'
      ]
    },
    {
      name: 'FORTRESS',
      speed: 7.2,
      map: [
        'XX222222XX',
        'X33333333X',
        '.3P3223P3.',
        '.22222222.',
        '..111111..'
      ]
    },
    {
      name: 'SLIPSTREAM',
      speed: 7.5,
      map: [
        '3..2..1..P',
        '.3..2..1..',
        '..3..2..1.',
        '1..3..2..P',
        '.1..3..2..'
      ]
    },
    {
      name: 'THE TUNNEL',
      speed: 7.8,
      map: [
        'XXX3333XXX',
        '33P3333P33',
        '3322223333',
        '2211112222'
      ]
    },
    {
      name: 'LAST STAND',
      speed: 8.2,
      map: [
        'X33333333X',
        '3P3333333P',
        '3333333333',
        '32X2222X23',
        '2222222222',
        '..1P11P1..'
      ]
    }
  ];

  /* 지도 오타(행 길이 불일치, 모르는 글자)는 조용히 깨진 레벨이 되므로 미리 잡는다. */
  function validate() {
    var problems = [];
    levels.forEach(function (lv, i) {
      lv.map.forEach(function (row, r) {
        if (row.length !== COLS) {
          problems.push('레벨 ' + (i + 1) + ' (' + lv.name + ') ' + r + '행: 길이 ' + row.length + ', 기대값 ' + COLS);
        }
        for (var c = 0; c < row.length; c++) {
          if ('.123XP'.indexOf(row[c]) === -1) {
            problems.push('레벨 ' + (i + 1) + ' ' + r + '행 ' + c + '열: 알 수 없는 글자 "' + row[c] + '"');
          }
        }
      });
      if (lv.map.join('').replace(/[.X]/g, '').length === 0) {
        problems.push('레벨 ' + (i + 1) + ': 깰 수 있는 벽돌이 없다');
      }
    });
    return problems;
  }

  return {
    COLS: COLS,
    count: levels.length,
    get: function (i) { return levels[i]; },
    all: levels,
    validate: validate
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = NB.Levels;
