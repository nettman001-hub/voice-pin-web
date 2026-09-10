import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

test('Comment Helper Download: version and URL configuration integrity', () => {
  const commentTypesPath = path.join(rootDir, 'src', 'types', 'comment.ts');
  const commentTypesContent = fs.readFileSync(commentTypesPath, 'utf8');

  const desktopPkgPath = path.join(rootDir, 'desktop', 'comment-helper', 'package.json');
  const desktopPkg = JSON.parse(fs.readFileSync(desktopPkgPath, 'utf8'));

  // 1. Must export COMMENT_HELPER_VERSION matching desktop package.json
  assert.match(
    commentTypesContent,
    new RegExp(`export const COMMENT_HELPER_VERSION = ['"]${desktopPkg.version}['"]`),
    `COMMENT_HELPER_VERSION in comment.ts should match desktop package.json version ${desktopPkg.version}`
  );

  // 2. Must not use releases/latest/download/ which causes 404 when other platform releases exist
  assert.doesNotMatch(
    commentTypesContent,
    /releases\/latest\/download\//,
    'COMMENT_HELPER_DOWNLOAD_URL must not use releases/latest/download/ as it causes 404'
  );

  // 3. Must point to exact version tag download URL for VoiceCAP-Comment-Helper-Setup.exe
  const expectedUrl = `https://github.com/nettman001-hub/voice-pin-web/releases/download/comment-helper-v${desktopPkg.version}/VoiceCAP-Comment-Helper-Setup.exe`;
  assert.ok(
    commentTypesContent.includes(expectedUrl),
    `COMMENT_HELPER_DOWNLOAD_URL must include ${expectedUrl}`
  );
});

test('Comment Helper Download: UI components use COMMENT_HELPER_DOWNLOAD_URL', () => {
  const liveHomePagePath = path.join(rootDir, 'src', 'pages', 'seller', 'LiveHomePage.tsx');
  const liveHomePageContent = fs.readFileSync(liveHomePagePath, 'utf8');

  assert.ok(
    liveHomePageContent.includes('COMMENT_HELPER_DOWNLOAD_URL'),
    'LiveHomePage.tsx must import and use COMMENT_HELPER_DOWNLOAD_URL'
  );
  assert.doesNotMatch(
    liveHomePageContent,
    /<a\s+[^>]*href="https:\/\/github\.com\/nettman001-hub\/voice-pin-web\/releases"/,
    'LiveHomePage.tsx should not use generic releases list for download button'
  );

  const recognitionRulesPath = path.join(rootDir, 'src', 'pages', 'seller', 'RecognitionRulesPage.tsx');
  const recognitionRulesContent = fs.readFileSync(recognitionRulesPath, 'utf8');

  assert.ok(
    recognitionRulesContent.includes('href={COMMENT_HELPER_DOWNLOAD_URL}'),
    'RecognitionRulesPage.tsx must use COMMENT_HELPER_DOWNLOAD_URL for download link'
  );
});
