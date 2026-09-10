import React, { useState, useEffect, useMemo } from 'react';
import { aiSettingsApi } from '../../services/aiSettingsApi';
import { AiRuntimeStatus } from '../../types/aiTask';
import { AiHealthSummaryResponse, AiSlotHealth } from '../../types/aiHealth';
import { AiSettings, DEFAULT_AI_SETTINGS } from '../../types/aiSettings';
import { maskEndpointUrl } from '../../utils/maskingUtils';
import { useSales } from '../../context/SalesContext';
import {
  Sparkles,
  Server,
  Cloud,
  Cpu,
  RefreshCw,
  X,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowRight,
  ShieldCheck,
  Zap,
} from 'lucide-react';

export const AiLiveStatusBadge: React.FC = () => {
  const { sales } = useSales();
  const [runtimeStatus, setRuntimeStatus] = useState<AiRuntimeStatus | null>(null);
  const [healthSummary, setHealthSummary] = useState<AiHealthSummaryResponse | null>(null);
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [isOpenModal, setIsOpenModal] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // 미해결 보류 판매 건수
  const pendingCount = useMemo(() => {
    return sales.filter((s) => s.status === '보류').length;
  }, [sales]);

  const fetchData = async () => {
    try {
      const [rtResp, hlResp, stData] = await Promise.all([
        aiSettingsApi.getAiRuntimeStatus().catch(() => null),
        aiSettingsApi.getAiHealth().catch(() => null),
        aiSettingsApi.getAiSettings().catch(() => null),
      ]);
      if (rtResp?.runtimeStatus) setRuntimeStatus(rtResp.runtimeStatus);
      if (hlResp) setHealthSummary(hlResp);
      if (stData) setSettings(stData);
    } catch (err) {
      console.warn('[AiLiveStatusBadge] AI 상태 동기화 실패:', err);
    }
  };

  useEffect(() => {
    void fetchData();
    const interval = window.setInterval(() => {
      void fetchData();
    }, 15000); // 15초 주기 경량 상태 갱신
    return () => window.clearInterval(interval);
  }, []);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchData();
    } finally {
      setIsRefreshing(false);
    }
  };

  // 위치 명칭 한글화 헬퍼 (PLAN.md 6번 규격)
  const getLocationLabel = (slot: AiSlotHealth | null, slotConfig?: { location?: string; provider?: string }): string => {
    const loc = slot?.location || slotConfig?.location || 'SAME_PC';
    const provider = slotConfig?.provider || 'OLLAMA';

    if (provider !== 'OLLAMA' && provider !== 'LM_STUDIO' && provider !== 'VLLM') {
      return '클라우드';
    }
    if (loc === 'SAME_PC') return '로컬';
    if (loc === 'INTERNAL_NETWORK') return '자체 운영(내부망)';
    if (loc === 'EXTERNAL_IP' || loc === 'DOMAIN') return '자체 운영(외부 서버)';
    return '로컬';
  };

  // 요청 경로 명칭 한글화
  const getRoutingLabel = (routingMode?: string): string => {
    if (routingMode === 'PC_HELPER') return 'PC 도우미 경유';
    return '서버 직접 호출';
  };

  // 상단 배지 라벨 및 스타일 계산
  const badgeInfo = useMemo(() => {
    const s1Health = healthSummary?.slot1;
    const s2Health = healthSummary?.slot2;
    const s1Config = settings.slot1;
    const s2Config = settings.slot2;

    const s1Type = getLocationLabel(s1Health || null, s1Config);
    const s2Type = getLocationLabel(s2Health || null, s2Config);

    const isSlot1Open = runtimeStatus?.slot1CircuitBreaker?.isOpen || s1Health?.overallStatus === 'UNAVAILABLE';
    const isSlot2Open = runtimeStatus?.slot2CircuitBreaker?.isOpen || s2Health?.overallStatus === 'UNAVAILABLE';

    const processingCount = runtimeStatus?.processingTaskCount || 0;
    const queuedCount = runtimeStatus?.queuedTaskCount || 0;
    const activeSlot = runtimeStatus?.activeSlot || 1;

    // 1. 다중 작업 처리 중인 경우 (예: 1번 1건 · 2번 2건 처리 중)
    if (processingCount > 1) {
      return {
        label: `AI 1번 1건 · 2번 ${processingCount - 1}건 처리 중`,
        colorClass: 'bg-indigo-50 text-indigo-700 border-indigo-200 animate-pulse',
        dotColor: 'bg-indigo-500',
      };
    }

    // 2. 단일 작업 분석 중
    if (processingCount === 1) {
      if (activeSlot === 2 && runtimeStatus?.lastSwitchReason) {
        return {
          label: `AI 2번 · ${s2Type} · 대체 처리 중`,
          colorClass: 'bg-purple-50 text-purple-700 border-purple-200 animate-pulse',
          dotColor: 'bg-purple-500',
        };
      }
      return {
        label: `AI ${activeSlot}번 · ${activeSlot === 1 ? s1Type : s2Type} · 정정 분석 중`,
        colorClass: 'bg-sky-50 text-sky-700 border-sky-200 animate-pulse',
        dotColor: 'bg-sky-500',
      };
    }

    // 3. 1번 -> 2번 전환 중 (서킷 브레이커 열림 또는 최근 전환 사유 존재)
    if (runtimeStatus?.lastSwitchReason && isSlot1Open && !isSlot2Open) {
      const reason = runtimeStatus.lastSwitchReason.length > 12
        ? `${runtimeStatus.lastSwitchReason.slice(0, 10)}...`
        : runtimeStatus.lastSwitchReason;
      return {
        label: `AI 1번 → 2번 전환 중 · ${reason}`,
        colorClass: 'bg-amber-50 text-amber-800 border-amber-300',
        dotColor: 'bg-amber-500',
      };
    }

    // 4. 양쪽 모두 사용 불가
    if (isSlot1Open && isSlot2Open) {
      return {
        label: `AI 사용 불가 · 보류 ${pendingCount}건 재시도 대기`,
        colorClass: 'bg-rose-50 text-rose-700 border-rose-200',
        dotColor: 'bg-rose-500',
      };
    }

    // 5. 1번 장애이고 2번만 가용한 대기 상태
    if (isSlot1Open && !isSlot2Open) {
      return {
        label: `AI 2번 사용 가능 · 1번 복구 점검 중`,
        colorClass: 'bg-amber-50 text-amber-800 border-amber-200',
        dotColor: 'bg-amber-500',
      };
    }

    // 6. 점검 결과 만료 여부 확인 (45초 이상 경과)
    if (s1Health?.isExpired || (s1Health?.lastCheckedAt && Date.now() - new Date(s1Health.lastCheckedAt).getTime() > 45000)) {
      const minutesAgo = s1Health?.lastCheckedAt
        ? Math.max(1, Math.round((Date.now() - new Date(s1Health.lastCheckedAt).getTime()) / 60000))
        : 1;
      return {
        label: `AI 상태 확인 중 · 마지막 점검 ${minutesAgo}분 전`,
        colorClass: 'bg-slate-100 text-slate-700 border-slate-200',
        dotColor: 'bg-slate-400',
      };
    }

    // 7. 정상 대기 상태 (1번 슬롯 가용)
    const primaryNum = settings.primarySlot || 1;
    const primaryType = primaryNum === 1 ? s1Type : s2Type;
    return {
      label: `AI ${primaryNum}번 · ${primaryType} · 사용 가능`,
      colorClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      dotColor: 'bg-emerald-500',
    };
  }, [runtimeStatus, healthSummary, settings, pendingCount]);

  return (
    <>
      {/* 상단 클릭 가능한 AI 상태 배지 */}
      <button
        type="button"
        onClick={() => setIsOpenModal(true)}
        className={`px-3 py-1.5 rounded-2xl border text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-2xs hover:shadow-xs active:scale-95 ${badgeInfo.colorClass}`}
        title="클릭하여 보류·정정 AI 2개 슬롯의 상세 모델, 연결 상태 및 전환 이력을 확인합니다."
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${badgeInfo.dotColor}`} />
        <span className="truncate max-w-[280px] sm:max-w-none">{badgeInfo.label}</span>
        <Sparkles className="w-3.5 h-3.5 opacity-60 flex-shrink-0" />
      </button>

      {/* AI 상세 모달 (PLAN.md 6번 명세) */}
      {isOpenModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 flex flex-col max-h-[90vh]">
            {/* 모달 헤더 */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center font-bold">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-black text-slate-900 flex items-center gap-2">
                    <span>보류·정정 AI 상태 상세 관제</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-100 text-brand-700 font-bold">
                      2-슬롯 Failover
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    음성 정정 및 보류 해결에 할당된 1번/2번 슬롯의 가용 상태 및 전환 사유입니다.
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  onClick={handleManualRefresh}
                  disabled={isRefreshing}
                  className="p-2 rounded-xl text-slate-500 hover:bg-slate-200 transition"
                  title="지금 상태 새로고침"
                >
                  <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpenModal(false)}
                  className="p-2 rounded-xl text-slate-500 hover:bg-slate-200 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 모달 본문 (스크롤) */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs">
              {/* 현재 런타임 요약 배너 */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-slate-800">현재 우선 사용:</span>
                  <span className="px-2 py-0.5 rounded bg-brand-600 text-white font-bold text-[11px]">
                    AI {settings.primarySlot}번 우선
                  </span>
                  {runtimeStatus?.lastSwitchReason && (
                    <span className="text-amber-700 bg-amber-100 px-2 py-0.5 rounded font-medium text-[10px]">
                      최근 전환: {runtimeStatus.lastSwitchReason}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">
                  대기 작업: <strong>{runtimeStatus?.queuedTaskCount || 0}건</strong> · 처리 중: <strong>{runtimeStatus?.processingTaskCount || 0}건</strong>
                </div>
              </div>

              {/* 2개 슬롯 카드 그리드 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                {/* 슬롯 1 카드 */}
                <SlotDetailCard
                  slotNumber={1}
                  isPrimary={settings.primarySlot === 1}
                  config={settings.slot1}
                  health={healthSummary?.slot1 || null}
                  circuitBreaker={runtimeStatus?.slot1CircuitBreaker}
                  locationLabel={getLocationLabel(healthSummary?.slot1 || null, settings.slot1)}
                  routingLabel={getRoutingLabel(settings.slot1.routingMode)}
                />

                {/* 슬롯 2 카드 */}
                <SlotDetailCard
                  slotNumber={2}
                  isPrimary={settings.primarySlot === 2}
                  config={settings.slot2}
                  health={healthSummary?.slot2 || null}
                  circuitBreaker={runtimeStatus?.slot2CircuitBreaker}
                  locationLabel={getLocationLabel(healthSummary?.slot2 || null, settings.slot2)}
                  routingLabel={getRoutingLabel(settings.slot2.routingMode)}
                />
              </div>

              {/* 보안 및 프라이버시 고지 */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-[11px] text-slate-500 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-brand-600 flex-shrink-0" />
                <span>
                  보안 지침에 따라 접속 주소의 내부 IP 및 인증정보(API Key, Token)는 마스킹 처리되어 안전하게 보호됩니다.
                </span>
              </div>
            </div>

            {/* 모달 푸터 */}
            <div className="p-3.5 sm:p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
              <button
                type="button"
                onClick={() => setIsOpenModal(false)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs transition"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

interface SlotDetailCardProps {
  slotNumber: 1 | 2;
  isPrimary: boolean;
  config: any;
  health: AiSlotHealth | null;
  circuitBreaker?: {
    isOpen: boolean;
    consecutiveFailures: number;
    lastFailureReason?: string | null;
  };
  locationLabel: string;
  routingLabel: string;
}

const SlotDetailCard: React.FC<SlotDetailCardProps> = ({
  slotNumber,
  isPrimary,
  config,
  health,
  circuitBreaker,
  locationLabel,
  routingLabel,
}) => {
  const isAvailable = health?.overallStatus === 'AVAILABLE' && !circuitBreaker?.isOpen;
  const isCloud = config.provider !== 'OLLAMA';

  // 마스킹된 엔드포인트 URL
  const maskedUrl = maskEndpointUrl(config.endpointUrl || health?.endpointUrl);

  return (
    <div
      className={`p-4 rounded-2xl border transition ${
        isPrimary ? 'bg-white border-brand-300 ring-1 ring-brand-500/20 shadow-xs' : 'bg-white border-slate-200 shadow-xs'
      }`}
    >
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center space-x-2">
          <span className="w-6 h-6 rounded-lg bg-slate-100 text-slate-900 font-black text-xs flex items-center justify-center">
            {slotNumber}
          </span>
          <span className="font-bold text-slate-900 text-xs sm:text-sm">
            AI {slotNumber}번 ({locationLabel})
          </span>
        </div>
        {isPrimary && (
          <span className="px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 font-bold text-[10px] border border-brand-200">
            우선 슬롯
          </span>
        )}
      </div>

      <div className="space-y-2 text-[11px]">
        <div className="flex justify-between py-1 border-b border-slate-100">
          <span className="text-slate-500">모델명</span>
          <span className="font-mono font-bold text-slate-800 truncate max-w-[160px]">
            {config.model || health?.model || '미지정'}
          </span>
        </div>

        <div className="flex justify-between py-1 border-b border-slate-100">
          <span className="text-slate-500">연결 위치</span>
          <span className="font-semibold text-slate-800">{locationLabel}</span>
        </div>

        <div className="flex justify-between py-1 border-b border-slate-100">
          <span className="text-slate-500">요청 경로</span>
          <span className="font-semibold text-slate-800">{routingLabel}</span>
        </div>

        <div className="flex justify-between py-1 border-b border-slate-100">
          <span className="text-slate-500">준비 상태</span>
          <span
            className={`font-bold px-1.5 py-0.2 rounded text-[10px] ${
              isAvailable
                ? 'bg-emerald-100 text-emerald-800'
                : circuitBreaker?.isOpen
                ? 'bg-rose-100 text-rose-800'
                : health?.overallStatus === 'PREPARING'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {isAvailable
              ? '사용 가능'
              : circuitBreaker?.isOpen
              ? '장애 차단(서킷 오픈)'
              : health?.overallStatus === 'PREPARING'
              ? '준비/로딩 중'
              : health?.overallStatus === 'DEGRADED'
              ? '지연'
              : health?.overallStatus || '미점검'}
          </span>
        </div>

        <div className="flex justify-between py-1 border-b border-slate-100">
          <span className="text-slate-500">접속 주소</span>
          <span className="font-mono text-slate-600 truncate max-w-[170px]" title={maskedUrl}>
            {maskedUrl || '기본 클라우드 주소'}
          </span>
        </div>

        <div className="flex justify-between py-1 border-b border-slate-100">
          <span className="text-slate-500">최근 점검</span>
          <span className="text-slate-600">
            {health?.lastCheckedAt ? new Date(health.lastCheckedAt).toLocaleTimeString() : '기록 없음'}
            {health?.tier1?.latencyMs ? ` (${health.tier1.latencyMs}ms)` : ''}
          </span>
        </div>

        {circuitBreaker?.lastFailureReason && (
          <div className="p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 mt-2">
            <span className="font-bold block text-[10px]">⚠️ 최근 장애 / 전환 이유</span>
            <span className="text-[10px] break-words">{circuitBreaker.lastFailureReason}</span>
          </div>
        )}
      </div>
    </div>
  );
};
