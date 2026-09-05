import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SalesProvider } from './context/SalesContext';
import { LiveProvider } from './context/LiveContext';
import { CommentCaptureProvider } from './context/CommentCaptureContext';
import { AppDataProvider } from './context/AppDataContext';
import { Header } from './components/common/Header';
import { Sidebar } from './components/common/Sidebar';
import { MobileBottomNav } from './components/common/MobileBottomNav';

// 페이지 목록
import { OnboardingPage } from './pages/auth/OnboardingPage';
import { LoginPage } from './pages/auth/LoginPage';
import { SignupPage } from './pages/auth/SignupPage';
import { PasswordResetPage } from './pages/auth/PasswordResetPage';
import { PricingPage } from './pages/auth/PricingPage';
import { PrivacyPolicyPage } from './pages/legal/PrivacyPolicyPage';

import { LiveHomePage } from './pages/seller/LiveHomePage';
import { VoiceTrainingPage } from './pages/seller/VoiceTrainingPage';
import { RecognitionRulesPage } from './pages/seller/RecognitionRulesPage';
import { CommentRecordsPage } from './pages/seller/CommentRecordsPage';
import { SalesListPage } from './pages/seller/SalesListPage';
import { SalesDetailPage } from './pages/seller/SalesDetailPage';
import { SalesReviewPage } from './pages/seller/SalesReviewPage';
import { SettlementPage } from './pages/seller/SettlementPage';
import { CaptureViewerModal } from './pages/seller/CaptureViewerModal';
import { InvoiceManagementPage } from './pages/seller/InvoiceManagementPage';
import { ShipmentManagementPage } from './pages/seller/ShipmentManagementPage';
import { CommerceProvider } from './context/CommerceContext';

import { PlanSelectionPage } from './pages/subscription/PlanSelectionPage';
import { PaymentPage } from './pages/subscription/PaymentPage';
import { SubscriptionManagePage } from './pages/subscription/SubscriptionManagePage';

import { NotificationSettingsPage } from './pages/my/NotificationSettingsPage';
import { MyPage } from './pages/my/MyPage';
import { PermissionErrorModal } from './pages/my/PermissionErrorModal';

import { AdminDashboardPage } from './pages/admin/AdminDashboardPage';
import { MemberManagementPage } from './pages/admin/MemberManagementPage';
import { ReportManagementPage } from './pages/admin/ReportManagementPage';
import { AdminStatsPage } from './pages/admin/AdminStatsPage';

const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // 온보딩 및 인증/공개 정책 페이지는 사이드바 및 하단 바 숨김
  const authRoutes = ['/onboarding', '/login', '/signup', '/password/reset', '/pricing', '/privacy'];
  const isAuthRoute = authRoutes.some((route) => location.pathname === route);

  const showNav = isAuthenticated && !isAuthRoute;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col selection:bg-brand-500 selection:text-white antialiased">
      <Header
        onToggleMobileMenu={showNav ? () => setIsMobileMenuOpen(!isMobileMenuOpen) : undefined}
        isMobileMenuOpen={isMobileMenuOpen}
      />
      <div className="flex-1 flex flex-row relative">
        {showNav && (
          <Sidebar
            isMobileOpen={isMobileMenuOpen}
            onCloseMobile={() => setIsMobileMenuOpen(false)}
          />
        )}
        <main className={`flex-1 overflow-x-hidden min-h-[calc(100vh-4rem)] ${showNav ? 'pb-20 lg:pb-0' : ''}`}>
          {children}
        </main>
      </div>
      {showNav && <MobileBottomNav />}
    </div>
  );
};

const RootRedirect: React.FC = () => {
  const { isAuthenticated, isInitialized, user } = useAuth();
  if (!isInitialized) return <AuthLoadingState />;
  if (!isAuthenticated) return <Navigate to="/onboarding" replace />;
  if (user?.role === '관리자') return <Navigate to="/admin" replace />;
  return <Navigate to="/live" replace />;
};

