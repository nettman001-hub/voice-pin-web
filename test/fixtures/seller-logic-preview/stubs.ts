export const useLive = () => ({ isListening: false, sonioxApiKey: '' });
export const useCommentCapture = () => ({ isActive: false, config: { tiktokUsername: '', serverUrl: '' } });
export class SellerLogicCapture { async start() {} async stop() {} prioritizeNicknames() {} }
export async function getSellerLogicSlots() {
  return { appliedVersion: 3, primarySlot: 1, slots: [
    { slotNumber: 1, provider: 'UI_TEST', model: '기존 슬롯 1 화면 확인' },
    { slotNumber: 2, provider: 'UI_TEST', model: '기존 슬롯 2 화면 확인' },
  ] };
}
export async function analyzeSellerLogic(input: any) {
  return {
    provider: 'UI_TEST', model: '화면 검증용 가상 응답', summary: '화면 검증용 응답입니다. 실제 AI 판단이 아닙니다.',
    purchaseIntentCommentIds: input.comments.slice(0, 1).map((c: any) => c.id),
    decisions: input.comments.slice(0, 1).map((c: any) => ({
      id: 'fixture', status: 'CONFIRMED', nickname: c.nickname, unitPrice: 18000, quantity: 1,
      productName: '맨투맨', spokenNickname: '엑소', decidedAt: input.transcripts[1]?.recognizedAt || c.capturedAt,
      reason: '화면 검증용 데이터: 원문 닉네임, 금액, 선정 이유와 근거 대화가 표시되는지 확인합니다.',
      commentIds: [c.id], transcriptIds: input.transcripts.slice(0, 2).map((t: any) => t.id),
    })),
  };
}
