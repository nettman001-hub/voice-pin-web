import React, { useEffect, useRef, useState } from 'react';
import {
  EulerCommentStream,
  type CommentToken,
  type EulerComment,
  type EulerStatus,
} from '../../services/eulerComments';

// 로그인·서버 모듈은 이 시험을 쓸 때만 불러온다(시험 화면의 프린터·카메라 시험은 로그인 없이 돈다).
const invokeSalesApi = async <T,>(action: string, payload: Record<string, unknown> = {}) =>
  (await import('../../services/productSalesApi')).invokeSalesApi<T>(action, payload);

const btn = 'rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-bold disabled:opacity-40';
const primary = 'rounded-xl bg-blue-700 px-3 py-3 text-sm font-bold text-white disabled:opacity-40';

/** 1단계 시험: 판매 폰이 Euler 댓글 서버에 직접 붙어 댓글을 받는지. 받은 원문 앞부분을 기록에 남긴다. */
export function SellTestComments({ addLog }: { addLog: (line: string) => void }) {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [tiktokId, setTiktokId] = useState('');
  const [status, setStatus] = useState<EulerStatus | null>(null);
  const [comments, setComments] = useState<EulerComment[]>([]);
  const [error, setError] = useState('');
  const stream = useRef<EulerCommentStream | null>(null);
  const raws = useRef(0);

  useEffect(() => {
    void import('../../services/supabaseClient')
      .then(({ requireSupabase }) => requireSupabase().auth.getSession())
      .then(({ data }) => setLoggedIn(!!data.session))
      .catch(() => setLoggedIn(false));
    return () => stream.current?.stop();
  }, []);

  const connect = async () => {
    setError('');
    try {
      const id = tiktokId.trim().replace(/^@/, '');
      if (id) await invokeSalesApi('touch-tiktok-id', { uniqueId: id });
      raws.current = 0;
      setComments([]);
      stream.current?.stop();
      const s = new EulerCommentStream({
        getToken: async () => {
          const token = await invokeSalesApi<CommentToken>('touch-comment-token');
          addLog(`댓글 연결 정보: ${token.mode === 'JWT' ? '짧은 토큰' : '키 전달'} · @${token.uniqueId}`);
          return token;
        },
        onComments: (items) => {
          setComments((old) => [...items.reverse(), ...old].slice(0, 30));
          for (const c of items) addLog(`댓글 ${c.nickname}(@${c.uniqueId}): ${c.content}`);
        },
        onStatus: (st) => {
          setStatus(st);
          addLog(`댓글 상태: ${st.state}${'message' in st ? ` · ${st.message}` : ''}`);
        },
        onRaw: (text) => {
          // 모양 확인용으로 앞의 5개만 남긴다.
          if (raws.current++ < 5) addLog(`원문 ${raws.current}: ${text.slice(0, 400)}`);
        },
      });
      stream.current = s;
      s.start();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const stop = () => {
    stream.current?.stop();
    stream.current = null;
  };

  return (
    <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm" aria-label="댓글 연결 시험">
      <h2 className="text-lg font-black">3. 댓글 연결 (PC 없이)</h2>
      {loggedIn === false ? (
        <p className="text-sm text-slate-600">
          판매자 계정으로 로그인해야 시험할 수 있습니다.{' '}
          <a className="text-blue-700 underline" href="/sell">
            판매 화면에서 로그인
          </a>
          한 뒤 이 화면을 다시 열어 주세요.
        </p>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            방송 중인 틱톡 ID를 넣고 연결하면 이 폰이 댓글을 직접 받습니다. 방송 전이면 &quot;아직 방송 중이
            아닙니다&quot;가 나옵니다.
          </p>
          <label className="block text-sm font-bold">
            틱톡 ID (@ 제외, 비우면 저장된 ID)
            <input
              className="mt-1 w-full rounded-xl border border-slate-300 p-3"
              value={tiktokId}
              onChange={(e) => setTiktokId(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={primary} onClick={() => void connect()}>
              댓글 연결
            </button>
            <button type="button" className={btn} disabled={!stream.current} onClick={stop}>
              끊기
            </button>
          </div>
          <p className="text-sm">
            상태: <strong>{status ? status.state : '연결 안 함'}</strong>
            {status && 'message' in status ? ` · ${status.message}` : ''} · 받은 댓글 {comments.length}개
          </p>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <ul className="max-h-48 space-y-1 overflow-auto text-sm">
            {comments.map((c) => (
              <li key={c.id} className="rounded bg-slate-50 p-2">
                <strong>{c.nickname}</strong> {c.content}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
