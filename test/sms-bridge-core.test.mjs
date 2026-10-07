import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildServerClaim,
  invoiceFromRow,
  parseOutgoing,
  parsePayment,
} from '../supabase/functions/sms-bridge/core.ts';

const categories = new Set(['PURCHASE_INFO', 'CUSTOMER_INQUIRY', 'QUESTION', 'ANSWER', 'INVOICE', 'SHIPPING', 'GENERAL']);

test('outgoing: 필수값 검사와 기본값', () => {
  assert.equal(parseOutgoing({ phoneNumber: '010', body: 'x' }, categories).ok, false);
  const parsed = parseOutgoing({ externalId: 'device-sms-sent-7', phoneNumber: '010-1234-5678', body: '안녕하세요', sentAt: 'bad' }, categories);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.status, 'SENT');
  assert.equal(parsed.value.category, 'GENERAL');
  assert.equal(parsed.value.error, null);
  assert.ok(!Number.isNaN(Date.parse(parsed.value.sentAt)));
});

test('outgoing: 실패 상태는 오류 문구를 남긴다', () => {
  const parsed = parseOutgoing({ externalId: 'e', phoneNumber: '010', body: 'b', status: 'FAILED', category: 'ANSWER' }, categories);
  assert.equal(parsed.value.status, 'FAILED');
  assert.equal(parsed.value.category, 'ANSWER');
  assert.equal(parsed.value.error, 'SMS 발송 실패');
});

test('payment-incoming: 금액은 1원 이상 정수, 입금자명이 없으면 미확인', () => {
  assert.equal(parsePayment({ externalId: 'x', amount: 0 }).ok, false);
  assert.equal(parsePayment({ externalId: 'x', amount: 1000.5 }).ok, false);
  assert.equal(parsePayment({ amount: 1000 }).ok, false);
  const parsed = parsePayment({ externalId: 'banknoti:a:b', amount: '30000', receiverName: ' 홍판서 ', source: 'SMS', bank: '카카오뱅크' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.amount, 30000);
  assert.equal(parsed.value.payerName, '미확인');
  assert.equal(parsed.value.receiverName, '홍판서');
  assert.equal(parsed.value.source, 'SMS');
  assert.equal(parsePayment({ externalId: 'x', amount: 1, source: 'OTHER' }).value.source, 'NOTIFICATION');
});

test('정산서 행을 대조용 값으로 바꾼다', () => {
  const value = invoiceFromRow({
    id: 'inv', customer_nickname: '성훈맘', amount: 30000, status: 'SENT', sale_ids: ['s1'], deposit_code: 'A7K2', created_at: '2026-10-07T00:00:00Z',
  });
  assert.deepEqual(value, {
    id: 'inv', customerNickname: '성훈맘', amount: 30000, status: 'SENT', saleIds: ['s1'], depositCode: 'A7K2', createdAt: '2026-10-07T00:00:00Z',
  });
});

test('구매정보 문자로 서버에서 구매 신청을 만들고 입금자명 별칭을 뽑는다', () => {
  const message = {
    id: 'sms-1',
    phone_number: '01012345678',
    body: '닉네임: 성훈맘\n주소: 서울시 강남구\n상품: 햇반\n금액: 30,000원\n입금자명: 김철수',
    attachments: [{ id: 'a', mimeType: 'image/jpeg', path: 'ws/sms/sms-1/x.jpg' }],
    received_at: '2026-10-07T01:00:00.000Z',
  };
  const sales = [
    { id: 'sale-1', session_id: 's', buyer_nickname: '성훈맘', amount: 30000, product_name: '햇반', recognized_at: '2026-10-06T10:00:00Z', status: '확정', capture_image_paths: ['p'] },
    { id: 'sale-2', session_id: 's', buyer_nickname: '하늘이', amount: 30000, product_name: '햇반', recognized_at: '2026-10-06T10:00:00Z', status: '확정', capture_image_paths: [] },
    { id: 'sale-held', session_id: 's', buyer_nickname: '성훈맘', amount: 30000, product_name: '햇반', recognized_at: '2026-10-06T11:00:00Z', status: '보류', capture_image_paths: [] },
  ];
  const { claim, alias } = buildServerClaim('ws', message, sales, '2026-10-07T01:00:01.000Z');
  assert.equal(claim.id, 'claim-sms-1');
  assert.equal(claim.message_id, 'sms-1');
  assert.equal(claim.nickname, '성훈맘');
  assert.equal(claim.amount, 30000);
  assert.deepEqual(claim.sale_ids, ['sale-1']);
  assert.deepEqual(claim.capture_image_paths, ['ws/sms/sms-1/x.jpg']);
  assert.equal(claim.match_status, 'MATCHED');
  assert.equal(claim.created_at, '2026-10-07T01:00:00.000Z');
  assert.deepEqual(alias, { payer_name_normalized: '김철수', buyer_nickname: '성훈맘' });
});

test('입금자명이 없으면 별칭을 만들지 않는다', () => {
  const { alias } = buildServerClaim('ws', { id: 'm', phone_number: '010', body: '닉네임: 하늘이\n주소: 부산\n금액: 10000원', attachments: [] }, []);
  assert.equal(alias, null);
});

test('sms-bridge가 새 액션과 서버 대조를 연결한다', () => {
  const source = fs.readFileSync(new URL('../supabase/functions/sms-bridge/index.ts', import.meta.url), 'utf8');
  assert.match(source, /action === 'outgoing'/);
  assert.match(source, /direction: 'OUTGOING'/);
  assert.match(source, /createClaimForMessage\(workspaceId, data\)/);
  assert.match(source, /matchStoredPayment\(workspaceId, id, input\)/);
  assert.match(source, /receiver_name: input\.receiverName/);
});
