import type { CaptureAreaConfig } from '../types/rules';
import { screenCaptureService } from './screenCaptureService';
export interface TouchFrame { at:number; image:string; }
export class TouchFrameBuffer {
  private frames:TouchFrame[]=[];
  private timer:ReturnType<typeof setTimeout>|null=null;
  private generation=0;
  start(area:()=>CaptureAreaConfig){
    this.stop();const generation=++this.generation;
    const sample=async()=>{
      const started=Date.now();
      if(screenCaptureService.getActiveStream()){
        try{const canvas=await screenCaptureService.captureAreaCanvas(screenCaptureService.getActiveStream(),area());
          if(canvas && generation===this.generation){
            const scale=Math.min(1,800/Math.max(canvas.width,canvas.height));
            const small=document.createElement('canvas');small.width=Math.max(1,Math.round(canvas.width*scale));small.height=Math.max(1,Math.round(canvas.height*scale));
            const context=small.getContext('2d');if(context){context.drawImage(canvas,0,0,small.width,small.height);
              this.push({at:Date.now(),image:small.toDataURL('image/jpeg',0.65)});}
          }
        }catch{/* The worker marks an unavailable frame as missing; never request new screen sharing from a timer. */}
      }
      if(generation===this.generation)this.timer=setTimeout(()=>void sample(),Math.max(30,500-(Date.now()-started)));
    };void sample();
  }
  push(frame:TouchFrame){
    this.frames.push(frame);this.frames=this.frames.filter(f=>f.at>=frame.at-30000).slice(-65);
    let bytes=this.frames.reduce((n,f)=>n+f.image.length*2,0);
    while(bytes>8*1024*1024&&this.frames.length>1)bytes-=this.frames.shift()!.image.length*2;
  }
  nearest(at:number,tolerance=900):TouchFrame|null{
    let closest:TouchFrame|null=null;
    for(const frame of this.frames)if(!closest||Math.abs(frame.at-at)<Math.abs(closest.at-at))closest=frame;
    return closest&&Math.abs(closest.at-at)<=tolerance?closest:null;
  }
  stop(){++this.generation;if(this.timer)clearTimeout(this.timer);this.timer=null;this.frames=[];}
}
