import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitTranscriptIntoTwoLineChunks,
  createCaptionFlowItems,
  InterimStreamChunker,
  DEFAULT_MAX_CHARS_PER_SUBTITLE
} from '../src/services/captionStreamService.ts';

test('splitTranscriptIntoTwoLineChunks - 짧은 발화는 분할 없이 1개 청크 유지', () => {
  const shortText = '구매확정! 러블리샵 35,000원입니다.';
  const chunks = splitTranscriptIntoTwoLineChunks(shortText, 40);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], shortText);
});

test('splitTranscriptIntoTwoLineChunks - 문장부호가 포함된 긴 발화는 문장 단위로 분할', () => {
  const longText = '구매확정! 닉네임 러블리샵님 금액 35,000원입니다. 다음 상품 보여드릴게요. 캡처해주세요.';
  const chunks = splitTranscriptIntoTwoLineChunks(longText, 40);
  
  assert.ok(chunks.length >= 2, `청크 수가 2개 이상이어야 함. 실제: ${chunks.length}`);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 40, `모든 청크는 40자 이하여야 함 (실제: ${chunk.length}자, "${chunk}")`);
  }
  // 분할된 조각들을 합쳤을 때 원본 단어들이 모두 보존되는지 확인
  assert.ok(chunks.join(' ').includes('러블리샵'));
  assert.ok(chunks.join(' ').includes('35,000원'));
  assert.ok(chunks.join(' ').includes('다음 상품'));
});

test('splitTranscriptIntoTwoLineChunks - 쉼표 및 어절 공백 기준으로 어절 잘림 없이 분할', () => {
  const continuousText = '안녕하세요 오늘 라이브 방송 찾아와 주신 모든 분들께 감사드리며 특가 상품인 여름 린넨 원피스를 소개해 드립니다';
  const chunks = splitTranscriptIntoTwoLineChunks(continuousText, 40);

  assert.ok(chunks.length >= 2, `청크 수가 2개 이상이어야 함. 실제: ${chunks.length}`);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 40, `청크 길이 40자 이하 (실제: ${chunk.length}자, "${chunk}")`);
  }
});

test('splitTranscriptIntoTwoLineChunks - 줄바꿈(\\n)이 있는 경우 최대 2줄씩 묶어 분할', () => {
  const multiline = '첫 번째 줄 발화\n두 번째 줄 발화\n세 번째 줄 발화\n네 번째 줄 발화';
  const chunks = splitTranscriptIntoTwoLineChunks(multiline, 40);

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0], '첫 번째 줄 발화 두 번째 줄 발화');
  assert.equal(chunks[1], '세 번째 줄 발화 네 번째 줄 발화');
});

test('createCaptionFlowItems - 각 청크마다 서로 다른 순차 타임스탬프(다음 시간표시) 부여', () => {
  const baseDate = new Date('2026-09-09T20:00:00');
  const longText = '첫 번째 2줄 발화입니다 아주 예쁘고 시원합니다. 두 번째 2줄 발화입니다 다음 시간표시에 떠야 합니다.';
  const items = createCaptionFlowItems(longText, baseDate, 35);

  assert.ok(items.length >= 2, '2개 이상의 flow item이 생성되어야 함');
  // 시간표시가 서로 달라야 함 ("다음 시간표시에 표시")
  assert.notEqual(items[0].timestamp, items[1].timestamp, '각 항목의 타임스탬프가 순차적으로 달라야 함');
  assert.ok(items[0].id.startsWith('flow-'));
  assert.ok(items[1].id.startsWith('flow-'));
});

test('InterimStreamChunker - 실시간 스트리밍 중 2줄 초과 시 앞부분을 시간표시와 함께 방출하고 남은 꼬리만 interim 유지', () => {
  const chunker = new InterimStreamChunker(30);
  const startTime = new Date('2026-09-09T20:00:00');

  // 1. 짧은 중간 전사 (30자 이하)
  const res1 = chunker.processInterim('안녕하세요 반갑습니다', startTime);
  assert.equal(res1.newFlowItems.length, 0);
  assert.equal(res1.displayInterimText, '안녕하세요 반갑습니다');

  // 2. 말이 길어져 30자 초과 (44자)
  const res2 = chunker.processInterim('안녕하세요 반갑습니다. 오늘 특가 상품은 린넨 원피스입니다', startTime);
  assert.ok(res2.newFlowItems.length >= 1, '완성된 앞부분이 flow item으로 방출되어야 함');
  assert.ok(res2.displayInterimText.length > 0, '남은 꼬리 부분이 interimText로 반환되어야 함');
  assert.ok(res2.displayInterimText.length <= 30, '남은 interimText는 30자 이하여야 함');

  // 3. 발화 확정 (isFinal)
  const finalItems = chunker.finalize('안녕하세요 반갑습니다. 오늘 특가 상품은 린넨 원피스입니다', new Date('2026-09-09T20:00:05'));
  assert.ok(finalItems.length >= 1, '남은 꼬리 부분이 최종 확정 flow item으로 방출되어야 함');
  assert.ok(finalItems[0].text.includes('린넨 원피스'));
});
