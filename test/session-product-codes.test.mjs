import test from 'node:test';
import assert from 'node:assert/strict';

// Core session product code assignment logic matching src/services/storageService.ts
export function getNextProductCodeForSession(
  sessionId,
  existingSales = [],
  activeProductCode,
  existingProducts
) {
  const sessionSales = sessionId ? existingSales.filter((s) => s.sessionId === sessionId) : existingSales;

  const numbers = new Set();
  sessionSales.forEach((s) => {
    const c = String(s.productCode || '').trim();
    if (/^\d+$/.test(c)) {
      const n = parseInt(c, 10);
      if (n > 0) numbers.add(n);
    }
  });

  if (activeProductCode && /^\d+$/.test(String(activeProductCode).trim())) {
    const n = parseInt(String(activeProductCode).trim(), 10);
    if (n > 0) numbers.add(n);
  }

  if (existingProducts) {
    existingProducts.forEach((p) => {
      const c = String(p.productCode || '').trim();
      if (/^\d+$/.test(c)) {
        const n = parseInt(c, 10);
        if (n > 0) numbers.add(n);
      }
    });
  }

  if (numbers.size === 0) {
    return '1';
  }

  const maxNum = Math.max(...Array.from(numbers));
  return String(maxNum + 1);
}

// Spoken product code regex matching src/context/LiveContext.tsx
export function extractSpokenProductCode(text) {
  const match =
    text.match(/상품\s*번호(?:는|은|가)?\s*([0-9]+)\s*번?/u) ||
    text.match(/상품\s*([0-9]+)\s*번/u) ||
    text.match(/([0-9]+)\s*번\s*상품/u);
  return match?.[1];
}

test('Session Product Code: new session starts with product code 1', () => {
  const sessionSales = [];
  const code = getNextProductCodeForSession('20260910_1700', sessionSales);
  assert.equal(code, '1');
});

test('Session Product Code: increments sequentially within the same session', () => {
  const sessionSales = [
    { id: 's1', sessionId: '20260910_1700', productCode: '1', buyerNickname: 'A', amount: 10000, status: '확정' },
  ];
  const nextCode = getNextProductCodeForSession('20260910_1700', sessionSales);
  assert.equal(nextCode, '2');

  sessionSales.push({
    id: 's2',
    sessionId: '20260910_1700',
    productCode: '2',
    buyerNickname: 'B',
    amount: 20000,
    status: '확정',
  });
  const nextCode2 = getNextProductCodeForSession('20260910_1700', sessionSales);
  assert.equal(nextCode2, '3');
});

test('Session Product Code: resets to 1 when a new session starts', () => {
  const allSales = [
    { id: 's1', sessionId: '20260910_1400', productCode: '1', buyerNickname: 'A', amount: 10000, status: '확정' },
    { id: 's2', sessionId: '20260910_1400', productCode: '2', buyerNickname: 'B', amount: 20000, status: '확정' },
    { id: 's3', sessionId: '20260910_1400', productCode: '3', buyerNickname: 'C', amount: 30000, status: '확정' },
  ];

  // A new session 20260910_1700 has no sales yet
  const nextCodeNewSession = getNextProductCodeForSession('20260910_1700', allSales);
  assert.equal(nextCodeNewSession, '1', 'New session must start from product code 1');
});

test('Session Product Code: accounts for activeProductCode even before sales occur', () => {
  const sessionSales = [];
  // Active product 1 is registered, but no sales yet recorded
  const nextCode = getNextProductCodeForSession('20260910_1700', sessionSales, '1');
  assert.equal(nextCode, '2');
});

test('Session Product Code: accounts for existingProducts list', () => {
  const sessionSales = [];
  const existingProducts = [{ productCode: '1' }, { productCode: '2' }];
  const nextCode = getNextProductCodeForSession('20260910_1700', sessionSales, null, existingProducts);
  assert.equal(nextCode, '3');
});

test('Spoken Product Code Extraction: extracts various Korean speech formats', () => {
  assert.equal(extractSpokenProductCode('상품번호 1번 등록'), '1');
  assert.equal(extractSpokenProductCode('상품번호는 5번입니다'), '5');
  assert.equal(extractSpokenProductCode('상품 2번 가격 25000원'), '2');
  assert.equal(extractSpokenProductCode('3번 상품 등록해줘'), '3');
  assert.equal(extractSpokenProductCode('10번 상품'), '10');
  assert.equal(extractSpokenProductCode('상품등록 가격 3만원'), undefined);
});
