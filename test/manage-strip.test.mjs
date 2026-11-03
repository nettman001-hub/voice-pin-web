import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { broadcastCallList, buyerManageInfo, keptCountByBuyer, stripParts } from '../src/services/manage/buyerStrip.ts';

const links = [
  { phone: '01011112222', buyerKey: 'buyer:b1', nickname: '꽃심이', linkedAt: '2026-10-01T00:00:00Z' },
  { phone: '01033334444', nickname: '하늘이', linkedAt: '2026-10-01T00:00:00Z' },
];
const items = [
  { saleId: 'a', buyerKey: 'buyer:b1', state: 'KEPT' },
  { saleId: 'b', buyerKey: 'buyer:b1', state: 'KEPT' },
  { saleId: 'c', buyerKey: 'buyer:b1', state: 'RESERVED' },
  { saleId: 'd', buyerKey: 'nickname:달', state: 'KEPT' },
];

test('strip: kept count and contact state per buyer', () => {
  const kept = keptCountByBuyer(items);
  const flower = buyerManageInfo({ buyerId: 'b1', nickname: '꽃심이' }, links, kept);
  assert.deepEqual(stripParts(flower), ['킵 2']);
  const moon = buyerManageInfo({ nickname: '달' }, links, kept);
  assert.deepEqual(stripParts(moon), ['킵 1', '연락처 없음']);
  const sky = buyerManageInfo({ nickname: '하늘이' }, links, kept);
  assert.deepEqual(stripParts(sky), [], 'legacy link by exact nickname counts as linked');
});

test('call list: this broadcast buyers without contact, unique, and a text message drops them', () => {
  const buyers = [{ buyerId: 'b1', nickname: '꽃심이' }, { nickname: '달' }, { nickname: '달' }, { nickname: '별' }, { nickname: ' ' }];
  assert.deepEqual(broadcastCallList(buyers, links).map((b) => b.nickname), ['달', '별']);
  const after = broadcastCallList(buyers, links, [{ phone: '01055556666', direction: 'INCOMING', body: '별 입니다 주소 보내요' }]);
  assert.deepEqual(after.map((b) => b.nickname), ['달']);
});

test('sell page and PC listening home show the extras only behind the new-manage toggle', () => {
  const extras = fs.readFileSync('src/components/manage/ManageSellExtras.tsx', 'utf8');
  assert.match(extras, /if \(!enabled\) return null;/);
  assert.match(extras, /useOptionalCommerce/);
  assert.doesNotMatch(extras, /useSales\(|useCommerce\(/, 'standalone /sell has no Sales/Commerce providers');
  const sell = fs.readFileSync('src/pages/seller/TouchMobileSalesPage.tsx', 'utf8');
  assert.match(sell, /<ManageSellExtras selected=\{selectedSnapshot\} buyers=\{broadcastBuyers\} \/>/);
  const live = fs.readFileSync('src/pages/seller/LiveHomePage.tsx', 'utf8');
  assert.match(live, /<ManageSellExtras callListOnly buyers=\{callListBuyers\} \/>/);
});
