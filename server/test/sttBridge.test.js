const test = require('node:test');
const assert = require('node:assert/strict');
const { sttBridge } = require('../sttBridge');

test('sttBridge exposes initial status and manages worker lifecycle', async (t) => {
  const status = sttBridge.getStatus();
  assert.ok(typeof status === 'object', 'status is an object');
  assert.ok('state' in status, 'status has state property');
  assert.ok('model' in status, 'status has model property');
  assert.ok('device' in status, 'status has device property');
  assert.ok('pythonPath' in status, 'status has pythonPath property');

  // worker message handler works safely with malformed JSON
  sttBridge.handleWorkerMessage('invalid json line');
  assert.notEqual(sttBridge.getStatus().state, 'CRASHED');

  // worker message handler updates model/device on valid status event
  sttBridge.handleWorkerMessage(JSON.stringify({
    event: 'status',
    state: 'READY',
    model: 'base',
    device: 'cpu',
    compute_type: 'int8',
    message: '테스트 준비 완료'
  }));

  const updated = sttBridge.getStatus();
  assert.equal(updated.state, 'READY');
  assert.equal(updated.model, 'base');
  assert.equal(updated.device, 'cpu');
  assert.equal(updated.computeType, 'int8');
});
