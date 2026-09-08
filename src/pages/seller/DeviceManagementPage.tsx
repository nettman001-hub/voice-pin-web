import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { productSalesApi } from '../../services/productSalesApi';
import type { Device, DeviceCapability } from '../../types/productSales';
import { Smartphone, Monitor, Printer, Shield, Check, RefreshCw, ArrowLeft, AlertCircle } from 'lucide-react';

const ALL_CAPABILITIES: { key: DeviceCapability; label: string; desc: string }[] = [
  { key: 'SALES_READ', label: '판매 조회', desc: '회차별 판매내역 및 실시간 댓글 조회' },
  { key: 'SALES_WRITE', label: '판매 등록/수정', desc: '댓글 선택 판매등록, 단가 및 구매자 수정' },
  { key: 'PRODUCT_WRITE', label: '상품 등록/수정', desc: '신규 상품 초안 작성 및 전면 카메라 촬영 등록' },
  { key: 'COMMENT_INGEST', label: '댓글 수집', desc: 'TikTok 실시간 댓글을 클라우드로 전송' },
  { key: 'PRINT', label: '전표 인쇄', desc: '지정된 프린터로 판매 및 정정 전표 출력 작업 수신' },
  { key: 'SMS', label: '문자 연동', desc: '정산서 및 배송 안내 SMS 발송' },
];

export const DeviceManagementPage: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingDeviceId, setSavingDeviceId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadDevices = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await productSalesApi.listDevices();
      setDevices(res.devices);
    } catch (err: any) {
      setError(err.message || '기기 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDevices();
  }, []);

  const handleToggleCapability = (deviceId: string, cap: DeviceCapability) => {
    setDevices((prev) =>
      prev.map((d) => {
        if (d.id !== deviceId) return d;
        const currentCaps = new Set(d.capabilities);
        if (currentCaps.has(cap)) {
          currentCaps.delete(cap);
        } else {
          currentCaps.add(cap);
        }
        return { ...d, capabilities: Array.from(currentCaps) as DeviceCapability[] };
      })
    );
  };

  const handleSaveCapabilities = async (device: Device) => {
    try {
      setSavingDeviceId(device.id);
      setError(null);
      setSuccessMessage(null);
      const opId = crypto.randomUUID();
      await productSalesApi.updateDeviceCapabilities(opId, device.id, device.revision, device.capabilities);
      setSuccessMessage(`${device.displayName}의 권한이 성공적으로 저장되었습니다.`);
      await loadDevices();
    } catch (err: any) {
      setError(err.message || '권한 저장에 실패했습니다.');
    } finally {
      setSavingDeviceId(null);
    }
  };

  const handleSetOutputDevice = async (device: Device) => {
    try {
      setSavingDeviceId(device.id);
      setError(null);
      setSuccessMessage(null);
      const opId = crypto.randomUUID();
      await productSalesApi.setOutputDevice(opId, device.id, 1);
      setSuccessMessage(`${device.displayName}이(가) 기본 전표 출력 장치로 지정되었습니다.`);
      await loadDevices();
    } catch (err: any) {
      setError(err.message || '출력 장치 지정에 실패했습니다.');
    } finally {
      setSavingDeviceId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/seller" className="p-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 transition">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Shield className="w-6 h-6 text-indigo-600" />
                기기 권한 및 출력 장치 관리
              </h1>
              <p className="text-sm text-slate-500">
                연결된 Android 휴대폰과 PC 댓글 도우미의 판매/출력 권한을 명시적으로 관리합니다.
              </p>
            </div>
          </div>
          <button
            onClick={loadDevices}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm hover:bg-slate-100 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-3 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl flex items-center gap-3 text-sm">
            <Check className="w-5 h-5 flex-shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {loading && !devices.length ? (
          <div className="text-center py-16 text-slate-400">기기 목록을 불러오는 중...</div>
        ) : devices.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500">
            연결된 기기가 없습니다. 마이페이지에서 새 기기를 연결해 주세요.
          </div>
        ) : (
          <div className="grid gap-6">
            {devices.map((dev) => (
              <div
                key={dev.id}
                className={`bg-white rounded-2xl border p-6 transition shadow-sm ${
                  dev.isOutputDevice ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between pb-4 border-b border-slate-100 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600">
                      {dev.deviceType === 'ANDROID_PHONE' || dev.deviceType === 'ANDROID_SMS' ? (
                        <Smartphone className="w-6 h-6" />
                      ) : (
                        <Monitor className="w-6 h-6" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-slate-900">{dev.displayName}</h3>
                        {dev.isOutputDevice && (
                          <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-700 flex items-center gap-1">
                            <Printer className="w-3 h-3" /> 기본 전표 출력기
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        기기 ID: {dev.id} · 최근 연결: {dev.lastSeenAt ? new Date(dev.lastSeenAt).toLocaleString() : '미확인'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {dev.capabilities.includes('PRINT') && !dev.isOutputDevice && (
                      <button
                        onClick={() => handleSetOutputDevice(dev)}
                        disabled={savingDeviceId === dev.id}
                        className="px-3 py-1.5 text-xs font-semibold bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg transition disabled:opacity-50"
                      >
                        출력 기기로 지정
                      </button>
                    )}
                    <button
                      onClick={() => handleSaveCapabilities(dev)}
                      disabled={savingDeviceId === dev.id}
                      className="px-4 py-1.5 text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg transition disabled:opacity-50 shadow-sm"
                    >
                      {savingDeviceId === dev.id ? '저장 중...' : '권한 저장'}
                    </button>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">허용할 기능 권한</h4>
                  <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {ALL_CAPABILITIES.map((cap) => {
                      const checked = dev.capabilities.includes(cap.key);
                      return (
                        <label
                          key={cap.key}
                          className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition select-none ${
                            checked ? 'bg-indigo-50/40 border-indigo-200' : 'bg-slate-50 border-slate-200 hover:bg-slate-100/50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => handleToggleCapability(dev.id, cap.key)}
                            className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                          />
                          <div>
                            <div className="text-sm font-semibold text-slate-800">{cap.label}</div>
                            <div className="text-xs text-slate-500 mt-0.5 leading-snug">{cap.desc}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
