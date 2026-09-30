import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as voiceSaleValidation from '../src/services/voiceSaleValidation.ts';

// Execute the application modules with a local Supabase stub; never connect to
// the real database or browser storage during these persistence checks.
function loadModule(relativePath, dependencies = {}) {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  });
  const module = { exports: {} };
  const execute = vm.runInThisContext(`(function(require, module, exports) {\n${outputText}\n})`, {
    filename: relativePath,
  });
  execute((name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}

const changesModule = loadModule('../src/services/commerceChanges.ts');
const { getCommerceChanges, hasCommerceChanges } = changesModule;

const emptyState = () => ({ messages: [], claims: [], invoices: [], payments: [], shipments: [], verifiedSaleIds: [] });
const timestamp = '2026-09-29T05:00:00.000Z';
const message = (id) => ({
  id, sellerId: 'workspace-1', phoneNumber: '01000000000', body: '구매 확인', direction: 'OUTGOING',
  category: 'QUESTION', status: 'QUEUED', saleIds: ['sale-1'], attachments: [], createdAt: timestamp,
});
const claim = (id) => ({
  id, messageId: 'message-1', phoneNumber: '01000000000', nickname: '구매자', address: '서울',
  productName: '상품', amount: 13000, captureImageUrls: [], saleIds: ['sale-1'], matchStatus: 'MATCHED',
  fieldMatches: { nickname: true, amount: true, capture: null }, sellerNote: '', createdAt: timestamp, updatedAt: timestamp,
});
const invoice = (id) => ({
  id, saleIds: ['sale-1'], customerNickname: '구매자', phoneNumber: '01000000000', address: '서울',
  amount: 13000, bankAccount: '은행 123', dueDate: '2026-10-01', status: 'DRAFT', createdAt: timestamp,
});
const payment = (id) => ({
  id, sellerId: 'workspace-1', payerName: '구매자', amount: 13000, paidAt: timestamp,
  saleIds: ['sale-1'], matchStatus: 'MATCHED', createdAt: timestamp,
});
const shipment = (id) => ({
  id, saleIds: ['sale-1'], recipientName: '구매자', phoneNumber: '01000000000', address: '서울',
  carrier: 'CJ대한통운', trackingNumber: '', status: 'READY', memo: '', createdAt: timestamp,
});
const populatedState = () => ({
  messages: [message('message-1'), message('message-2')], claims: [claim('claim-1'), claim('claim-2')],
  invoices: [invoice('invoice-1'), invoice('invoice-2')], payments: [payment('payment-1'), payment('payment-2')],
  shipments: [shipment('shipment-1'), shipment('shipment-2')], verifiedSaleIds: ['sale-1', 'sale-2'],
});

function createClient({ failingTable, verified = [] } = {}) {
  const calls = [];
  const verifiedIds = new Set(verified);
  const client = {
    from(table) {
      return {
        upsert(rows) {
          calls.push({ table, operation: 'upsert', rows });
          if (table === 'verified_sales') rows.forEach((row) => verifiedIds.add(row.sale_id));
          return Promise.resolve({ error: table === failingTable ? { message: 'write failed' } : null });
        },
        delete() {
          const filters = {};
          return {
            eq(column, value) { filters[column] = value; return this; },
            in(column, values) {
              filters[column] = values;
              calls.push({ table, operation: 'delete', filters });
              if (table === 'verified_sales') values.forEach((id) => verifiedIds.delete(id));
              return Promise.resolve({ error: null });
            },
          };
        },
        select() { throw new Error('A change save must not read the full table'); },
      };
    },
    storage: {
      from() {
        return { upload() { throw new Error('Unchanged images must not upload again'); } };
      },
    },
  };
  return { client, calls, verifiedIds };
}

function remoteService(client) {
  return loadModule('../src/services/remoteWorkspaceService.ts', {
    './supabaseClient': { isSupabaseConfigured: true, requireSupabase: () => client },
    './commerceChanges': changesModule,
    './sttVocabularyService': { normalizeSttVocabulary: (words) => words },
    './voiceSaleValidation': voiceSaleValidation,
  }).remoteWorkspaceService;
}

test('unchanged and reconstructed commerce data produce zero Supabase requests', async () => {
  const previous = populatedState();
  const next = JSON.parse(JSON.stringify(previous));
  next.messages.reverse();
  next.verifiedSaleIds.reverse();
  next.claims[0].fieldMatches = { capture: null, amount: true, nickname: true };
  next.messages[0].error = undefined;
  const { client, calls } = createClient();
  const changes = getCommerceChanges(previous, next);
  assert.equal(hasCommerceChanges(changes), false);
  await remoteService(client).saveCommerceChanges('workspace-1', changes);
  assert.deepEqual(calls, []);
});

test('editing one shipment saves exactly that row and leaves every other table alone', async () => {
  const previous = populatedState();
  const next = { ...previous, shipments: previous.shipments.map((row) => row.id === 'shipment-2'
    ? { ...row, trackingNumber: '123456', status: 'SHIPPED', shippedAt: timestamp }
    : row) };
  const { client, calls } = createClient();
  await remoteService(client).saveCommerceChanges('workspace-1', getCommerceChanges(previous, next));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].table, 'shipments');
  assert.equal(calls[0].rows.length, 1);
  assert.equal(calls[0].rows[0].id, 'shipment-2');
  assert.equal(calls[0].rows[0].workspace_id, 'workspace-1');
  assert.equal(calls[0].rows[0].tracking_number, '123456');
  assert.equal(calls[0].rows[0].status, 'SHIPPED');
});

