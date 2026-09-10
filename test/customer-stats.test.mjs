import test from 'node:test';
import assert from 'node:assert/strict';
import { areNicknamesSimilar, normalizeNickname } from '../src/services/nicknameMatcher.ts';

export const normalizeBuyerNickname = (name) => {
  return normalizeNickname(name);
};

export const calculateCustomerStats = ({
  nickname,
  sales,
  claims = [],
  invoices = [],
  shipments = [],
  isPaid,
  currentSessionId,
  activeSessionId
}) => {
  const normalizedTarget = normalizeBuyerNickname(nickname);
  if (!normalizedTarget || normalizedTarget === '미확인' || normalizedTarget === '미확인(보류)') {
    return { purchaseCount: 0, totalRevenue: 0, defaultCount: 0, isFirstTimeBuyer: false, validSales: [] };
  }

  const customerSales = sales.filter((s) => {
    const saleNorm = normalizeBuyerNickname(s.buyerNickname);
    if (!saleNorm || saleNorm === '미확인' || saleNorm === '미확인(보류)') return false;
    if (saleNorm === normalizedTarget) return true;
    return areNicknamesSimilar(s.buyerNickname, nickname);
  });

  if (customerSales.length === 0) {
    return { purchaseCount: 0, totalPurchaseCount: 0, totalRevenue: 0, defaultCount: 0, isFirstTimeBuyer: false, validSales: [] };
  }

  const isCurrentSessionSale = (s) => {
    if (currentSessionId || activeSessionId) {
      return (
        (Boolean(currentSessionId) && s.sessionId === currentSessionId) ||
        (Boolean(activeSessionId) && s.sessionId === activeSessionId)
      );
    }
    return Boolean(s.recognizedAt) && Date.now() - new Date(s.recognizedAt).getTime() < 12 * 60 * 60 * 1000;
  };

  const pastSales = customerSales.filter((s) => !isCurrentSessionSale(s));

  // 1. 구매횟수: 이번 회차 이전(과거 회차)에 구매한 횟수
  const purchaseCount = pastSales.length;
  const totalPurchaseCount = customerSales.length;
  let totalRevenue = 0;
  let defaultCount = 0;

  customerSales.forEach((sale) => {
    const isPastSessionSale = !isCurrentSessionSale(sale);

    // [미이행 횟수] 이번 판매회차는 완전히 제외하고, '지난 누적회차'에서만 계산
    if (isPastSessionSale) {
      let isDefaulted = false;

      if (
        sale.status === '취소' ||
        sale.status === '반품' ||
        sale.status === '환불'
      ) {
        isDefaulted = true;
      } else if (
        sale.note &&
        (sale.note.includes('반품') ||
          sale.note.includes('취소') ||
          sale.note.includes('환불') ||
          sale.note.includes('노쇼') ||
          sale.note.includes('미입금취소') ||
          sale.note.includes('미입금'))
      ) {
        isDefaulted = true;
      } else if (
        invoices.some((inv) => inv.saleIds.includes(sale.id) && inv.status === 'CANCELLED')
      ) {
        isDefaulted = true;
      } else if (
        shipments.some((ship) => ship.saleIds.includes(sale.id) && (ship.status === 'CANCELLED' || ship.status === 'RETURNED'))
      ) {
        isDefaulted = true;
      } else {
        const overdueInvoice = invoices.find(
          (inv) =>
            inv.saleIds.includes(sale.id) &&
            (inv.status === 'OVERDUE' ||
              (inv.status !== 'PAID' && inv.dueDate && new Date(inv.dueDate).getTime() < Date.now()))
        );
        if (overdueInvoice && isPaid && !isPaid([sale.id])) {
          isDefaulted = true;
        }
      }

      if (isDefaulted) {
        defaultCount += 1;
      }
    }

    // [누적 매출] 유효 주문만 합산 (취소/반품/환불 및 보류 제외)
    const isCancelled =
      sale.status === '취소' ||
      sale.status === '반품' ||
      sale.status === '환불' ||
      Boolean(
        sale.note &&
          (sale.note.includes('반품') ||
            sale.note.includes('취소') ||
            sale.note.includes('환불') ||
            sale.note.includes('노쇼') ||
            sale.note.includes('미입금취소'))
      );

    if (!isCancelled && sale.status !== '보류') {
      totalRevenue += (sale.amount || 0);
    }
  });

  // 첫구매자 판정: 지난 회차에 구매한 것이 없고(pastSales.length === 0), 이번 회차에 주문이 존재할 때
  const isFirstTimeBuyer = pastSales.length === 0 && customerSales.length > 0;

  return {
    purchaseCount,
    totalPurchaseCount,
    totalRevenue,
    defaultCount,
    isFirstTimeBuyer,
    validSales: customerSales
  };
};

