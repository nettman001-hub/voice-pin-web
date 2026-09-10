import React, { useEffect, useState, useCallback } from 'react';
import { aiSettingsApi } from '../../services/aiSettingsApi';
import {
  AiSettings,
  AiSlotConfig,
  DEFAULT_AI_SETTINGS,
} from '../../types/aiSettings';
import {
  AiSlotHealth,
  AiHealthOverallStatus,
  AiTier3SyntheticResult,
  Tier2ReadinessStatus,
} from '../../types/aiHealth';
import { AiRuntimeStatus } from '../../types/aiTask';
import { maskEndpointUrl, extractPortFromUrl, setPortInUrl } from '../../utils/maskingUtils';
import {
  Sparkles,
  Server,
  Cloud,
  ArrowRightLeft,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Save,
  Lock,
  Eye,
  EyeOff,
  Globe,
  Clock,
  KeyRound,
  ExternalLink,
  Activity,
  X,
  Play,
  Layers,
  Cpu,
  Info,
  Bot,
} from 'lucide-react';

export const AdminAiSettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 비밀정보 입력 임시 상태
  const [slot1NewSecret, setSlot1NewSecret] = useState<string>('');
  const [slot1ClearSecret, setSlot1ClearSecret] = useState<boolean>(false);
  const [showSlot1SecretInput, setShowSlot1SecretInput] = useState<boolean>(false);

  const [slot2NewSecret, setSlot2NewSecret] = useState<string>('');
  const [slot2ClearSecret, setSlot2ClearSecret] = useState<boolean>(false);
  const [showSlot2SecretInput, setShowSlot2SecretInput] = useState<boolean>(false);

  // 건강 점검 상태
  const [healthSlot1, setHealthSlot1] = useState<AiSlotHealth | null>(null);
  const [isCheckingSlot1, setIsCheckingSlot1] = useState<boolean>(false);

  const [healthSlot2, setHealthSlot2] = useState<AiSlotHealth | null>(null);
  const [isCheckingSlot2, setIsCheckingSlot2] = useState<boolean>(false);

  const [isCheckingAll, setIsCheckingAll] = useState<boolean>(false);
  const [runtimeStatus, setRuntimeStatus] = useState<AiRuntimeStatus | null>(null);
  const lastAlertSignatureRef = React.useRef<string>('');
  const [syntheticModalData, setSyntheticModalData] = useState<{
    slotNumber: 1 | 2;
    result: AiTier3SyntheticResult;
  } | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [settingsData, healthData, runtimeData] = await Promise.all([
        aiSettingsApi.getAiSettings(),
        aiSettingsApi.getAiHealth().catch(() => null),
        aiSettingsApi.getAiRuntimeStatus().catch(() => null),
      ]);
      setSettings(settingsData);
      if (healthData) {
        setHealthSlot1(healthData.slot1);
        setHealthSlot2(healthData.slot2);
      }
      if (runtimeData?.runtimeStatus) {
        setRuntimeStatus(runtimeData.runtimeStatus);
      }
    } catch (err: any) {
      showToast('error', err?.message || '설정 및 상태를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const showToast = (type: 'success' | 'error', text: string, deduplicateKey?: string) => {
    if (type === 'error') {
      const key = deduplicateKey || text;
      if (lastAlertSignatureRef.current === key) {
        // 동일한 장애 알림은 점검마다 중복 생성하지 않음 (PLAN.md 요구사항)
        return;
      }
      lastAlertSignatureRef.current = key;
    } else {
      lastAlertSignatureRef.current = '';
    }
    setToastMsg({ type, text });
    setTimeout(() => setToastMsg(null), 4000);
  };

  const handleSwapPriority = () => {
    setSettings((prev) => ({
      ...prev,
      primarySlot: prev.primarySlot === 1 ? 2 : 1,
    }));
  };

  const handleSlotChange = (slotNum: 1 | 2, field: keyof AiSlotConfig, value: any) => {
    setSettings((prev) => {
      const targetKey = slotNum === 1 ? 'slot1' : 'slot2';
      const prevSlot = prev[targetKey];
      const updatedSlot = { ...prevSlot, [field]: value };

      // 1. 실행 유형(type) 변경 시 위치 및 라우팅 모드 자동 동기화
      if (field === 'type') {
        if (value === 'LOCAL') {
          if (updatedSlot.location === 'EXTERNAL_IP' && (!updatedSlot.endpointUrl || updatedSlot.endpointUrl.includes('127.0.0.1') || updatedSlot.endpointUrl.includes('localhost'))) {
            updatedSlot.location = 'SAME_PC';
            updatedSlot.routingMode = 'PC_HELPER';
            if (!updatedSlot.endpointUrl) {
              updatedSlot.endpointUrl = updatedSlot.provider === 'LM_STUDIO' ? 'http://127.0.0.1:1234/v1' : 'http://127.0.0.1:11434';
            }
          }
        } else if (value === 'CLOUD') {
          updatedSlot.location = 'EXTERNAL_IP';
          updatedSlot.routingMode = 'SERVER_DIRECT';
        }
      }

      // 2. 엔드포인트 URL 변경 시 루프백 vs 외부 IP 자동 감지
      if (field === 'endpointUrl') {
        const urlStr = String(value || '').trim().toLowerCase();
        if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost') || urlStr.includes('::1')) {
          if (updatedSlot.routingMode === 'SERVER_DIRECT') {
            updatedSlot.routingMode = 'PC_HELPER';
            updatedSlot.location = 'SAME_PC';
          }
        } else if (urlStr.startsWith('http://') || urlStr.startsWith('https://')) {
          try {
            const parsed = new URL(urlStr);
            const host = parsed.hostname.toLowerCase();
            if (host !== '127.0.0.1' && host !== 'localhost' && !host.startsWith('192.168.')) {
              if (updatedSlot.location === 'SAME_PC') {
                updatedSlot.location = 'EXTERNAL_IP';
                updatedSlot.routingMode = 'SERVER_DIRECT';
              }
            }
          } catch {}
        }
      }

      return {
        ...prev,
        [targetKey]: updatedSlot,
      };
    });
  };

  const handleSave = async (applyImmediately: boolean) => {
    setIsSaving(true);
    try {
      // 저장 전 주소와 라우팅 모드 불일치 자동 정제 (SSRF 보안 오류 방지)
      const sanitizeSlot = (slot: AiSlotConfig): AiSlotConfig => {
        const clean = { ...slot };
        clean.endpointUrl = (clean.endpointUrl || '').trim();
        const urlStr = clean.endpointUrl.toLowerCase();
        if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost') || urlStr.includes('::1')) {
          clean.routingMode = 'PC_HELPER';
          clean.location = 'SAME_PC';
        } else if (clean.type === 'CLOUD') {
          clean.routingMode = 'SERVER_DIRECT';
          clean.location = 'EXTERNAL_IP';
        }
        return clean;
      };

      const cleanSlot1 = sanitizeSlot(settings.slot1);
      const cleanSlot2 = sanitizeSlot(settings.slot2);

      const updated = await aiSettingsApi.saveAiSettings({
        expectedVersion: settings.version,
        applyImmediately,
        changeSummary: applyImmediately
          ? `버전 ${settings.version + 1} 저장 및 운영 즉시 적용`
          : `버전 ${settings.version + 1} 초안 저장`,
        settings: {
          enabledPendingResolution: settings.enabledPendingResolution,
          enabledVoiceCorrection: settings.enabledVoiceCorrection,
          primarySlot: settings.primarySlot,
          autoFallbackEnabled: settings.autoFallbackEnabled,
          recoveryIntervalSeconds: settings.recoveryIntervalSeconds,
          autoReturnToPrimary: settings.autoReturnToPrimary,
          cloudMonthlyBudgetKrw: settings.cloudMonthlyBudgetKrw,
          slot1: {
            ...cleanSlot1,
            newSecret: slot1NewSecret.trim() || undefined,
            clearSecret: slot1ClearSecret,
          },
          slot2: {
            ...cleanSlot2,
            newSecret: slot2NewSecret.trim() || undefined,
            clearSecret: slot2ClearSecret,
          },
        },
      });

      setSettings(updated);
      setSlot1NewSecret('');
      setSlot1ClearSecret(false);
      setShowSlot1SecretInput(false);
      setSlot2NewSecret('');
      setSlot2ClearSecret(false);
      setShowSlot2SecretInput(false);

      showToast(
        'success',
        applyImmediately
          ? `🎉 설정이 저장되고 운영 버전(v${updated.appliedVersion})에 즉시 적용되었습니다.`
          : `💾 설정 초안(v${updated.version})이 안전하게 저장되었습니다.`
      );
    } catch (err: any) {
      showToast('error', err?.message || '설정 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleApplyCurrentVersion = async () => {
    setIsSaving(true);
    try {
      const updated = await aiSettingsApi.applyAiSettings(settings.version);
      setSettings(updated);
      showToast('success', `운영 설정이 버전 v${updated.appliedVersion}으로 성공적으로 적용되었습니다.`);
    } catch (err: any) {
      showToast('error', err?.message || '적용 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  // 슬롯별 점검 실행 핸들러 (Tier 1 연결 / Tier 3 실제 처리 시험 / ALL 전체 점검)
  const handleCheckSlotHealth = async (
    slotNum: 1 | 2,
    tier: 'TIER1' | 'TIER2' | 'TIER3' | 'ALL'
  ) => {
    const slotConfig = slotNum === 1 ? settings.slot1 : settings.slot2;
    const tempSecret = slotNum === 1 ? slot1NewSecret : slot2NewSecret;

    if (slotNum === 1) setIsCheckingSlot1(true);
    else setIsCheckingSlot2(true);

    try {
      const resp = await aiSettingsApi.checkAiHealth({
        slotNumber: slotNum,
        tier,
        tempSlotConfig: slotConfig,
        newSecret: tempSecret || undefined,
      });

      const updatedSlotHealth = resp.health as AiSlotHealth;
      if (slotNum === 1) setHealthSlot1(updatedSlotHealth);
      else setHealthSlot2(updatedSlotHealth);

      showToast('success', `${slotNum}번 슬롯 점검 완료 (${updatedSlotHealth.overallStatus})`);
    } catch (err: any) {
      showToast('error', `${slotNum}번 슬롯 점검 실패: ${err?.message || '오류'}`);
    } finally {
      if (slotNum === 1) setIsCheckingSlot1(false);
      else setIsCheckingSlot2(false);
    }
  };

  // 두 모델 전체 점검 실행
  const handleCheckAll = async () => {
    setIsCheckingAll(true);
    try {
      const resp = await aiSettingsApi.checkAiHealth({ tier: 'ALL' });
      const healthMap = resp.health as { slot1: AiSlotHealth; slot2: AiSlotHealth };
      if (healthMap.slot1) setHealthSlot1(healthMap.slot1);
      if (healthMap.slot2) setHealthSlot2(healthMap.slot2);
      showToast('success', '1번 및 2번 슬롯 전체 3단계 점검을 완료했습니다.');
    } catch (err: any) {
      showToast('error', `전체 점검 실패: ${err?.message || '오류'}`);
    } finally {
      setIsCheckingAll(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Toast Notification */}
      {toastMsg && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3 text-sm font-bold border animate-in slide-in-from-bottom-5 ${
            toastMsg.type === 'success'
              ? 'bg-emerald-950 text-emerald-100 border-emerald-700'
              : 'bg-rose-950 text-rose-100 border-rose-700'
          }`}
        >
          {toastMsg.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-rose-400" />
          )}
          <span>{toastMsg.text}</span>
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-brand-50 rounded-2xl border border-brand-200 text-brand-600">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900">판매 AI 설정 (보류 해결 · 음성 정정)</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                2-슬롯 AI 모델 가용성, 3단계 사전 점검(연결·모델·합성 추론) 및 장애 대체 상태
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={loadData}
            disabled={isLoading || isSaving}
            className="p-2.5 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 transition"
            title="새로고침"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            disabled={isCheckingAll || isCheckingSlot1 || isCheckingSlot2}
            onClick={handleCheckAll}
            className="px-4 py-2.5 bg-brand-50 hover:bg-brand-100 text-brand-700 text-xs font-bold rounded-xl transition border border-brand-200 flex items-center gap-1.5"
          >
            <Activity className={`w-4 h-4 ${isCheckingAll ? 'animate-spin text-brand-600' : 'text-brand-600'}`} />
            <span>두 모델 전체 점검</span>
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={() => handleSave(false)}
            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition border border-slate-300"
          >
            초안 저장 (v{settings.version + 1})
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={() => handleSave(true)}
            className="px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold rounded-xl transition shadow-md shadow-brand-200 flex items-center gap-1.5"
          >
            <Save className="w-4 h-4" />
            <span>운영 환경에 즉시 적용</span>
          </button>
        </div>
      </div>

      {/* Version Status Ribbon */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 bg-slate-900 text-white rounded-2xl text-xs font-medium">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">현재 운영 적용 버전:</span>
            <span className="px-2.5 py-0.5 bg-brand-500/20 text-brand-300 border border-brand-500/30 rounded-full font-mono font-bold">
              v{settings.appliedVersion}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-400">저장된 최신 버전:</span>
            <span className="px-2.5 py-0.5 bg-slate-800 text-slate-300 border border-slate-700 rounded-full font-mono font-bold">
              v{settings.version}
            </span>
          </div>

          {settings.isDraft && (
            <span className="px-2.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full text-[11px] font-bold">
              미적용 초안 존재 (운영 버전과 다름)
            </span>
          )}
        </div>

        {settings.isDraft && (
          <button
            type="button"
            disabled={isSaving}
            onClick={handleApplyCurrentVersion}
            className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-lg transition"
          >
            저장된 v{settings.version}을 지금 즉시 적용하기
          </button>
        )}
      </div>

      {/* Security & Operation Info Banner */}
      <div className="bg-amber-50/80 border border-amber-200 text-amber-900 p-4 rounded-2xl text-xs space-y-1 leading-relaxed">
        <div className="font-bold flex items-center gap-1.5 text-amber-950">
          <Lock className="w-4 h-4 text-amber-600" />
          <span>보안, 외부 IP 서버 직접 호출 및 3단계 건강 점검 안내</span>
        </div>
        <p>
          • <strong>3단계 사전 점검 체계</strong>: 1단계(연결·TLS·인증) → 2단계(모델 접근·로딩 상태, 관리 API 없을 시 '조회 불가' 표시) → 3단계(5대 합성 정정 문장 추론 검증).
        </p>
        <p>
          • <strong>경로 격리</strong>: PC 도우미 경유 경로는 기기별로 건강 상태가 분리되며, <strong>서버 직접 호출 외부 IP 서버</strong>는 PC 도우미가 종료되어도 영향을 받지 않습니다.
        </p>
      </div>

      {/* Global AI Features & Fallback Policies */}
      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4">
        <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
          <Activity className="w-4 h-4 text-brand-600" />
          <span>기능 사용 및 자동 전환(Failover) 정책</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <label className="flex items-start gap-3 p-3.5 rounded-2xl border border-slate-200 bg-slate-50/50 cursor-pointer hover:bg-slate-50 transition">
            <input
              type="checkbox"
              checked={settings.enabledPendingResolution}
              onChange={(e) => setSettings({ ...settings, enabledPendingResolution: e.target.checked })}
              className="mt-1 w-4 h-4 text-brand-600 rounded border-slate-300 focus:ring-brand-500"
            />
            <div>
              <div className="text-xs font-bold text-slate-900">판매 적재 보류 자동 해결</div>
              <div className="text-[11px] text-slate-500 mt-0.5">닉네임 오인식, 금액 누락, 분리 발화 문맥을 AI로 보완</div>
            </div>
          </label>

          <label className="flex items-start gap-3 p-3.5 rounded-2xl border border-slate-200 bg-slate-50/50 cursor-pointer hover:bg-slate-50 transition">
            <input
              type="checkbox"
              checked={settings.enabledVoiceCorrection}
              onChange={(e) => setSettings({ ...settings, enabledVoiceCorrection: e.target.checked })}
              className="mt-1 w-4 h-4 text-brand-600 rounded border-slate-300 focus:ring-brand-500"
            />
            <div>
              <div className="text-xs font-bold text-slate-900">판매자 음성 정정 자동 처리</div>
              <div className="text-[11px] text-slate-500 mt-0.5">"가격이 0.9가 아니고 1.2입니다", 구매자 교체 정정 처리</div>
            </div>
          </label>

          <label className="flex items-start gap-3 p-3.5 rounded-2xl border border-slate-200 bg-slate-50/50 cursor-pointer hover:bg-slate-50 transition">
            <input
              type="checkbox"
              checked={settings.autoFallbackEnabled}
              onChange={(e) => setSettings({ ...settings, autoFallbackEnabled: e.target.checked })}
              className="mt-1 w-4 h-4 text-brand-600 rounded border-slate-300 focus:ring-brand-500"
            />
            <div>
              <div className="text-xs font-bold text-slate-900">1번 장애 시 2번 자동 대체</div>
              <div className="text-[11px] text-slate-500 mt-0.5">타임아웃, 엔진 미작동, 키 오류 시 2번 슬롯으로 자동 전환</div>
            </div>
          </label>

          <label className="flex items-start gap-3 p-3.5 rounded-2xl border border-slate-200 bg-slate-50/50 cursor-pointer hover:bg-slate-50 transition">
            <input
              type="checkbox"
              checked={settings.autoReturnToPrimary}
              onChange={(e) => setSettings({ ...settings, autoReturnToPrimary: e.target.checked })}
              className="mt-1 w-4 h-4 text-brand-600 rounded border-slate-300 focus:ring-brand-500"
            />
            <div>
              <div className="text-xs font-bold text-slate-900">1번 복구 시 자동 복귀</div>
              <div className="text-[11px] text-slate-500 mt-0.5">장애 복구 점검 연속 성공 시 우선 슬롯으로 자동 복귀</div>
            </div>
          </label>

          <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-1.5">
            <div className="text-xs font-bold text-slate-900 flex items-center justify-between">
              <span>복구 점검 간격</span>
              <span className="text-brand-600 font-mono font-black">{settings.recoveryIntervalSeconds ?? 30}초</span>
            </div>
            <input
              type="range"
              min={10}
              max={180}
              step={5}
              value={settings.recoveryIntervalSeconds ?? 30}
              onChange={(e) => setSettings({ ...settings, recoveryIntervalSeconds: parseInt(e.target.value, 10) || 30 })}
              className="w-full accent-brand-600"
            />
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>10초 (빠름)</span>
              <span>180초 (느림)</span>
            </div>
          </div>
        </div>
      </div>

      {/* 슬롯별 사용량, 실패/전환 횟수, 복구 시각, 지연 및 마스킹된 접속 정보 관제 (PLAN.md 6번 명세) */}
      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-brand-600" />
            <span>슬롯별 사용량·자동 전환 횟수·지연 및 기기별 운영 관제</span>
          </h2>
          <span className="text-[11px] text-slate-400">
            점검 시각: {healthSlot1?.lastCheckedAt ? new Date(healthSlot1.lastCheckedAt).toLocaleTimeString() : '미확인'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 슬롯 1 관제 카드 */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded bg-brand-600 text-white font-black text-[10px] flex items-center justify-center">1</span>
                <span>AI 1번 ({settings.slot1.location === 'SAME_PC' ? '로컬' : settings.slot1.location === 'LAN' ? '자체 운영(내부망)' : '자체 운영(외부 서버)'})</span>
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                healthSlot1?.overallStatus === 'AVAILABLE' && !runtimeStatus?.slot1CircuitBreaker?.isOpen
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-rose-100 text-rose-800'
              }`}>
                {runtimeStatus?.slot1CircuitBreaker?.isOpen ? '서킷 차단(장애)' : healthSlot1?.overallStatus || '미확인'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
              <div className="p-2 bg-white rounded-xl border border-slate-200/80">
                <span className="text-slate-400 block text-[10px]">응답 지연</span>
                <strong className="text-slate-800 font-mono">{healthSlot1?.tier1?.latencyMs || healthSlot1?.lastLatencyMs || 0}ms</strong>
              </div>
              <div className="p-2 bg-white rounded-xl border border-slate-200/80">
                <span className="text-slate-400 block text-[10px]">연속 실패/전환</span>
                <strong className="text-slate-800 font-mono">{runtimeStatus?.slot1CircuitBreaker?.consecutiveFailures || 0}회</strong>
              </div>
            </div>

            <div className="space-y-1 text-[11px] text-slate-600 pt-1">
              <div className="flex justify-between">
                <span>요청 경로:</span>
                <strong className="text-slate-800">{settings.slot1.routingMode === 'PC_HELPER' ? 'PC 도우미 경유' : '서버 직접 호출'}</strong>
              </div>
              <div className="flex justify-between">
                <span>접속 주소(마스킹):</span>
                <span className="font-mono text-slate-700 truncate max-w-[190px]" title={settings.slot1.endpointUrl}>
                  {maskEndpointUrl(settings.slot1.endpointUrl || 'http://127.0.0.1:11434')}
                </span>
              </div>
              <div className="flex justify-between">
                <span>최근 정상 복구:</span>
                <span className="text-slate-500">{healthSlot1?.lastHealthyAt ? new Date(healthSlot1.lastHealthyAt).toLocaleTimeString() : '기록 없음'}</span>
              </div>
            </div>
          </div>

          {/* 슬롯 2 관제 카드 */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded bg-purple-600 text-white font-black text-[10px] flex items-center justify-center">2</span>
                <span>AI 2번 ({settings.slot2.type === 'LOCAL' ? '자체 운영' : '클라우드'})</span>
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                healthSlot2?.overallStatus === 'AVAILABLE' && !runtimeStatus?.slot2CircuitBreaker?.isOpen
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-rose-100 text-rose-800'
              }`}>
                {runtimeStatus?.slot2CircuitBreaker?.isOpen ? '서킷 차단(장애)' : healthSlot2?.overallStatus || '미확인'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
              <div className="p-2 bg-white rounded-xl border border-slate-200/80">
                <span className="text-slate-400 block text-[10px]">응답 지연</span>
                <strong className="text-slate-800 font-mono">{healthSlot2?.tier1?.latencyMs || healthSlot2?.lastLatencyMs || 0}ms</strong>
              </div>
              <div className="p-2 bg-white rounded-xl border border-slate-200/80">
                <span className="text-slate-400 block text-[10px]">연속 실패/전환</span>
                <strong className="text-slate-800 font-mono">{runtimeStatus?.slot2CircuitBreaker?.consecutiveFailures || 0}회</strong>
              </div>
            </div>

            <div className="space-y-1 text-[11px] text-slate-600 pt-1">
              <div className="flex justify-between">
                <span>요청 경로:</span>
                <strong className="text-slate-800">{settings.slot2.routingMode === 'PC_HELPER' ? 'PC 도우미 경유' : '서버 직접 호출'}</strong>
              </div>
              <div className="flex justify-between">
                <span>접속 주소(마스킹):</span>
                <span className="font-mono text-slate-700 truncate max-w-[190px]" title={settings.slot2.endpointUrl}>
                  {maskEndpointUrl(settings.slot2.endpointUrl || 'https://api.openai.com')}
                </span>
              </div>
              <div className="flex justify-between">
                <span>최근 정상 복구:</span>
                <span className="text-slate-500">{healthSlot2?.lastHealthyAt ? new Date(healthSlot2.lastHealthyAt).toLocaleTimeString() : '기록 없음'}</span>
              </div>
            </div>
          </div>
        </div>

        {runtimeStatus?.lastSwitchReason && (
          <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between">
            <span className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span>최근 자동 전환 사유: <strong>{runtimeStatus.lastSwitchReason}</strong></span>
            </span>
            <span className="text-[11px] text-amber-700 font-mono">
              {runtimeStatus.lastSwitchedAt ? new Date(runtimeStatus.lastSwitchedAt).toLocaleTimeString() : ''}
            </span>
          </div>
        )}
      </div>

      {/* Priority Swap Banner */}
      <div className="bg-gradient-to-r from-brand-900 to-slate-900 text-white p-5 rounded-3xl shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs px-2.5 py-0.5 bg-brand-500/30 border border-brand-400/40 rounded-full font-black text-brand-300">
              우선순위 슬롯
            </span>
            <span className="text-sm font-black">
              현재 [ 슬롯 {settings.primarySlot} ] 이 우선(Primary) 처리기로 지정됨
            </span>
          </div>
          <p className="text-xs text-slate-300">
            기본적으로 1번 모델이 판매 보류·정정을 분석하며, 1번 사용 불가 시 2번 모델로 대체(Failover)됩니다.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSwapPriority}
          className="px-4 py-2.5 bg-white hover:bg-slate-100 text-slate-950 font-black rounded-xl text-xs flex items-center gap-2 transition shadow-md whitespace-nowrap"
        >
          <ArrowRightLeft className="w-4 h-4 text-brand-600" />
          <span>우선순위 1 ↔ 2 원클릭 맞교체</span>
        </button>
      </div>

      {/* Dual Slots Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Slot 1 Card */}
        <SlotCard
          slotNumber={1}
          isPrimary={settings.primarySlot === 1}
          config={settings.slot1}
          health={healthSlot1}
          isChecking={isCheckingSlot1}
          newSecret={slot1NewSecret}
          setNewSecret={setSlot1NewSecret}
          clearSecret={slot1ClearSecret}
          setClearSecret={setSlot1ClearSecret}
          showSecretInput={showSlot1SecretInput}
          setShowSecretInput={setShowSlot1SecretInput}
          onChange={(field, val) => handleSlotChange(1, field, val)}
          onCheck={(tier) => handleCheckSlotHealth(1, tier)}
          onOpenSyntheticDetail={(res) => setSyntheticModalData({ slotNumber: 1, result: res })}
        />

        {/* Slot 2 Card */}
        <SlotCard
          slotNumber={2}
          isPrimary={settings.primarySlot === 2}
          config={settings.slot2}
          health={healthSlot2}
          isChecking={isCheckingSlot2}
          newSecret={slot2NewSecret}
          setNewSecret={setSlot2NewSecret}
          clearSecret={slot2ClearSecret}
          setClearSecret={setSlot2ClearSecret}
          showSecretInput={showSlot2SecretInput}
          setShowSecretInput={setShowSlot2SecretInput}
          onChange={(field, val) => handleSlotChange(2, field, val)}
          onCheck={(tier) => handleCheckSlotHealth(2, tier)}
          onOpenSyntheticDetail={(res) => setSyntheticModalData({ slotNumber: 2, result: res })}
        />
      </div>

      {/* Synthetic Scenarios Detail Modal */}
      {syntheticModalData && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white max-w-2xl w-full rounded-3xl border border-slate-200 shadow-2xl p-6 space-y-4 max-h-[85vh] overflow-y-auto animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-brand-50 text-brand-600 rounded-xl">
                  <Play className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    슬롯 {syntheticModalData.slotNumber}번 — 5대 합성 정정 시험 결과
                  </h3>
                  <p className="text-xs text-slate-500">
                    판매 데이터를 변경하지 않는 합성 정정 발화 추론 및 정답 검증 상세
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSyntheticModalData(null)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              {syntheticModalData.result.scenarios.map((sc, idx) => (
                <div
                  key={sc.scenarioId}
                  className={`p-4 rounded-2xl border text-xs space-y-2 ${
                    sc.passed
                      ? 'bg-emerald-50/60 border-emerald-200 text-emerald-950'
                      : 'bg-rose-50/60 border-rose-200 text-rose-950'
                  }`}
                >
                  <div className="flex items-center justify-between font-bold">
                    <span className="flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-white/80 rounded-md border border-slate-200 text-[11px]">
                        시나리오 {idx + 1}
                      </span>
                      <span>{sc.title}</span>
                    </span>
                    <span className="flex items-center gap-1.5 font-mono">
                      {sc.passed ? (
                        <span className="text-emerald-600 flex items-center gap-1">
                          <CheckCircle2 className="w-4 h-4" /> 통과
                        </span>
                      ) : (
                        <span className="text-rose-600 flex items-center gap-1">
                          <X className="w-4 h-4" /> 실패
                        </span>
                      )}
                      <span className="text-slate-400 text-[11px]">({sc.latencyMs}ms)</span>
                    </span>
                  </div>

                  <div className="bg-white/80 p-2.5 rounded-xl border border-slate-200/60 space-y-1 font-mono text-[11px]">
                    <div className="text-slate-500">발화: "{sc.utterance}"</div>
                    <div className="text-slate-700">기대: {sc.expectedSummary}</div>
                    <div className={sc.passed ? 'text-emerald-700 font-bold' : 'text-rose-700 font-bold'}>
                      결과: {sc.actualSummary}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setSyntheticModalData(null)}
                className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// 8대 건강 상태 배지 렌더러
const HealthStatusBadge: React.FC<{ status?: AiHealthOverallStatus; isExpired?: boolean }> = ({
  status,
  isExpired,
}) => {
  if (isExpired || status === 'EXPIRED') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-amber-50 text-amber-800 border border-amber-300">
        <Clock className="w-3.5 h-3.5 text-amber-600" />
        상태 만료 (45초 경과)
      </span>
    );
  }
  switch (status) {
    case 'AVAILABLE':
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-emerald-50 text-emerald-800 border border-emerald-300">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          사용 가능
        </span>
      );
    case 'PREPARING':
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-amber-50 text-amber-800 border border-amber-300">
          <RefreshCw className="w-3.5 h-3.5 text-amber-600 animate-spin" />
          준비 중 (메모리 대기)
        </span>
      );
    case 'DEGRADED':
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-orange-50 text-orange-800 border border-orange-300">
          <AlertTriangle className="w-3.5 h-3.5 text-orange-600" />
          지연 발생
        </span>
      );
    case 'RECOVERING':
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-purple-50 text-purple-800 border border-purple-300">
          <Activity className="w-3.5 h-3.5 text-purple-600 animate-pulse" />
          복구 시험 중
        </span>
      );
    case 'UNAVAILABLE':
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-rose-50 text-rose-800 border border-rose-300">
          <X className="w-3.5 h-3.5 text-rose-600" />
          사용 불가
        </span>
      );
    case 'CHECKING':
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-blue-50 text-blue-800 border border-blue-300">
          <RefreshCw className="w-3.5 h-3.5 text-blue-600 animate-spin" />
          점검 중
        </span>
      );
    case 'UNCONFIGURED':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-slate-100 text-slate-500 border border-slate-200">
          미설정
        </span>
      );
  }
};

interface SlotCardProps {
  slotNumber: 1 | 2;
  isPrimary: boolean;
  config: AiSlotConfig;
  health: AiSlotHealth | null;
  isChecking: boolean;
  newSecret: string;
  setNewSecret: (v: string) => void;
  clearSecret: boolean;
  setClearSecret: (v: boolean) => void;
  showSecretInput: boolean;
  setShowSecretInput: (v: boolean) => void;
  onChange: (field: keyof AiSlotConfig, value: any) => void;
  onCheck: (tier: 'TIER1' | 'TIER2' | 'TIER3' | 'ALL') => void;
  onOpenSyntheticDetail: (res: AiTier3SyntheticResult) => void;
}

const SlotCard: React.FC<SlotCardProps> = ({
  slotNumber,
  isPrimary,
  config,
  health,
  isChecking,
  newSecret,
  setNewSecret,
  clearSecret,
  setClearSecret,
  showSecretInput,
  setShowSecretInput,
  onChange,
  onCheck,
  onOpenSyntheticDetail,
}) => {
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(false);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);
  const [isDirectInput, setIsDirectInput] = useState<boolean>(false);
  const currentPort = extractPortFromUrl(config.endpointUrl);

  const fetchModels = useCallback(async (silent = false) => {
    const url = (config.endpointUrl || '').trim();
    if (!url) {
      setAvailableModels([]);
      return;
    }
    if (!silent) setIsLoadingModels(true);
    setModelFetchError(null);
    try {
      const res = await aiSettingsApi.listAiModels({
        slotNumber,
        provider: config.provider,
        endpointUrl: url,
        authType: config.authType,
        secret: newSecret || undefined,
        location: config.location,
        routingMode: config.routingMode,
      });
      if (res.ok && res.models && res.models.length > 0) {
        setAvailableModels(res.models);
        setModelFetchError(null);
        if ((!config.model || !res.models.includes(config.model)) && res.models[0]) {
          onChange('model', res.models[0]);
        }
      } else {
        setAvailableModels([]);
        if (res.message) {
          setModelFetchError(res.message);
        }
      }
    } catch (err: any) {
      setAvailableModels([]);
      setModelFetchError(err?.message || '모델 목록을 불러오지 못했습니다.');
    } finally {
      setIsLoadingModels(false);
    }
  }, [config.endpointUrl, config.authType, config.provider, config.location, config.routingMode, newSecret, slotNumber, config.model, onChange]);

  useEffect(() => {
    const trimmed = (config.endpointUrl || '').trim();
    if (!trimmed) {
      setAvailableModels([]);
      return;
    }
    const timer = setTimeout(() => {
      fetchModels(true);
    }, 600);
    return () => clearTimeout(timer);
  }, [config.endpointUrl, config.authType, config.provider, config.routingMode, newSecret, fetchModels]);

  return (
    <div
      className={`bg-white rounded-3xl border shadow-sm p-6 space-y-5 transition relative ${
        isPrimary ? 'border-brand-500 ring-4 ring-brand-500/10' : 'border-slate-200'
      }`}
    >
      {/* Slot Header */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-2xl flex items-center justify-center font-black text-sm ${
              isPrimary ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            #{slotNumber}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-slate-900">
                슬롯 {slotNumber} {isPrimary ? '(주 처리기 · Primary)' : '(대체 처리기 · Fallback)'}
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {config.type === 'LOCAL' ? '자체 운영(로컬/자체서버) 모델' : '클라우드 API 모델'}
            </p>
          </div>
        </div>

        <div>
          <HealthStatusBadge status={health?.overallStatus} isExpired={health?.isExpired} />
        </div>
      </div>

      {/* Model Type Selector */}
      <div>
        <label className="block text-xs font-bold text-slate-700 mb-2">실행 유형</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onChange('type', 'LOCAL')}
            className={`px-4 py-2.5 rounded-2xl text-xs font-bold border flex items-center justify-center gap-2 transition ${
              config.type === 'LOCAL'
                ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <Server className="w-4 h-4" />
            <span>자체 운영 LLM</span>
          </button>
          <button
            type="button"
            onClick={() => onChange('type', 'CLOUD')}
            className={`px-4 py-2.5 rounded-2xl text-xs font-bold border flex items-center justify-center gap-2 transition ${
              config.type === 'CLOUD'
                ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <Cloud className="w-4 h-4" />
            <span>클라우드 LLM</span>
          </button>
        </div>
      </div>

      {/* Provider Selector */}
      <div>
        <label className="block text-xs font-bold text-slate-700 mb-1">공급자 / 실행 엔진</label>
        <select
          value={config.provider}
          onChange={(e) => {
            const newProvider = e.target.value as any;
            onChange('provider', newProvider);
            if (config.type === 'LOCAL') {
              if (newProvider === 'LM_STUDIO' && (!config.endpointUrl || config.endpointUrl.includes('11434'))) {
                onChange('endpointUrl', 'http://127.0.0.1:1234/v1');
              } else if (newProvider === 'OLLAMA' && (!config.endpointUrl || config.endpointUrl.includes('1234') || config.endpointUrl.includes('1235'))) {
                onChange('endpointUrl', 'http://127.0.0.1:11434');
              }
            } else {
              if (newProvider === 'DEEPSEEK') {
                onChange('model', 'deepseek-chat');
                if (!config.authType || config.authType === 'NONE') {
                  onChange('authType', 'BEARER');
                }
              } else if (newProvider === 'OPENAI') {
                onChange('model', 'gpt-4o-mini');
                if (!config.authType || config.authType === 'NONE') {
                  onChange('authType', 'BEARER');
                }
              } else if (newProvider === 'ANTHROPIC') {
                onChange('model', 'claude-3-5-haiku-20241022');
                if (!config.authType || config.authType === 'NONE') {
                  onChange('authType', 'API_KEY');
                }
              }
            }
          }}
          className="w-full px-3 py-2 border border-slate-200 rounded-xl font-bold text-slate-800 bg-white text-xs"
        >
          {config.type === 'LOCAL' ? (
            <>
              <option value="OLLAMA">Ollama (권장 로컬 엔진)</option>
              <option value="LM_STUDIO">LM Studio (OpenAI 호환)</option>
              <option value="VLLM">vLLM (OpenAI 호환)</option>
              <option value="CUSTOM">커스텀 자체 운영 서버</option>
            </>
          ) : (
            <>
              <option value="OPENAI">OpenAI (GPT-4o, GPT-4o-mini)</option>
              <option value="ANTHROPIC">Anthropic (Claude 3.5 Sonnet / Haiku)</option>
              <option value="GOOGLE">Google Gemini (Gemini 1.5 Flash)</option>
              <option value="DEEPSEEK">DeepSeek (Chat / Reasoner)</option>
              <option value="CUSTOM">커스텀 클라우드 (OpenAI 호환)</option>
            </>
          )}
        </select>
      </div>

      {/* Local LLM Location & Routing Mode */}
      {config.type === 'LOCAL' ? (
        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-3 text-xs">
          <div className="font-bold text-slate-800 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-brand-600" />
              <span>실행 서버 위치 및 호출 경로</span>
            </span>
            <span className="text-[11px] font-normal text-slate-500">
              {config.location === 'EXTERNAL_IP'
                ? '서버 직접 호출 (PC 도우미 무관)'
                : 'PC 도우미 경유 (기기별 격리)'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => {
                onChange('location', 'SAME_PC');
                onChange('routingMode', 'PC_HELPER');
                if (!config.endpointUrl || config.endpointUrl.includes('api.openai.com')) {
                  onChange('endpointUrl', config.provider === 'LM_STUDIO' ? 'http://127.0.0.1:1234/v1' : 'http://127.0.0.1:11434');
                }
              }}
              className={`p-2.5 rounded-xl border text-center transition ${
                config.location === 'SAME_PC'
                  ? 'bg-white border-brand-500 font-black text-brand-700 shadow-sm'
                  : 'border-slate-200 text-slate-600 hover:bg-white'
              }`}
            >
              <div className="text-[11px] font-bold">같은 PC</div>
              <div className="text-[9px] text-slate-400 font-mono">127.0.0.1 (도우미 경유)</div>
            </button>

            <button
              type="button"
              onClick={() => {
                onChange('location', 'LAN');
                onChange('routingMode', 'PC_HELPER');
              }}
              className={`p-2.5 rounded-xl border text-center transition ${
                config.location === 'LAN'
                  ? 'bg-white border-brand-500 font-black text-brand-700 shadow-sm'
                  : 'border-slate-200 text-slate-600 hover:bg-white'
              }`}
            >
              <div className="text-[11px] font-bold">내부망 (LAN)</div>
              <div className="text-[9px] text-slate-400 font-mono">192.168.x.x (도우미 경유)</div>
            </button>

            <button
              type="button"
              onClick={() => {
                onChange('location', 'EXTERNAL_IP');
                onChange('routingMode', 'SERVER_DIRECT');
              }}
              className={`p-2.5 rounded-xl border text-center transition ${
                config.location === 'EXTERNAL_IP'
                  ? 'bg-white border-brand-500 font-black text-brand-700 shadow-sm'
                  : 'border-slate-200 text-slate-600 hover:bg-white'
              }`}
            >
              <div className="text-[11px] font-bold">외부 IP / 도메인</div>
              <div className="text-[9px] text-brand-600 font-mono">서버 직접 호출</div>
            </button>
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
              <div className="sm:col-span-3">
                <label className="block font-bold text-slate-700 mb-1">엔드포인트 전체 주소</label>
                <input
                  type="text"
                  value={config.endpointUrl}
                  onChange={(e) => {
                    const newUrl = e.target.value;
                    onChange('endpointUrl', newUrl);
                    const p = extractPortFromUrl(newUrl);
                    onChange('port', p ? parseInt(p, 10) : undefined);
                  }}
                  placeholder={
                    config.provider === 'LM_STUDIO'
                      ? '예: http://nettman.iptime.org:1235/v1 또는 http://127.0.0.1:1234/v1'
                      : '예: http://127.0.0.1:11434 또는 http://my-llm.example.com:8443'
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono text-slate-800 bg-white"
                />
              </div>

              <div className="sm:col-span-1">
                <label className="block font-bold text-slate-700 mb-1 flex items-center justify-between">
                  <span>포트 번호</span>
                  <span className="text-[10px] font-normal text-slate-400">Port</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={currentPort}
                  onChange={(e) => {
                    const rawPort = e.target.value.replace(/\D/g, '').slice(0, 5);
                    const updatedUrl = setPortInUrl(config.endpointUrl, rawPort);
                    onChange('endpointUrl', updatedUrl);
                    onChange('port', rawPort ? parseInt(rawPort, 10) : undefined);
                  }}
                  placeholder={config.provider === 'LM_STUDIO' ? '1234' : '11434'}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono text-slate-800 bg-white font-bold text-center"
                />
              </div>
            </div>

            {/* 빠른 포트 선택 프리셋 버튼 */}
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              <span className="text-[10px] text-slate-400 font-medium mr-0.5">포트 빠른 설정:</span>
              {[
                { label: '1235 (LM Studio 외부)', port: '1235' },
                { label: '1234 (LM Studio 로컬)', port: '1234' },
                { label: '11434 (Ollama)', port: '11434' },
                { label: '8000 (vLLM)', port: '8000' },
                { label: '8080 (웹)', port: '8080' },
              ].map((preset) => (
                <button
                  key={preset.port}
                  type="button"
                  onClick={() => {
                    const updatedUrl = setPortInUrl(config.endpointUrl, preset.port);
                    onChange('endpointUrl', updatedUrl);
                    onChange('port', parseInt(preset.port, 10));
                  }}
                  className={`px-2 py-0.5 rounded-lg border text-[10px] font-mono transition ${
                    currentPort === preset.port
                      ? 'bg-brand-50 border-brand-400 text-brand-700 font-bold'
                      : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {config.location === 'EXTERNAL_IP' && (
              <p className="text-[10px] text-amber-700 mt-1">
                * 외부 공인 IP 서버는 HTTP 및 HTTPS 연결을 지원하며, PC 도우미가 꺼져 있어도 서버에서 직접 호출됩니다.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <label className="block font-bold text-slate-700">커스텀 엔드포인트 URL (선택사항)</label>
            {config.provider === 'DEEPSEEK' && (
              <a
                href="https://api-docs.deepseek.com/"
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-brand-600 hover:underline font-bold flex items-center gap-1"
              >
                DeepSeek API 문서 ↗
              </a>
            )}
          </div>
          <input
            type="text"
            value={config.endpointUrl}
            onChange={(e) => onChange('endpointUrl', e.target.value)}
            placeholder={
              config.provider === 'DEEPSEEK'
                ? '기본값: https://api.deepseek.com (공식 OpenAI 호환)'
                : '기본 공식 API 주소 사용 시 비워두세요'
            }
            className="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono text-slate-800 bg-white"
          />
          {config.provider === 'DEEPSEEK' && (
            <p className="text-[10px] text-slate-500">
              * DeepSeek 공식 API는 OpenAI 완전 호환 규격(Base URL: <code className="font-mono text-brand-700">https://api.deepseek.com</code>)입니다.
            </p>
          )}
        </div>
      )}

      {/* Auth Settings & Secret Management */}
      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-3 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-bold text-slate-800 flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5 text-brand-600" />
            <span>인증 방식 및 비밀정보 격리 보관</span>
          </span>
          {config.hasSecret && !clearSecret && (
            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded font-mono text-[10px] font-bold">
              {config.maskedSecret || '키 등록됨 (sk-***)'}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {['NONE', 'BEARER', 'API_KEY'].map((atype) => (
            <button
              key={atype}
              type="button"
              onClick={() => onChange('authType', atype)}
              className={`p-2 rounded-xl border text-center font-bold transition ${
                config.authType === atype
                  ? 'bg-white border-brand-500 text-brand-700 shadow-sm'
                  : 'border-slate-200 text-slate-500 hover:bg-white'
              }`}
            >
              {atype === 'NONE' ? '인증 없음' : atype === 'BEARER' ? 'Bearer 토큰' : 'API Key 헤더'}
            </button>
          ))}
        </div>

        {config.authType !== 'NONE' && (
          <div className="space-y-2 pt-1">
            {!showSecretInput ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowSecretInput(true)}
                  className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl text-xs font-bold text-slate-700 transition"
                >
                  {config.hasSecret && !clearSecret ? '비밀정보(키) 변경' : '비밀정보(키) 새로 등록'}
                </button>
                {config.hasSecret && !clearSecret && (
                  <button
                    type="button"
                    onClick={() => {
                      setClearSecret(true);
                      setNewSecret('');
                    }}
                    className="px-3 py-1.5 text-rose-600 hover:bg-rose-50 rounded-xl text-xs font-bold transition"
                  >
                    삭제
                  </button>
                )}
                {clearSecret && (
                  <span className="text-xs text-rose-600 font-bold">
                    [저장 시 삭제 예정]{' '}
                    <button
                      type="button"
                      onClick={() => setClearSecret(false)}
                      className="underline text-slate-600 font-normal ml-1"
                    >
                      취소
                    </button>
                  </span>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={newSecret}
                    onChange={(e) => {
                      setNewSecret(e.target.value);
                      setClearSecret(false);
                    }}
                    placeholder="새로운 API Key 또는 인증 토큰 입력"
                    className="flex-1 px-3 py-2 border border-brand-300 rounded-xl text-xs font-mono text-slate-900 focus:outline-brand-500 bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecretInput(false)}
                    className="px-3 py-2 text-slate-500 hover:bg-slate-200 rounded-xl text-xs font-bold"
                  >
                    닫기
                  </button>
                </div>
                <p className="text-[10px] text-slate-400">
                  입력된 비밀정보는 서버 격리 저장소(ai_secrets)에만 보관되며 브라우저로 반환되지 않습니다.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Model Selector / Tag Section (Moved below Endpoint and Auth) */}
      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2.5 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <label className="font-bold text-slate-800 flex items-center gap-1.5">
              <Bot className="w-3.5 h-3.5 text-brand-600" />
              <span>모델명 (Model Tag)</span>
            </label>
            {isLoadingModels ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                <RefreshCw className="w-3 h-3 animate-spin" />
                목록 조회 중...
              </span>
            ) : availableModels.length > 0 ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle2 className="w-3 h-3" />
                {availableModels.length}개 감지됨
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={isLoadingModels || !config.endpointUrl}
              onClick={() => fetchModels(false)}
              className="p-1 px-2 text-[11px] bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-600 transition flex items-center gap-1 disabled:opacity-40"
              title="연결 가능한 모델 목록 새로고침"
            >
              <RefreshCw className={`w-3 h-3 ${isLoadingModels ? 'animate-spin text-brand-600' : ''}`} />
              <span>목록 조회</span>
            </button>
            {availableModels.length > 0 && (
              <button
                type="button"
                onClick={() => setIsDirectInput(!isDirectInput)}
                className="text-[11px] text-brand-600 hover:text-brand-700 underline font-medium ml-1"
              >
                {isDirectInput ? '목록에서 선택' : '직접 입력'}
              </button>
            )}
          </div>
        </div>

        {/* If we have available models and not in direct input mode */}
        {availableModels.length > 0 && !isDirectInput ? (
          <div className="space-y-1.5">
            <select
              value={config.model || availableModels[0] || ''}
              onChange={(e) => {
                if (e.target.value === '__DIRECT__') {
                  setIsDirectInput(true);
                } else {
                  onChange('model', e.target.value);
                }
              }}
              className="w-full px-3 py-2 border border-brand-300 rounded-xl font-mono text-xs font-bold text-slate-900 bg-white focus:outline-brand-500 shadow-sm"
            >
              {config.model && !availableModels.includes(config.model) && (
                <option value={config.model}>
                  {config.model} (현재 설정값)
                </option>
              )}
              {availableModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value="__DIRECT__">✏️ 직접 입력 (목록에 없는 경우)...</option>
            </select>
            <p className="text-[10px] text-slate-500">
              엔드포인트({config.endpointUrl || '지정 주소'})에서 감지된 모델 목록입니다.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <input
              type="text"
              value={config.model}
              onChange={(e) => onChange('model', e.target.value)}
              placeholder={
                config.provider === 'DEEPSEEK'
                  ? 'deepseek-chat 또는 deepseek-reasoner'
                  : config.provider === 'LM_STUDIO'
                  ? '예: qwen2.5-7b-instruct, mistral-7b-instruct'
                  : config.type === 'LOCAL'
                  ? '예: qwen2.5:7b, llama3.1:8b'
                  : '예: gpt-4o-mini, claude-3-5-sonnet'
              }
              className="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono text-slate-800 bg-white font-bold"
            />

            {/* DeepSeek 전용 모델 빠른 프리셋 버튼 */}
            {config.provider === 'DEEPSEEK' && (
              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                <span className="text-[10px] text-slate-400 font-medium mr-0.5">DeepSeek 모델:</span>
                {[
                  { id: 'deepseek-chat', label: 'deepseek-chat (V3 강력추천)', desc: '초고속 범용' },
                  { id: 'deepseek-reasoner', label: 'deepseek-reasoner (R1 추론)', desc: '심층 사고' },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onChange('model', m.id)}
                    className={`px-2 py-0.5 rounded-lg border text-[10px] font-mono transition ${
                      config.model === m.id
                        ? 'bg-brand-50 border-brand-400 text-brand-700 font-bold'
                        : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span>
                {availableModels.length > 0
                  ? '직접 입력 모드입니다.'
                  : config.endpointUrl
                  ? '엔드포인트 및 인증 방식이 올바르면 모델 목록이 자동으로 조회됩니다.'
                  : '엔드포인트 주소를 입력하면 연결 가능한 모델이 자동 조회됩니다.'}
              </span>
              {availableModels.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIsDirectInput(false)}
                  className="text-brand-600 hover:underline font-bold"
                >
                  감지된 목록({availableModels.length}개)에서 선택하기
                </button>
              )}
            </div>
          </div>
        )}

        {modelFetchError && (
          <p className="text-[10px] text-rose-500">
            * {modelFetchError} (직접 모델명을 입력하여 진행할 수 있습니다)
          </p>
        )}
      </div>

      {/* 3-Tier Health Inspection Actions & Status Display */}
      <div className="pt-2 border-t border-slate-100 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs font-black text-slate-900 flex items-center gap-1.5">
            <Cpu className="w-4 h-4 text-brand-600" />
            <span>3단계 사전 점검 및 가용성 진단</span>
          </span>

          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              disabled={isChecking}
              onClick={() => onCheck('TIER1')}
              className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold transition disabled:opacity-50"
            >
              1단계: 연결 시험
            </button>
            <button
              type="button"
              disabled={isChecking}
              onClick={() => onCheck('TIER3')}
              className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold transition disabled:opacity-50"
            >
              3단계: 실제 처리 시험
            </button>
            <button
              type="button"
              disabled={isChecking}
              onClick={() => onCheck('ALL')}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-[11px] font-bold transition flex items-center gap-1 shadow-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${isChecking ? 'animate-spin' : ''}`} />
              <span>전체 점검</span>
            </button>
          </div>
        </div>

        {/* 3-Tier Results Panel */}
        <div className="grid grid-cols-1 gap-2.5 text-xs">
          {/* Tier 1 Box */}
          <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <div className="font-bold text-slate-800 flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-[10px]">
                  1
                </span>
                <span>연결 · DNS · TLS · 인증</span>
              </div>
              <p className="text-[11px] text-slate-500">
                {health?.tier1?.message || '점검 이력 없음'}
              </p>
            </div>
            <div className="text-right">
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  health?.tier1?.ok
                    ? 'bg-emerald-100 text-emerald-800'
                    : health?.tier1?.status && health.tier1.status !== 'UNCONFIGURED'
                    ? 'bg-rose-100 text-rose-800'
                    : 'bg-slate-200 text-slate-600'
                }`}
              >
                {health?.tier1?.ok
                  ? `정상 (${health.tier1.latencyMs || 0}ms)`
                  : health?.tier1?.status
                  ? `실패 (${health.tier1.status})`
                  : '미실행'}
              </span>
            </div>
          </div>

          {/* Tier 2 Box */}
          <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <div className="font-bold text-slate-800 flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-[10px]">
                  2
                </span>
                <span>모델 접근 · 설치 및 로딩 상태</span>
              </div>
              <p className="text-[11px] text-slate-500">
                {health?.tier2?.message || '점검 이력 없음'}
              </p>
            </div>
            <div className="text-right">
              {health?.tier2?.status === 'NOT_QUERYABLE' ? (
                <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded text-[10px] font-bold" title="원격 서버가 관리 API를 미제공 (장애 아님)">
                  조회 불가 (정상 취급)
                </span>
              ) : (
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    health?.tier2?.status === 'READY'
                      ? 'bg-emerald-100 text-emerald-800'
                      : health?.tier2?.status === 'PREPARING'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {health?.tier2?.status === 'READY'
                    ? '로딩 완료'
                    : health?.tier2?.status === 'PREPARING'
                    ? '메모리 대기'
                    : health?.tier2?.status || '미실행'}
                </span>
              )}
            </div>
          </div>

          {/* Tier 3 Box */}
          <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <div className="font-bold text-slate-800 flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-[10px]">
                  3
                </span>
                <span>실제 추론 시험 (5대 합성 정정 문장)</span>
              </div>
              <p className="text-[11px] text-slate-500">
                {health?.tier3?.message || '합성 시험 이력 없음'}
              </p>
              {health?.tier3?.scenarios && health.tier3.scenarios.length > 0 && (
                <button
                  type="button"
                  onClick={() => onOpenSyntheticDetail(health.tier3)}
                  className="text-[10px] text-brand-600 underline font-bold hover:text-brand-700 mt-1 inline-block"
                >
                  5대 시나리오 정답·결과 상세 보기
                </button>
              )}
            </div>
            <div className="text-right">
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  health?.tier3?.allPassed
                    ? 'bg-emerald-100 text-emerald-800'
                    : health?.tier3?.passedCount
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-slate-200 text-slate-600'
                }`}
              >
                {health?.tier3?.passedCount !== undefined
                  ? `${health.tier3.passedCount}/${health.tier3.totalCount} 통과 (${health.tier3.totalLatencyMs}ms)`
                  : '미실행'}
              </span>
            </div>
          </div>
        </div>

        {health?.lastCheckedAt && (
          <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
            <span>최근 점검: {new Date(health.lastCheckedAt).toLocaleTimeString()}</span>
            <span>경로: {health.routingMode} ({health.executorId})</span>
          </div>
        )}
      </div>
    </div>
  );
};
