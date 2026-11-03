import React, { useEffect, useState } from 'react';
import { MonitorSmartphone, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { invokeSalesApi } from '../../services/productSalesApi';

const LOCAL_HELPER = 'http://127.0.0.1:2137/helper/registration';

/** 이 PC에서 실행 중인 도우미의 확인코드를 읽는다(허용된 Origin만 응답). 실패하면 직접 입력. */
async function readLocalCode(): Promise<string | null> {
  try {
    const res = await fetch(LOCAL_HELPER, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json?.code === 'string' ? json.code : null;
  } catch {
    return null;
  }
}

export function normalizeHelperCode(input: string) {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

/**
 * Windows 댓글도우미 등록: 도우미가 연 브라우저에서 로그인한 대표·매니저가 확인코드를 확인하고 승인한다.
 * 토큰은 이 페이지를 거치지 않는다(도우미가 서버에서 직접 받는다).
 */
export const HelperRegisterPage: React.FC = () => {
  const { workspaceId } = useAuth();
  const [code, setCode] = useState('');
  const [autoFilled, setAutoFilled] = useState(false);
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let alive = true;
    void readLocalCode().then((c) => {
      if (alive && c) {
        setCode(c);
        setAutoFilled(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const submit = async () => {
    setState('saving');
    setMessage('');
    try {
      const result = await invokeSalesApi<{ helperName: string }>('helper-register-approve', {
        code,
        ...(workspaceId ? { workspaceId } : {}),
      });
      setState('done');
      setMessage(`${result.helperName || '이 PC'}를 등록했습니다. 도우미 화면에 "등록됨"이 보이면 이 창을 닫아도 됩니다.`);
    } catch (e) {
      setState('error');
      setMessage((e as Error).message || '등록하지 못했습니다.');
    }
  };

  const ready = code.replace('-', '').length === 8;

  return (
    <div className="mx-auto max-w-xl space-y-5 p-4 sm:p-8">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl bg-brand-50 p-2 text-brand-600">
            <MonitorSmartphone className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-black text-slate-900">PC 댓글도우미 등록</h1>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          이 PC의 VoiceCAP 댓글도우미를 내 판매자 계정에 등록합니다. 등록하면 PC 홈페이지를 닫아도 도우미가 안드로이드 판매
          폰으로 댓글을 보낼 수 있습니다. 이미 등록된 다른 도우미가 있으면 그 등록과 폰 연결은 해제됩니다.
        </p>

        <label htmlFor="helper-code" className="mt-5 block text-xs font-bold text-slate-700">
          도우미 화면의 확인코드 (8자리)
        </label>
        <input
          id="helper-code"
          value={code}
          onChange={(e) => {
            setCode(normalizeHelperCode(e.target.value));
            setAutoFilled(false);
          }}
          placeholder="ABCD-EFGH"
          autoComplete="off"
          className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center font-mono text-2xl tracking-[0.3em] text-slate-900 focus:border-brand-500 focus:outline-none"
        />
        <p className="mt-1.5 text-xs text-slate-500">
          {autoFilled
            ? '이 PC에서 실행 중인 도우미의 코드를 불러왔습니다. 도우미 화면의 코드와 같은지 확인해 주세요.'
            : '도우미 화면에 보이는 코드를 입력해 주세요. 다른 사람이 보낸 코드는 입력하지 마세요.'}
        </p>

        <button
          type="button"
          disabled={!ready || state === 'saving' || state === 'done'}
          onClick={() => void submit()}
          className="mt-5 w-full rounded-2xl bg-brand-600 py-3.5 text-sm font-black text-white disabled:opacity-40"
        >
          {state === 'saving' ? '등록하는 중...' : state === 'done' ? '등록됨' : '이 PC 등록'}
        </button>

        {message && (
          <div
            className={`mt-4 flex items-start gap-2 rounded-2xl p-3.5 text-sm ${
              state === 'done' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
            }`}
          >
            {state === 'done' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{message}</span>
          </div>
        )}
      </div>
    </div>
  );
};
