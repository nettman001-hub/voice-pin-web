const params = new URLSearchParams(window.location.search);
document.querySelector('#line1').textContent = params.get('line1') || '';
document.querySelector('#line2').textContent = params.get('line2') || '';