test('normalizeBuyerNickname - 닉네임 앞뒤 공백, @, 님 제거 및 정규화', () => {
  assert.equal(normalizeBuyerNickname('또로롱'), '또로롱');
  assert.equal(normalizeBuyerNickname('또로롱님'), '또로롱');
  assert.equal(normalizeBuyerNickname(' @또로롱 님 '), '또로롱');
  assert.equal(normalizeBuyerNickname(''), '');
});

test('첫구매자(또로롱) - 현재 방송 세션(activeSessionId)의 정상 주문은 미이행 0회(첫구매)여야 함', () => {
  const sales = [
    {
      id: 'sale-1',
      sessionId: 'session-uuid-1234',
      buyerNickname: '또로롱',
      amount: 35000,
      recognizedAt: new Date().toISOString(),
      rawTranscript: '구매확정 닉네임 또로롱 삼만 오천원',
      status: '자동저장'
    }
  ];

  const stats = calculateCustomerStats({
    nickname: '또로롱',
    sales,
    invoices: [],
    shipments: [],
    isPaid: () => false,
    currentSessionId: 'local-session-999', // useLive의 로컬 회차 ID와 불일치해도
    activeSessionId: 'session-uuid-1234'   // activeSession UUID와 일치하므로 현재 라이브 주문
  });

  assert.equal(stats.purchaseCount, 0, '이번 회차 이전 구매횟수는 0회');
  assert.equal(stats.isFirstTimeBuyer, true, '첫구매자여야 함');
  assert.equal(stats.totalRevenue, 35000, '누적금액은 35000원');
  assert.equal(stats.defaultCount, 0, '첫구매자의 현재 세션 주문은 미이행 0회여야 함');
});

test('첫구매자(또로롱) - 웹 청취 세션(currentSessionId) 주문도 미이행 0회여야 함', () => {
  const sales = [
    {
      id: 'sale-2',
      sessionId: 'local-session-999',
      buyerNickname: '또로롱',
      amount: 45000,
      recognizedAt: new Date().toISOString(),
      rawTranscript: '구매확정 또로롱 사만 오천원',
      status: '자동저장'
    }
  ];

  const stats = calculateCustomerStats({
    nickname: '또로롱',
    sales,
    invoices: [],
    shipments: [],
    isPaid: () => false,
    currentSessionId: 'local-session-999',
    activeSessionId: null
  });

  assert.equal(stats.purchaseCount, 0, '이번 회차 이전 구매횟수는 0회');
  assert.equal(stats.isFirstTimeBuyer, true, '첫구매자여야 함');
  assert.equal(stats.totalRevenue, 45000, '누적금액은 45000원');
  assert.equal(stats.defaultCount, 0, '미이행 0회');
});

test('첫구매자(또로롱) - 보류(status: "보류") 상태라도 단순 미추출/검토 대기 주문이면 미이행이 아님', () => {
  const sales = [
    {
      id: 'sale-3',
      sessionId: 'session-uuid-1234',
      buyerNickname: '또로롱',
      amount: 0,
      recognizedAt: new Date().toISOString(),
      rawTranscript: '구매확정 또로롱 금액 미확인',
      status: '보류',
      note: '댓글 닉네임 검증 필요'
    }
  ];

  const stats = calculateCustomerStats({
    nickname: '또로롱',
    sales,
    invoices: [],
    shipments: [],
    isPaid: () => false,
    currentSessionId: 'local-session-999',
    activeSessionId: 'session-uuid-1234'
  });

  assert.equal(stats.purchaseCount, 0, '이번 회차 이전 구매횟수는 0회');
  assert.equal(stats.isFirstTimeBuyer, true, '첫구매자여야 함');
  assert.equal(stats.defaultCount, 0, '단순 보류 주문은 미이행으로 판정하지 않음');
});

