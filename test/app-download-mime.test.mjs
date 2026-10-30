import assert from 'node:assert/strict';
import test from 'node:test';
import { imageMimeOf } from '../src/services/appDownload.ts';

const bytes = (...b) => new Uint8Array([...b, ...new Array(12).fill(0)].slice(0, 12));

test('형식이 적혀 있으면 사진 형식만 받는다', () => {
  assert.equal(imageMimeOf('image/jpeg', bytes()), 'image/jpeg');
  assert.equal(imageMimeOf('text/html', bytes(0x89, 0x50, 0x4e, 0x47)), null);
});

test('형식이 비어 있으면 파일 앞부분으로 사진인지 본다(오류 HTML은 저장하지 않는다)', () => {
  assert.equal(imageMimeOf('', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a)), 'image/png');
  assert.equal(imageMimeOf('', bytes(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg');
  assert.equal(imageMimeOf('', bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)), 'image/gif');
  assert.equal(imageMimeOf('', bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)), 'image/webp');
  assert.equal(imageMimeOf('', new TextEncoder().encode('<!doctype html>')), null);
  assert.equal(imageMimeOf('', new Uint8Array()), null);
});
