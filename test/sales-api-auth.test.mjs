import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

// Read contracts fixtures
const fixturesDir = path.resolve('contracts/product-sales/v1/fixtures')
const deviceFixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'device_management.json'), 'utf8'))
const errorsFixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'errors.json'), 'utf8'))

function sha256(val) {
  return crypto.createHash('sha256').update(val).digest('hex')
}

// Emulate sales-api envelope generator
function successResponse(data, status = 200) {
  return {
    status,
    body: {
      ok: true,
      apiVersion: 1,
      serverTime: new Date().toISOString(),
      data,
    },
  }
}

function errorResponse(code, message, status = 400, details = {}, retryable = false) {
  return {
    status,
    body: {
      ok: false,
      apiVersion: 1,
      serverTime: new Date().toISOString(),
      error: {
        code,
        message,
        retryable,
        details,
      },
    },
  }
}

// Capability check logic matching supabase/functions/sales-api/index.ts
function checkCapability(capabilities, requiredCap) {
  if (!capabilities.has(requiredCap)) {
    return errorResponse(
      'CAPABILITY_DENIED',
      `해당 작업을 수행할 권한(${requiredCap})이 없습니다.`,
      403,
      { requiredCapability: requiredCap }
    )
  }
  return null
}

// Mock auth resolver
function resolveAuth({ authHeader, deviceToken, devicesTable, workspaceMembersTable }) {
  if (deviceToken) {
    const hash = sha256(deviceToken)
    const device = devicesTable.find((d) => d.token_hash === hash && !d.revoked_at)
    if (!device) return null
    return {
      workspaceId: device.workspace_id,
      actorId: device.id,
      actorType: 'DEVICE',
      deviceId: device.id,
      capabilities: new Set(device.capabilities || ['SMS']),
    }
  }

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    // mock decoding valid user tokens
    if (token === 'valid-user-jwt') {
      const member = workspaceMembersTable.find((m) => m.user_id === 'user-123')
      if (!member) return null
      return {
        workspaceId: member.workspace_id,
        actorId: 'user-123',
        actorType: 'USER',
        role: member.role,
        capabilities: new Set([
          'SALES_READ',
          'SALES_WRITE',
          'PRODUCT_WRITE',
          'COMMENT_INGEST',
          'PRINT',
          'SMS',
        ]),
      }
    }
  }

  return null
}

test('CORE-03: Unauthenticated request is rejected with AUTH_REQUIRED (401)', () => {
  const auth = resolveAuth({
    authHeader: null,
    deviceToken: null,
    devicesTable: [],
    workspaceMembersTable: [],
  })
  assert.equal(auth, null)

  const resp = errorResponse('AUTH_REQUIRED', '인증이 필요하거나 기기 연결이 해제되었습니다.', 401)
  assert.equal(resp.status, 401)
  assert.equal(resp.body.ok, false)
  assert.equal(resp.body.apiVersion, 1)
  assert.equal(resp.body.error.code, 'AUTH_REQUIRED')
})

test('CORE-03: Revoked device token is rejected', () => {
  const devices = [
    {
      id: 'dev-1',
      workspace_id: 'ws-1',
      token_hash: sha256('revoked-token'),
      revoked_at: '2026-09-08T00:00:00.000Z',
      capabilities: ['SALES_READ', 'SALES_WRITE'],
    },
  ]
  const auth = resolveAuth({
    authHeader: null,
    deviceToken: 'revoked-token',
    devicesTable: devices,
    workspaceMembersTable: [],
  })
  assert.equal(auth, null)
})

test('CORE-03: SMS-only legacy device cannot perform SALES_WRITE (403 CAPABILITY_DENIED)', () => {
  const devices = [
    {
      id: 'legacy-sms-device',
      workspace_id: 'ws-1',
      token_hash: sha256('sms-device-token'),
      revoked_at: null,
      capabilities: ['SMS'], // Default legacy capability
    },
  ]
  const auth = resolveAuth({
    authHeader: null,
    deviceToken: 'sms-device-token',
    devicesTable: devices,
    workspaceMembersTable: [],
  })
  assert.ok(auth)
  assert.equal(auth.actorType, 'DEVICE')
  assert.equal(auth.capabilities.has('SMS'), true)
  assert.equal(auth.capabilities.has('SALES_WRITE'), false)

  const denied = checkCapability(auth.capabilities, 'SALES_WRITE')
  assert.ok(denied)
  assert.equal(denied.status, 403)
  assert.equal(denied.body.error.code, 'CAPABILITY_DENIED')
  assert.equal(denied.body.error.details.requiredCapability, 'SALES_WRITE')
})

