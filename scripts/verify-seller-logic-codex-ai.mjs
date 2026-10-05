/** Opt-in paid AI check against existing applied slots, using bounded fictional examples.
 * node scripts/verify-seller-logic-codex-ai.mjs 2 --key-file scratch/seller-logic-api-keys.local
 * Reads settings/secrets without mutation; replaces only the local administrator boundary.
 * Reports never contain provider credentials. This does not exercise deployed authentication.
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { executeAiPrompt } from '../supabase/functions/sales-api/handlers/aiAdapters/index.ts';
process.loadEnvFile('.env.local');
const keyFlag = process.argv.indexOf('--key-file');
if (keyFlag < 0 || !process.argv[keyFlag + 1]) throw new Error('Provide --key-file pointing to an ignored Supabase management API-key JSON file.');
const key = JSON.parse(fs.readFileSync(process.argv[keyFlag + 1], 'utf8').replace(/^\uFEFF/, '')).find(row => row.name === 'service_role')?.api_key;
if (!key) throw new Error('Verification credential unavailable');
globalThis.codexAdmin = createClient(process.env.VITE_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
globalThis.codexExecute = async (prompt, options) => {
  const response = await executeAiPrompt(prompt, options);
  return response;
};
const bundle = await build({ stdin: { contents: `export {handleSellerLogicAnalysis,handleSellerLogicSlots} from './supabase/functions/sales-api/handlers/sellerLogicAnalysis.ts'; export {handleSellerLogicDetection} from './supabase/functions/sales-api/handlers/sellerLogicDetection.ts';`, resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'read-only-validation', setup(b) {
  b.onResolve({ filter: /_shared\/productSales\.ts$/ }, () => ({ path: 'db', namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const admin=globalThis.codexAdmin; export const successResponse=data=>Response.json({ok:true,data}); export const errorResponse=(code,message,status=400)=>Response.json({ok:false,error:{code,message}},{status});' }));
  b.onLoad({ filter: /handlers[\\/]sellerLogic(Analysis|Detection)\.ts$/ }, ({path}) => ({contents:fs.readFileSync(path,'utf8').replaceAll('executeAiPrompt(prompt, {','globalThis.codexExecute(prompt, {'),loader:'ts'}));
} }] });
const handlers = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const auth = { actorType: 'USER', role: 'ADMIN' }, slotNumber = Number(process.argv[2] || 2);
const report = { startedAt: new Date().toISOString(), slotNumber, realProviderCalls: true, simulatedAdminBoundary: true,
  scope: 'Representative bounded windows of free purchase and numbered purchase; not a full broadcast replay or physical printing test',
  sources: Object.fromEntries(['src/services/sellerLogicDetection.ts','src/services/sellerLogicContract.ts'].map(path => [path, createHash('sha256').update(fs.readFileSync(path)).digest('hex')])), cases: [] };
const file = `artifacts/seller-logic-codex-ai-slot-${slotNumber}.json`, save = () => fs.writeFileSync(file, JSON.stringify(report,null,2));
const at = seconds => new Date(Date.UTC(2026,9,5,6,26,30)+seconds*1000).toISOString();
function evidence(name, comments, speech) {
  const sessionId = `codex-validation-${name}-${slotNumber}`;
  return { sessionId, slotNumber,
    comments: comments.map(([seconds,nickname,content],i)=>({id:`c${i}`,sessionId,nickname,content,capturedAt:at(seconds)})),
    transcripts: speech.map(([seconds,text],i)=>({id:`s${i}`,text,recognizedAt:at(seconds),isFinal:true,
      utteranceId:name==='number'&&(i===2||i===3)?'split-allocation':`u${i}`,utteranceEnded:!(name==='number'&&i===2),revision:1})) };
}
const cases = [
  { name:'free-purchase-exact-platform-name', input:evidence('free', [[6,'😚JJEONG😚','저용'],[7,'문의자','이 니트 66도 맞아요?']],
    [[0,'이 후드 아이보리 니트 집업 2만 원입니다.'],[8,'쩡 언니 후드 아이보리 니트 집업 2만원 드릴게요.']]),
    intents:['c0'], confirmed:[['😚JJEONG😚',20000,'아이보리']] },
  { name:'numbered-simultaneous-buyers-split-speech', input:evidence('number', [[3,'은하수용인','2'],[4,'곰곰🐼','2'],[5,'생강♡까꿍사랑♡','2']],
    [[0,'블랙 니트 7천원, 2번, 두 분만 가능합니다.'],[7,'은하수 용인 언니 2번 블랙 니트 드릴게요.'],[9,'2번 공곰 언니도'],[10,'블랙 니트 7천원 드릴게요. 생강 언니는 수량이 없어요.']]),
    intents:['c0','c1','c2'], confirmed:[['은하수용인',7000,'블랙'],['곰곰🐼',7000,'블랙']] },
  { name:'price-correction-and-reused-number', input:evidence('correction', [[2,'루비','1번 저요'],[25,'루비','1번 블랙 저요']],
    [[0,'1번 아이보리 골지 니트 1만8천원입니다.'],[4,'루비 언니 1번 아이보리 골지 니트 드릴게요.'],[8,'방금 루비 언니 니트 가격 제가 잘못 말했어요. 1만5천원으로 정정할게요.'],[23,'다음 상품 블랙 가디건 2만원이고 이번 주문번호도 1번입니다.'],[28,'루비 언니 1번 블랙 가디건 2만원 드릴게요.']]),
    intents:['c0','c1'], confirmed:[['루비',15000,'아이보리'],['루비',20000,'블랙']] },
  { name:'description-and-question-no-purchase', input:evidence('question', [[1,'문의자','그레이 니트 얼마인가요?']],
    [[0,'그레이 니트 원단 부드럽고 신축성이 좋아요. 7천원이고 44에서55까지 맞아요.']]), intents:[],confirmed:[] },
];
try {
  for (const item of cases) {
    const started = Date.now();
    const response = await handlers.handleSellerLogicDetection(auth,{input:{...item.input,freshCommentIds:item.input.comments.map(r=>r.id),freshTranscriptIds:item.input.transcripts.map(r=>r.id),existingSignals:[],carry:[]}});
    const detected = await response.json();
    const row = {name:item.name,detectStatus:response.status,provider:detected.data?.provider,model:detected.data?.model,appliedVersion:detected.data?.appliedVersion,
      purchaseIntentCommentIds:detected.data?.purchaseIntentCommentIds,signals:detected.data?.signals,error:detected.error};
    row.pass = detected.ok === true && JSON.stringify([...(detected.data.purchaseIntentCommentIds||[])].sort())===JSON.stringify([...item.intents].sort());
    if (detected.ok && detected.data.signals.length) {
      const linkedResponse = await handlers.handleSellerLogicAnalysis(auth,{input:{...item.input,linkSignals:detected.data.signals,previousDecisions:[]}});
      const linked = await linkedResponse.json(); row.linkStatus=linkedResponse.status;row.decisions=linked.data?.decisions;row.linkError=linked.error;
      const confirmed=(linked.data?.decisions||[]).filter(d=>d.status==='CONFIRMED');
      row.pass &&= linked.ok === true && confirmed.length===item.confirmed.length && item.confirmed.every(([name,price,option])=>confirmed.some(d=>d.nickname===name&&d.unitPrice===price&&`${d.productName||''} ${d.option||''}`.includes(option)));
    } else row.pass &&= item.confirmed.length===0 && detected.data.signals.length===0;
    row.elapsedMs=Date.now()-started;report.cases.push(row);save();
    console.log(JSON.stringify({slotNumber,name:row.name,pass:row.pass,elapsedMs:row.elapsedMs,detectStatus:row.detectStatus,linkStatus:row.linkStatus,error:row.error||row.linkError}));
  }
  report.pass=report.cases.every(r=>r.pass);process.exitCode=report.pass?0:1;
} catch(error) { report.error=String(error);process.exitCode=1; }
finally { report.completedAt=new Date().toISOString();save();console.log(JSON.stringify({slotNumber,pass:report.pass,error:report.error})); }
