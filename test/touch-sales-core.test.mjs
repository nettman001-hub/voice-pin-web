import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTouchPrice,
  validateTouchCommit,
} from '../supabase/functions/sales-api/handlers/touchSalesCore.ts';
test('touch numeric pad preserves explicit won and decimal ten-thousands, rejects ambiguous input', () => {
  for (const [input, won] of [
    ['1.5', 15000],
    ['0.8', 8000],
    ['3', 30000],
    ['15000', 15000],
    ['1.', 10000],
    ['.5', 5000],
  ])
    assert.equal(parseTouchPrice(input).amount, won, input);
  for (const input of [
    '150',
    '100',
    '999',
    '0',
    '-1',
    '1.5.3',
    'Infinity',
    '1500.5',
    '999999999',
  ])
    assert.equal(parseTouchPrice(input).amount, null, input);
});
test('touch commits validate actual keypad value, full comment, time and quantity', () => {
  const data = {
    operationId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    comment: {
      platformMessageId: 'msg',
      nickname: '하니',
      content: '저요',
      capturedAt: new Date().toISOString(),
    },
    confirmedAt: new Date().toISOString(),
    inputPrice: '1.5',
    unitPrice: 15000,
    quantity: 1,
  };
  assert.equal(validateTouchCommit(data), null);
  assert.ok(validateTouchCommit({ ...data, unitPrice: 1500 }));
  assert.ok(validateTouchCommit({ ...data, quantity: 0 }));
  assert.ok(
    validateTouchCommit({ ...data, comment: { ...data.comment, content: '' } }),
  );
});
