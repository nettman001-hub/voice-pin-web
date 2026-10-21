import React,{useState} from 'react';
import {useTouchMode} from '../../context/TouchModeContext';
export const SalesModeSelector:React.FC<{locked:boolean}>=({locked})=>{
  const {settings,save}=useTouchMode();const [busy,setBusy]=useState(false),[error,setError]=useState('');
  return <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm">
    <strong>판매방식</strong>{(['VOICE','COMMENT_TOUCH'] as const).map(mode=><button type="button" key={mode} disabled={locked||busy}
      aria-pressed={settings.mode===mode} className={`rounded-lg border px-4 py-2 font-bold disabled:opacity-50 ${settings.mode===mode?'border-blue-600 bg-blue-600 text-white':'bg-white text-slate-600'}`}
      onClick={()=>{setBusy(true);setError('');void save({...settings,mode}).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>{mode==='VOICE'?'음성인식':'댓글터치'}</button>)}
    {locked&&<span className="text-xs text-slate-500">판매 중에는 방식을 변경할 수 없습니다.</span>}{error&&<span role="alert" className="text-rose-600">{error}</span>}
  </div>;
};
