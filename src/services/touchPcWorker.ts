import {TouchSalesApi} from './touchSalesApi';
import {TouchFrameBuffer,type TouchFrame} from './touchFrameBuffer';
import {touchLocalStore} from './touchLocalStore';
import type {SalePrintRequest,SalePrintResult} from './commentStreamService';
export interface PcWorkerOptions {
  api:TouchSalesApi;producerId:string;frames:TouchFrameBuffer;
  serverOffset:()=>number;delaySeconds:()=>number;prepareSeconds:()=>number;canPrint:()=>boolean;
  print:(payload:SalePrintRequest)=>Promise<SalePrintResult>;
  onChange:()=>void;onError:(kind:string,error:unknown)=>void;
}
/** Server leases receipts; capture has its own durable claim and is independent of printer speed. */
export class TouchPcWorker {
  private timer:ReturnType<typeof setTimeout>|null=null;private stopped=true;private busy=false;
  private captureTimer:ReturnType<typeof setInterval>|null=null;
  private captures=new Map<string,{detail:any;target:number;primary?:TouchFrame|null;saved?:boolean;uploading?:boolean}>();
  private candidates=new Map<string,TouchFrame[]>();
  constructor(private options:PcWorkerOptions){}
  start(){this.stopped=false;this.captureTimer=setInterval(()=>void this.processCaptures(),250);void this.tick();}
  private async tick(){
    if(this.stopped||this.busy)return;this.busy=true;
    try{
      const captures=await this.options.api.claimCaptures(this.options.producerId);
      for(const detail of captures.captures){
        const existing=this.captures.get(detail.sale_id);
        // The phone-confirmed time is authoritative. Re-evaluate a pending target after a reliable delay change.
        const due=Date.parse(detail.capture_due_at);
        const effective=detail.recapture?due-this.options.serverOffset()
          :Date.parse(detail.confirmed_at)+this.options.prepareSeconds()*1000+this.options.delaySeconds()*1000-this.options.serverOffset();
        if(!existing)this.captures.set(detail.sale_id,{detail,target:effective});
        else if(!existing.primary)existing.target=effective;
      }
      void this.processCaptures();
      if(this.options.canPrint()){
        const result=await this.options.api.claimPrints(this.options.producerId);
        for(const job of result.jobs){if(this.stopped)break;
          try{
            await this.options.api.print('BEGIN',job.id,result.leaseToken);
            const payload=job.immutable_payload;
            const printed=await this.options.print({saleId:job.sale_id,printRevision:job.sale_revision,
              buyerNickname:payload.buyerNickname,amount:payload.amount,sessionId:payload.sessionId,recognizedAt:payload.recognizedAt});
            // A missing helper acknowledgement cannot prove that paper was not printed.
            const unknown=!printed.ok && /시간|응답|timeout/i.test(printed.error || '');
            await this.options.api.print('ACK',job.id,result.leaseToken,printed.ok?'SUCCESS':unknown?'UNKNOWN':'FAILED');
            this.options.onChange();
            if(!printed.ok)this.options.onError('PRINT_ERROR',printed.error);
          }catch(error){this.options.onError('PRINT_ERROR',error);}
        }
      }
    }catch(error){this.options.onError('WORKER_ERROR',error);}
    finally{this.busy=false;if(!this.stopped)this.timer=setTimeout(()=>void this.tick(),1000);}
  }
  private async processCaptures(){
    for(const [saleId,job]of this.captures){
      if(this.stopped)return;
      const now=Date.now();if(now<job.target+450)continue;
      if(!job.primary)job.primary=this.options.frames.nearest(job.target);
      if(now>=job.target+2500 && job.primary && !this.candidates.has(saleId)){
        const nearby=[this.options.frames.nearest(job.target-2000),job.primary,this.options.frames.nearest(job.target+2000)]
          .filter((f):f is TouchFrame=>!!f);
        this.candidates.set(saleId,nearby);
        void touchLocalStore.saveFrames(this.options.api.workspaceId,saleId,nearby).catch(error=>this.options.onError('LOCAL_FRAME_ERROR',error));
      }
      if(job.uploading)continue;
      job.uploading=true;
      try{
        if(!job.saved){
          if(!job.primary&&now<job.target+1500)continue;
          if(!job.primary){
            await this.options.api.saveCapture(this.options.producerId,saleId);this.captures.delete(saleId);
            this.options.onError('CAPTURE_MISSING',new Error('해당 시각의 방송 화면이 없습니다.'));continue;
          }
          await this.options.api.saveCapture(this.options.producerId,saleId,job.primary.image,new Date(job.primary.at+this.options.serverOffset()).toISOString());
          job.saved=true;this.options.onChange();
        }
        if(now>=job.target+2500){
          this.captures.delete(saleId);
        }
      }catch(error){this.options.onError('CAPTURE_ERROR',error);}
      finally{job.uploading=false;}
    }
  }
  async getCandidates(saleId:string){return this.candidates.get(saleId)||touchLocalStore.getFrames(this.options.api.workspaceId,saleId);}
  async chooseFrame(saleId:string,index:number){
    const frames=await this.getCandidates(saleId),frame=frames[index];if(!frame)throw new Error('예비 장면을 찾을 수 없습니다.');
    // Refresh the capture lease for an explicit replacement without generating a receipt.
    await this.options.api.resetCapture(saleId);await this.options.api.claimCaptures(this.options.producerId);
    await this.options.api.saveCapture(this.options.producerId,saleId,frame.image,new Date(frame.at+this.options.serverOffset()).toISOString());
    this.options.onChange();
  }
  wake(){if(!this.stopped&&!this.busy){if(this.timer)clearTimeout(this.timer);void this.tick();}}
  stop(){this.stopped=true;if(this.timer)clearTimeout(this.timer);if(this.captureTimer)clearInterval(this.captureTimer);
    this.timer=null;this.captureTimer=null;this.captures.clear();this.candidates.clear();}
}
