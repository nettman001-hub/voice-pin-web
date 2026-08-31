const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell, utilityProcess } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const http = require('http');
const path = require('path');

const APP_NAME = 'VoiceCAP 댓글 도우미';
const WEB_APP_URL = 'https://www.voicecap.shop/live';
const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 2137;
const LOGIN_ITEM_ARGS = ['--hidden'];
const AUTO_START_INITIALIZED_FILE = 'auto-start-initialized';

let mainWindow = null;
let tray = null;
let serverProcess = null;
let healthTimer = null;
let restartTimer = null;
let isQuitting = false;
let manualRestart = false;
let lastStatusSignature = '';
let logFile = '';

const state = {
  helper: 'starting',
  message: '댓글 서버를 시작하고 있습니다.',
  tiktokState: 'idle',
  tiktokUsername: '',
  viewerCount: 0,
  totalComments: 0,
  lastCheckedAt: null,
  version: app.getVersion(),
  autoStart: false,
  webAppUrl: WEB_APP_URL
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

function iconPath() {
  return path.join(__dirname, 'assets', 'icon.png');
}

function prepareLogs() {
  const logDir = app.getPath('logs');
  fs.mkdirSync(logDir, { recursive: true });
  logFile = path.join(logDir, 'comment-helper.log');
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) {
      fs.renameSync(logFile, path.join(logDir, 'comment-helper.previous.log'));
    }
  } catch (_) {
    // 로그 회전 실패는 앱 실행을 막지 않는다.
  }
}

function writeLog(source, value) {
  const line = String(value == null ? '' : value).trimEnd();
  if (!line) return;
  const text = `[${new Date().toISOString()}] [${source}] ${line}\n`;
  try {
    fs.appendFileSync(logFile, text, 'utf8');
  } catch (_) {
    // 디스크 오류가 댓글 수집을 중단시키지 않도록 무시한다.
  }
}

function readRuntimeConfig() {
  const candidates = [
    path.join(process.resourcesPath, 'runtime-config.json'),
    path.join(__dirname, 'build-runtime', 'runtime-config.json')
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return JSON.parse(fs.readFileSync(candidate, 'utf8'));
      }
    } catch (error) {
      writeLog('helper', `런타임 설정 읽기 실패: ${error.message}`);
    }
  }
  return {};
}

function serverEntryPath() {
  return path.join(app.getAppPath(), 'server', 'index.js');
}

function startServer() {
  clearTimeout(restartTimer);
  restartTimer = null;
  if (serverProcess) return;

  const runtimeConfig = readRuntimeConfig();
  state.helper = 'starting';
  state.message = '댓글 서버를 시작하고 있습니다.';
  publishStatus();

  writeLog('helper', `서버 시작: ${serverEntryPath()}`);
  serverProcess = utilityProcess.fork(serverEntryPath(), [], {
    serviceName: 'VoiceCAP Comment Server',
    stdio: 'pipe',
    env: {
      ...process.env,
      HOST: SERVER_HOST,
      PORT: String(SERVER_PORT),
      EULERSTREAM_API_KEY: String(runtimeConfig.eulerApiKey || ''),
      ALLOWED_ORIGINS: [
        'https://voicecap.shop',
        'https://www.voicecap.shop',
        'https://voice-pin-web.vercel.app',
        'http://localhost:5173',
        'http://127.0.0.1:5173'
      ].join(',')
    }
  });

  serverProcess.stdout?.on('data', (chunk) => writeLog('server', chunk.toString('utf8')));
  serverProcess.stderr?.on('data', (chunk) => writeLog('server-error', chunk.toString('utf8')));
  serverProcess.on('exit', (code) => {
    writeLog('helper', `서버 종료 (코드 ${code})`);
    serverProcess = null;

    // 트레이 메뉴의 종료 요청으로 서버를 끈 경우에는 창·트레이가 이미 파기될 수 있다.
    // 이때 상태를 다시 보내거나 서버를 재시작하지 않는다.
    if (isQuitting) {
      manualRestart = false;
      return;
    }

    state.helper = 'error';
    state.message = '댓글 서버가 중지되었습니다. 자동으로 다시 시작합니다.';
    publishStatus();

    if (!isQuitting && !manualRestart) {
      restartTimer = setTimeout(startServer, 3000);
    }
    manualRestart = false;
  });
}

