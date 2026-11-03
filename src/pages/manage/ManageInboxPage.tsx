import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, GitCompare, ReceiptText, UserCheck } from 'lucide-react';

/** 문자·입금: 새 "확인 필요" 화면이 생기기 전까지 기존 화면으로 이어 준다. */
export const ManageInboxPage: React.FC = () => (
  <div className="mx-auto max-w-lg space-y-3 p-3">
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {[
        { to: '/manage/contacts', icon: UserCheck, name: '연락처 연결', hint: '구매자가 보낸 닉네임·번호 확인, 모르는 번호 지정' },
        { to: '/customer-messages', icon: GitCompare, name: '문자', hint: '받은 문자와 판매내역을 맞춰 봅니다' },
        { to: '/invoices', icon: ReceiptText, name: '입금', hint: '정산서와 입금 확인' },
      ].map((item) => (
        <li key={item.to}>
          <Link to={item.to} className="flex min-h-[56px] items-center gap-3 px-4 py-3 active:bg-slate-50">
            <item.icon className="h-5 w-5 flex-shrink-0 text-brand-600" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-slate-900">{item.name}</span>
              <span className="mt-0.5 block text-[11px] text-slate-500">{item.hint}</span>
            </span>
            <ChevronRight className="h-4 w-4 text-slate-400" />
          </Link>
        </li>
      ))}
    </ul>
  </div>
);

export default ManageInboxPage;
