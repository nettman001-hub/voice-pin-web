import test from 'node:test';
import assert from 'node:assert/strict';
import { groupSalesByBuyer } from '../src/services/buyerSaleGrouping.ts';

const sale = (id, nickname, buyerId, second) => ({
  id, buyerNickname: nickname, buyerId, recognizedAt: `2026-10-17T01:00:${String(second).padStart(2, '0')}Z`,
});

test('comparison list groups repeat purchases but keeps each sale and newest buyer first', () => {
  const older = sale('hani-first', '하니', 'buyer-hani', 1);
  const other = sale('other', '러블리', 'buyer-lovely', 2);
  const newer = sale('hani-second', '하니💕', 'buyer-hani', 3);
  const groups = groupSalesByBuyer([older, other, newer]);

  assert.deepEqual(groups.map((group) => group.records.map((record) => record.id)), [
    ['hani-second', 'hani-first'], ['other'],
  ]);
  assert.equal(groups[0].nickname, '하니💕');
  assert.equal(groups[0].records[1], older);
});

test('different buyer IDs and unidentified rows do not merge by display name', () => {
  const groups = groupSalesByBuyer([
    sale('identified-a', '하니', 'buyer-a', 1),
    sale('identified-b', '하니', 'buyer-b', 2),
    sale('legacy', '하니', undefined, 3),
    sale('unknown-a', '', undefined, 4),
    sale('unknown-b', '', undefined, 5),
  ]);
  assert.equal(groups.length, 5);
  assert.deepEqual(groups.map((group) => group.records.length), [1, 1, 1, 1, 1]);
});