function stopServer() {
  clearTimeout(restartTimer);
  restartTimer = null;
  if (!serverProcess) return;
  manualRestart = true;
  try {
    serverProcess.kill();
  } catch (error) {
    writeLog('helper', `서버 종료 실패: ${error.message}`);
    serverProcess = null;
  }
}

function restartServer() {
  writeLog('helper', '사용자 요청으로 서버 다시 시작');
  if (!serverProcess) {
    startServer();
    return;
  }
  stopServer();
  restartTimer = setTimeout(() => {
    manualRestart = false;
    startServer();
  }, 800);
}

function requestHealth() {
  if (isQuitting) return;

  const request = http.get(
    { hostname: SERVER_HOST, port: SERVER_PORT, path: '/status', timeout: 1800 },
    (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const tiktok = payload.tiktok || {};
          state.helper = 'running';
          state.message = tiktok.message || '댓글 서버가 정상 작동 중입니다.';
          state.tiktokState = tiktok.state || 'idle';
          state.tiktokUsername = tiktok.username || '';
          state.viewerCount = Number(tiktok.viewerCount || 0);
          state.totalComments = Number(tiktok.totalComments || 0);
          state.lastCheckedAt = new Date().toISOString();
          publishStatus();
        } catch (error) {
          setHealthError(`서버 응답을 읽을 수 없습니다: ${error.message}`);
        }
      });
    }
  );
  request.on('timeout', () => request.destroy(new Error('시간 초과')));
  request.on('error', () => setHealthError('댓글 서버에 연결하는 중입니다.'));
}

function setHealthError(message) {
  if (isQuitting) return;
  if (!serverProcess) state.helper = 'error';
  else if (state.helper !== 'starting') state.helper = 'starting';
  state.message = message;
  state.lastCheckedAt = new Date().toISOString();
  publishStatus();
}

function statusSnapshot() {
  return { ...state };
}

function statusLabel() {
  if (state.helper === 'error') return '오류';
  if (state.helper !== 'running') return '시작 중';
  if (state.tiktokState === 'collecting') return '댓글 수집 중';
  if (state.tiktokState === 'connecting') return '틱톡 연결 중';
  if (state.tiktokState === 'waiting_live') return '방송 시작 대기 중';
  return '정상 작동 중';
}

function publishStatus() {
  if (isQuitting) return;

  const snapshot = statusSnapshot();
  const signature = JSON.stringify(snapshot);
  if (signature === lastStatusSignature) return;
  lastStatusSignature = signature;
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('helper:status', snapshot);
  }
  if (tray) {
    tray.setToolTip(`${APP_NAME} · ${statusLabel()}`);
    tray.setContextMenu(buildTrayMenu());
  }
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: `상태: ${statusLabel()}`, enabled: false },
    { type: 'separator' },
    { label: '상태 화면 열기', click: showWindow },
    { label: 'VoiceCAP 홈페이지 열기', click: () => shell.openExternal(WEB_APP_URL) },
    { label: '댓글 서버 다시 시작', click: restartServer },
    { label: '업데이트 확인', click: checkForUpdates },
    { label: '진단 로그 열기', click: () => shell.showItemInFolder(logFile) },
    { type: 'separator' },
    { label: '종료', click: quitApp }
  ]);
}