test('message, claim, invoice and payment updates each write only their changed row', async (t) => {
  for (const [key, table, field, value, column] of [
    ['messages', 'customer_messages', 'body', '새 질문', 'body'],
    ['claims', 'purchase_claims', 'sellerNote', '주소 확인', 'seller_note'],
    ['invoices', 'invoices', 'status', 'CANCELLED', 'status'],
    ['payments', 'payment_receipts', 'memo', '입금 확인', 'memo'],
  ]) {
    await t.test(key, async () => {
      const previous = populatedState();
      const next = { ...previous, [key]: previous[key].map((row, index) => index === 0 ? { ...row, [field]: value } : row) };
      const { client, calls } = createClient();
      await remoteService(client).saveCommerceChanges('workspace-1', getCommerceChanges(previous, next));
      assert.equal(calls.length, 1);
      assert.equal(calls[0].table, table);
      assert.equal(calls[0].rows.length, 1);
      assert.equal(calls[0].rows[0].id, previous[key][0].id);
      assert.equal(calls[0].rows[0][column], value);
    });
  }
});

test('new messages and invoices retain the fields needed by SMS and invoice workflows', async () => {
  const previous = populatedState();
  const newMessage = { ...message('message-3'), category: 'INVOICE' };
  const newInvoice = { ...invoice('invoice-3'), smsMessageId: 'message-3', status: 'QUEUED', sentAt: timestamp };
  const next = { ...previous, messages: [...previous.messages, newMessage], invoices: [...previous.invoices, newInvoice] };
  const { client, calls } = createClient();
  await remoteService(client).saveCommerceChanges('workspace-1', getCommerceChanges(previous, next));
  assert.deepEqual(calls.map((call) => [call.table, call.rows.map((row) => row.id)]), [
    ['customer_messages', ['message-3']], ['invoices', ['invoice-3']],
  ]);
  assert.equal(calls[1].rows[0].sms_message_id, 'message-3');
  assert.equal(calls[1].rows[0].status, 'QUEUED');
  assert.equal(calls[1].rows[0].sent_at, timestamp);
});

test('verification changes affect only explicitly toggled sale IDs, preserving another device', async () => {
  const previous = { ...emptyState(), verifiedSaleIds: ['sale-1', 'sale-2'] };
  const next = { ...previous, verifiedSaleIds: ['sale-2', 'sale-3'] };
  const { client, calls, verifiedIds } = createClient({ verified: ['sale-1', 'sale-2', 'other-device-sale'] });
  await remoteService(client).saveCommerceChanges('workspace-1', getCommerceChanges(previous, next));
  assert.deepEqual(calls, [
    { table: 'verified_sales', operation: 'upsert', rows: [{ workspace_id: 'workspace-1', sale_id: 'sale-3' }] },
    { table: 'verified_sales', operation: 'delete', filters: { workspace_id: 'workspace-1', sale_id: ['sale-1'] } },
  ]);
  assert.deepEqual([...verifiedIds].sort(), ['other-device-sale', 'sale-2', 'sale-3']);
});

test('changing verification or shipment does not process a claim image again', async () => {
  const previous = populatedState();
  previous.claims[0].captureImageUrls = ['data:image/png;base64,unchanged'];
  const next = { ...previous, verifiedSaleIds: [...previous.verifiedSaleIds, 'sale-3'] };
  const { client, calls } = createClient();
  await remoteService(client).saveCommerceChanges('workspace-1', getCommerceChanges(previous, next));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].table, 'verified_sales');
});

test('claim text edits retain the canonical storage path rather than the signed URL', async () => {
  const previous = populatedState();
  previous.claims[0].captureImageUrls = ['https://storage.example/image?token=temporary'];
  previous.claims[0].__voicecapStoragePaths = ['workspace-1/claims/claim-1/image.png'];
  const next = { ...previous, claims: previous.claims.map((row, index) => index === 0 ? { ...row, address: '부산' } : row) };
  const { client, calls } = createClient();
  await remoteService(client).saveCommerceChanges('workspace-1', getCommerceChanges(previous, next));
  assert.deepEqual(calls[0].rows[0].capture_image_paths, ['workspace-1/claims/claim-1/image.png']);
});

test('failed database writes still reject instead of reporting successful persistence', async () => {
  const next = { ...emptyState(), shipments: [shipment('shipment-1')] };
  const { client } = createClient({ failingTable: 'shipments' });
  await assert.rejects(remoteService(client).saveCommerceChanges('workspace-1', getCommerceChanges(emptyState(), next)),
    (error) => error.message === 'write failed');
});

