import React from 'react';
import { Link } from 'react-router-dom';
import { Mic, Radio, Camera, Database, Sparkles, ArrowRight, CheckCircle2 } from 'lucide-react';

export const OnboardingPage: React.FC = () => {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-slate-50 via-white to-slate-100 text-slate-800 flex flex-col justify-between">
      {/* 히어로 섹션 */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-16 text-center">
        <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-brand-50 border border-brand-200 text-brand-700 text-xs font-bold mb-6 shadow-sm">
          <Sparkles className="w-3.5 h-3.5 text-brand-600" />
          <span>Deepgram Nova-3 실시간 한국어 STT 엔진 탑재</span>
        </div>

        <h1 className="text-4xl sm:text-6xl font-black tracking-tight leading-tight text-slate-900">
          틱톡 라이브 판매 멘트를 듣고,<br />
          <span className="bg-gradient-to-r from-brand-600 via-brand-500 to-rose-500 bg-clip-text text-transparent">
            판매 내역과 댓글 화면을 자동 기록
          </span>
          합니다.
        </h1>

        <p className="mt-6 text-base sm:text-xl text-slate-600 max-w-3xl mx-auto leading-relaxed">
          방송 중에 말하는 <strong className="text-slate-900">"구매확정, 닉네임, 금액"</strong>을 AI가 0.1초 만에 캐치하여 DB에 자동 저장하고, 지정된 댓글창 영역까지 원클릭으로 캡처합니다.
        </p>

        {/* 메인 CTA */}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            to="/signup"
            className="w-full sm:w-auto px-8 py-3.5 rounded-2xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-base shadow-xl shadow-brand-500/25 flex items-center justify-center space-x-2 transition transform hover:-translate-y-0.5"
          >
            <span>7일 무료 체험 시작하기</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            to="/login"
            className="w-full sm:w-auto px-8 py-3.5 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold text-base shadow-sm transition"
          >
            기존 계정으로 로그인
          </Link>
          <Link
            to="/pricing"
            className="text-xs text-slate-500 hover:text-brand-600 font-bold underline underline-offset-4"
          >
            요금제 자세히 보기
          </Link>
        </div>

        {/* 4대 주요 기능 카드 그리드 */}
        <div className="mt-16 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 text-left">
          <div className="p-6 rounded-3xl bg-white border border-slate-200/80 shadow-sm hover:shadow-md hover:border-brand-300 transition">
            <div className="w-12 h-12 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mb-4">
              <Radio className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">실시간 음성 인식</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Deepgram Nova-3와 키워드 바이어싱으로 판매자 특유의 빠른 말투와 닉네임도 정확히 인식합니다.
            </p>
          </div>

          <div className="p-6 rounded-3xl bg-white border border-slate-200/80 shadow-sm hover:shadow-md hover:border-cyan-300 transition">
            <div className="w-12 h-12 rounded-2xl bg-cyan-50 text-cyan-600 flex items-center justify-center mb-4">
              <Database className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">판매 내역 자동 적재</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              구매자 닉네임, 금액, 방송 회차를 자동으로 분류하여 로컬 DB에 저장하고 엑셀 CSV로 내보냅니다.
            </p>
          </div>

          <div className="p-6 rounded-3xl bg-white border border-slate-200/80 shadow-sm hover:shadow-md hover:border-rose-300 transition">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mb-4">
              <Camera className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">지정 영역 화면 캡처</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              "캡처" 한마디에 댓글창/주문창 좌표 영역을 자동으로 잘라내어 판매 내역과 즉시 연결합니다.
            </p>
          </div>

          <div className="p-6 rounded-3xl bg-white border border-slate-200/80 shadow-sm hover:shadow-md hover:border-amber-300 transition">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mb-4">
              <Mic className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">나만의 음성 학습</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              판매자의 자주 쓰는 멘트를 3회 반복 훈련하여 인식률을 98% 이상으로 개인화합니다.
            </p>
          </div>
        </div>

        {/* 3단계 간단 이용 안내 */}
        <div className="mt-16 p-8 rounded-3xl bg-white border border-slate-200 shadow-sm text-left">
          <h2 className="text-xl font-bold text-slate-900 mb-6 text-center">어떻게 사용하나요? (초간단 3단계)</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex items-start space-x-3">
              <div className="w-8 h-8 rounded-full bg-brand-600 text-white flex items-center justify-center font-bold text-sm flex-shrink-0">1</div>
              <div>
                <h4 className="text-sm font-bold text-slate-800">틱톡 라이브 실행</h4>
                <p className="text-xs text-slate-500 mt-1">PC에서 틱톡 라이브를 켜고 방송을 진행합니다.</p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <div className="w-8 h-8 rounded-full bg-brand-600 text-white flex items-center justify-center font-bold text-sm flex-shrink-0">2</div>
              <div>
                <h4 className="text-sm font-bold text-slate-800">VoiceCAP 청취 시작</h4>
                <p className="text-xs text-slate-500 mt-1">VoiceCAP 앱에서 [청취 시작]을 누르고 오디오를 공유합니다.</p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <div className="w-8 h-8 rounded-full bg-brand-600 text-white flex items-center justify-center font-bold text-sm flex-shrink-0">3</div>
              <div>
                <h4 className="text-sm font-bold text-slate-800">자동 저장 & CSV 다운로드</h4>
                <p className="text-xs text-slate-500 mt-1">방송 후 원클릭 일괄 확정 및 엑셀 CSV로 정산 완료!</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 푸터 */}
      <footer className="border-t border-slate-200 bg-white py-8 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex space-x-6">
            <Link to="/password/reset" className="hover:text-brand-600 font-medium">비밀번호 찾기</Link>
            <Link to="/pricing" className="hover:text-brand-600 font-medium">요금제 비교</Link>
            <span className="text-slate-400">이용약관</span>
            <span className="text-slate-400">개인정보처리방침</span>
          </div>
        </div>
        {/* 푸터 카피라이트 */}
        <div className="text-center text-xs text-slate-400 pt-8 border-t border-slate-200">
          <p>© 2026 VoiceCAP. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};
