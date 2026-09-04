const test = require('node:test');
const assert = require('node:assert/strict');
const { sttBridge } = require('../sttBridge');

test('sttBridge exposes initial status and manages worker lifecycle', async (t) => {
  const status = sttBridge.getStatus();
  assert.ok(typeof status === 'object', 'status is an object');
  assert.ok('state' in status, 'status has state property');
  assert.ok('model' in status, 'status has model property');
  assert.ok('requestedModel' in status, 'status has requestedModel property');
  assert.ok('device' in status, 'status has device property');
  assert.ok('pythonPath' in status, 'status has pythonPath property');

  // 1. worker message handler works safely with malformed JSON
  sttBridge.handleWorkerMessage('invalid json line');
  assert.notEqual(sttBridge.getStatus().state, 'CRASHED');

  // 2. worker error event propagates state='ERROR' and error details
  sttBridge.handleWorkerMessage(JSON.stringify({
    event: 'error',
    error_code: 'MODEL_LOAD_FAILED',
    message: '모델 로딩 실패: out of memory'
  }));
  const errStatus = sttBridge.getStatus();
  assert.equal(errStatus.state, 'ERROR');
  assert.equal(errStatus.error, '모델 로딩 실패: out of memory');

  // 3. worker status event with READY recovers state and clears error
  sttBridge.handleWorkerMessage(JSON.stringify({
    event: 'status',
    state: 'READY',
    model: 'base',
    device: 'cpu',
    compute_type: 'int8',
    message: '테스트 준비 완료'
  }));

  const readyStatus = sttBridge.getStatus();
  assert.equal(readyStatus.state, 'READY');
  assert.equal(readyStatus.error, null);
  assert.equal(readyStatus.model, 'base');
  assert.equal(readyStatus.device, 'cpu');
  assert.equal(readyStatus.computeType, 'int8');

  // 4. listening_started & listening_stopped state transitions
  sttBridge.handleWorkerMessage(JSON.stringify({
    event: 'listening_started',
    session_id: 'test-sess-123',
    generation: 2,
    model: 'base',
    device: 'cpu',
    compute_type: 'int8'
  }));
  const listeningStatus = sttBridge.getStatus();
  assert.equal(listeningStatus.state, 'LISTENING');
  assert.equal(listeningStatus.activeSessionId, 'test-sess-123');
  assert.equal(listeningStatus.activeGeneration, 2);

  sttBridge.handleWorkerMessage(JSON.stringify({
    event: 'listening_stopped',
    session_id: 'test-sess-123'
  }));
  const stoppedStatus = sttBridge.getStatus();
  assert.equal(stoppedStatus.state, 'READY');
  assert.equal(stoppedStatus.activeSessionId, '');
});
