import { invokeSalesApi } from './productSalesApi';
import type { TouchCommit, TouchCommitResult, TouchPcState, TouchRun, TouchSale, TouchSettings } from '../types/touchSales';
export interface TouchBootstrap {
  run: TouchRun | null;
  session: {id:string; display_code:string; status:string} | null;
  sales: TouchSale[];
  product: TouchPcState['product'];
  serverNow: number;
}
export class TouchSalesApi {
  constructor(readonly workspaceId: string) {}
  call<T>(action: string, payload: Record<string, unknown> = {}) {
    return invokeSalesApi<T>(action,{...payload,workspaceId:this.workspaceId});
  }
  bootstrap() {return this.call<TouchBootstrap>('touch-bootstrap');}
  commit(sale: TouchCommit) {return this.call<TouchCommitResult>('commit-touch-sale',{sale});}
  run(kind:'START'|'HEARTBEAT'|'STOP',producerId:string,sessionId:string,settings:TouchSettings,state:Partial<TouchPcState>) {
    return this.call('touch-run',{kind,producerId,sessionId,settings,state});
  }
  claimPrints(producerId:string) {return this.call<{jobs:any[];leaseToken:string}>('claim-touch-jobs',{producerId});}
  print(kind:'BEGIN'|'ACK',jobId:string,leaseToken:string,result?:'SUCCESS'|'FAILED'|'UNKNOWN') {
    return this.call('touch-print',{kind,jobId,leaseToken,result});
  }
  claimCaptures(producerId:string) {return this.call<{captures:any[]}>('claim-touch-captures',{producerId});}
  saveCapture(producerId:string,saleId:string,image?:string,capturedAt?:string) {
    return this.call('touch-capture-save',{producerId,saleId,image,capturedAt});
  }
  resetCapture(saleId:string) {return this.call('touch-capture-reset',{saleId});}
  update(patch: {saleId:string;expectedRevision:number;kind:'PRICE'|'BUYER'|'CANCEL'|'REPRINT';inputPrice?:string;unitPrice?:number;buyerId?:string;reprint?:boolean}) {
    return this.call('update-touch-sale',{patch:{operationId:crypto.randomUUID(),...patch}});
  }
  event(kind:string,sessionId:string,producerId:string,metrics:Record<string,number>={},eventId:string=crypto.randomUUID()) {
    return this.call('touch-events',{kind,sessionId,producerId,metrics,eventId});
  }
}
