import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

const helperRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../desktop/comment-helper');
const source = fs.readFileSync(path.join(helperRoot, 'main.cjs'), 'utf8');

function fixture() {
  let ready;
  let quitCount = 0;
  const children = [];
  const windows = [];
  const shellCommands = [];
  const timeouts = [];
  const intervals = [];
  const requests = [];
  const handlers = new Map();
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true,
    getVersion: () => '1.3.9',
    requestSingleInstanceLock: () => true,
    whenReady: () => ({ then(callback) { ready = callback; } }),
    getAppPath: () => helperRoot,
    getPath: (name) => path.join('C:/fixture', name),
    setAppUserModelId() {},
    getLoginItemSettings: () => ({ openAtLogin: false }),
    setLoginItemSettings() {},
    quit() { quitCount++; }
  });
  class BrowserWindow extends EventEmitter {
    constructor() {
      super();
      windows.push(this);
      this.webContents = Object.assign(new EventEmitter(), {
        isDestroyed: () => false,
        send() {},
        setWindowOpenHandler() {}
      });
    }
    isDestroyed() { return false; }
    loadFile() {}
  }
  class Tray extends EventEmitter {
    setToolTip() {}
    setContextMenu() {}
  }
  const electron = {
    app, BrowserWindow, Tray,
    Menu: { buildFromTemplate: (items) => items },
    nativeImage: { createFromPath: () => ({ isEmpty: () => false, resize: () => ({}) }) },
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    shell: {}, dialog: {},
    utilityProcess: {
      fork(entry, args, options) {
        const child = Object.assign(new EventEmitter(), {
          entry, args, options,
          stdout: new EventEmitter(), stderr: new EventEmitter(),
          killCount: 0,
          kill() { this.killCount++; this.emit('exit', 0); }
        });
        children.push(child);
        return child;
      }
    }
  };
  const http = {
    get(options, callback) {
      const request = Object.assign(new EventEmitter(), {
        options,
        destroy(error) { this.emit('error', error); },
        respond(payload) {
          const response = Object.assign(new EventEmitter(), { setEncoding() {} });
          callback(response);
          response.emit('data', JSON.stringify(payload));
          response.emit('end');
        }
      });
      requests.push(request);
      return request;
    }
  };
  const modules = {
    electron,
    'electron-updater': { autoUpdater: Object.assign(new EventEmitter(), {}) },
    fs: { mkdirSync() {}, existsSync: () => false, appendFileSync() {}, writeFileSync() {} },
    http, path,
    child_process: { execSync(command) { shellCommands.push(command); return ''; } }
  };
  vm.runInNewContext(source, {
    require(id) {
      assert.ok(id in modules, `Unexpected startup dependency: ${id}`);
      return modules[id];
    },
    __dirname: helperRoot,
    process: {
      platform: 'win32', pid: 1234,
      execPath: 'C:/fixture/VoiceCAP 댓글 도우미.exe',
      resourcesPath: 'C:/fixture/resources', argv: [], env: {}
    },
    Buffer, console,
    setTimeout(callback, delay) {
      const timer = { callback, delay };
      timeouts.push(timer);
      return timer;
    },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    setInterval(callback, delay) {
      const timer = { callback, delay };
      intervals.push(timer);
      return timer;
    },
    clearInterval(timer) { if (timer) timer.cleared = true; }
  }, { filename: 'desktop/comment-helper/main.cjs' });
  return {
    start: () => ready(),
    status: () => handlers.get('helper:get-status')(),
    invoke: (name) => handlers.get(name)(),
    children, windows, shellCommands, timeouts, intervals, requests,
    quitCount: () => quitCount
  };
}

test('packaged helper starts its own server without terminating executable names or port owners', () => {
  const f = fixture();
  f.start();
  assert.equal(f.windows.length, 1);
  assert.equal(f.children.length, 1);
  assert.equal(f.children[0].entry, path.join(helperRoot, 'server/index.js'));
  assert.equal(f.children[0].options.env.PORT, '2137');
  assert.deepEqual(f.shellCommands, [], 'Startup must never taskkill itself or unrelated processes');
  assert.equal(f.quitCount(), 0);
  f.requests[0].respond({ tiktok: { state: 'idle' } });
  assert.equal(f.status().helper, 'running');
});

test('occupied port stays visible and leaves its owner alone until explicit retry', () => {
  const f = fixture();
  f.start();
  f.children[0].stderr.emit('data', Buffer.from('Error: listen EADDR'));
  f.children[0].stderr.emit('data', Buffer.from('INUSE: address already in use 127.0.0.1:2137'));
  f.children[0].emit('exit', 1);
  assert.equal(f.status().helper, 'error');
  assert.match(f.status().message, /2137.*다른 프로그램.*댓글 서버 다시 시작/);
  assert.equal(f.timeouts.filter((timer) => timer.delay === 3000).length, 0);
  assert.equal(f.children[0].killCount, 0);
  assert.deepEqual(f.shellCommands, []);

  // The listener on that port may answer an already pending health request.
  // Neither its JSON nor the health timer may erase the conflict message.
  const conflictMessage = f.status().message;
  f.requests[0].respond({ tiktok: { state: 'idle' } });
  f.intervals.find((timer) => timer.delay === 2500).callback();
  assert.equal(f.status().message, conflictMessage);
  assert.equal(f.requests.length, 1);

  f.invoke('helper:restart');
  assert.equal(f.children.length, 2);
  f.intervals.find((timer) => timer.delay === 2500).callback();
  assert.equal(f.requests.length, 2);
  f.requests[1].respond({ tiktok: { state: 'idle' } });
  assert.equal(f.status().helper, 'running');
});

test('other server exits still recover automatically', () => {
  const f = fixture();
  f.start();
  f.children[0].stderr.emit('data', Buffer.from('Unexpected server failure'));
  f.children[0].emit('exit', 1);
  const retry = f.timeouts.find((timer) => timer.delay === 3000);
  assert.ok(retry);
  retry.callback();
  assert.equal(f.children.length, 2);
  assert.deepEqual(f.shellCommands, []);
});

test('quit terminates only the utility process created by this helper', () => {
  const f = fixture();
  f.start();
  f.invoke('helper:quit');
  assert.equal(f.children[0].killCount, 1);
  assert.equal(f.quitCount(), 1);
  assert.deepEqual(f.shellCommands, []);
  assert.equal(f.timeouts.filter((timer) => timer.delay === 3000).length, 0);
});
