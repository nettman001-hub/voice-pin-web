const params = new URLSearchParams(window.location.search);
const paperSize = params.get('paperSize');
if (paperSize && document.body && document.body.classList) {
  document.body.classList.add(paperSize);
}
const line1El = document.querySelector('#line1');
const line2El = document.querySelector('#line2');
const line3El = document.querySelector('#line3');
const extEl = document.querySelector('#extendedInfo');

const line1Param = params.get('line1');
const line2Param = params.get('line2');
const line3Param = params.get('line3');

if (line1Param != null || line2Param != null || line3Param != null) {
  if (line1El) line1El.textContent = line1Param || '';
  if (line2El) line2El.textContent = line2Param || '';
  if (line3El) line3El.textContent = line3Param || '';
} else {
  const kind = params.get('kind');
  const buyerNickname = params.get('buyerNickname');
  const amount = params.get('amount');
  const sessionCode = params.get('sessionCode') || params.get('sessionId');
  const kindLabel = kind === 'CORRECTION' ? '[정정] ' : (kind === 'CANCEL' ? '[취소] ' : (kind === 'REPRINT' ? '[재인쇄] ' : ''));
  const nicknameText = `${kindLabel}${buyerNickname || ''}`.trim();
  const priceText = amount ? `${Number(amount).toLocaleString('ko-KR')}원` : '';
  const sessionText = sessionCode ? (sessionCode.includes('회차') ? sessionCode : `${sessionCode} 회차`) : '';

  if (line1El) line1El.textContent = nicknameText;
  if (line2El) line2El.textContent = priceText;
  if (line3El) line3El.textContent = sessionText;
}

const productCode = params.get('productCode');
const productName = params.get('productName');
const createdAt = params.get('createdAt');
if (extEl && (productCode || productName || createdAt)) {
  const prod = `${productCode || ''} ${productName || ''}`.trim();
  const sub = [prod, createdAt].filter(Boolean).join(' | ');
  if (sub) extEl.textContent = sub;
}



