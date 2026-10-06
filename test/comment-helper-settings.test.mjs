import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function renderFixture(relativePath, imports) {
  const hooks = [];
  let hookIndex = 0;
  const react = {
    createElement(type, props, ...children) {
      return { type, props: { ...props, children } };
    },
    useState(initial) {
      const index = hookIndex++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], (next) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }];
    },
    useEffect() {},
  };
  const icon = () => null;
  const iconImports = new Proxy({}, { get: () => icon });
  const modules = {
    react: { __esModule: true, default: react, ...react },
    'react-router-dom': { Link: 'a' },
    'lucide-react': iconImports,
    ...imports,
  };
  const source = fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (id) => {
      assert.ok(id in modules, `Unexpected import: ${id}`);
      return modules[id];
    },
    document: { body: {} },
    console,
  }, { filename: relativePath });
  return {
    exports,
    render(name, props = {}) {
      hookIndex = 0;
      return exports[name](props);
    },
  };
}

function visit(tree, visitor) {
  if (Array.isArray(tree)) return tree.forEach((child) => visit(child, visitor));
  if (tree === null || tree === undefined || typeof tree === 'boolean') return;
  visitor(tree);
  if (typeof tree === 'object') visit(tree.props?.children, visitor);
}

function visibleText(tree) {
  const parts = [];
  visit(tree, (node) => {
    if (typeof node === 'string' || typeof node === 'number') parts.push(String(node));
  });
  return parts.join(' ');
}

function byId(tree, id) {
  let found;
  visit(tree, (node) => {
    if (node?.props?.id === id) found = node;
  });
  assert.ok(found, `Missing element #${id}`);
  return found;
}

function buttonWithText(tree, label) {
  let found;
  visit(tree, (node) => {
    if (node?.type === 'button' && visibleText(node).includes(label)) found = node;
  });
  assert.ok(found, `Missing button: ${label}`);
  return found;
}

test('comment settings moved into the helper page, in operational order', () => {
  const fixture = renderFixture('src/pages/seller/CommentHelperPage.tsx', {
    '../../context/AuthContext': { useAuth: () => ({ user: { role: '판매자' } }) },
    '../../components/helper/CommentCaptureSettings': { CommentCaptureSettings: () => null },
    '../../services/commentHelperService': { commentHelperService: {} },
  });
  const tree = fixture.render('CommentHelperPage');
  // The imported component is a separate section between status and printing.
  const children = tree.props.children.flat(Infinity).filter((child) => child && typeof child === 'object');
  const positions = children.map((child) => child.props?.id || (typeof child.type === 'function' ? 'comment-capture-settings' : ''));
  assert.deepEqual(positions.filter(Boolean), [
    'helper-status', 'comment-capture-settings', 'helper-print-settings', 'helper-system-settings',
  ]);
  assert.ok(visibleText(tree).includes('댓글/판매멘트 기록'));
  assert.ok(!visibleText(tree).includes('STT'));
  assert.ok(!visibleText(tree).includes('하드웨어 가속'));
});

test('STT hardware controls appear only for administrators in page and quick settings', () => {
  for (const [filename, exportName, props] of [
    ['src/pages/seller/CommentHelperPage.tsx', 'CommentHelperPage', {}],
    ['src/components/helper/CommentHelperModal.tsx', 'CommentHelperModal', { isOpen: true, onClose() {} }],
  ]) {
    let role = '판매자';
    const fixture = renderFixture(filename, {
      '../../context/AuthContext': { useAuth: () => ({ user: { role } }) },
      '../../components/helper/CommentCaptureSettings': { CommentCaptureSettings: () => null },
      '../../services/commentHelperService': { commentHelperService: {} },
      'react-dom': { createPortal: (tree) => tree },
    });
    const sellerText = visibleText(fixture.render(exportName, props));
    assert.ok(!sellerText.includes('STT'), `${filename} leaked STT to seller`);
    assert.ok(!sellerText.includes('하드웨어 가속'), `${filename} leaked hardware setting to seller`);
    role = '관리자';
    const adminText = visibleText(fixture.render(exportName, props));
    assert.ok(adminText.includes('음성인식(STT) 하드웨어 가속'), `${filename} lost admin controls`);
  }
});

test('moved comment capture controls retain normalization, save, and start/stop behavior', () => {
  const saved = [];
  let started = 0;
  let stopped = 0;
  let isActive = false;
  const config = {
    tiktokUsername: 'old_shop', serverUrl: 'http://127.0.0.1:2137',
    alertWords: ['저요'], alertDurationSec: 15, alertVoiceCommand: '닫아',
  };
  const fixture = renderFixture('src/components/helper/CommentCaptureSettings.tsx', {
    '../../context/CommentCaptureContext': {
      useCommentCapture: () => ({
        config, saveConfig: (value) => saved.push(value), isActive, isRunning: false,
        serverStatus: 'CONNECTED', serverMessage: '', newCount: 4,
        startCapture: () => { started++; }, stopCapture: () => { stopped++; },
      }),
      getCommentStatusBadge: () => ({ label: '연결됨' }),
    },
    '../../types/comment': {
      DEFAULT_COMMENT_SERVER_URL: 'http://127.0.0.1:2137',
      COMMENT_HELPER_DOWNLOAD_URL: 'https://example.com/helper',
    },
  });
  const render = () => fixture.render('CommentCaptureSettings');
  buttonWithText(render(), '댓글 수집 시작').props.onClick();
  assert.equal(started, 1);
  isActive = true;
  buttonWithText(render(), '댓글 수집 정지').props.onClick();
  assert.equal(stopped, 1);

  byId(render(), 'comment-helper-tiktok-id').props.onChange({ target: { value: '@new_shop' } });
  byId(render(), 'comment-helper-alert-words').props.onChange({ target: { value: ' 저요, 구매, ' } });
  byId(render(), 'comment-helper-alert-duration').props.onChange({ target: { value: '1' } });
  byId(render(), 'comment-helper-alert-command').props.onChange({ target: { value: '닫아, 닫아, 알림 닫기' } });
  assert.equal(byId(render(), 'comment-helper-alert-command').props.value, '닫아, 닫아, 알림 닫기');
  buttonWithText(render(), '댓글 수집·알림 설정 저장').props.onClick();
  assert.equal(saved.length, 1);
  assert.equal(JSON.stringify(saved[0]), JSON.stringify({
    tiktokUsername: 'new_shop', serverUrl: 'http://127.0.0.1:2137',
    alertWords: ['저요', '구매'], alertDurationSec: 3, alertVoiceCommand: '닫아, 알림 닫기',
  }));
});
