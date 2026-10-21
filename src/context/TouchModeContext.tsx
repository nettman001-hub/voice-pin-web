import React,{createContext,useContext,useEffect,useRef,useState} from 'react';
import {useRuntimeAuth,useWorkspaceRuntime} from './WorkspaceRuntimeContext';
import type {TouchSettings} from '../types/touchSales';
const defaults:TouchSettings={mode:'VOICE',prepareSeconds:4,fallbackDelaySeconds:6};
interface Value {settings:TouchSettings;save:(settings:TouchSettings)=>Promise<void>;runningSession:string|null;setRunningSession:(id:string|null)=>void;}
const Context=createContext<Value>({settings:defaults,save:async()=>{},runningSession:null,setRunningSession:()=>{}});
export const useTouchMode=()=>useContext(Context);
export const TouchModeProvider:React.FC<{children:React.ReactNode}>=({children})=>{
  const {workspaceId,isRemoteAuth}=useRuntimeAuth();const {remoteWorkspaceService}=useWorkspaceRuntime();
  const [state,setState]=useState<{owner:string;settings:TouchSettings}>({owner:'',settings:defaults});
  const [run,setRun]=useState<{owner:string;id:string|null}>({owner:'',id:null});
  const generation=useRef(0),owner=useRef(workspaceId);owner.current=workspaceId;
  useEffect(()=>{
    const current=++generation.current;setRun({owner:workspaceId||'',id:null});
    let local:TouchSettings=defaults;try{local={...defaults,...JSON.parse(localStorage.getItem(`voicecap-touch-settings:${workspaceId}`)||'{}')};}catch{}
    setState({owner:workspaceId||'',settings:local});
    if(workspaceId&&isRemoteAuth)void remoteWorkspaceService.fetchWorkspaceSettings<TouchSettings>(workspaceId,'touch_sales').then(value=>{
      if(value&&generation.current===current)setState({owner:workspaceId,settings:{...defaults,...value}});
    });
    return()=>{generation.current++;};
  },[workspaceId,isRemoteAuth]);
  const save=async(settings:TouchSettings)=>{
    if(!workspaceId)return;const current=++generation.current;
    if(run.owner===workspaceId&&run.id)throw new Error('판매를 멈춘 뒤 방식을 변경해 주세요.');
    if(isRemoteAuth)await remoteWorkspaceService.saveWorkspaceSettings(workspaceId,'touch_sales',settings,{throwOnError:true});
    if(generation.current!==current||owner.current!==workspaceId)return;
    localStorage.setItem(`voicecap-touch-settings:${workspaceId}`,JSON.stringify(settings));setState({owner:workspaceId,settings});
  };
  return <Context.Provider value={{settings:state.owner===workspaceId?state.settings:defaults,save,
    runningSession:run.owner===workspaceId?run.id:null,setRunningSession:id=>setRun({owner:workspaceId||'',id})}}>{children}</Context.Provider>;
};
