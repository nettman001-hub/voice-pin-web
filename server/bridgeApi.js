const express = require('express');

const clampLimit = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(2000, parsed)) : fallback;
};

const validateIdentity = (payload) => {
  if (!String(payload.sellerId || '').trim()) return 'sellerId가 필요합니다.';
  return null;
};

function createBridgeRouter({ store, apiKey, onEvent = () => {} }) {
  const router = express.Router();

  router.use((req, res, next) => {
    if (!apiKey) return next();
    if (String(req.headers['x-voicecap-key'] || '') !== apiKey) {
      return res.status(401).json({ ok: false, error: 'voicecapSMS API 키가 올바르지 않습니다.' });
    }
    next();
  });

  router.get('/bridge/status', (_req, res) => {
    res.json({
      ok: true,
      service: 'voicecap-sms-bridge',
      authenticationEnabled: Boolean(apiKey),
      queuedMessages: store.listOutbox('', 2000).length
    });
  });

  router.get('/sms/messages', (req, res) => {
    const sellerId = String(req.query.sellerId || '').trim();
    if (!sellerId) return res.status(400).json({ ok: false, error: 'sellerId가 필요합니다.' });
    res.json({ ok: true, messages: store.listMessages(sellerId, clampLimit(req.query.limit, 1000)) });
  });

  router.post('/sms/incoming', (req, res) => {
    const payload = req.body || {};
    const identityError = validateIdentity(payload);
    if (identityError) return res.status(400).json({ ok: false, error: identityError });
    if (!String(payload.phoneNumber || '').trim() || !String(payload.body || '').trim()) {
      return res.status(400).json({ ok: false, error: 'phoneNumber와 body가 필요합니다.' });
    }
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    if (attachments.length > 8 || attachments.some((item) =>
      !String(item.mimeType || '').startsWith('image/') || String(item.dataUrl || '').length > 8 * 1024 * 1024
    )) {
      return res.status(413).json({ ok: false, error: '이미지 첨부는 최대 8개, 각 8MB까지 허용됩니다.' });
    }
    const result = store.addIncoming(payload);
    if (result.created) onEvent('sms:message', result.message);
    res.status(result.created ? 201 : 200).json({ ok: true, duplicate: !result.created, message: result.message });
  });

  router.get('/sms/outbox', (req, res) => {
    const sellerId = String(req.query.sellerId || '').trim();
    if (!sellerId) return res.status(400).json({ ok: false, error: 'sellerId가 필요합니다.' });
    res.json({ ok: true, messages: store.listOutbox(sellerId, clampLimit(req.query.limit, 100)) });
  });

  router.post('/sms/outbox', (req, res) => {
    const payload = req.body || {};
    const identityError = validateIdentity(payload);
    if (identityError) return res.status(400).json({ ok: false, error: identityError });
    if (!String(payload.phoneNumber || '').trim() || !String(payload.body || '').trim()) {
      return res.status(400).json({ ok: false, error: 'phoneNumber와 body가 필요합니다.' });
    }
    const message = store.queueOutgoing(payload);
    onEvent('sms:outbox', message);
    res.status(201).json({ ok: true, message });
  });

  router.patch('/sms/outbox/:id/status', (req, res) => {
    const message = store.updateOutgoing(req.params.id, req.body || {});
    if (!message) return res.status(404).json({ ok: false, error: '발송 문자를 찾을 수 없습니다.' });
    onEvent('sms:message', message);
    res.json({ ok: true, message });
  });

  router.get('/payments', (req, res) => {
    const sellerId = String(req.query.sellerId || '').trim();
    if (!sellerId) return res.status(400).json({ ok: false, error: 'sellerId가 필요합니다.' });
    res.json({ ok: true, payments: store.listPayments(sellerId, clampLimit(req.query.limit, 1000)) });
  });

  router.post('/payments/incoming', (req, res) => {
    const payload = req.body || {};
    const identityError = validateIdentity(payload);
    if (identityError) return res.status(400).json({ ok: false, error: identityError });
    if (!String(payload.payerName || '').trim() || !Number.isFinite(Number(payload.amount)) || Number(payload.amount) <= 0) {
      return res.status(400).json({ ok: false, error: 'payerName과 0보다 큰 amount가 필요합니다.' });
    }
    const result = store.addPayment(payload);
    if (result.created) onEvent('payment:new', result.payment);
    res.status(result.created ? 201 : 200).json({ ok: true, duplicate: !result.created, payment: result.payment });
  });

  return router;
}

module.exports = { createBridgeRouter };

