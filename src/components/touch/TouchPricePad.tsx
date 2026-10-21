import React,{useState} from 'react';
import {parseTouchPrice} from '../../../supabase/functions/sales-api/handlers/touchSalesCore';
import type {TouchComment} from '../../types/touchSales';
import {customerStatsLabel} from '../../services/customerStatsIndex';
interface Props {comment:TouchComment;productName?:string;recent:string[];busy:boolean;error?:string;title?:string;
  onCancel:()=>void;onSubmit:(input:string,unitPrice:number,quantity:number)=>void;}
export const TouchPricePad:React.FC<Props>=({comment,productName,recent,busy,error,title='가격 입력',onCancel,onSubmit})=>{
  const [input,setInput]=useState(''),[quantity,setQuantity]=useState(1);const price=parseTouchPrice(input);
  const total=price.amount!==null?price.amount*quantity:0,valid=total>0&&total<=99999999;
  const key=(value:string)=>{if(busy)return;if(value==='⌫')setInput(s=>s.slice(0,-1));
    else setInput(s=>value==='.'?(s.includes('.')?s:(s||'0')+'.'):(s+value).slice(0,12));};
  return <section className="touch-price-screen" aria-label={title}>
    <header className="touch-price-header"><button type="button" aria-label="댓글로 돌아가기" disabled={busy} onClick={onCancel}>‹</button><h1>{title}</h1></header>
    <div className="touch-price-buyer"><h2>{comment.nickname}님 <small>구매자</small></h2><p>댓글 “{comment.content}”</p>
      {comment.stats&&<p className="touch-muted">{customerStatsLabel({...comment.stats,validSales:[]})}</p>}</div>
    <div className="touch-price-product"><span>상품</span> <strong>{productName||'상품명 없이 등록'}</strong><small>PC 현재 상품</small></div>
    <div className="touch-amount-box"><div className="touch-price-input" aria-live="polite"><span>{input||'0'}</span><small>{Number(input)<100?'만원':'원'}</small><button type="button" aria-label="가격 모두 지우기" disabled={busy} onClick={()=>setInput('')}>×</button></div>
      <p className="touch-amount-result">= {total.toLocaleString()}원</p><p className="touch-muted">100 미만은 만원 단위 · 1.5 = 15,000원</p>
      {input&&price.error&&<p role="alert" className="touch-error">{price.error}</p>}{total>99999999&&<p role="alert" className="touch-error">총금액 범위를 확인해 주세요.</p>}</div>
    <div className="touch-keypad-area"><div className="touch-price-tools"><div className="touch-recent-prices"><small>최근</small>{recent.slice(0,3).map(p=><button type="button" key={p} disabled={busy} onClick={()=>setInput(p)}>{p}</button>)}</div>
      <div className="touch-quantity"><button type="button" aria-label="수량 줄이기" disabled={busy||quantity<=1} onClick={()=>setQuantity(q=>q-1)}>−</button><strong>{quantity}개</strong><button type="button" aria-label="수량 늘리기" disabled={busy||quantity>=999} onClick={()=>setQuantity(q=>q+1)}>＋</button></div></div>
      <div className="touch-keypad">{['1','2','3','4','5','6','7','8','9','.','0','⌫'].map(value=><button type="button" key={value} disabled={busy} onClick={()=>key(value)}>{value}</button>)}</div>
      {error&&<p role="alert" className="touch-error">{error}</p>}
      <button type="button" className="touch-primary touch-confirm-price" disabled={!valid||busy||!!price.error}
        onClick={()=>{if(valid&&price.amount)onSubmit(input,price.amount,quantity);}}>{busy?'저장 확인 중…':`확정 · ${total.toLocaleString()}원`}</button>
    </div>
  </section>;
};
