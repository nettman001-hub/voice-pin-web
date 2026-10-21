import React,{useEffect,useRef} from 'react';
import {useLive} from '../../context/LiveContext';
import {useProductSales} from '../../context/ProductSalesContext';
import {useRuntimeAuth} from '../../context/WorkspaceRuntimeContext';
import {TouchSalesApi} from '../../services/touchSalesApi';
/** Reporting is best-effort and never gates or changes voice recognition/sale processing. */
export const VoicePhoneStatusReporter:React.FC=()=>{
  const {isListening}=useLive(),{activeSession}=useProductSales(),{workspaceId,isRemoteAuth}=useRuntimeAuth();
  const producer=useRef(crypto.randomUUID());
  useEffect(()=>{
    if(!isListening||!workspaceId||!isRemoteAuth||!activeSession)return;
    const api=new TouchSalesApi(workspaceId),payload={producerId:producer.current,sessionId:activeSession.id};
    const report=()=>void api.call('touch-voice-presence',{...payload,running:true}).catch(()=>{});
    report();const timer=setInterval(report,10000);
    return()=>{clearInterval(timer);void api.call('touch-voice-presence',{...payload,running:false}).catch(()=>{});};
  },[isListening,workspaceId,isRemoteAuth,activeSession?.id]);
  return null;
};
