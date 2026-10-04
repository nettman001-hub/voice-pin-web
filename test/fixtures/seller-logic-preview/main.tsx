import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import SellerLogicAnalysisPage from '../../../src/pages/admin/SellerLogicAnalysisPage';
import '../../../src/index.css';
createRoot(document.getElementById('root')!).render(<BrowserRouter><div className="bg-amber-100 p-2 text-center text-xs">로컬 화면 검증 · 가상 AI 응답 · 운영 서버 연결 없음</div><SellerLogicAnalysisPage /></BrowserRouter>);
