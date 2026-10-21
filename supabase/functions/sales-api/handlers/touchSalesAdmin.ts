import {admin,successResponse,errorResponse,type AuthContext} from '../../_shared/productSales.ts';
import {touchMonthRange} from './touchSalesAdminCore.ts';
export async function handleTouchSalesAdmin(auth:AuthContext,body:any){
  // Owners have the existing ADMIN capability for their own settings; it is not global admin access.
  if(auth.actorType!=='USER'||auth.role!=='ADMIN')return errorResponse('CAPABILITY_DENIED','관리자만 판매 폰 연결 현황을 볼 수 있습니다.',403);
  const month=typeof body.month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month)?body.month:new Date(Date.now()+9*3600000).toISOString().slice(0,7);
  try{
    const range=touchMonthRange(month);
    const [totals,runs,voice,events]=await Promise.all([
      admin.rpc('voicecap_touch_monthly_stats',{p_from:range.from,p_until:range.until}),
      admin.from('touch_sales_runs').select('workspace_id,session_id,producer_id,running,lease_expires_at,updated_at,last_state'),
      admin.from('touch_voice_presence').select('*').eq('running',true),
      admin.from('touch_sales_events').select('id,workspace_id,session_id,kind,metrics,created_at').order('created_at',{ascending:false}).limit(200),
    ]);
    for(const result of [totals,runs,voice,events])if(result.error)throw result.error;
    const ids=[...new Set([...runs.data||[],...voice.data||[],...totals.data||[],...events.data||[]].map((r:any)=>r.workspace_id))];
    const names:Record<string,string>={};
    for(let i=0;i<ids.length;i+=200){const {data,error}=await admin.from('workspaces').select('id,name').in('id',ids.slice(i,i+200));if(error)throw error;for(const w of data||[])names[w.id]=w.name;}
    return successResponse({month,totals:totals.data||[],runs:runs.data||[],voice:voice.data||[],events:events.data||[],names,serverNow:Date.now()});
  }catch{return errorResponse('DATABASE_ERROR','연결 현황을 읽지 못했습니다. DB 마이그레이션 적용 여부를 확인해 주세요.',500);}
}
