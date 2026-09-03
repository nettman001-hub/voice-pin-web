import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, ArrowLeft, Lock, Smartphone, Database, UserCheck } from 'lucide-react';

export const PrivacyPolicyPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-white rounded-3xl shadow-sm border border-slate-200 p-6 sm:p-10">
        <div className="mb-8">
          <Link
            to="/onboarding"
            className="inline-flex items-center text-sm font-semibold text-brand-600 hover:text-brand-700 mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            홈으로 돌아가기
          </Link>
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-2xl bg-brand-50 border border-brand-200 flex items-center justify-center text-brand-600">
              <ShieldCheck className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-slate-900">VoiceCAP 개인정보 처리방침</h1>
              <p className="text-xs text-slate-500 mt-0.5">시행일자: 2026년 9월 4일 (최신 개정)</p>
            </div>
          </div>
        </div>

        <div className="space-y-6 text-sm text-slate-700 leading-relaxed">
          <section className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
            <p className="font-semibold text-slate-900">
              VoiceCAP 및 VoiceCAP SMS Bridge(이하 ‘서비스’)는 이용자의 개인정보 및 프라이버시를 매우 소중하게 생각하며, 「개인정보 보호법」 및 Google Play 개발자 프로그램 정책을 철저히 준수합니다.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-brand-600" />
              1. 수집하는 개인정보 항목 및 수집 방법
            </h2>
            <p>서비스는 틱톡 라이브 판매자의 주문 및 정산 처리를 위해 최소한의 정보만을 처리합니다.</p>
            <ul className="list-disc list-inside space-y-1 text-slate-600 pl-2">
              <li><strong>판매자 회원정보:</strong> 이메일, 닉네임, 계정 식별자, 결제/구독 이력</li>
              <li><strong>업무 고객 주문 문자 (SMS/MMS):</strong> 수신 동의한 고객의 전화번호, 구매 주문정보(닉네임, 상품명, 수량, 주소), 첨부된 상품 확인 사진</li>
              <li><strong>배제 항목 (수집하지 않는 정보):</strong> 인증번호(OTP), 은행/금융사 알림, 일반 개인 사생활 문자는 <strong>일체 수집하거나 서버로 전송하지 않습니다.</strong></li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Database className="w-4 h-4 text-brand-600" />
              2. 개인정보의 이용 목적
            </h2>
            <ul className="list-disc list-inside space-y-1 text-slate-600 pl-2">
              <li>실시간 라이브 방송 판매 내역과 고객 구매 문자의 자동 대조 및 주문서 생성</li>
              <li>고객 문의(배송 일정, 계좌 안내, 입금 확인)에 대한 판매자 승인 문자 답변 발송</li>
              <li>택배 송장 생성, 배송 관리 및 정산서 발행</li>
              <li><strong>수집된 데이터는 광고 목적으로 사용되거나 제3자에게 판매되지 않습니다.</strong></li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Lock className="w-4 h-4 text-brand-600" />
              3. SMS/MMS 권한 사용에 대한 특별 고지 (Google Play 준수)
            </h2>
            <p>
              안드로이드 전용 <code>VoiceCAP SMS Bridge</code> 앱은 기본 SMS 앱(Default SMS Handler) 기능을 기반으로 동작하며, 판매자가 명시적으로 동의하고 시스템 권한을 승인한 경우에 한하여 업무용 문자를 동기화합니다.
            </p>
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-900 space-y-1">
              <p>✓ <strong>권한 사용:</strong> READ_SMS, RECEIVE_SMS, RECEIVE_MMS, SEND_SMS</p>
              <p>✓ <strong>필터링 원칙:</strong> 등록된 업무 고객(첫 구매정보 발송자 또는 판매자 발신 번호)과의 거래 관련 대화만 선별 동기화</p>
              <p>✓ <strong>동의 철회:</strong> 앱 내 [이 휴대폰 연결 해제] 또는 안드로이드 설정에서 언제든 권한을 철회할 수 있습니다.</p>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-brand-600" />
              4. 개인정보의 보유 및 파기 절차
            </h2>
            <p>
              원칙적으로 개인정보 수집 및 이용 목적이 달성되면 해당 정보를 지체 없이 파기합니다.
            </p>
            <ul className="list-disc list-inside space-y-1 text-slate-600 pl-2">
              <li><strong>보유 기간:</strong> 회원 탈퇴 시 또는 판매자가 판매/문자 이력 삭제 요청 시 즉시 완전 삭제</li>
              <li><strong>관련 법령에 따른 보존:</strong> 전자상거래 등에서의 소비자보호에 관한 법률 등 관계 법령에 따라 일정 기간 보관이 필요한 거래 기록은 법정 기간 동안 안전하게 보관 후 파기합니다.</li>
            </ul>
          </section>

          <section className="space-y-2 pt-4 border-t border-slate-200">
            <h2 className="text-base font-bold text-slate-900">5. 개인정보 보호책임자 및 문의처</h2>
            <div className="text-xs text-slate-600 space-y-1">
              <p>• 서비스명: VoiceCAP (VoiceCAP SMS Bridge)</p>
              <p>• 고객지원 및 개인정보 문의: <a href="mailto:support@voicecap.shop" className="text-brand-600 underline">support@voicecap.shop</a></p>
              <p>• 공식 웹사이트: <a href="https://www.voicecap.shop" target="_blank" rel="noreferrer" className="text-brand-600 underline">https://www.voicecap.shop</a></p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
