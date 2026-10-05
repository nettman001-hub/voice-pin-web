import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadTsModule(relativePath) {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(compiled, {
    module: mod,
    exports: mod.exports,
    setTimeout,
    clearTimeout,
    Date,
    Array,
    Set,
    Math,
    Promise,
    console,
  }, { filename: relativePath });
  return mod.exports;
}

const inputModule = loadTsModule('../src/services/anti/sellerLogic02AntiInput.ts');
const vocabModule = loadTsModule('../src/services/anti/sellerLogic02AntiVocabulary.ts');
const captureModule = loadTsModule('../src/services/anti/sellerLogic02AntiCapture.ts');
const contractModule = loadTsModule('../src/services/anti/sellerLogic02AntiContract.ts');

const {
  parseSellerLogic02AntiText,
  SELLER_LOGIC_METHOD1_EXAMPLE,
  SELLER_LOGIC_METHOD2_EXAMPLE,
} = inputModule;

const {
  SttVocabularyManager,
  generateKoreanPronunciationHints,
} = vocabModule;

const {
  SttSeamlessCaptureService,
} = captureModule;

const {
  runSellerLogic02AntiAnalysis,
} = contractModule;

test('02Anti: 판매방식 1 및 판매방식 2 예시 데이터 정상 파싱', () => {
  const method1 = parseSellerLogic02AntiText(SELLER_LOGIC_METHOD1_EXAMPLE, '2026-10-05', 'session-1');
  assert.ok(method1.comments.length > 50, '방법1 댓글 50건 이상 파싱');
  assert.ok(method1.transcripts.length > 50, '방법1 멘트 50건 이상 파싱');

  const method2 = parseSellerLogic02AntiText(SELLER_LOGIC_METHOD2_EXAMPLE, '2026-10-05', 'session-2');
  assert.ok(method2.comments.length > 50, '방법2 댓글 50건 이상 파싱');
  assert.ok(method2.transcripts.length > 50, '방법2 멘트 50건 이상 파싱');
});

test('02Anti: 영문 닉네임 한글 G2P 발음 힌트 생성', () => {
  const hints1 = generateKoreanPronunciationHints('xou.3z');
  assert.ok(hints1.includes('엑소'), 'xou.3z에 엑소 발음 포함');

  const hints2 = generateKoreanPronunciationHints('😚JJEONG😚');
  assert.ok(hints2.some(h => h.includes('정') || h.includes('쩡')), '이모지 포함 영문 닉네임 정/쩡 발음 포함');
});

test('02Anti STT 어휘 매니저: 첫 번째 즉시 전송(0ms) + 두 번째부터 5초 쿨다운(배치 큐 중복 제거) 룰', async () => {
  const updateEvents = [];
  const debugLogs = [];

  const manager = new SttVocabularyManager({
    maxVocabularySize: 50,
    batchCooldownMs: 50, // 테스트를 위해 50ms로 단축
    onUpdate: (evt) => updateEvents.push(evt),
    onDebugLog: (log) => debugLogs.push(log),
  });

  manager.seedInitialNicknames(['기존1', '기존2', '기존3']);
  assert.equal(manager.getNicknames().length, 3);

  // [규칙 1] 첫 번째 구매의사자 감지 -> 0ms 즉시 세션 재시작 트리거!
  manager.registerNickname('구매자A', true);

  assert.equal(updateEvents.length, 1, '첫 번째 구매의사자는 즉시 세션 업데이트');
  assert.equal(updateEvents[0].triggerType, 'IMMEDIATE_FIRST');
  assert.equal(updateEvents[0].newCandidates[0], '구매자A');
  assert.ok(manager.getNicknames().includes('구매자A'));

  // [규칙 2] 쿨다운 기간(5초) 동안 연속 유입되는 구매의사자들 -> 큐에 적재 (중복 제거)
  manager.registerNickname('구매자B', true);
  manager.registerNickname('구매자C', true);
  manager.registerNickname('구매자B', true); // 중복 닉네임 입력!

  // 아직 타이머 만료 전이므로 즉시 업데이트는 1건 그대로여야 함
  assert.equal(updateEvents.length, 1, '쿨다운 중에는 즉시 업데이트되지 않고 배치 대기');

  // 쿨다운 만료 대기 (60ms)
  await new Promise((r) => setTimeout(r, 70));

  // 쿨다운 만료 후 배치 업데이트 1회 발생
  assert.equal(updateEvents.length, 2, '쿨다운 만료 후 배치 일괄 업데이트 1회 실행');
  assert.equal(updateEvents[1].triggerType, 'BATCH_COOLDOWN');
  // 중복된 구매자B는 1번만 포함되어야 함
  assert.equal(updateEvents[1].newCandidates.length, 2, '중복 제거되어 구매자B와 구매자C만 포함');
  assert.ok(updateEvents[1].newCandidates.includes('구매자B'));
  assert.ok(updateEvents[1].newCandidates.includes('구매자C'));

  manager.destroy();
});

