/* 의존성 없는 레벨 지도 검증. `node test/levels.test.js`
   행 길이·알 수 없는 글자·깰 수 없는 레벨을 잡는다. 지도는 손으로 그리는 데이터라
   오타가 나면 조용히 이상한 레벨이 되므로 커밋 전에 한 번 돌린다. */
const path = require('path');
const Levels = require(path.join(__dirname, '..', 'js', 'levels.js'));

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('  PASS  ' + name);
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}

console.log('레벨 데이터 검증');

const problems = Levels.validate();
check('지도 문법 오류 없음', problems.length === 0, problems);
check('레벨이 1개 이상', Levels.count > 0, Levels.count);

Levels.all.forEach((lv, i) => {
  const tag = 'L' + (i + 1) + ' ' + lv.name;
  check(tag + ': 이름 있음', typeof lv.name === 'string' && lv.name.length > 0);
  check(tag + ': 속도가 상식 범위(4~12)', lv.speed >= 4 && lv.speed <= 12, lv.speed);
  check(tag + ': 벽돌 행 12줄 이하', lv.map.length <= 12, lv.map.length);
});

// 난이도는 뒤로 갈수록 빨라져야 한다
const speeds = Levels.all.map(l => l.speed);
check('레벨이 진행될수록 공이 빨라짐',
      speeds.every((s, i) => i === 0 || s >= speeds[i - 1]), speeds);

console.log(fail ? '\n' + fail + '건 실패' : '\n전부 통과');
process.exit(fail ? 1 : 0);