test('과거 주문 중 명시적 취소/반품/환불/노쇼는 미이행 횟수 정상 가산', () => {
  const sales = [
    {
      id: 'sale-old-1',
      sessionId: 'old-session-1',
      buyerNickname: '홍길동',
      amount: 30000,
      recognizedAt: '2026-08-01T10:00:00Z',
      rawTranscript: '구매확정 홍길동 3만원',
      status: '취소'
    },
    {
      id: 'sale-old-2',
      sessionId: 'old-session-2',
      buyerNickname: '홍길동',
      amount: 50000,
      recognizedAt: '2026-08-10T10:00:00Z',
      rawTranscript: '구매확정 홍길동 5만원',
      status: '확정',
      note: '고객 노쇼로 미입금취소'
    },
    {
      id: 'sale-new',
      sessionId: 'current-session-3',
      buyerNickname: '홍길동',
      amount: 20000,
      recognizedAt: new Date().toISOString(),
      rawTranscript: '구매확정 홍길동 2만원',
      status: '자동저장'
    }
  ];

  const stats = calculateCustomerStats({
    nickname: '홍길동',
    sales,
    invoices: [],
    shipments: [],
    isPaid: () => false,
    currentSessionId: 'current-session-3',
    activeSessionId: null
  });

  assert.equal(stats.purchaseCount, 2, '과거 2회 구매 시도');
  assert.equal(stats.isFirstTimeBuyer, false, '과거 구매 이력이 있으므로 첫구매 아님');
  assert.equal(stats.defaultCount, 2, '취소 1건 + 노쇼 1건 = 미이행 2회');
  assert.equal(stats.totalRevenue, 20000, '취소 건 제외 유효 매출 20000원');
});

test('과거 인보이스 기한 만료(OVERDUE) 및 미입금인 경우 미이행 1회 가산', () => {
  const sales = [
    {
      id: 'sale-overdue-1',
      sessionId: 'past-session',
      buyerNickname: '이몽룡',
      amount: 40000,
      recognizedAt: '2026-07-01T10:00:00Z',
      rawTranscript: '구매확정 이몽룡 4만원',
      status: '확정'
    }
  ];

  const invoices = [
    {
      id: 'inv-1',
      saleIds: ['sale-overdue-1'],
      status: 'OVERDUE',
      dueDate: '2026-07-05T00:00:00Z'
    }
  ];

  const stats = calculateCustomerStats({
    nickname: '이몽룡',
    sales,
    invoices,
    shipments: [],
    isPaid: () => false,
    currentSessionId: 'current-session-now',
    activeSessionId: null
  });

  assert.equal(stats.purchaseCount, 1);
  assert.equal(stats.defaultCount, 1, '인보이스 OVERDUE 미입금은 미이행 1회');
});

test('사용자 명시 규칙: 이번 판매회차의 주문 변경/취소/보류는 미이행에서 제외되고 지난 누적회차만 계산', () => {
  const sales = [
    // 1. 과거 누적 회차의 정상 주문 2건
    {
      id: 'past-sale-1',
      sessionId: 'session-20260801',
      buyerNickname: '강감찬',
      amount: 50000,
      recognizedAt: '2026-08-01T10:00:00Z',
      rawTranscript: '구매확정 강감찬 5만원',
      status: '확정'
    },
    {
      id: 'past-sale-2',
      sessionId: 'session-20260815',
      buyerNickname: '강감찬',
      amount: 30000,
      recognizedAt: '2026-08-15T10:00:00Z',
      rawTranscript: '구매확정 강감찬 3만원',
      status: '확정'
    },
    // 2. 이번 판매회차의 주문 (현재 라이브 진행 중)
    {
      id: 'current-sale-1',
      sessionId: 'session-today-live',
      buyerNickname: '강감찬',
      amount: 40000,
      recognizedAt: new Date().toISOString(),
      rawTranscript: '구매확정 강감찬 4만원',
      status: '보류',
      note: '댓글 닉네임 확인 필요'
    }
  ];

  const stats = calculateCustomerStats({
    nickname: '강감찬',
    sales,
    invoices: [],
    shipments: [],
    isPaid: () => false,
    currentSessionId: 'session-today-live',
    activeSessionId: null
  });

  assert.equal(stats.purchaseCount, 2, '이번 회차 이전 구매횟수는 과거 2건 = 2회');
  assert.equal(stats.totalPurchaseCount, 3, '총 주문건수는 과거 2건 + 이번 회차 1건 = 3회');
  assert.equal(stats.defaultCount, 0, '이번 판매회차는 미이행 횟수에서 제외되고 지난 회차에도 미이행이 없으므로 0회');
  assert.equal(stats.totalRevenue, 80000, '누적 매출은 과거 유효 주문 80000원');
});

