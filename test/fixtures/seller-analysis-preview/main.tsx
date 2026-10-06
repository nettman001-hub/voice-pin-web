import React from 'react';
import {createRoot} from 'react-dom/client';
import SellerAnalysisPage from '../../../src/pages/admin/SellerAnalysisPage';
import '../../../src/index.css';
createRoot(document.getElementById('root')!).render(<><p className="bg-amber-100 p-2 text-center text-xs">로컬 UI 테스트 · 가상 자료 · 운영 서버 연결 없음</p><SellerAnalysisPage/></>);
