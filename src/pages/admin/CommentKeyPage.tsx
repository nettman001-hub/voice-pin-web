import React, { useEffect, useState } from 'react';
import { invokeSalesApi } from '../../services/productSalesApi';

interface KeyInfo {
  configured: boolean;
  maskedKey: string;
  accountId: string;
  jwtReady: boolean;
  updatedAt: string | null;
}

/** 관리자 메뉴 "댓글 연결 키 (Euler)". 키는 서버에만 저장하고 화면에는 가린 값만 보인다. */
export default function CommentKeyPage() {
  const [info, setInfo] = useState<KeyInfo | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [accountId, setAccountId] = useState('');
  const [testId, setTestId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    try {
      const value = await invokeSalesApi<KeyInfo>('comment-key-get');
      setInfo(value);
      setAccountId(value.accountId);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const value = await invokeSalesApi<KeyInfo>('comment-key-save', { apiKey, accountId });
      setInfo(value);
      setApiKey('');
      setMessage('저장했습니다.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const value = await invokeSalesApi<{ mode: string; ok: boolean; message: string }>(
        'comment-key-test',
        { uniqueId: testId },
      );
      setMessage(`${value.mode === 'JWT' ? '짧은 토큰' : '키 전달'} · ${value.message}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-8">
      <h1 className="text-2xl font-black">댓글 연결 키 (Euler)</h1>
      <p className="text-sm text-slate-600">
        폰 단독 판매에서 판매 폰이 틱톡 댓글을 직접 받을 때 쓰는 키입니다. 서버에만 저장하고
        판매자에게는 보이지 않습니다. 계정 번호까지 넣으면 판매 폰에는 8시간짜리 짧은 토큰만
        넘기고, 계정 번호가 없거나 토큰을 만들지 못하면 로그인한 판매 앱에 연결할 때마다 키를
        넘깁니다(앱은 저장하지 않음).
      </p>
      <section className="space-y-3 rounded-2xl border bg-white p-4">
        <div className="text-sm">
          지금 키:{' '}
          <strong>{info?.configured ? info.maskedKey : '없음'}</strong>
          {info?.updatedAt && (
            <span className="ml-2 text-slate-500">
              ({new Date(info.updatedAt).toLocaleString('ko-KR')} 저장)
            </span>
          )}
          <div className="mt-1 text-slate-600">
            연결 방식: {info?.jwtReady ? '짧은 토큰 (계정 번호 있음)' : info?.configured ? '키 전달 (계정 번호 없음)' : '-'}
          </div>
        </div>
        <label className="block text-sm font-bold">
          새 키 (바꿀 때만 입력)
          <input
            className="mt-1 w-full rounded-xl border p-2 font-mono"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={info?.configured ? '비워 두면 지금 키를 그대로 씁니다' : 'Euler API 키'}
          />
        </label>
        <label className="block text-sm font-bold">
          Euler 계정 번호 (Euler 대시보드의 Account ID, 숫자)
          <input
            className="mt-1 w-full rounded-xl border p-2"
            inputMode="numeric"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          />
        </label>
        <button
          className="rounded-xl bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50"
          disabled={busy}
          onClick={() => void save()}
        >
          저장
        </button>
      </section>
      <section className="space-y-3 rounded-2xl border bg-white p-4">
        <h2 className="font-black">연결 시험</h2>
        <label className="block text-sm font-bold">
          시험할 틱톡 ID (선택)
          <input
            className="mt-1 w-full rounded-xl border p-2"
            value={testId}
            onChange={(e) => setTestId(e.target.value)}
          />
        </label>
        <button
          className="rounded-xl border px-4 py-2 font-bold disabled:opacity-50"
          disabled={busy || !info?.configured}
          onClick={() => void test()}
        >
          짧은 토큰 만들어 보기
        </button>
      </section>
      {message && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
