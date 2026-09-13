import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

test('Comment Helper: Types and interfaces integrity', () => {
  const typesPath = path.join(rootDir, 'src', 'types', 'helper.ts');
  assert.ok(fs.existsSync(typesPath), 'src/types/helper.ts must exist');

  const content = fs.readFileSync(typesPath, 'utf8');
  assert.ok(content.includes('export interface CommentHelperStatus'), 'Must export CommentHelperStatus');
  assert.ok(content.includes('export interface PrintSettings'), 'Must export PrintSettings');
  assert.ok(content.includes('export interface SttStatus'), 'Must export SttStatus');
  assert.ok(content.includes('export interface PrinterInfo'), 'Must export PrinterInfo');
  assert.ok(content.includes('export interface VoicecapNativeBridge'), 'Must export VoicecapNativeBridge');
  assert.ok(content.includes("'LABEL_50_30'"), 'PrintSettings paperSize must support LABEL_50_30 (50x30)');
  assert.ok(content.includes("'RECEIPT_80'"), 'PrintSettings paperSize must support RECEIPT_80 (80mm)');
  assert.ok(content.includes("'RECEIPT_58'"), 'PrintSettings paperSize must support RECEIPT_58 (58mm)');
  assert.ok(content.includes("'A4'"), 'PrintSettings paperSize must support A4');
});

test('Comment Helper: Service implementation and bridge support', () => {
  const servicePath = path.join(rootDir, 'src', 'services', 'commentHelperService.ts');
  assert.ok(fs.existsSync(servicePath), 'src/services/commentHelperService.ts must exist');

  const content = fs.readFileSync(servicePath, 'utf8');
  assert.ok(content.includes('export const commentHelperService'), 'Must export commentHelperService');
  assert.ok(content.includes('getStatus'), 'Must implement getStatus');
  assert.ok(content.includes('getPrinters'), 'Must implement getPrinters');
  assert.ok(content.includes('savePrintSettings'), 'Must implement savePrintSettings');
  assert.ok(content.includes('testPrint'), 'Must implement testPrint');
  assert.ok(content.includes('setSttDevice'), 'Must implement setSttDevice');
  assert.ok(content.includes('setAutoStart'), 'Must implement setAutoStart');
  assert.ok(content.includes('restartServer'), 'Must implement restartServer');
  assert.ok(content.includes('openHelperWindow'), 'Must implement openHelperWindow');
  assert.ok(content.includes('subscribeStatus'), 'Must implement subscribeStatus');
  // Check IPC and HTTP fallback
  assert.ok(content.includes('window.voicecap'), 'Must support window.voicecap Electron bridge');
  assert.ok(content.includes('127.0.0.1:2137'), 'Must support local HTTP fallback on port 2137');
});

test('Comment Helper: UI Modal and Standalone Page integrity', () => {
  const modalPath = path.join(rootDir, 'src', 'components', 'helper', 'CommentHelperModal.tsx');
  assert.ok(fs.existsSync(modalPath), 'CommentHelperModal.tsx must exist');

  const modalContent = fs.readFileSync(modalPath, 'utf8');
  assert.ok(modalContent.includes('CommentHelperModal'), 'Must export CommentHelperModal');
  assert.ok(
    modalContent.includes('handleTestPrint') || modalContent.includes('테스트 출력') || modalContent.includes('테스트 인쇄'),
    'Modal must have test print capability'
  );
  assert.ok(modalContent.includes('프린터'), 'Modal must have printer settings');
  assert.ok(modalContent.includes('하드웨어 가속') || modalContent.includes('STT'), 'Modal must have STT device selection');

  const pagePath = path.join(rootDir, 'src', 'pages', 'seller', 'CommentHelperPage.tsx');
  assert.ok(fs.existsSync(pagePath), 'CommentHelperPage.tsx must exist');

  const pageContent = fs.readFileSync(pagePath, 'utf8');
  assert.ok(pageContent.includes('CommentHelperPage'), 'Must export CommentHelperPage');
  assert.ok(pageContent.includes('commentHelperService'), 'Page must use commentHelperService');
});

test('Comment Helper: Routing and Navigation integration', () => {
  // App.tsx routes
  const appPath = path.join(rootDir, 'src', 'App.tsx');
  const appContent = fs.readFileSync(appPath, 'utf8');
  assert.ok(appContent.includes('CommentHelperPage'), 'App.tsx must import CommentHelperPage');
  assert.ok(appContent.includes('/seller/helper'), 'App.tsx must route /seller/helper');
  assert.ok(appContent.includes('/helper'), 'App.tsx must route /helper');

  // Sidebar navigation
  const sidebarPath = path.join(rootDir, 'src', 'components', 'common', 'Sidebar.tsx');
  const sidebarContent = fs.readFileSync(sidebarPath, 'utf8');
  assert.ok(sidebarContent.includes('/seller/helper'), 'Sidebar must include link to /seller/helper');
  assert.ok(sidebarContent.includes('댓글 도우미'), 'Sidebar must show Comment Helper label');

  // Header quick access
  const headerPath = path.join(rootDir, 'src', 'components', 'common', 'Header.tsx');
  const headerContent = fs.readFileSync(headerPath, 'utf8');
  assert.ok(headerContent.includes('CommentHelperModal'), 'Header must integrate CommentHelperModal');
  assert.ok(headerContent.includes('commentHelperService'), 'Header must check commentHelperService status');

  // LiveHomePage integration
  const liveHomePagePath = path.join(rootDir, 'src', 'pages', 'seller', 'LiveHomePage.tsx');
  const liveHomePageContent = fs.readFileSync(liveHomePagePath, 'utf8');
  assert.ok(liveHomePageContent.includes('CommentHelperModal'), 'LiveHomePage must include CommentHelperModal');

  // RecognitionRulesPage integration
  const rulesPath = path.join(rootDir, 'src', 'pages', 'seller', 'RecognitionRulesPage.tsx');
  const rulesContent = fs.readFileSync(rulesPath, 'utf8');
  assert.ok(rulesContent.includes('CommentHelperModal'), 'RecognitionRulesPage must include CommentHelperModal');
  assert.ok(rulesContent.includes('윈도우 앱 내장 댓글 도우미'), 'RecognitionRulesPage must display embedded helper info in desktop mode');
});
