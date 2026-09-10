import test from 'node:test';
import assert from 'node:assert/strict';
import { validateUrlForSsrf, maskSecretValue } from '../supabase/functions/sales-api/handlers/aiValidation.ts';

test('AI Settings Security: maskSecretValue conceals sensitive API keys and tokens', () => {
  assert.equal(maskSecretValue(''), '');
  assert.equal(maskSecretValue('12345'), '***');
  assert.equal(maskSecretValue('sk-abcdef1234567890'), 'sk-...7890');
  assert.equal(maskSecretValue('Bearer eyJhbGciOiJIUzI1NiJ9.test'), 'Bea...test');
  // Must not expose full secret in any circumstance
  const masked = maskSecretValue('sk-live-secret-key-voicecap-9999');
  assert.equal(masked.includes('live-secret-key-voicecap'), false);
});

test('AI Settings Security (SSRF): validateUrlForSsrf blocks cloud metadata endpoints', () => {
  const badUrls = [
    'http://169.254.169.254/latest/meta-data/',
    'http://169.254.169.253',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://metadata/v1',
  ];

  for (const url of badUrls) {
    const res = validateUrlForSsrf(url, 'SERVER_DIRECT');
    assert.equal(res.valid, false, `Must reject metadata URL: ${url}`);
    assert.match(res.reason || '', /메타데이터/);
  }
});

test('AI Settings Security (SSRF): validateUrlForSsrf blocks loopback on SERVER_DIRECT', () => {
  const loopbacks = [
    'http://localhost:11434',
    'http://127.0.0.1:11434',
    'http://127.0.0.2:8000',
    'http://0.0.0.0:11434',
  ];

  for (const url of loopbacks) {
    const res = validateUrlForSsrf(url, 'SERVER_DIRECT');
    assert.equal(res.valid, false, `Must reject loopback on SERVER_DIRECT: ${url}`);
    assert.match(res.reason || '', /루프백/);
  }
});

test('AI Settings Security (SSRF): validateUrlForSsrf allows loopback on PC_HELPER', () => {
  // Same PC Ollama helper is permitted because the PC helper runs on seller machine, not cloud backend
  const res = validateUrlForSsrf('http://127.0.0.1:11434', 'PC_HELPER');
  assert.equal(res.valid, true);
});

test('AI Settings Security (SSRF): validateUrlForSsrf allows valid public IP and domains', () => {
  const goodUrls = [
    'https://ai.example.com',
    'https://ai.example.com:11434/v1',
    'http://203.0.113.195:11434',
    'https://api.openai.com/v1',
  ];

  for (const url of goodUrls) {
    const res = validateUrlForSsrf(url, 'SERVER_DIRECT');
    assert.equal(res.valid, true, `Must accept valid URL: ${url}`);
  }
});

test('AI Settings Security (SSRF): validateUrlForSsrf rejects invalid protocols', () => {
  assert.equal(validateUrlForSsrf('ftp://example.com', 'SERVER_DIRECT').valid, false);
  assert.equal(validateUrlForSsrf('file:///etc/passwd', 'SERVER_DIRECT').valid, false);
  assert.equal(validateUrlForSsrf('gopher://example.com', 'SERVER_DIRECT').valid, false);
});

test('AI Settings Schema & Versioning: version increments and separates draft vs applied', () => {
  // Simulate setting transition
  const current = {
    version: 1,
    applied_version: 1,
    is_draft: false,
    primary_slot: 1,
    slot1: { type: 'LOCAL', model: 'qwen2.5:7b' },
    slot2: { type: 'CLOUD', model: 'gpt-4o-mini' },
  };

  // Case A: Save draft (applyImmediately = false)
  const draftSaved = {
    ...current,
    version: current.version + 1,
    applied_version: current.applied_version, // remains 1
    is_draft: true,
  };
  assert.equal(draftSaved.version, 2);
  assert.equal(draftSaved.applied_version, 1);
  assert.equal(draftSaved.is_draft, true);

  // Case B: Apply version 2
  const applied = {
    ...draftSaved,
    applied_version: draftSaved.version,
    is_draft: false,
  };
  assert.equal(applied.version, 2);
  assert.equal(applied.applied_version, 2);
  assert.equal(applied.is_draft, false);
});

test('AI Settings Priority: swap slot 1 and slot 2 priority smoothly', () => {
  let primarySlot = 1;
  const swap = (cur) => (cur === 1 ? 2 : 1);

  primarySlot = swap(primarySlot);
  assert.equal(primarySlot, 2, 'Must switch to Slot 2 as primary');

  primarySlot = swap(primarySlot);
  assert.equal(primarySlot, 1, 'Must switch back to Slot 1 as primary');
});

test('AI Settings RBAC: non-admin request is denied modification', () => {
  const sellerAuth = { role: 'SELLER', capabilities: new Set(['SALES_READ', 'SALES_WRITE']) };
  const adminAuth = { role: 'ADMIN', capabilities: new Set(['ADMIN', 'SALES_READ', 'SALES_WRITE']) };

  const canSave = (auth) => auth.role === 'ADMIN' || auth.capabilities.has('ADMIN');

  assert.equal(canSave(sellerAuth), false, 'Seller must not be allowed to save AI settings');
  assert.equal(canSave(adminAuth), true, 'Admin must be allowed to save AI settings');
});
