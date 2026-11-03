import React, { useCallback, useEffect, useState } from 'react';
import type { TouchSalesApi } from '../../services/touchSalesApi';
import {
  clearHelperLink,
  helperLinkSecure,
  phoneIdentity,
  readHelperLink,
  saveHelperLink,
} from '../../services/helperLinkStore';

export type HelperPhoneStatus = {
  linkStatus: 'PENDING' | 'ACTIVE' | 'REJECTED' | 'CANCELLED' | 'EXPIRED' | 'REVOKED';
  helperName?: string;
  enabled?: boolean;
  helperAlive?: boolean;
  collector?: { tiktok?: string; message?: string };
};

const closedMessage: Record<string, string> = {
  REJECTED: 'PC에서 연결을 거절했습니다.',
  CANCELLED: '연결 요청이 취소되었습니다. 인증번호를 다시 받아 주세요.',
  EXPIRED: '승인 시간이 지났습니다. 인증번호를 다시 받아 주세요.',
  REVOKED: 'PC 도우미 연결이 해제되었습니다. 다시 연결해 주세요.',
};

/**
 * 판매 시작 설정의 "PC 댓글도우미" 연결. 인증번호 입력 → PC 승인 → 이 폰에서만 쓰는 연결 토큰 보관.
 * 판매 시작 전에 끝내서 촬영 중인 카메라와 겹치지 않게 한다.
 */
export function HelperLinkPanel(props: {
  api: TouchSalesApi;
  disabled?: boolean;
  onReady: (ready: boolean) => void;
}) {
  const { api, onReady } = props;
  const workspaceId = api.workspaceId;
  const [status, setStatus] = useState<HelperPhoneStatus | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [hasToken, setHasToken] = useState(() => !!readHelperLink(workspaceId));

  const check = useCallback(async () => {
    const token = readHelperLink(workspaceId);
    setHasToken(!!token);
    if (!token) {
      setStatus(null);
      onReady(false);
      return;
    }
    try {
      const s = await api.call<HelperPhoneStatus>('helper-phone-status', { linkToken: token });
      setStatus(s);
      onReady(s.linkStatus === 'ACTIVE');
      if (s.linkStatus !== 'ACTIVE' && s.linkStatus !== 'PENDING') {
        clearHelperLink(workspaceId);
        setHasToken(false);
        setMessage(closedMessage[s.linkStatus] || '');
      }
    } catch (e) {
      const c = (e as { code?: string }).code;
      if (c === 'LINK_NOT_ACTIVE' || c === 'LINK_NOT_FOUND') {
        clearHelperLink(workspaceId);
        setHasToken(false);
        setStatus(null);
        setMessage('PC 도우미 연결 정보가 없습니다. 다시 연결해 주세요.');
      } else setMessage((e as Error).message || '연결 상태를 확인하지 못했습니다.');
      onReady(false);
    }
  }, [api, workspaceId, onReady]);

  useEffect(() => {
    void check();
  }, [check]);

  // 승인 기다리는 동안 2초마다 확인.
  useEffect(() => {
    if (status?.linkStatus !== 'PENDING') return;
    const timer = setInterval(() => void check(), 2000);
    return () => clearInterval(timer);
  }, [status?.linkStatus, check]);

  const claim = async () => {
    setBusy(true);
    setMessage('');
    try {
      const me = phoneIdentity();
      const r = await api.call<{ linkToken: string; helperName: string }>('helper-pair-claim', {
        code,
        installId: me.installId,
        phoneName: me.name,
      });
      if (!saveHelperLink(workspaceId, r.linkToken))
        throw new Error('이 폰에 연결 정보를 안전하게 저장하지 못했습니다. 앱을 다시 열어 주세요.');
      setCode('');
      await check();
    } catch (e) {
      setMessage((e as Error).message || '연결하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!confirm('이 폰과 PC 댓글도우미의 연결을 해제할까요? 다시 쓰려면 PC에서 다시 승인해야 합니다.')) return;
    setBusy(true);
    try {
      const token = readHelperLink(workspaceId);
      if (token) await api.call('helper-phone-unlink', { linkToken: token }).catch(() => {});
    } finally {
      clearHelperLink(workspaceId);
      setHasToken(false);
      setStatus(null);
      onReady(false);
      setBusy(false);
    }
  };

  const active = status?.linkStatus === 'ACTIVE';
  const pending = status?.linkStatus === 'PENDING';
  const pcState = !active
    ? ''
    : !status?.helperAlive
      ? 'PC 도우미 꺼짐 · PC에서 도우미를 실행해 주세요'
      : !status?.enabled
        ? '판매를 시작하면 PC 도우미 댓글 연결이 자동으로 켜집니다'
        : 'PC 도우미 켜짐';

  return (
    <div className="touch-helper-link" aria-live="polite">
      {active && (
        <div className="touch-phone-printer">
          <span>
            PC ● {status?.helperName || 'PC 댓글도우미'} 연결됨
            <br />
            <small>{pcState}</small>
          </span>
          <button type="button" disabled={busy || props.disabled} onClick={() => void unlink()}>
            연결 해제
          </button>
        </div>
      )}
      {pending && (
        <div className="touch-phone-printer">
          <span>
            {status?.helperName || 'PC'}에서 승인을 기다리는 중입니다. PC 도우미 화면에서 <b>승인</b>을 눌러 주세요.
          </span>
          <button type="button" disabled={busy} onClick={() => void unlink()}>
            취소
          </button>
        </div>
      )}
      {!hasToken && (
        <label>
          PC 도우미 화면의 인증번호 6자리
          <div className="touch-helper-code">
            <input
              value={code}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <button type="button" disabled={busy || props.disabled || code.length !== 6} onClick={() => void claim()}>
              PC와 연결
            </button>
          </div>
        </label>
      )}
      {!helperLinkSecure() && (
        <small className="touch-muted">
          이 브라우저에서는 연결 정보를 저장하지 않습니다. 페이지를 새로 열면 다시 연결해야 합니다. 판매 앱을 쓰면 안전하게 기억합니다.
        </small>
      )}
      {message && <p role="status" className="touch-muted">{message}</p>}
    </div>
  );
}
