import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const tick = () => new Promise(setImmediate);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture({ save = async () => {}, comments = async () => {}, persistence = () => {} } = {}) {
  const cells = [];
  let index = 0, salesAttempts = 0, commentAttempts = 0, persistenceAttempts = 0;
  let syncError = '저장 근거 확인이 필요한 판매 4건: 판매 근거 확인 필요';
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const key = index++;
      if (!(key in cells)) cells[key] = initial;
      return [cells[key], (value) => { cells[key] = value; }];
    },
    useRef(initial) { const key = index++; cells[key] ||= { current: initial }; return cells[key]; },
    useEffect() {},
  };
  const dependencies = {
    react: { ...react, default: react },
    '../../context/SalesContext': { useSales: () => ({ syncError, retrySync: () => { salesAttempts++; return save(); } }) },
    '../../context/AuthContext': { useAuth: () => ({ workspaceId: 'workspace-1' }) },
    '../../services/storageService': { storageService: {
      getPersistenceError: () => null,
      retryPersistence: () => { persistenceAttempts++; persistence(); },
    } },
    '../../services/commentSyncService': { flushPendingComments: (workspace) => {
      assert.equal(workspace, 'workspace-1'); commentAttempts++; return comments();
    } },
  };
  const { outputText } = ts.transpileModule(fs.readFileSync(new URL('../src/components/common/SyncStatusNotice.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports,
    require(name) { assert.ok(name in dependencies, name); return dependencies[name]; },
  });
  const text = (node) => Array.isArray(node) ? node.map(text).join('')
    : node && typeof node === 'object' ? text(node.props.children)
      : typeof node === 'string' ? node : '';
  return {
    render() {
      index = 0;
      const tree = module.exports.SyncStatusNotice();
      return { text: text(tree), button: tree?.props.children.find((node) => node?.type === 'button') };
    },
    attempts: () => ({ salesAttempts, commentAttempts, persistenceAttempts }),
    setSyncError: (value) => { syncError = value; },
  };
}

test('retry shows progress, suppresses duplicate clicks and reports completion without claiming server success', async () => {
  const save = deferred();
  const ctx = fixture({ save: () => save.promise });
  const button = ctx.render().button;
  button.props.onClick();
  button.props.onClick();
  const busy = ctx.render();
  assert.equal(busy.button.props.disabled, true);
  assert.match(busy.text, /저장 재시도 중…/);
  assert.deepEqual(ctx.attempts(), { salesAttempts: 1, commentAttempts: 1, persistenceAttempts: 1 });
  save.resolve();
  await tick();
  const finished = ctx.render();
  assert.equal(finished.button.props.disabled, false);
  assert.match(finished.text, /재시도를 마쳤습니다/);
  assert.match(finished.text, /저장 근거 확인이 필요한 판매 4건/);
  assert.doesNotMatch(finished.text, /저장 완료|저장 성공/);
});

test('comment retry failure remains explicit even when the sales retry clears its error', async () => {
  const comments = deferred();
  const ctx = fixture({ comments: () => comments.promise });
  ctx.render().button.props.onClick();
  ctx.setSyncError(null);
  comments.reject(new Error('offline'));
  await tick();
  const finished = ctx.render();
  assert.equal(finished.button.props.disabled, false);
  assert.match(finished.text, /일부 저장 재시도에 실패했습니다/);
  assert.doesNotMatch(finished.text, /재시도를 마쳤습니다/);
});

test('retry initiation failure restores the button and reports the failed attempt', async () => {
  const ctx = fixture({ persistence: () => { throw new Error('storage unavailable'); } });
  ctx.render().button.props.onClick();
  await tick();
  assert.equal(ctx.render().button.props.disabled, false);
  assert.match(ctx.render().text, /저장 재시도를 진행하지 못했습니다/);
});