const AuthLoadingState: React.FC = () => (
  <div
    role="status"
    aria-live="polite"
    className="min-h-[calc(100vh-4rem)] flex items-center justify-center text-sm font-semibold text-slate-500"
  >
    로그인 상태 확인 중...
  </div>
);

const ProtectedRoute: React.FC = () => {
  const { isAuthenticated, isInitialized } = useAuth();
  if (!isInitialized) return <AuthLoadingState />;
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
};

const AdminRoute: React.FC = () => {
  const { user, isInitialized } = useAuth();
  if (!isInitialized) return <AuthLoadingState />;
  return user?.role === '관리자' ? <Outlet /> : <Navigate to="/live" replace />;
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SalesProvider>
          <CommerceProvider>
          <LiveProvider>
            <CommentCaptureProvider>
              <AppDataProvider>
                <AppLayout>
                <Routes>
                  {/* 루트 리다이렉트 */}
                  <Route path="/" element={<RootRedirect />} />

                  {/* 1. 시작 및 인증 (PG-001 ~ PG-005) */}
                  <Route path="/onboarding" element={<OnboardingPage />} />
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/signup" element={<SignupPage />} />
                  <Route path="/password/reset" element={<PasswordResetPage />} />
                  <Route path="/pricing" element={<PricingPage />} />
                  <Route path="/privacy" element={<PrivacyPolicyPage />} />

                  <Route element={<ProtectedRoute />}>
                    {/* 2. 판매자 핵심 기능 (PG-006 ~ PG-013) */}
                    <Route path="/live" element={<LiveHomePage />} />
                    <Route path="/voice-training" element={<VoiceTrainingPage />} />
                    <Route path="/training" element={<VoiceTrainingPage />} />
                    <Route path="/recognition-rules" element={<RecognitionRulesPage />} />
                    <Route path="/rules" element={<RecognitionRulesPage />} />
                    <Route path="/comments" element={<CommentRecordsPage />} />
                    <Route path="/sales" element={<SalesListPage />} />
                    <Route path="/sales/:id" element={<SalesDetailPage />} />
                    <Route path="/sales/:id/capture" element={<CaptureViewerModal />} />
                    <Route path="/sales/review" element={<SalesReviewPage />} />
                    <Route path="/invoices" element={<InvoiceManagementPage />} />
                    <Route path="/shipments" element={<ShipmentManagementPage />} />
                    <Route path="/settlement" element={<SettlementPage />} />

                    {/* 3. 구독 섹션 (PG-014 ~ PG-017) */}
                    <Route path="/subscription" element={<Navigate to="/subscription/plans" replace />} />
                    <Route path="/subscription/plans" element={<PlanSelectionPage />} />
                    <Route path="/subscription/payment" element={<PaymentPage />} />
                    <Route path="/subscription/manage" element={<SubscriptionManagePage />} />

                    {/* 4. 마이 & 알림 설정 (PG-018 ~ PG-020) */}
                    <Route path="/notifications/settings" element={<NotificationSettingsPage />} />
                    {/* 이전 메뉴 주소를 북마크한 경우에도 알림 설정으로 이동 */}
                    <Route path="/settings/notifications" element={<Navigate to="/notifications/settings" replace />} />
                    <Route path="/my" element={<MyPage />} />
                    <Route
                      path="/error/permission"
                      element={
                        <PermissionErrorModal
                          isOpen={true}
                          onClose={() => window.history.back()}
                          onRetry={() => window.location.reload()}
                        />
                      }
                    />

                    {/* 5. 관리자 웹 대시보드 (PG-021 ~ PG-024) */}
                    <Route element={<AdminRoute />}>
                      <Route path="/admin" element={<AdminDashboardPage />} />
                      <Route path="/admin/members" element={<MemberManagementPage />} />
                      <Route path="/admin/reports" element={<ReportManagementPage />} />
                      <Route path="/admin/stats" element={<AdminStatsPage />} />
                    </Route>
                  </Route>

                  {/* 일치하지 않는 경로는 홈으로 리다이렉트 */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </AppLayout>
              </AppDataProvider>
            </CommentCaptureProvider>
          </LiveProvider>
          </CommerceProvider>
        </SalesProvider>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
