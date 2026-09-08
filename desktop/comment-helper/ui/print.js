const params = new URLSearchParams(window.location.search);
const paperSize = params.get('paperSize');
if (paperSize && document.body && document.body.classList) {
  document.body.classList.add(paperSize);
}
const line1El = document.querySelector('#line1');
const line2El = document.querySelector('#line2');
const extEl = document.querySelector('#extendedInfo');

const kind = params.get('kind');
const productCode = params.get('productCode');
const productName = params.get('productName');
const buyerNickname = params.get('buyerNickname');
const quantity = params.get('quantity');
const amount = params.get('amount');
const sessionCode = params.get('sessionCode');
const createdAt = params.get('createdAt');

if (productCode || kind) {
  const kindLabel = kind === 'CORRECTION' ? '[정정] ' : (kind === 'CANCEL' ? '[취소] ' : (kind === 'REPRINT' ? '[재인쇄] ' : ''));
  const headerText = `${kindLabel}${buyerNickname || ''} ${amount ? Number(amount).toLocaleString() + '원' : ''}`.trim();
  const subText = `${productCode || ''} ${productName || ''} | ${quantity || 1}개`.trim();
  if (line1El) line1El.textContent = headerText || (params.get('line1') || '');
  if (line2El) line2El.textContent = subText || (params.get('line2') || '');
  if (extEl && (sessionCode || createdAt)) {
    extEl.textContent = `${sessionCode || ''} ${createdAt || ''}`.trim();
  }
} else {
  if (line1El) line1El.textContent = params.get('line1') || '';
  if (line2El) line2El.textContent = params.get('line2') || '';
}