function readyProvider(initial, save = async () => {}) {
  const localSaves = [];
  const stateUpdates = [];
  let stateIndex = 0;
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    createElement: (_type, props) => ({ props }),
    useRef: (current) => ({ current }),
    useCallback: (callback) => callback,
    useMemo: (factory) => factory(),
    useEffect: () => {},
    useState(initializer) {
      const index = stateIndex++;
      let value = typeof initializer === 'function' ? initializer() : initializer;
      // This fixture represents the provider after its initial remote load.
      if (index === 4) value = true;
      return [value, (update) => {
        if (typeof update === 'function') {
          update(value); // React may replay a functional updater in StrictMode.
          value = update(value);
        } else value = update;
        if (index === 0) stateUpdates.push(value);
      }];
    },
  };
  const { CommerceProvider } = loadModule('../src/context/CommerceContext.tsx', {
    react: { ...react, default: react },
    './AuthContext': { useAuth: () => ({ user: { id: 'user-1' }, workspaceId: 'workspace-1', isRemoteAuth: true }) },
    './SalesContext': { useSales: () => ({ sales: [{ id: 'sale-1', buyerNickname: '구매자', amount: 13000 }] }) },
    '../services/customerMessageParser': loadModule('../src/services/customerMessageParser.ts'),
    '../services/smsBridgeService': { smsBridgeService: { getConfig: () => ({ sellerId: 'workspace-1' }) } },
    '../services/storageService': { storageService: {
      getCommerceState: () => initial, saveCommerceState: (state) => localSaves.push(state),
    } },
    '../services/remoteWorkspaceService': { remoteWorkspaceService: { saveCommerceChanges: save } },
    '../services/commerceChanges': changesModule,
  });
  const value = CommerceProvider({ children: null }).props.value;
  return { value, localSaves, stateUpdates };
}

test('provider no-op actions skip both local persistence and remote persistence', async () => {
  const initial = populatedState();
  const remoteSaves = [];
  const { value, localSaves, stateUpdates } = readyProvider(initial, async (...args) => remoteSaves.push(args));
  value.setVerified(['sale-1'], true);
  value.setVerified(['never-verified'], false);
  value.updateShipment({ ...initial.shipments[0] });
  value.updateClaim(JSON.parse(JSON.stringify(initial.claims[0])));
  await new Promise(setImmediate);
  assert.deepEqual(remoteSaves, []);
  assert.deepEqual(localSaves, []);
  assert.deepEqual(stateUpdates, []);
});

test('provider saves an actual action once even when React replays functional updaters', async () => {
  const remoteSaves = [];
  const { value, localSaves } = readyProvider(populatedState(), async (...args) => remoteSaves.push(args));
  value.setVerified(['sale-3'], true);
  await new Promise(setImmediate);
  assert.equal(localSaves.length, 1);
  assert.equal(remoteSaves.length, 1);
  assert.equal(remoteSaves[0][0], 'workspace-1');
  assert.deepEqual(remoteSaves[0][1].verifiedSaleIdsToAdd, ['sale-3']);
});

test('rapid verify/unverify remains immediate in the UI and persists in user action order', async () => {
  let releaseFirstSave;
  const firstSave = new Promise((resolve) => { releaseFirstSave = resolve; });
  const remoteSaves = [];
  const { value, stateUpdates } = readyProvider(populatedState(), async (_workspace, changes) => {
    remoteSaves.push(changes);
    if (remoteSaves.length === 1) await firstSave;
  });
  value.setVerified(['sale-3'], true);
  value.setVerified(['sale-3'], false);
  assert.equal(stateUpdates.length, 2);
  assert.equal(stateUpdates[1].verifiedSaleIds.includes('sale-3'), false);
  await new Promise(setImmediate);
  assert.equal(remoteSaves.length, 1, 'The unverify request waits for the verify request');
  releaseFirstSave();
  await new Promise(setImmediate);
  assert.equal(remoteSaves.length, 2);
  assert.deepEqual(remoteSaves[0].verifiedSaleIdsToAdd, ['sale-3']);
  assert.deepEqual(remoteSaves[1].verifiedSaleIdsToRemove, ['sale-3']);
});

test('sending an invoice persists the message before updating its invoice reference', async () => {
  const remoteSaves = [];
  const { value } = readyProvider(populatedState(), async (_workspace, changes) => remoteSaves.push(changes));
  const queuedMessage = await value.sendInvoice('invoice-1');
  await new Promise(setImmediate);
  assert.equal(remoteSaves.length, 2);
  assert.equal(remoteSaves[0].messages.length, 1);
  assert.equal(remoteSaves[0].messages[0].id, queuedMessage.id);
  assert.equal(remoteSaves[1].invoices.length, 1);
  assert.equal(remoteSaves[1].invoices[0].smsMessageId, queuedMessage.id);
  assert.equal(remoteSaves[1].invoices[0].status, 'QUEUED');
  assert.equal(remoteSaves[1].messages.length, 0);
});
