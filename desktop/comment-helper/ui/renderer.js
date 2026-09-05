const statusDot = document.querySelector('#status-dot');
const statusLabel = document.querySelector('#status-label');
const statusPill = document.querySelector('#status-pill');
const statusMessage = document.querySelector('#status-message');
const liveStats = document.querySelector('#live-stats');
const tiktokUsername = document.querySelector('#tiktok-username');
const commentCount = document.querySelector('#comment-count');
const sttStatus = document.querySelector('#stt-status');
const sttDeviceSelect = document.querySelector('#stt-device-select');
const refreshDevicesButton = document.querySelector('#refresh-devices');
const gpuBadge = document.querySelector('#gpu-badge');
const sttDeviceMessage = document.querySelector('#stt-device-message');
const autoStart = document.querySelector('#auto-start');
const restartButton = document.querySelector('#restart');
const version = document.querySelector('#version');
const printEnabled = document.querySelector('#print-enabled');
const printerSelect = document.querySelector('#printer-select');
const paperSize = document.querySelector('#paper-size');
const printMessage = document.querySelector('#print-message');
const savePrinterButton = document.querySelector('#save-printer');
const testPrintButton = document.querySelector('#test-print');

let printSettingsDirty = false;
let printSettingsSaving = false;
const PRINTER_REQUIRED_MESSAGE = '자동 출력을 켜려면 Windows 프린터를 선택해 주세요.';

function setPrintMessage(message) {
  const text = message || '프린터를 선택하면 판매 전표를 자동으로 출력합니다.';
  printMessage.textContent = text;
  printMessage.className = text === PRINTER_REQUIRED_MESSAGE
    ? 'print-message print-warning'
    : 'print-message';
}

function viewState(status) {
  if (status.helper === 'error') return { tone: 'error', label: '연결에 문제가 있습니다', pill: '확인 필요' };
  if (status.helper !== 'running') return { tone: 'starting', label: '시작하는 중', pill: '잠시만요' };
  if (status.tiktokState === 'collecting') return { tone: 'collecting', label: '댓글을 받고 있습니다', pill: '수집 중' };
  if (status.tiktokState === 'connecting') return { tone: 'starting', label: '틱톡에 연결하는 중', pill: '연결 중' };
  if (status.tiktokState === 'waiting_live') return { tone: 'running', label: '방송 시작을 기다립니다', pill: '대기 중' };
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
  const print = status.print || {};
  if (!printSettingsDirty && !printSettingsSaving) {
    printEnabled.checked = Boolean(print.enabled);
    paperSize.value = print.paperSize || 'LABEL_50_30';
    if (print.printerName && printerSelect.options.length) printerSelect.value = print.printerName;
  }
  setPrintMessage(print.message);
  const hasLiveInfo = Boolean(status.tiktokUsername) || status.tiktokState === 'collecting' || Boolean(status.stt);
  liveStats.hidden = !hasLiveInfo;
  tiktokUsername.textContent = status.tiktokUsername ? `@${status.tiktokUsername}` : '-';
  commentCount.textContent = `${Number(status.totalComments || 0).toLocaleString('ko-KR')}개`;
  if (sttStatus) {
    const stt = status.stt;
    if (!stt) {
      sttStatus.textContent = '대기 중';
    } else if (stt.state === 'READY' || stt.state === 'LISTENING') {
      const devLabel = stt.device === 'cuda' ? 'GPU 가속' : 'CPU';
      sttStatus.textContent = `준비됨 (${stt.model || 'base'} / ${devLabel})`;
    } else if (stt.state === 'LOADING') {
      sttStatus.textContent = `로딩 중 (${stt.requestedModel || stt.model || 'base'})`;
    } else if (stt.state === 'ERROR') {
      sttStatus.textContent = '오류';
    } else {
      sttStatus.textContent = stt.state || '대기';
    }
  }

  if (status.stt) {
    const stt = status.stt;
    if (gpuBadge) {
      if (stt.hasGpu) {
        gpuBadge.className = 'badge-gpu';
        gpuBadge.textContent = `⚡ ${stt.gpuName || 'NVIDIA GPU'} 감지됨`;
      } else {
        gpuBadge.className = 'badge-gpu disabled';
        gpuBadge.textContent = 'GPU 미감지 (CPU 모드)';
      }
    }
    if (sttDeviceSelect && !sttDeviceSelect.matches(':focus')) {
      if (Array.isArray(stt.availableDevices) && stt.availableDevices.length > 0) {
        sttDeviceSelect.replaceChildren();
        stt.availableDevices.forEach((dev) => {
          const opt = document.createElement('option');
          opt.value = dev.id;
          opt.textContent = dev.id === 'cuda'
            ? `🚀 GPU 가속 (${dev.name})`
            : `💻 CPU (${dev.name})`;
          opt.disabled = !dev.available;
          sttDeviceSelect.append(opt);
        });
        sttDeviceSelect.value = stt.device || 'cuda';
      } else if (stt.device) {
        sttDeviceSelect.value = stt.device;
      }
    }
    if (sttDeviceMessage) {
      if (stt.device === 'cuda') {
        sttDeviceMessage.textContent = `NVIDIA GPU (${stt.gpuName || 'CUDA'}) 가속 활성화됨: 지연 없는 초고속 실시간 음성인식`;
        sttDeviceMessage.className = 'stt-message';
      } else {
        sttDeviceMessage.textContent = 'CPU 기본 연산으로 동작 중입니다. 빠른 발화 시 지연이 발생할 수 있습니다.';
        sttDeviceMessage.className = 'stt-message';
      }
    }
  }
}

