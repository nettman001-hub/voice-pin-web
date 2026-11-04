import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, Phone, RefreshCw, UserX } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useManageDashboard } from '../../services/manage/useManageData';
import { ManageApi } from '../../services/manage/manageApi';
import { normalizePhone } from '../../services/manage/contactLink';
import { buildContactWorklist, callListText, formatPhone } from '../../services/manage/contactWorklist';
import { appToast } from '../../services/appDownload';
import { ManageBackLink } from '../../components/manage/ManageBackLink';

/**
 * 연락처 연결 (청구보다 먼저).
 * 판매자는 구매자에게 먼저 연락할 수 없으므로, 구매자가 보낸 문자(닉네임+번호)를 구매자에 붙인다.
 * 모든 변경은 서버(manage-contact-link)로만 저장한다. 인터넷이 끊기면 저장하지 않는다.
 */
export const ContactLinkPage: React.FC = () => {
  const { workspaceId } = useAuth();
  const api = useMemo(() => (workspaceId ? new ManageApi(workspaceId) : null), [workspaceId]);
  const [periodDays, setPeriodDays] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const { dashboard, server } = useManageDashboard(periodDays, reloadKey);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const showAppToast = (message: string) => { setNotice(message); appToast({ message }); };
  const [manualPhone, setManualPhone] = useState<Record<string, string>>({});
  const [assignTo, setAssignTo] = useState<Record<string, string>>({});

  const list = useMemo(
    () => buildContactWorklist(dashboard.contactBook, dashboard.contactMessages),
    [dashboard.contactBook, dashboard.contactMessages],
  );
  const waitingBuyers = useMemo(
    () => [...list.missing, ...list.confirm].sort((a, b) => a.nickname.localeCompare(b.nickname, 'ko')),
    [list],
  );

  const run = async (key: string, action: () => Promise<unknown>, done: string) => {
    if (!api) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError('인터넷 연결 후 다시 해 주세요.');
      return;
    }
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      showAppToast(done);
      setReloadKey((value) => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(null);
    }
  };

  const link = (buyerKey: string, nickname: string, phone: string, source: 'MANUAL' | 'MESSAGE') =>
    run(`${buyerKey}:${phone}`, () => api!.linkContact({ phone, buyerKey, nickname, source }), `${nickname}님 번호를 연결했습니다.`);

  const copyCallList = async () => {
    const text = callListText(list.missing);
    try {
      await navigator.clipboard.writeText(text);
      showAppToast('불러 줄 명단을 복사했습니다.');
    } catch {
      setError(`복사하지 못했습니다. 직접 읽어 주세요: ${text}`);
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-3 p-3 lg:max-w-3xl">
      <div className="flex items-center justify-between gap-1">
        <div className="flex min-w-0 items-center gap-1">
          <ManageBackLink inline />
          <div role="tablist" aria-label="기간" className="flex gap-1">
            {[{ days: 7, label: '7일' }, { days: 30, label: '30일' }, { days: 0, label: '전체' }].map((period) => (
              <button
                key={period.days}
                type="button"
                role="tab"
                aria-selected={periodDays === period.days}
                onClick={() => setPeriodDays(period.days)}
                className={`min-h-[36px] rounded-full px-3 text-xs font-bold ${
                  periodDays === period.days ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600'
                }`}
              >
                {period.label}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setReloadKey((key) => key + 1)}
          aria-label="새로고침"
          className="flex h-9 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 text-xs font-bold text-slate-600 min-[380px]:px-3"
        >
          <RefreshCw className="h-3.5 w-3.5" /> <span className="hidden min-[380px]:inline">새로고침</span>
        </button>
      </div>

      {!server.serverReady && server.loadedAt && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          서버 연결 기록을 읽지 못했습니다. 인터넷 연결을 확인해 주세요.
        </div>
      )}
      {notice && !error && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{notice}</div>
      )}
      {error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">{error}</div>
      )}

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <h2 className="text-sm font-extrabold text-emerald-900">수신OK 새구매자 {list.toSave.length}건</h2>
        {list.toSave.length === 0 ? (
          <p className="mt-1 text-sm text-emerald-800">새 문자로 확인된 구매자가 없습니다.</p>
        ) : (
          <>
            <p className="mt-0.5 text-xs text-emerald-800">문자에 닉네임이 그대로 있었습니다. 저장하면 다음 회차에도 자동으로 연결됩니다.</p>
            <ul className="mt-2 space-y-1 text-sm text-emerald-950">
              {list.toSave.map((contact) => (
                <li key={contact.buyerKey} className="flex justify-between gap-2">
                  <span className="truncate font-bold">{contact.nickname}</span>
                  <span className="tabular-nums">{formatPhone(contact.phone || '')}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void run('save-all', async () => {
                for (const contact of list.toSave) {
                  await api!.linkContact({ phone: contact.phone!, buyerKey: contact.buyerKey, nickname: contact.nickname, source: 'MESSAGE' });
                }
              }, `${list.toSave.length}건을 저장했습니다.`)}
              className="mt-2 h-11 w-full rounded-xl bg-emerald-600 text-sm font-bold text-white disabled:opacity-50"
            >
              모두 저장
            </button>
          </>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-amber-200 bg-white">
        <h2 className="border-b border-amber-100 bg-amber-50 px-4 py-2.5 text-sm font-extrabold text-amber-900">
          확인 필요 {list.confirm.length}
        </h2>
        {list.confirm.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">확인할 연결이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.confirm.map((contact) => (
              <li key={contact.buyerKey} className="px-4 py-3">
                <div className="text-sm font-extrabold text-slate-900">{contact.nickname}</div>
                <div className="text-[11px] font-bold text-amber-700">{contact.reason}</div>
                <ul className="mt-2 space-y-2">
                  {contact.snippets.map((snippet) => (
                    <li key={snippet.phone} className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="flex items-center justify-between gap-2 text-xs font-bold text-slate-700">
                        <span className="tabular-nums">{formatPhone(snippet.phone)}</span>
                        <span className="text-slate-400">문자 {snippet.count}통</span>
                      </div>
                      {snippet.lastBody && <p className="mt-1 line-clamp-3 break-words text-sm text-slate-800">“{snippet.lastBody}”</p>}
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() => void link(contact.buyerKey, contact.nickname, snippet.phone, 'MESSAGE')}
                          className="flex h-10 flex-1 items-center justify-center gap-1 rounded-lg bg-brand-600 text-sm font-bold text-white disabled:opacity-50"
                        >
                          <Check className="h-4 w-4" /> 이 번호로 연결
                        </button>
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() => void run(`block:${snippet.phone}`, () => api!.blockContact({ phone: snippet.phone, buyerKey: contact.buyerKey, nickname: contact.nickname }), '이 번호는 이 구매자에게 다시 붙이지 않습니다.')}
                          className="flex h-10 items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 disabled:opacity-50"
                        >
                          <UserX className="h-4 w-4" /> 아님
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          <h2 className="text-sm font-extrabold text-slate-900">연락 대기 {list.missing.length}</h2>
          {list.missing.length > 0 && (
            <button type="button" onClick={() => void copyCallList()} className="flex min-h-[36px] items-center gap-1 text-xs font-bold text-brand-700">
              <Copy className="h-3.5 w-3.5" /> 불러 줄 명단 복사
            </button>
          )}
        </div>
        {list.missing.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">모든 구매자의 연락처가 있습니다.</p>
        ) : (
          <>
            <p className="px-4 pt-2 text-[11px] text-slate-500">방송에서 이름을 불러 문자를 부탁하거나, 카톡 등으로 받은 번호를 직접 넣으세요.</p>
            <ul className="divide-y divide-slate-100">
              {list.missing.map((contact) => {
                const value = manualPhone[contact.buyerKey] || '';
                const phone = normalizePhone(value);
                const valid = /^0\d{8,10}$/.test(phone);
                return (
                  <li key={contact.buyerKey} className="flex items-center gap-2 px-4 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">{contact.nickname}</span>
                    <input
                      type="tel"
                      inputMode="tel"
                      placeholder="010-0000-0000"
                      aria-label={`${contact.nickname} 연락처`}
                      value={value}
                      onChange={(event) => setManualPhone((prev) => ({ ...prev, [contact.buyerKey]: event.target.value }))}
                      className="h-10 w-36 rounded-lg border border-slate-300 px-2 text-sm tabular-nums"
                    />
                    <button
                      type="button"
                      disabled={!valid || !!busy}
                      onClick={() => void link(contact.buyerKey, contact.nickname, phone, 'MANUAL')}
                      className="flex h-10 items-center gap-1 rounded-lg bg-slate-900 px-3 text-sm font-bold text-white disabled:opacity-40"
                    >
                      <Phone className="h-4 w-4" /> 연결
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-extrabold text-slate-900">발신자 확인안됨 {list.unknown.length}</h2>
        {list.unknown.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">모르는 번호의 문자가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.unknown.map((snippet) => {
              const chosen = assignTo[snippet.phone] || '';
              const buyer = waitingBuyers.find((item) => item.buyerKey === chosen);
              return (
                <li key={snippet.phone} className="px-4 py-3">
                  <div className="flex justify-between text-xs font-bold text-slate-700">
                    <span className="tabular-nums">{formatPhone(snippet.phone)}</span>
                    <span className="text-slate-400">문자 {snippet.count}통</span>
                  </div>
                  {snippet.lastBody && <p className="mt-1 line-clamp-3 break-words text-sm text-slate-800">“{snippet.lastBody}”</p>}
                  {waitingBuyers.length > 0 && (
                    <div className="mt-2 flex gap-2">
                      <select
                        aria-label="연결할 구매자"
                        value={chosen}
                        onChange={(event) => setAssignTo((prev) => ({ ...prev, [snippet.phone]: event.target.value }))}
                        className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-sm"
                      >
                        <option value="">연락 기다리는 구매자 고르기</option>
                        {waitingBuyers.map((item) => (
                          <option key={item.buyerKey} value={item.buyerKey}>{item.nickname}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!buyer || !!busy}
                        onClick={() => buyer && void link(buyer.buyerKey, buyer.nickname, snippet.phone, 'MANUAL')}
                        className="h-10 rounded-lg bg-slate-900 px-3 text-sm font-bold text-white disabled:opacity-40"
                      >
                        연결
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-extrabold text-slate-900">수신OK 기존구매자 {list.linked.length}</h2>
        {list.linked.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">아직 연결된 구매자가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.linked.map((contact) => (
              <li key={contact.buyerKey} className="flex items-center gap-2 px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">{contact.nickname}</span>
                <span className="text-xs tabular-nums text-slate-600">{formatPhone(contact.phone || '')}</span>
                <button
                  type="button"
                  disabled={!!busy || !server.serverReady}
                  onClick={() => {
                    if (!window.confirm(`${contact.nickname}님과 이 번호의 연결을 해제할까요? 같은 번호는 이 구매자에게 다시 자동으로 붙지 않습니다.`)) return;
                    void run(`unlink:${contact.phone}`, () => api!.blockContact({ phone: contact.phone!, buyerKey: contact.buyerKey, nickname: contact.nickname }), '연결을 해제했습니다.');
                  }}
                  className="h-9 rounded-lg border border-slate-300 px-2 text-xs font-bold text-slate-600 disabled:opacity-40"
                >
                  해제
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link to="/manage/orders?stage=READY_TO_BILL" className="block text-center text-sm font-bold text-brand-700">
        청구 전 주문 보기
      </Link>
    </div>
  );
};

export default ContactLinkPage;
