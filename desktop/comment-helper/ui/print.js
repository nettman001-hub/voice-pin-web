const params = new URLSearchParams(window.location.search);
const paperSize = params.get('paperSize');
if (paperSize && document.body && document.body.classList) {
  document.body.classList.add(paperSize);
}
document.querySelector('#line1').textContent = params.get('line1') || '';
document.querySelector('#line2').textContent = params.get('line2') || '';