async function loadPrinters(selectedName) {
  printerSelect.disabled = true;
  try {
    const printers = await window.voicecap.getPrinters();
    printerSelect.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = printers.length ? '프린터를 선택해 주세요' : 'Windows에서 프린터를 찾지 못했습니다';
    printerSelect.append(placeholder);
    printers.forEach((printer) => {
      const option = document.createElement('option');
      option.value = printer.name;
      option.textContent = `${printer.displayName || printer.name}${printer.options?.isDefault ? ' (기본 프린터)' : ''}`;
      printerSelect.append(option);
    });
    if (selectedName) printerSelect.value = selectedName;
    if (!printerSelect.value) {
      const preferredPrinter = printers.find((printer) => /xprinter|label|xp-/i.test(printer.name));
      const defaultPrinter = printers.find((printer) => printer.options?.isDefault);
      if (preferredPrinter) printerSelect.value = preferredPrinter.name;
      else if (defaultPrinter) printerSelect.value = defaultPrinter.name;
    }
  } catch (error) {
    printerSelect.replaceChildren(new Option('프린터 목록을 읽지 못했습니다', ''));
    setPrintMessage(error instanceof Error ? error.message : '프린터 목록을 읽지 못했습니다.');
  } finally {
    printerSelect.disabled = false;
  }
}

document.querySelector('#open-web').addEventListener('click', () => window.voicecap.openWebApp());
document.querySelector('#open-logs').addEventListener('click', () => window.voicecap.openLogs());
document.querySelector('#hide').addEventListener('click', () => window.voicecap.hideWindow());
document.querySelector('#refresh-printers').addEventListener('click', () => loadPrinters(printerSelect.value));

printerSelect.addEventListener('change', () => { printSettingsDirty = true; });
paperSize.addEventListener('change', () => { printSettingsDirty = true; });

autoStart.addEventListener('change', async () => {
  autoStart.disabled = true;
  try { autoStart.checked = await window.voicecap.setAutoStart(autoStart.checked); }
  finally { autoStart.disabled = false; }
});

async function saveCurrentPrintSettings() {
  if (printSettingsSaving) return;
  const requested = {
    enabled: printEnabled.checked,
    printerName: printerSelect.value,
    paperSize: paperSize.value
  };

  printSettingsDirty = true;
  printSettingsSaving = true;
  printEnabled.disabled = true;
  savePrinterButton.disabled = true;
  try {
    const status = await window.voicecap.savePrintSettings(requested);
    printSettingsDirty = false;
    printSettingsSaving = false;
    render(status);
    if (requested.enabled && !status.print?.enabled) setPrintMessage(PRINTER_REQUIRED_MESSAGE);
  } catch (error) {
    printSettingsDirty = false;
    printSettingsSaving = false;
    try { render(await window.voicecap.getStatus()); } catch (_) { /* 기존 화면 상태를 유지한다. */ }
    setPrintMessage(error instanceof Error ? error.message : '프린터 설정을 저장하지 못했습니다.');
  } finally {
    printSettingsSaving = false;
    printEnabled.disabled = false;
    savePrinterButton.disabled = false;
  }
}

printEnabled.addEventListener('change', () => {
  printSettingsDirty = true;
  void saveCurrentPrintSettings();
});

savePrinterButton.addEventListener('click', () => {
  void saveCurrentPrintSettings();
});

testPrintButton.addEventListener('click', async () => {
  testPrintButton.disabled = true;
  testPrintButton.textContent = '출력 중...';
  try {
    const result = await window.voicecap.testPrint();
    setPrintMessage(result.ok ? '테스트 전표를 프린터로 보냈습니다.' : (result.error || '테스트 출력에 실패했습니다.'));
  } finally {
    testPrintButton.disabled = false;
    testPrintButton.textContent = '두 줄 테스트 출력';
  }
});

restartButton.addEventListener('click', async () => {
  restartButton.disabled = true;
  restartButton.textContent = '다시 시작하는 중...';
  try { render(await window.voicecap.restart()); }
  finally {
    setTimeout(() => { restartButton.disabled = false; restartButton.textContent = '서버 다시 시작'; }, 1800);
  }
});

sttDeviceSelect?.addEventListener('change', async () => {
  const chosen = sttDeviceSelect.value;
  sttDeviceSelect.disabled = true;
  if (sttDeviceMessage) {
    sttDeviceMessage.textContent = `${chosen === 'cuda' ? 'GPU 가속' : 'CPU'} 모드로 전환하는 중입니다...`;
  }
  try {
    await window.voicecap.setSttDevice(chosen);
    render(await window.voicecap.getStatus());
  } catch (err) {
    if (sttDeviceMessage) {
      sttDeviceMessage.textContent = `장치 전환 실패: ${err.message}`;
    }
  } finally {
    sttDeviceSelect.disabled = false;
  }
});

refreshDevicesButton?.addEventListener('click', async () => {
  refreshDevicesButton.disabled = true;
  try {
    await window.voicecap.detectSttDevices();
    render(await window.voicecap.getStatus());
  } finally {
    setTimeout(() => { refreshDevicesButton.disabled = false; }, 1000);
  }
});

window.voicecap.onStatus(render);
window.voicecap.getStatus().then((status) => { render(status); return loadPrinters(status.print?.printerName); });