test('닉네임 보강 규칙 1, 2, 3이 적용된 고객 통계 연동 검증', () => {
  const sales = [
    // 1. 과거에 mindset0517 로 구매한 건
    {
      id: 'past-sale-mindset',
      sessionId: 'session-20260801',
      buyerNickname: 'mindset0517',
      amount: 45000,
      recognizedAt: '2026-08-01T10:00:00Z',
      status: '확정'
    },
    // 2. 과거에 코맹 으로 구매한 건
    {
      id: 'past-sale-comaeng',
      sessionId: 'session-20260801',
      buyerNickname: '코맹',
      amount: 20000,
      recognizedAt: '2026-08-01T10:00:00Z',
      status: '확정'
    }
  ];

  // 규칙 2 검증: "마인드셋"으로 조회해도 과거 "mindset0517" 주문이 매칭되어야 함
  const statsMindset = calculateCustomerStats({
    nickname: '마인드셋',
    sales,
    currentSessionId: 'session-today'
  });
  assert.equal(statsMindset.purchaseCount, 1, '마인드셋은 mindset0517과 발음 매칭되어 1건 집계되어야 함');
  assert.equal(statsMindset.totalRevenue, 45000);

  // 규칙 3 검증: "뒷번호 0517님"으로 조회해도 "mindset0517" 주문이 매칭되어야 함
  const statsSuffix = calculateCustomerStats({
    nickname: '뒷번호 0517님',
    sales,
    currentSessionId: 'session-today'
  });
  assert.equal(statsSuffix.purchaseCount, 1, '뒷번호 0517님은 mindset0517과 식별자 일치로 1건 집계되어야 함');
  assert.equal(statsSuffix.totalRevenue, 45000);

  // 규칙 1 검증: "코맹맹"으로 조회해도 과거 "코맹" 주문이 매칭되어야 함
  const statsComaeng = calculateCustomerStats({
    nickname: '코맹맹',
    sales,
    currentSessionId: 'session-today'
  });
  assert.equal(statsComaeng.purchaseCount, 1, '코맹맹은 코맹과 반복글자/편집거리1 매칭되어 1건 집계되어야 함');
  assert.equal(statsComaeng.totalRevenue, 20000);
});

test('라이브 청취 홈 규칙: 이번 회차 이전 구매 횟수(구매횟수) 및 지난 회차 구매가 없는 첫구매 판정 검증', () => {
  // 1) 신규 고객이 이번 회차에서 처음 구매한 경우 -> 구매 0회, 첫구매 true
  const singleLiveOrder = [
    {
      id: 'live-1',
      sessionId: 'session-20260910_1600',
      buyerNickname: '샛별이',
      amount: 25000,
      status: '확정'
    }
  ];
  const stats1 = calculateCustomerStats({
    nickname: '샛별이',
    sales: singleLiveOrder,
    currentSessionId: 'session-20260910_1600'
  });
  assert.equal(stats1.purchaseCount, 0, '이번 회차 이전 구매 횟수는 0회여야 함');
  assert.equal(stats1.isFirstTimeBuyer, true, '지난 회차 구매가 없으므로 첫구매여야 함');

  // 2) 신규 고객이 이번 회차에서 2건째 추가 구매(다건)한 경우에도 -> 여전히 구매 0회, 첫구매 true 유지
  const multiLiveOrders = [
    ...singleLiveOrder,
    {
      id: 'live-2',
      sessionId: 'session-20260910_1600',
      buyerNickname: '샛별이',
      amount: 30000,
      status: '확정'
    }
  ];
  const stats2 = calculateCustomerStats({
    nickname: '샛별이',
    sales: multiLiveOrders,
    currentSessionId: 'session-20260910_1600'
  });
  assert.equal(stats2.purchaseCount, 0, '이번 회차 이전 구매 횟수는 0회여야 함');
  assert.equal(stats2.isFirstTimeBuyer, true, '이번 회차에서 다건 구매하더라도 지난 회차 구매가 없으면 첫구매여야 함');
  assert.equal(stats2.totalPurchaseCount, 2, '전체 주문은 2건');

  // 3) 과거 회차에 3건 구매 이력이 있고 이번 회차에 1건 구매한 경우 -> 구매 3회, 첫구매 false
  const returningOrders = [
    { id: 'past-1', sessionId: 'past-1', buyerNickname: '단골고객', amount: 10000, status: '확정' },
    { id: 'past-2', sessionId: 'past-2', buyerNickname: '단골고객', amount: 20000, status: '확정' },
    { id: 'past-3', sessionId: 'past-3', buyerNickname: '단골고객', amount: 30000, status: '확정' },
    { id: 'today-1', sessionId: 'today-live', buyerNickname: '단골고객', amount: 40000, status: '확정' }
  ];
  const stats3 = calculateCustomerStats({
    nickname: '단골고객',
    sales: returningOrders,
    currentSessionId: 'today-live'
  });
  assert.equal(stats3.purchaseCount, 3, '이번 회차 이전 구매 횟수는 3회여야 함');
  assert.equal(stats3.isFirstTimeBuyer, false, '지난 회차 구매가 있으므로 첫구매가 아니어야 함');
  assert.equal(stats3.totalPurchaseCount, 4, '전체 주문은 4건');
});

