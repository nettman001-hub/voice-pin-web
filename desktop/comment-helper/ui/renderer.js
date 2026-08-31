const statusDot = document.querySelector('#status-dot');
const statusLabel = document.querySelector('#status-label');
const statusPill = document.querySelector('#status-pill');
const statusMessage = document.querySelector('#status-message');
const liveStats = document.querySelector('#live-stats');
const tiktokUsername = document.querySelector('#tiktok-username');
const commentCount = document.querySelector('#comment-count');
const autoStart = document.querySelector('#auto-start');
const restartButton = document.querySelector('#restart');
const version = document.querySelector('#version');

function viewState(status) {
  if (status.helper === 'error') {
    return { tone: 'error', label: '연결에 문제가 있습니다', pill: '확인 필요' };
  }
  if (status.helper !== 'running') {
    return { tone: 'starting', label: '시작하는 중', pill: '잠시만요' };
  }
  if (status.tiktokState === 'collecting') {
    return { tone: 'collecting', label: '댓글을 받고 있습니다', pill: '수집 중' };
  }
  if (status.tiktokState === 'connecting') {
    return { tone: 'starting', label: '틱톡에 연결하는 중', pill: '연결 중' };
  }
  if (status.tiktokState === 'waiting_live') {
    return { tone: 'running', label: '방송 시작을 기다립니다', pill: '대기 중' };
  }
  return { tone: 'running', label: '정상적으로 작동 중입니다', pill: '정상' };
}

function render(status) {
  const view = viewState(status);
  statusDot.className = `status-dot ${view.tone}`;
  statusPill.className = `pill ${view.tone}`;
  statusLabel.textContent = view.label;
  statusPill.textContent = view.pill;
  statusMessage.textContent = status.message || '댓글 서버가 정상 작동 중입니다.';
  autoStart.checked = Boolean(status.autoStart);
  version.textContent = `VoiceCAP 댓글 도우미 v${status.version || '-'}`;

  const hasLiveInfo = Boolean(status.tiktokUsername) || status.tiktokState === 'collecting';
  liveStats.hidden = !hasLiveInfo;
  tiktokUsername.textContent = status.tiktokUsername ? `@${status.tiktokUsername}` : '-';
  commentCount.textContent = `${Number(status.totalComments || 0).toLocaleString('ko-KR')}개`;
}

document.querySelector('#open-web').addEventListener('click', () => window.voicecap.openWebApp());
document.querySelector('#open-logs').addEventListener('click', () => window.voicecap.openLogs());
document.querySelector('#hide').addEventListener('click', () => window.voicecap.hideWindow());

autoStart.addEventListener('change', async () => {
  autoStart.disabled = true;
  try {
    autoStart.checked = await window.voicecap.setAutoStart(autoStart.checked);
  } finally {
    autoStart.disabled = false;
  }
});

restartButton.addEventListener('click', async () => {
  restartButton.disabled = true;
  restartButton.textContent = '다시 시작하는 중...';
  try {
    render(await window.voicecap.restart());
  } finally {
    setTimeout(() => {
      restartButton.disabled = false;
      restartButton.textContent = '서버 다시 시작';
    }, 1800);
  }
});

window.voicecap.onStatus(render);
window.voicecap.getStatus().then(render);