function checkForUpdates() {
  if (!app.isPackaged) {
    writeLog('update', '개발 실행에서는 업데이트 확인을 건너뜁니다.');
    return;
  }
  void autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    writeLog('update', `업데이트 확인 실패: ${error.message}`);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 680,
    minWidth: 420,
    minHeight: 620,
    show: false,
    title: APP_NAME,
    icon: iconPath(),
    autoHideMenuBar: true,
    backgroundColor: '#f3f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    writeLog('ui-error', `화면 로드 실패 (${code}): ${description}`);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    writeLog('ui-error', `화면 프로세스 종료: ${details.reason}`);
  });
  mainWindow.webContents.on('console-message', (_event, details) => {
    if (details.level === 'error') writeLog('ui-error', details.message);
  });
  mainWindow.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) mainWindow.show();
  });
  mainWindow.webContents.once('did-finish-load', () => {
    const capturePath = process.env.VOICECAP_CAPTURE_PATH;
    if (!capturePath) return;
    setTimeout(async () => {
      try {
        const image = await mainWindow.webContents.capturePage();
        fs.writeFileSync(capturePath, image.toPNG());
        writeLog('helper', `UI 미리보기 저장: ${capturePath}`);
      } catch (error) {
        writeLog('ui-error', `UI 미리보기 실패: ${error.message}`);
      }
    }, 1200);
  });
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createTray() {
  const sourceImage = nativeImage.createFromPath(iconPath());
  if (sourceImage.isEmpty()) {
    writeLog('helper', `트레이 아이콘을 읽을 수 없습니다: ${iconPath()}`);
  }
  const trayImage = sourceImage.resize({ width: 16, height: 16 });
  tray = new Tray(trayImage);
  tray.setToolTip(`${APP_NAME} · 시작 중`);
  tray.setContextMenu(buildTrayMenu());
  tray.on('double-click', showWindow);
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function getAutoStartSettings() {
  if (!app.isPackaged) return { openAtLogin: false };

  try {
    // setLoginItemSettings에 path/args를 지정했으므로 조회할 때도 같은 값을
    // 전달해야 Electron이 해당 Run 항목의 활성화 상태를 정확히 판단한다.
    return app.getLoginItemSettings({
      path: process.execPath,
      args: LOGIN_ITEM_ARGS
    });
  } catch (error) {
    writeLog('helper', `자동 실행 상태 확인 실패: ${error.message}`);
    return { openAtLogin: false };
  }
}

function setAutoStart(enabled) {
  if (app.isPackaged) {
    try {
      app.setLoginItemSettings({
        openAtLogin: Boolean(enabled),
        path: process.execPath,
        args: LOGIN_ITEM_ARGS,
        enabled: Boolean(enabled)
      });
    } catch (error) {
      writeLog('helper', `자동 실행 설정 실패: ${error.message}`);
    }
  }
  state.autoStart = app.isPackaged
    ? Boolean(getAutoStartSettings().openAtLogin)
    : Boolean(enabled);
  publishStatus();
  return state.autoStart;
}

function initializeAutoStart() {
  const settings = getAutoStartSettings();
  state.autoStart = Boolean(settings.openAtLogin);

  if (!app.isPackaged) return;

  // 기존 설치 사용자는 첫 실행 때만 기본 자동 실행을 등록한다.
  // 사용자가 토글을 끈 뒤 다음 실행에서 다시 켜지는 문제를 방지한다.
  const markerPath = path.join(app.getPath('userData'), AUTO_START_INITIALIZED_FILE);
  if (!fs.existsSync(markerPath) && !state.autoStart) {
    state.autoStart = setAutoStart(true);
  }

  try {
    fs.writeFileSync(markerPath, '1\n', 'utf8');
  } catch (error) {
    writeLog('helper', `자동 실행 초기화 상태 저장 실패: ${error.message}`);
  }
}

function quitApp() {
  isQuitting = true;
  clearInterval(healthTimer);
  clearTimeout(restartTimer);
  stopServer();
  app.quit();
}

ipcMain.handle('helper:get-status', () => statusSnapshot());
ipcMain.handle('helper:restart', () => {
  restartServer();
  return statusSnapshot();
});
ipcMain.handle('helper:open-webapp', () => shell.openExternal(WEB_APP_URL));
ipcMain.handle('helper:open-logs', () => shell.showItemInFolder(logFile));
ipcMain.handle('helper:set-auto-start', (_event, enabled) => setAutoStart(enabled));
ipcMain.handle('helper:hide-window', () => mainWindow?.hide());
ipcMain.handle('helper:quit', quitApp);

app.whenReady().then(() => {
  app.setAppUserModelId('shop.voicecap.commenthelper');
  prepareLogs();
  createWindow();
  createTray();
  startServer();
  initializeAutoStart();
  requestHealth();
  healthTimer = setInterval(requestHealth, 2500);
  if (app.isPackaged) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', (info) => writeLog('update', `업데이트 발견: ${info.version}`));
    autoUpdater.on('update-downloaded', (info) => writeLog('update', `업데이트 다운로드 완료: ${info.version}. 다음 종료 시 설치합니다.`));
    setTimeout(checkForUpdates, 10000);
    setInterval(checkForUpdates, 6 * 60 * 60 * 1000);
  }
});

app.on('activate', showWindow);
app.on('before-quit', () => {
  isQuitting = true;
});
app.on('window-all-closed', () => {
  // Windows 트레이 앱이므로 창을 닫아도 백그라운드에서 계속 실행한다.
});
