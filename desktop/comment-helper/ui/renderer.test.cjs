const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function fakeElement() {
  const listeners = new Map();
  return {
    checked: false,
    className: '',
    disabled: false,
    hidden: false,
    options: [],
    textContent: '',
    value: '',
    addEventListener(type, listener) { listeners.set(type, listener); },
    append(option) { this.options.push(option); },
    dispatch(type) { return listeners.get(type)?.(); },
    replaceChildren(...options) {
      this.options = options;
      this.value = options[0]?.value || '';
    }
  };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('자동 출력 토글을 즉시 저장하고 상태 갱신에도 선택값을 유지한다', async () => {
  const ids = [
    'status-dot', 'status-label', 'status-pill', 'status-message', 'live-stats',
    'tiktok-username', 'comment-count', 'auto-start', 'restart', 'version',
    'print-enabled', 'printer-select', 'paper-size', 'print-message',
    'save-printer', 'test-print', 'open-web', 'open-logs', 'hide', 'refresh-printers'
  ];
  const elements = Object.fromEntries(ids.map((id) => [`#${id}`, fakeElement()]));
  let statusListener = () => {};
  let savedPrint = {
    enabled: false,
    printerName: 'Printer A',
    paperSize: 'A4',
    message: '자동 출력을 켜면 판매 전표가 출력됩니다.'
  };
  const saveCalls = [];
  const status = () => ({
    helper: 'running',
    message: '정상 작동 중입니다.',
    tiktokState: 'idle',
    autoStart: false,
    version: '1.1.2',
    print: { ...savedPrint }
  });

  const voicecap = {
    getPrinters: async () => [
      { name: 'Printer A', displayName: 'Printer A', options: { isDefault: true } },
      { name: 'Printer B', displayName: 'Printer B', options: {} }
    ],
    getStatus: async () => status(),
    hideWindow() {},
    onStatus(listener) { statusListener = listener; },
    openLogs() {},
    openWebApp() {},
    restart: async () => status(),
    savePrintSettings: async (settings) => {
      saveCalls.push({ ...settings });
      statusListener(status());
      await flush();
      savedPrint = {
        ...settings,
        message: settings.enabled ? '자동 출력 준비 완료' : '자동 출력을 켜면 판매 전표가 출력됩니다.'
      };
      statusListener(status());
      return status();
    },
    setAutoStart: async (enabled) => enabled,
    testPrint: async () => ({ ok: true })
  };
  const document = {
    createElement: () => fakeElement(),
    querySelector: (selector) => elements[selector]
  };
  const source = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  vm.runInNewContext(source, { console, document, Option: fakeElement, setTimeout, window: { voicecap } });
  await flush();
  await flush();

  const printEnabled = elements['#print-enabled'];
  const printerSelect = elements['#printer-select'];

  printerSelect.value = 'Printer B';
  printerSelect.dispatch('change');
  statusListener(status());
  assert.equal(printerSelect.value, 'Printer B', '편집 중인 프린터를 주기 상태 갱신이 덮어쓰면 안 된다');

  printEnabled.checked = true;
  printEnabled.dispatch('change');
  await flush();
  await flush();
  assert.equal(saveCalls.at(-1).enabled, true);
  assert.equal(saveCalls.at(-1).printerName, 'Printer B');
  assert.equal(printEnabled.checked, true);

  printEnabled.checked = false;
  printEnabled.dispatch('change');
  await flush();
  await flush();
  assert.equal(saveCalls.at(-1).enabled, false);
  assert.equal(printEnabled.checked, false);
});
