const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('인쇄 화면에 닉네임, 가격, 회차 3줄이 올바르게 표시된다', () => {
  const elements = {
    '#line1': { textContent: '' },
    '#line2': { textContent: '' },
    '#line3': { textContent: '' }
  };
  const source = fs.readFileSync(path.join(__dirname, 'print.js'), 'utf8');
  vm.runInNewContext(source, {
    document: { querySelector: (selector) => elements[selector] },
    URLSearchParams,
    window: { location: { search: '?line1=%ED%85%8C%EC%8A%A4%ED%8A%B8%EA%B5%AC%EB%A7%A4%EC%9E%90&line2=15%2C000%EC%9B%90&line3=1%ED%9A%8C%EC%B0%A8' } }
  });

  assert.equal(elements['#line1'].textContent, '테스트구매자');
  assert.equal(elements['#line2'].textContent, '15,000원');
  assert.equal(elements['#line3'].textContent, '1회차');
});

test('판매 속성 전달 시 닉네임, 가격, 회차 3줄로 자동 변환된다', () => {
  const elements = {
    '#line1': { textContent: '' },
    '#line2': { textContent: '' },
    '#line3': { textContent: '' }
  };
  const source = fs.readFileSync(path.join(__dirname, 'print.js'), 'utf8');
  vm.runInNewContext(source, {
    document: { querySelector: (selector) => elements[selector] },
    URLSearchParams,
    window: { location: { search: '?buyerNickname=%ED%99%8D%EA%B8%B8%EB%8F%99&amount=25000&sessionCode=2' } }
  });

  assert.equal(elements['#line1'].textContent, '홍길동');
  assert.equal(elements['#line2'].textContent, '25,000원');
  assert.equal(elements['#line3'].textContent, '2 회차');
});

test('인쇄 화면은 보안 정책에 허용되는 외부 스크립트와 스타일을 사용한다', () => {
  const html = fs.readFileSync(path.join(__dirname, 'print.html'), 'utf8');
  assert.match(html, /<script src="\.\/print\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\.\/print\.css" \/>/);
  assert.doesNotMatch(html, /<script>(?:.|\n)*<\/script>/);
  assert.doesNotMatch(html, /<style>(?:.|\n)*<\/style>/);
});

test('라벨 스티커 인쇄 시 한장 건너뜀 및 상단 잘림을 방지하는 안전 스타일이 적용되어 있다', () => {
  const css = fs.readFileSync(path.join(__dirname, 'print.css'), 'utf8');
  // 1. 상단 잘림 방지: 상단 패딩이 4mm 이상이어야 함
  assert.match(css, /padding:\s*[4-9](\.\d+)?mm/);
  // 2. 페이지 오버플로 방지: break-inside / page-break-inside avoid 적용
  assert.match(css, /page-break-inside:\s*avoid/);
  assert.match(css, /break-inside:\s*avoid/);

  // 3. main.cjs에서 1장만 인쇄하도록 pageRanges 강제 확인
  const mainCjs = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  assert.match(mainCjs, /pageRanges:\s*\[\s*\{\s*from:\s*0,\s*to:\s*0\s*\}\s*\]/);
});

