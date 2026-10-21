import { requireSupabase } from './supabaseClient';
import type { TouchComment, TouchPcState, TouchTransport } from '../types/touchSales';
import { mergeTouchComments, touchCommentKey } from './touchCommentState';
type Packet={kind:string;[key:string]:any};
interface Envelope {v:1;from:string;to?:string;role:'PC'|'PHONE';payload:Packet;}
export interface BridgeOptions {
  workspaceId:string;role:'PC'|'PHONE';id?:string;
  onPacket:(packet:Packet)=>void;
  onStatus?:(status:TouchTransport,phoneCount:number)=>void;
  onMetric?:(metric:'directComments'|'fallbackComments'|'fallbackMessages'|'signalMessages',count:number)=>void;
}
/** Authenticated signaling/fallback only. Audio envelopes and image candidates never use Broadcast. */
export class TouchSalesBridge {
  readonly id:string;
  transport:TouchTransport='DISCONNECTED';
  clockOffsetMs=0;
  lastReceivedAt=0;
  private options:BridgeOptions;
  private channel:ReturnType<ReturnType<typeof requireSupabase>['channel']>|null=null;
  private peer:RTCPeerConnection|null=null;
  private data:RTCDataChannel|null=null;
  private peerId='';
  private negotiation='';
  private ice:RTCIceCandidateInit[]=[];
  private timer:ReturnType<typeof setInterval>|null=null;
  private pendingTimer:ReturnType<typeof setTimeout>|null=null;
  private generation=0;
  private subscribed=false;
  private lastSentAt=0;
  private lastHelloAt=0;
  private lastOfferAt=0;
  private bestRtt=Infinity;
  private pcState:TouchPcState|null=null;
  private comments:TouchComment[]=[];
  private sequence=0;
  private pending:TouchComment[]=[];
  private chunks=new Map<string,{parts:string[];total:number;at:number}>();
  constructor(options:BridgeOptions){this.options=options;this.id=options.id || crypto.randomUUID();}
  async start(){
    const generation=++this.generation,client=requireSupabase();
    const {data}=await client.auth.getSession();
    if(generation!==this.generation || !data.session) return;
    await client.realtime.setAuth(data.session.access_token);
    if(generation!==this.generation) return;
    this.channel=client.channel(`touch-sales:${this.options.workspaceId}`,{config:{private:true,broadcast:{ack:true,self:false}}})
      .on('broadcast',{event:'touch'},({payload})=>{void this.receiveEnvelope(payload).catch(()=>this.setStatus('FALLBACK'));})
      .subscribe(status=>{
        if(generation!==this.generation) return;
        this.subscribed=status==='SUBSCRIBED';
        if(this.subscribed && this.options.role==='PHONE') this.hello();
        if(!this.subscribed && this.transport!=='DIRECT') this.setStatus('DISCONNECTED');
      });
    this.timer=setInterval(()=>this.tick(),1000);
  }
  private setStatus(status:TouchTransport){
    if(this.transport===status)return;this.transport=status;
    this.options.onStatus?.(status,this.peerId && Date.now()-this.lastReceivedAt<15000?1:0);
  }
  private async broadcast(packet:Packet,to?:string){
    if(!this.channel || !this.subscribed)return false;
    const envelope:Envelope={v:1,from:this.id,to,role:this.options.role,payload:packet};
    this.options.onMetric?.(['offer','answer','ice','hello'].includes(packet.kind)?'signalMessages':'fallbackMessages',2);
    const result=await this.channel.send({type:'broadcast',event:'touch',payload:envelope});
    return result==='ok';
  }
  private hello(){this.lastHelloAt=Date.now();void this.broadcast({kind:'hello'});}
  private async receiveEnvelope(raw:Envelope){
    if(!raw || raw.v!==1 || typeof raw.from!=='string' || raw.from===this.id || raw.role===this.options.role
      || (raw.to && raw.to!==this.id) || !raw.payload || typeof raw.payload.kind!=='string')return;
    const packet=raw.payload;
    if(packet.kind==='hello' && this.options.role==='PC'){
      if(this.peerId && this.peerId!==raw.from && Date.now()-this.lastReceivedAt<15000){void this.broadcast({kind:'busy'},raw.from);return;}
      this.peerId=raw.from;this.lastReceivedAt=Date.now();
      if(!this.peer || this.peer.connectionState==='failed' || Date.now()-this.lastOfferAt>20000) await this.offer();
      if(this.transport!=='DIRECT'){this.setStatus('FALLBACK');this.sendSnapshot();}
      return;
    }
    if(packet.kind==='offer' && this.options.role==='PHONE'){
      this.peerId=raw.from;this.lastReceivedAt=Date.now();
      await this.acceptOffer(packet);return;
    }
    if(raw.from!==this.peerId)return;
    this.lastReceivedAt=Date.now();
    if(packet.kind==='answer' && packet.negotiation===this.negotiation && this.peer){
      await this.peer.setRemoteDescription(packet.description);await this.flushIce();return;
    }
    if(packet.kind==='ice' && packet.negotiation===this.negotiation && packet.candidate){
      if(this.peer?.remoteDescription)await this.peer.addIceCandidate(packet.candidate);else this.ice.push(packet.candidate);return;
    }
    if(!['audio','candidates','choose-frame','chunk'].includes(packet.kind)){
      if(this.transport!=='DIRECT')this.setStatus('FALLBACK');
      this.receivePacket(packet,false);
    }
  }
  private createPeer(negotiation:string){
    this.peer?.close();this.data?.close();this.ice=[];this.negotiation=negotiation;
    const peer=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});this.peer=peer;
    peer.onicecandidate=e=>{if(e.candidate)void this.broadcast({kind:'ice',candidate:e.candidate.toJSON(),negotiation},this.peerId);};
    peer.onconnectionstatechange=()=>{if(peer!==this.peer)return;
      if(['failed','disconnected','closed'].includes(peer.connectionState)){this.setStatus(this.subscribed?'FALLBACK':'DISCONNECTED');
        if(this.options.role==='PHONE')this.hello();else this.sendSnapshot();}};
    return peer;
  }
  private bindData(data:RTCDataChannel){
    this.data=data;
    data.onopen=()=>{this.setStatus('DIRECT');this.lastReceivedAt=Date.now();
      if(this.options.role==='PC')this.sendSnapshot();else this.send({kind:'resync'});};
    data.onclose=()=>{if(this.data===data){this.setStatus(this.subscribed?'FALLBACK':'DISCONNECTED');if(this.options.role==='PHONE')this.hello();}};
    data.onmessage=event=>{
      if(typeof event.data!=='string' || event.data.length>200000)return;
      try{const packet=JSON.parse(event.data);this.lastReceivedAt=Date.now();this.receivePacket(packet,true);}catch{/* malformed peer message */}
    };
  }
  private async offer(){
    this.lastOfferAt=Date.now();
    const peer=this.createPeer(crypto.randomUUID());this.bindData(peer.createDataChannel('voicecap-sales',{ordered:true}));
    await peer.setLocalDescription(await peer.createOffer());
    if(peer===this.peer)void this.broadcast({kind:'offer',description:peer.localDescription,negotiation:this.negotiation},this.peerId);
  }
  private async acceptOffer(packet:Packet){
    const peer=this.createPeer(packet.negotiation);peer.ondatachannel=e=>this.bindData(e.channel);
    await peer.setRemoteDescription(packet.description);await this.flushIce();
    await peer.setLocalDescription(await peer.createAnswer());
    if(peer===this.peer)void this.broadcast({kind:'answer',description:peer.localDescription,negotiation:this.negotiation},this.peerId);
    if(this.transport!=='DIRECT')this.setStatus('FALLBACK');
  }
  private async flushIce(){for(const candidate of this.ice.splice(0))await this.peer?.addIceCandidate(candidate);}
  private receivePacket(packet:Packet,direct:boolean){
    if(!packet || typeof packet.kind!=='string')return;
    if(packet.kind==='chunk'){
      if(!direct || typeof packet.body!=='string' || packet.body.length>20000 || !Number.isInteger(packet.total)
        || packet.total<1 || packet.total>150 || !Number.isInteger(packet.index) || packet.index<0 || packet.index>=packet.total)return;
      for(const [key,chunk]of this.chunks)if(Date.now()-chunk.at>15000)this.chunks.delete(key);
      if(this.chunks.size>8)return;
      const value=this.chunks.get(packet.id)||{parts:[],total:packet.total,at:Date.now()};
      if(value.total!==packet.total)return;value.parts[packet.index]=packet.body;this.chunks.set(packet.id,value);
      if(value.parts.filter(v=>typeof v==='string').length===value.total){this.chunks.delete(packet.id);this.receivePacket(JSON.parse(value.parts.join('')),true);}return;
    }
    if(packet.kind==='ping'){this.send({kind:'pong',sentAt:packet.sentAt,peerAt:Date.now()});return;}
    if(packet.kind==='pong'){
      const rtt=Date.now()-Number(packet.sentAt);if(rtt>=0&&rtt<this.bestRtt){this.bestRtt=rtt;this.clockOffsetMs=Number(packet.peerAt)-(Date.now()+Number(packet.sentAt))/2;}return;
    }
    if(packet.kind==='resync'&&this.options.role==='PC'){this.sendSnapshot();return;}
    this.options.onPacket(packet);
  }
  send(packet:Packet){
    const direct=this.data?.readyState==='open' && this.transport==='DIRECT' && this.data.bufferedAmount<512000;
    if(direct){
      const text=JSON.stringify(packet);
      try{
        if(text.length<=16000)this.data!.send(text);
        else {const id=crypto.randomUUID(),total=Math.ceil(text.length/16000);if(total>150)return false;
          for(let index=0;index<total;index++)this.data!.send(JSON.stringify({kind:'chunk',id,index,total,body:text.slice(index*16000,(index+1)*16000)}));}
        this.lastSentAt=Date.now();return true;
      }catch{this.setStatus(this.subscribed?'FALLBACK':'DISCONNECTED');}
    }
    if(['audio','candidates','choose-frame'].includes(packet.kind))return false;
    if(!this.peerId)return false;
    this.lastSentAt=Date.now();void this.broadcast(packet,this.peerId);return true;
  }
  setPcState(state:TouchPcState){this.pcState=state;}
  publish(comments:TouchComment[]){
    const fresh:TouchComment[]=[];
    for(const comment of comments){
      const old=this.comments.find(c=>touchCommentKey(c)===touchCommentKey(comment));
      const item={...comment,sequence:old?.sequence || ++this.sequence};
      if(!old || JSON.stringify(old.stats)!==JSON.stringify(item.stats)){fresh.push(item);}
      this.comments=mergeTouchComments(this.comments,[item],item.sessionId);
    }
    this.pending.push(...fresh);
    if(!this.pendingTimer)this.pendingTimer=setTimeout(()=>{this.pendingTimer=null;this.flushComments();},100);
  }
  private flushComments(){
    const items=this.pending.splice(0);
    if(!this.peerId)return;
    for(let i=0;i<items.length;i+=20){const batch=items.slice(i,i+20);
      this.send({kind:'comments',items:batch,sessionId:this.pcState?.sessionId,state:this.pcState});
      this.options.onMetric?.(this.transport==='DIRECT'?'directComments':'fallbackComments',batch.length);}
  }
  private sendSnapshot(){
    if(!this.peerId)return;this.send({kind:'state',state:this.pcState});
    for(let i=0;i<this.comments.length;i+=20)this.send({kind:'comments',items:this.comments.slice(i,i+20),sessionId:this.pcState?.sessionId});
  }
  private tick(){
    const now=Date.now();
    if(this.peerId && now-this.lastReceivedAt>(this.transport==='DIRECT'?5000:12000)){
      if(this.transport==='DIRECT'){this.setStatus(this.subscribed?'FALLBACK':'DISCONNECTED');if(this.options.role==='PHONE')this.hello();else this.sendSnapshot();}
      else this.setStatus('DISCONNECTED');
    }
    if(this.options.role==='PHONE'){
      if(this.transport==='DIRECT'&&now-this.lastSentAt>2000)this.send({kind:'ping',sentAt:now});
      else if(this.transport!=='DIRECT'&&now-this.lastHelloAt>5000)this.hello();
    }else{
      if(this.peerId && now-this.lastSentAt>(this.transport==='DIRECT'?2000:5000))this.send({kind:'state',state:this.pcState});
      if(this.peerId && this.transport!=='DIRECT' && now-this.lastOfferAt>20000)void this.offer().catch(()=>{});
    }
  }
  stop(){
    ++this.generation;this.subscribed=false;
    if(this.timer)clearInterval(this.timer);if(this.pendingTimer)clearTimeout(this.pendingTimer);
    this.peer?.close();this.data?.close();this.peer=null;this.data=null;
    if(this.channel)void requireSupabase().removeChannel(this.channel);this.channel=null;this.peerId='';
    this.setStatus('DISCONNECTED');this.chunks.clear();
  }
}