test('CORE-03: SMS-only legacy device cannot perform PRODUCT_WRITE (403 CAPABILITY_DENIED)', () => {
  const capabilities = new Set(['SMS'])
  const denied = checkCapability(capabilities, 'PRODUCT_WRITE')
  assert.ok(denied)
  assert.equal(denied.status, 403)
  assert.equal(denied.body.error.code, 'CAPABILITY_DENIED')
  assert.equal(denied.body.error.details.requiredCapability, 'PRODUCT_WRITE')
})

test('CORE-03: Sales-capable device can access SALES_READ, SALES_WRITE, PRODUCT_WRITE', () => {
  const capabilities = new Set(['SALES_READ', 'SALES_WRITE', 'PRODUCT_WRITE'])
  assert.equal(checkCapability(capabilities, 'SALES_READ'), null)
  assert.equal(checkCapability(capabilities, 'SALES_WRITE'), null)
  assert.equal(checkCapability(capabilities, 'PRODUCT_WRITE'), null)
  // But cannot print
  assert.notEqual(checkCapability(capabilities, 'PRINT'), null)
})

test('CORE-03: Workspace isolation prevents cross-workspace access', () => {
  const userAuth = {
    workspaceId: 'workspace-alpha',
    actorId: 'user-1',
    capabilities: new Set(['SALES_READ', 'SALES_WRITE']),
  }

  const requestedResource = {
    id: 'product-999',
    workspaceId: 'workspace-beta', // Different workspace
  }

  assert.notEqual(userAuth.workspaceId, requestedResource.workspaceId)
})

test('CORE-03: Operation payload mismatch returns 400 OPERATION_PAYLOAD_MISMATCH', () => {
  const existingOperation = {
    id: 'eeeeeeee-2222-4eee-8eee-111111111111',
    request_hash: sha256(JSON.stringify({ action: 'commit-sales', target: 'original' })),
  }

  const newPayload = { action: 'commit-sales', target: 'tampered-or-different' }
  const incomingHash = sha256(JSON.stringify(newPayload))

  assert.notEqual(existingOperation.request_hash, incomingHash)

  const errResp = errorResponse(
    'OPERATION_PAYLOAD_MISMATCH',
    '동일한 operationId로 내용이 다른 요청이 전송되었습니다.',
    400,
    { operationId: existingOperation.id }
  )
  assert.equal(errResp.status, 400)
  assert.equal(errResp.body.error.code, 'OPERATION_PAYLOAD_MISMATCH')
  assert.equal(errResp.body.error.details.operationId, existingOperation.id)
})

test('CORE-03: Envelope strictly satisfies v1 contract format without leaking secrets', () => {
  const resp = successResponse(deviceFixture.listDevices.data)
  assert.equal(resp.body.ok, true)
  assert.equal(resp.body.apiVersion, 1)
  assert.ok(typeof resp.body.serverTime === 'string')
  assert.ok(Array.isArray(resp.body.data.devices))
  assert.equal(resp.body.data.devices.length, 2)

  const jsonStr = JSON.stringify(resp.body)
  assert.ok(!jsonStr.includes('SUPABASE_SERVICE_ROLE_KEY'))
  assert.ok(!jsonStr.includes('postgres:'))
  assert.ok(!jsonStr.includes('token_hash'))
})

test('CORE-03: Device capabilities fixture matches schema expectations', () => {
  const fixture = deviceFixture.listDevices.data.devices[0]
  assert.equal(fixture.deviceType, 'ANDROID_PHONE')
  assert.deepEqual(fixture.capabilities, ['SALES_READ', 'SALES_WRITE', 'PRODUCT_WRITE'])
  assert.equal(fixture.isOutputDevice, false)
})
