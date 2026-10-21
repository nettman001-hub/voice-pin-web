import React from 'react';
import {createRoot} from 'react-dom/client';
import TouchMobileSalesPage from '../../src/pages/seller/TouchMobileSalesPage';
import {TouchSalesBridge} from '../../src/services/touchSalesBridge';
import {mockState} from './touchBrowserMock';
const pc=new TouchSalesBridge({workspaceId:mockState.workspace,role:'PC',onPacket:()=>{}});mockState.bridge=pc;
pc.setPcState({running:true,producerId:pc.id,sessionId:mockState.session,displayCode:'2026-10-21 라이브 1회차',
  helperConnected:true,commentStatus:'COLLECTING',screenConnected:true,printerConnected:true,delaySeconds:5,delaySource:'SETTING',
  prepareSeconds:4,product:null,totalCount:0,totalAmount:0});
const add=(id:string,nickname:string,content:string)=>pc.publish([{id,platformMessageId:id,platformUserId:'account-'+id,uniqueId:id,
  sessionId:mockState.session,nickname,content,capturedAt:new Date().toISOString(),sequence:0}]);
await pc.start();
add('a','초코맘','저요');add('talk','해피데이','사이즈 55도 있어요?');add('b','라임','ㅈㅇ');add('c','구름빵','제가 살게요');
(window as any).touchTest={state:mockState,pc,add,forceFallback:()=>{pc['peer']?.close();pc['data']?.close();},
  useBlockedRtc:()=>{(window as any).RTCPeerConnection=class{constructor(){throw new Error('fixture blocks WebRTC');}};},};
createRoot(document.getElementById('root')!).render(<TouchMobileSalesPage/>);