test('02Anti 캡처 서비스: 무중단 오디오 버퍼링 및 듀얼 소켓 핸드오버', async () => {
  const logs = [];
  const capture = new SttSeamlessCaptureService({
    ringBufferSeconds: 15,
    onDebugLog: (log) => logs.push(log),
  });

  capture.startCapture();
  const dummyChunk = new Uint8Array([1, 2, 3, 4]);
  capture.pushAudioChunk(dummyChunk);

  const status1 = capture.getBufferStatus();
  assert.equal(status1.count, 1);
  assert.equal(status1.currentSessionId, 1);

  // 듀얼 소켓 핸드오버 실행
  const nextSession = await capture.handoverToNewSession(['어휘1', '어휘2'], '테스트 세션 교체');
  assert.equal(nextSession, 2);

  const status2 = capture.getBufferStatus();
  assert.equal(status2.currentSessionId, 2);

  // 핸드오버 로그가 정상 기록되었는지 확인
  const handoverLogs = logs.filter((l) => l.type === 'HANDOVER');
  assert.ok(handoverLogs.length >= 2, '핸드오버 시작 및 완료 로그 확인');

  capture.stopCapture();
});

test('02Anti AI 자율 판단 엔진: 구매의사 감지, STT 오탈자 닉네임 교차 매칭, 가격 확정', async () => {
  const aiLogs = [];
  const mockComments = [
    { id: 'c1', sessionId: 's1', nickname: '루비', content: '입고계신거 ㅈㅇ', capturedAt: '2026-10-05T14:40:30.000Z' },
    { id: 'c2', sessionId: 's1', nickname: 'xou.3z', content: '저여 맨투맨', capturedAt: '2026-10-05T15:00:05.000Z' },
  ];
  const mockTranscripts = [
    { id: 't1', text: '루비 언니 드릴게요. 가격은 18,000원.', recognizedAt: '2026-10-05T14:40:40.000Z', isFinal: true },
    { id: 't2', text: '저요 맨투맨. 우리 맨투맨 드릴게요. 엑소 언니 1.8.', recognizedAt: '2026-10-05T15:00:18.000Z', isFinal: true },
  ];

  const result = await runSellerLogic02AntiAnalysis(
    {
      sessionId: 'test-session',
      slotNumber: 1,
      comments: mockComments,
      transcripts: mockTranscripts,
    },
    {
      onDebugLog: (log) => aiLogs.push(log),
    }
  );

  assert.ok(result.decisions.length >= 2, '2건의 거래 확정 감지');

  // 1. 루비 매칭 확인
  const rubyDecision = result.decisions.find((d) => d.nickname === '루비');
  assert.ok(rubyDecision, '루비 확정 결정 존재');
  assert.equal(rubyDecision.unitPrice, 18000, '가격 18,000원 확정');

  // 2. xou.3z <-> '엑소 언니' 교차 매칭 확인 (핵심!)
  const xouDecision = result.decisions.find((d) => d.nickname === 'xou.3z');
  assert.ok(xouDecision, 'STT 발화 엑소 언니가 원문 댓글 닉네임 xou.3z로 교차 매칭됨');
  assert.equal(xouDecision.unitPrice, 18000, '1.8이 18,000원으로 환산됨');

  // 디버그 로그 정상 수집 확인
  assert.ok(aiLogs.some((l) => l.type === 'REQUEST'), 'REQUEST 디버그 로그 기록');
  assert.ok(aiLogs.some((l) => l.type === 'RESPONSE'), 'RESPONSE 디버그 로그 기록');
});
