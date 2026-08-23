import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SalesProvider } from './context/SalesContext';
import { LiveProvider } from './context/LiveContext';
import { AppDataProvider } from './context/AppDataContext';
import { Header } from './components/common/Header';
import { Sidebar } from './components/common/Sidebar';

// 페이지 목록
import { OnboardingPage } from './pages/auth/OnboardingPage';
import { LoginPage } from './pages/auth/LoginPage';
import { SignupPage } from './pages/auth/SignupPage';
import { PasswordResetPage } from './pages/auth/PasswordResetPage';
import { PricingPage } from './pages/auth/PricingPage';

import { LiveHomePage } from './pages/seller/LiveHomePage';
import { VoiceTrainingPage } from './pages/seller/VoiceTrainingPage';
import { RecognitionRulesPage } from './pages/seller/RecognitionRulesPage';
import { SalesListPage } from './pages/seller/SalesListPage';
import { SalesDetailPage } from './pages/seller/SalesDetailPage';
import { SalesReviewPage } from './pages/seller/SalesReviewPage';
import { SettlementPage } from './pages/seller/SettlementPage';

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
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();

  // 온보딩 및 인증 페이지는 사이드바 숨김
  const authRoutes = ['/onboarding', '/login', '/signup', '/password/reset', '/pricing'];
  const isAuthRoute = authRoutes.some((route) => location.pathname === route);

  const showSidebar = isAuthenticated && !isAuthRoute;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col selection:bg-brand-500 selection:text-white">
      <Header />
      <div className="flex-1 flex flex-row">
        {showSidebar && <Sidebar />}
        <main className="flex-1 overflow-x-hidden min-h-[calc(100vh-4rem)]">
          {children}
        </main>
      </div>
    </div>
  );
};

const RootRedirect: React.FC = () => {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/onboarding" replace />;
  if (user?.role === '관리자') return <Navigate to="/admin" replace />;
  return <Navigate to="/live" replace />;
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SalesProvider>
          <LiveProvider>
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

                  {/* 2. 판매자 핵심 기능 (PG-006 ~ PG-013) */}
                  <Route path="/live" element={<LiveHomePage />} />
                  <Route path="/voice-training" element={<VoiceTrainingPage />} />
                  <Route path="/recognition-rules" element={<RecognitionRulesPage />} />
                  <Route path="/sales" element={<SalesListPage />} />
                  <Route path="/sales/:id" element={<SalesDetailPage />} />
                  <Route path="/sales/:id/capture" element={<SalesDetailPage />} />
                  <Route path="/sales/review" element={<SalesReviewPage />} />
                  <Route path="/settlement" element={<SettlementPage />} />

                  {/* 3. 구독 섹션 (PG-014 ~ PG-017) */}
                  <Route path="/subscription" element={<Navigate to="/subscription/plans" replace />} />
                  <Route path="/subscription/plans" element={<PlanSelectionPage />} />
                  <Route path="/subscription/payment" element={<PaymentPage />} />
                  <Route path="/subscription/manage" element={<SubscriptionManagePage />} />

                  {/* 4. 마이 & 알림 설정 (PG-018 ~ PG-020) */}
                  <Route path="/notifications/settings" element={<NotificationSettingsPage />} />
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
                  <Route path="/admin" element={<AdminDashboardPage />} />
                  <Route path="/admin/members" element={<MemberManagementPage />} />
                  <Route path="/admin/reports" element={<ReportManagementPage />} />
                  <Route path="/admin/stats" element={<AdminStatsPage />} />

                  {/* 일치하지 않는 경로는 홈으로 리다이렉트 */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </AppLayout>
            </AppDataProvider>
          </LiveProvider>
        </SalesProvider>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
