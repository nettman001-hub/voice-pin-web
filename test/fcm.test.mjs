import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  classifyFcmError,
  createFcmSender,
  outboxPushMessage,
  parseServiceAccount,
  signServiceJwt,
} from '../supabase/functions/_shared/fcm.ts';

const toPem = (der) => {
  const base64 = Buffer.from(der).toString('base64').match(/.{1,64}/g).join('\n');
  return `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----\n`;
};

async function testAccount() {
  const keys = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const pem = toPem(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
  const account = parseServiceAccount(JSON.stringify({
    type: 'service_account',
    project_id: 'voicecap-test',
    client_email: 'fcm@voicecap-test.iam.gserviceaccount.com',
    private_key: pem,
    token_uri: 'https://oauth2.googleapis.com/token',
  }));
  return { account, publicKey: keys.publicKey };
}

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

test('서비스 계정 키: 빈 값·깨진 JSON·필수값 누락이면 FCM을 쓰지 않는다', () => {
  assert.equal(parseServiceAccount(undefined), null);
  assert.equal(parseServiceAccount(''), null);
  assert.equal(parseServiceAccount('{not json'), null);
  assert.equal(parseServiceAccount(JSON.stringify({ project_id: 'p', client_email: 'e' })), null);
  const account = parseServiceAccount(JSON.stringify({ project_id: 'p', client_email: 'e', private_key: '-----BEGIN PRIVATE KEY-----x' }));
  assert.equal(account.tokenUri, 'https://oauth2.googleapis.com/token');
});

test('Google OAuth JWT를 RS256으로 서명한다', async () => {
  const { account, publicKey } = await testAccount();
  const jwt = await signServiceJwt(account, 1_800_000_000);
  const [header, claims, signature] = jwt.split('.');
  assert.deepEqual(decode(header), { alg: 'RS256', typ: 'JWT' });
  assert.deepEqual(decode(claims), {
    iss: 'fcm@voicecap-test.iam.gserviceaccount.com',
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: 1_800_000_000,
    exp: 1_800_003_600,
  });
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    Buffer.from(signature, 'base64url'),
    new TextEncoder().encode(`${header}.${claims}`),
  );
  assert.equal(valid, true);
});

test('보낼 문자 신호는 내용 없는 고우선순위 데이터 메시지다', () => {
  assert.deepEqual(outboxPushMessage('tok'), {
    message: { token: 'tok', data: { type: 'OUTBOX' }, android: { priority: 'HIGH', ttl: '900s', collapse_key: 'outbox' } },
  });
});

test('FCM 오류: 등록 해제·다른 프로젝트·잘못된 토큰은 토큰 삭제, 나머지는 실패', () => {
  const body = (status, errorCode) => ({ error: { status, details: errorCode ? [{ '@type': 'x', errorCode }] : [] } });
  assert.equal(classifyFcmError(404, body('NOT_FOUND', 'UNREGISTERED')), 'STALE_TOKEN');
  assert.equal(classifyFcmError(403, body('PERMISSION_DENIED', 'SENDER_ID_MISMATCH')), 'STALE_TOKEN');
  assert.equal(classifyFcmError(400, body('INVALID_ARGUMENT')), 'STALE_TOKEN');
  assert.equal(classifyFcmError(404, {}), 'STALE_TOKEN');
  assert.equal(classifyFcmError(429, body('RESOURCE_EXHAUSTED', 'QUOTA_EXCEEDED')), 'FAILED');
  assert.equal(classifyFcmError(503, body('UNAVAILABLE', 'UNAVAILABLE')), 'FAILED');
  assert.equal(classifyFcmError(500, null), 'FAILED');
});

test('접근 토큰은 만료 1분 전까지 재사용하고, 메시지는 프로젝트 주소로 보낸다', async () => {
  const { account } = await testAccount();
  const calls = [];
  let clock = 1_800_000_000_000;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url === account.tokenUri) {
      return new Response(JSON.stringify({ access_token: `access-${calls.length}`, expires_in: 3600 }), { status: 200 });
    }
    if (JSON.parse(init.body).message.token === 'gone') {
      return new Response(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 });
    }
    return new Response('{}', { status: 200 });
  };
  const send = createFcmSender(account, fetchImpl, () => clock);

  assert.equal(await send('tok-1'), 'SENT');
  assert.equal(await send('gone'), 'STALE_TOKEN');
  assert.equal(calls.filter((call) => call.url === account.tokenUri).length, 1);
  const tokenRequest = new URLSearchParams(calls[0].init.body);
  assert.equal(tokenRequest.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  assert.equal(tokenRequest.get('assertion').split('.').length, 3);
  assert.equal(calls[1].url, 'https://fcm.googleapis.com/v1/projects/voicecap-test/messages:send');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer access-1');

  clock += 3_600_000 - 30_000;
  assert.equal(await send('tok-1'), 'SENT');
  assert.equal(calls.filter((call) => call.url === account.tokenUri).length, 2);
});

test('인증이 실패하면 오류를 던져 호출부가 실패로 처리한다', async () => {
  const { account } = await testAccount();
  const send = createFcmSender(account, async () => new Response('{"error":"invalid_grant"}', { status: 400 }));
  await assert.rejects(send('tok'), /FCM 인증 실패 \(400\)/);
});

test('device-pair가 알림 토큰 등록과 대기열 알림을 연결한다', () => {
  const source = fs.readFileSync(new URL('../supabase/functions/device-pair/index.ts', import.meta.url), 'utf8');
  assert.match(source, /action === 'register-push'/);
  assert.match(source, /action === 'notify-outbox'/);
  assert.match(source, /FCM_SERVICE_ACCOUNT_JSON/);
  assert.match(source, /\.eq\('status', 'QUEUED'\)/);
  assert.match(source, /result === 'STALE_TOKEN'/);
  assert.match(source, /from\('device_push_tokens'\)\.delete\(\)\.eq\('device_id', device\.id\)/);
});
