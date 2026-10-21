import React from 'react';
import ReactDOM from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {AuthProvider,useAuth} from './context/AuthContext';
import {LoginPage} from './pages/auth/LoginPage';
import TouchMobileSalesPage from './pages/seller/TouchMobileSalesPage';
import './index.css';
const Entry=()=>{
  const {isAuthenticated,isInitialized,isRemoteAuth,workspaceId,user}=useAuth();
  if(!isInitialized)return <div role="status" className="p-8 text-center text-slate-500">판매자 로그인 확인 중…</div>;
  if(!isAuthenticated)return <LoginPage returnTo="/sell"/>;
  if(!isRemoteAuth||!workspaceId)return <div className="p-8 text-center">실제 판매자 계정으로 로그인해 주세요. PC와 폰에서 같은 계정을 사용합니다.</div>;
  return <TouchMobileSalesPage key={`${user?.id}:${workspaceId}`}/>;
};
ReactDOM.createRoot(document.getElementById('root')!).render(<BrowserRouter><AuthProvider><Entry/></AuthProvider></BrowserRouter>);
