import { LABEL_HEIGHT_PX, LABEL_WIDTH_PX } from './marklifeProtocol.ts';

export type LabelContent = {
  buyer: string;
  amount: number;
  productLabel?: string;
};

const FONT =
  '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  start: number,
  min: number,
) {
  let size = start;
  for (; size > min; size -= 2) {
    ctx.font = `900 ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= maxWidth) break;
  }
  return size;
}

/** 50x30 mm label (384x240 px): number badge, buyer, amount. No 회차 line (plan decision). */
export function drawSaleLabel(
  canvas: HTMLCanvasElement,
  content: LabelContent,
  options: { width?: number; height?: number; margin?: number } = {},
) {
  const width = options.width ?? LABEL_WIDTH_PX;
  const height = options.height ?? LABEL_HEIGHT_PX;
  const m = options.margin ?? 16;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'middle';
  let top = m;
  if (content.productLabel) {
    ctx.font = `900 40px ${FONT}`;
    const w = ctx.measureText(content.productLabel).width + 24;
    ctx.fillRect(m, top, w, 52);
    ctx.fillStyle = '#fff';
    ctx.fillText(content.productLabel, m + 12, top + 27);
    ctx.fillStyle = '#000';
    top += 64;
  }
  const buyer = content.buyer.trim() || '구매자';
  const amount = `${Math.max(0, Math.round(content.amount)).toLocaleString('ko-KR')}원`;
  const rest = height - top - m;
  const buyerSize = fitFont(
    ctx,
    buyer,
    width - m * 2,
    Math.min(72, rest * 0.55),
    22,
  );
  ctx.font = `900 ${buyerSize}px ${FONT}`;
  ctx.fillText(buyer, m, top + rest * 0.3);
  const amountSize = fitFont(
    ctx,
    amount,
    width - m * 2,
    Math.min(64, rest * 0.45),
    22,
  );
  ctx.font = `900 ${amountSize}px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(amount, width - m, top + rest * 0.78);
  ctx.textAlign = 'left';
  return ctx.getImageData(0, 0, width, height);
}
