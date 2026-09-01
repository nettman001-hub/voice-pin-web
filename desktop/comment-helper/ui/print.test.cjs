const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('인쇄 화면에 닉네임·금액과 시간이 표시된다', () => {
  const elements = {
    '#line1': { textContent: '' },
    '#line2': { textContent: '' }
  };
  const source = fs.readFileSync(path.join(__dirname, 'print.js'), 'utf8');
  vm.runInNewContext(source, {
    document: { querySelector: (selector) => elements[selector] },
    URLSearchParams,
    window: { location: { search: '?line1=%ED%85%8C%EC%8A%A4%ED%8A%B8%EA%B5%AC%EB%A7%A4%EC%9E%90%2C+15%2C000%EC%9B%90&line2=2026.+9.+1.+%EC%98%A4%ED%9B%84+5%3A30' } }
  });

  assert.equal(elements['#line1'].textContent, '테스트구매자, 15,000원');
  assert.equal(elements['#line2'].textContent, '2026. 9. 1. 오후 5:30');
});

test('인쇄 화면은 보안 정책에 허용되는 외부 스크립트와 스타일을 사용한다', () => {
  const html = fs.readFileSync(path.join(__dirname, 'print.html'), 'utf8');
  assert.match(html, /<script src="\.\/print\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\.\/print\.css" \/>/);
  assert.doesNotMatch(html, /<script>(?:.|\n)*<\/script>/);
  assert.doesNotMatch(html, /<style>(?:.|\n)*<\/style>/);
});
