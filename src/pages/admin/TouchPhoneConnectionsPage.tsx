import React,{useEffect,useState} from 'react';
import {invokeSalesApi} from '../../services/productSalesApi';
interface Data {month:string;totals:any[];runs:any[];voice:any[];events:any[];names:Record<string,string>;serverNow:number;}
const names:Record<string,string>={START:'판매 시작',STOP:'판매 중지',DIRECT:'직접 연결',FALLBACK:'예비 연결',DISCONNECTED:'폰 연결 끊김',
  HELPER_ERROR:'도우미 연결 끊김',PRINT_ERROR:'전표 확인 필요',CAPTURE_MISSING:'캡처 없음',LATE_SALE:'늦게 도착한 판매',SUMMARY:'5분 요약'};
export default function TouchPhoneConnectionsPage(){
  const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[month,setMonth]=useState(new Date(Date.now()+9*3600000).toISOString().slice(0,7));
  const [quota,setQuota]=useState(5000000),[busy,setBusy]=useState(false);
  useEffect(()=>{
    let active=true,pending=false;const load=async()=>{if(pending)return;pending=true;setBusy(true);
      try{const result=await invokeSalesApi<Data>('touch-admin-connections',{month});if(active){setData(result);setError('');}}
      catch(e){if(active)setError((e as Error).message);}finally{pending=false;if(active)setBusy(false);}};
    void load();const timer=setInterval(()=>void load(),15000);return()=>{active=false;clearInterval(timer);};
  },[month]);
  const estimated=data?.totals.reduce((n,r)=>n+Number(r.fallback_messages)+Number(r.signal_messages),0)||0;
  const percent=estimated/quota*100,now=Date.now();
  const liveRuns=data?.runs.filter(r=>r.running&&Date.parse(r.lease_expires_at)>now)||[];
  const voice=data?.voice.filter(r=>now-Date.parse(r.updated_at)<30000&&!liveRuns.some(t=>t.workspace_id===r.workspace_id))||[];
  return <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-black">판매 폰 연결 현황</h1><p className="mt-1 text-sm text-slate-500">직접·예비 연결과 장애를 확인합니다. 댓글 내용과 고객 정보는 기록하지 않습니다.</p></div>
    <label className="text-sm">조회 월 <input aria-label="조회 월" type="month" value={month} onChange={e=>setMonth(e.target.value)} className="ml-2 rounded border p-2"/></label></div>
    {error&&<p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">{error}</p>}
    <section className={`rounded-2xl border p-5 ${percent>=80?'border-amber-300 bg-amber-50':'bg-white'}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-slate-500">이번 달 댓글터치 Broadcast 메시지 추정치</p><strong className="text-3xl">{estimated.toLocaleString()}</strong><span className="ml-2 text-slate-500">/ {quota.toLocaleString()}건 · {percent.toFixed(1)}%</span></div>
      <select aria-label="메시지 한도" value={quota} onChange={e=>setQuota(Number(e.target.value))} className="rounded-xl border p-3"><option value={2000000}>Free 200만</option><option value={5000000}>Pro / Team 500만</option></select></div>
      <div className="my-3 h-3 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${percent>=80?'bg-amber-500':'bg-blue-600'}`} style={{width:`${Math.min(100,percent)}%`}}/></div>
      {percent>=80&&<p role="alert" className="font-bold text-amber-900">설정한 메시지 한도의 80%를 넘었습니다. 예비 연결 비율이 높은 판매자를 확인하세요.</p>}
      <p className="text-xs text-slate-500">앱이 집계한 연결·예비 전달의 추정치입니다. 판매 DB 변경, 다른 기능의 Realtime 사용량 및 실제 청구량은 포함하지 않습니다. 정확한 값은 Supabase Usage에서 확인합니다.</p></section>
    <section className="rounded-2xl border bg-white p-5"><h2 className="mb-4 font-black">지금 방송 중 · {liveRuns.length+voice.length}명 {busy&&<small className="font-normal text-slate-400">갱신 중…</small>}</h2><div className="overflow-auto"><table className="w-full text-left text-sm"><thead className="border-b text-slate-500"><tr>{['판매자','판매방식','판매 폰','연결','마지막 신호','틱톡 지연'].map(label=><th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>
      {liveRuns.map(r=><tr key={r.workspace_id} className="border-b"><td className="p-3 font-bold">{data?.names[r.workspace_id]||r.workspace_id}</td><td className="p-3">댓글터치</td><td className="p-3">{r.last_state.phoneCount||0}대</td><td className="p-3">{r.last_state.transport==='DIRECT'?'직접':r.last_state.transport==='FALLBACK'?'예비':'끊김'}</td><td className="p-3">{new Date(r.updated_at).toLocaleTimeString('ko-KR')}</td><td className="p-3">{Number(r.last_state.delaySeconds||0).toFixed(1)}초</td></tr>)}
      {voice.map(r=><tr key={r.workspace_id} className="border-b"><td className="p-3 font-bold">{data?.names[r.workspace_id]||r.workspace_id}</td><td className="p-3">음성인식</td><td className="p-3">—</td><td className="p-3">PC 청취 중</td><td className="p-3">{new Date(r.updated_at).toLocaleTimeString('ko-KR')}</td><td className="p-3">—</td></tr>)}
    </tbody></table>{!liveRuns.length&&!voice.length&&<p className="p-6 text-center text-slate-400">현재 수신된 방송 신호가 없습니다.</p>}</div></section>
    <section className="rounded-2xl border bg-white p-5"><h2 className="mb-4 font-black">판매자별 연결 통계 · {month}</h2><div className="overflow-auto"><table className="w-full whitespace-nowrap text-left text-sm"><thead className="border-b text-slate-500"><tr>{['판매자','직접 비율','예비 시간','연결 전환','장애','지연 평균 / 최대','추정 메시지'].map(label=><th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>
      {data?.totals.map(r=>{const seconds=Number(r.direct_seconds)+Number(r.fallback_seconds),ratio=seconds?Number(r.direct_seconds)/seconds*100:0;
        return <tr key={r.workspace_id} className={`border-b ${seconds&&ratio<10?'bg-amber-50':''}`}><td className="p-3 font-bold">{data.names[r.workspace_id]||r.workspace_id}</td><td className="p-3">{ratio.toFixed(1)}%</td><td className="p-3">{Math.round(Number(r.fallback_seconds)/60)}분</td><td className="p-3">{r.connection_changes}</td><td className="p-3">{r.errors}</td><td className="p-3">{r.delay_average!==null?Number(r.delay_average).toFixed(1):'—'} / {r.delay_maximum!==null?Number(r.delay_maximum).toFixed(1):'—'}초</td><td className="p-3">{(Number(r.fallback_messages)+Number(r.signal_messages)).toLocaleString()}</td></tr>;})}
    </tbody></table></div><p className="mt-3 text-xs text-slate-500">예비 연결이 대부분인 판매자는 PC와 폰을 같은 와이파이에 연결하도록 안내할 수 있습니다. 요약은 5분마다 반영됩니다.</p></section>
    <section className="rounded-2xl border bg-white p-5"><h2 className="mb-3 font-black">최근 연결·장애 기록</h2><div className="max-h-96 overflow-auto">{data?.events.filter(e=>e.kind!=='SUMMARY').map(e=><div key={e.id} className="flex flex-wrap justify-between gap-2 border-b py-3 text-sm"><span><strong>{data.names[e.workspace_id]||e.workspace_id}</strong> · {names[e.kind]||e.kind}</span><time className="text-xs text-slate-500">{new Date(e.created_at).toLocaleString('ko-KR')}</time></div>)}</div></section>
  </div>;
}
