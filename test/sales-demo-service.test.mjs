import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

test('Sales Demo Service: File existence and API structure', () => {
  const servicePath = path.join(rootDir, 'src', 'services', 'salesDemoService.ts');
  assert.ok(fs.existsSync(servicePath), 'src/services/salesDemoService.ts must exist');

  const content = fs.readFileSync(servicePath, 'utf8');
  assert.ok(content.includes('export interface SalesDemoCallbacks'), 'Must export SalesDemoCallbacks');
  assert.ok(content.includes('export const salesDemoService'), 'Must export salesDemoService instance');
  assert.ok(content.includes('start('), 'Must provide start method');
  assert.ok(content.includes('stop('), 'Must provide stop method');
  assert.ok(content.includes('isRunning('), 'Must provide isRunning method');
  assert.ok(content.includes('getElapsedSeconds('), 'Must provide getElapsedSeconds method');
});

test('Sales Demo Service: Scenario steps coverage', () => {
  const servicePath = path.join(rootDir, 'src', 'services', 'salesDemoService.ts');
  const content = fs.readFileSync(servicePath, 'utf8');

  // 핵심 시나리오 발화 및 액션 검증
  assert.ok(content.includes('초코송이'), 'Scenario 1 must include buyer 초코송이');
  assert.ok(content.includes('35,000원') || content.includes('35000'), 'Scenario 1 must include amount 35000');
  assert.ok(content.includes('동대문언니'), 'Scenario 2 must include buyer 동대문언니');
  assert.ok(content.includes('민지맘'), 'Scenario 3 (correction) must include replacement buyer 민지맘');
  assert.ok(content.includes('아니고') && content.includes('변경'), 'Scenario 3 must demonstrate correction keywords');
  assert.ok(content.includes('러블리'), 'Scenario 4 must include buyer 러블리');
  assert.ok(content.includes('별빛천사'), 'Scenario 5 must include buyer 별빛천사');
  assert.ok(content.includes('PRINTED'), 'Must simulate print completion status');
  assert.ok(content.includes('QUEUED'), 'Must simulate print queued status');
});

test('LiveHomePage: Demo button and banner integration', () => {
  const pagePath = path.join(rootDir, 'src', 'pages', 'seller', 'LiveHomePage.tsx');
  assert.ok(fs.existsSync(pagePath), 'LiveHomePage.tsx must exist');

  const content = fs.readFileSync(pagePath, 'utf8');
  assert.ok(content.includes('salesDemoService'), 'Must import salesDemoService');
  assert.ok(content.includes('isDemoActive'), 'Must manage isDemoActive state');
  assert.ok(content.includes('handleToggleDemo'), 'Must have handleToggleDemo handler');
  assert.ok(content.includes('데모 시작'), 'Must render demo start button');
  assert.ok(content.includes('데모 중지'), 'Must render demo stop button');
  assert.ok(content.includes('영업 시연용 실시간 데모'), 'Must display sales demo banner when active');
  assert.ok(content.includes('effectiveWaveform'), 'Must route waveform through demo/live selector');
  assert.ok(content.includes('effectiveComments'), 'Must route comments through demo/live selector');
  assert.ok(content.includes('effectiveSessionSales'), 'Must route sales through demo/live selector');
});
