const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EMPTY_STATE = { messages: [], payments: [] };

class BridgeStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) return { ...EMPTY_STATE, messages: [], payments: [] };
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return {
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        payments: Array.isArray(parsed.payments) ? parsed.payments : []
      };
    } catch (error) {
      console.error('[BridgeStore] 저장 파일을 읽지 못해 빈 상태로 시작합니다.', error);
      return { ...EMPTY_STATE, messages: [], payments: [] };
    }
  }

  persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(temporaryPath, this.filePath);
  }

  listMessages(sellerId, limit = 1000) {
    return this.state.messages
      .filter((message) => !sellerId || message.sellerId === sellerId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  addIncoming(payload) {
    const sellerId = String(payload.sellerId || '').trim();
    const externalId = String(payload.externalId || '').trim();
    const duplicate = externalId && this.state.messages.find(
      (message) => message.sellerId === sellerId && message.externalId === externalId
    );
    if (duplicate) return { message: duplicate, created: false };

    const now = new Date().toISOString();
    const message = {
      id: `sms-${crypto.randomUUID()}`,
      sellerId,
      externalId: externalId || undefined,
      phoneNumber: String(payload.phoneNumber || '').trim(),
      body: String(payload.body || '').trim(),
      direction: 'INCOMING',
      category: payload.category || 'PURCHASE_INFO',
      status: 'RECEIVED',
      saleIds: Array.isArray(payload.saleIds) ? payload.saleIds.map(String) : [],
      attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
      createdAt: payload.receivedAt || now,
      receivedAt: payload.receivedAt || now
    };
    this.state.messages.unshift(message);
    this.persist();
    return { message, created: true };
  }

  queueOutgoing(payload) {
    const now = new Date().toISOString();
    const message = {
      id: `sms-${crypto.randomUUID()}`,
      sellerId: String(payload.sellerId || '').trim(),
      phoneNumber: String(payload.phoneNumber || '').trim(),
      body: String(payload.body || '').trim(),
      direction: 'OUTGOING',
      category: payload.category || 'GENERAL',
      status: 'QUEUED',
      saleIds: Array.isArray(payload.saleIds) ? payload.saleIds.map(String) : [],
      attachments: [],
      createdAt: now
    };
    this.state.messages.unshift(message);
    this.persist();
    return message;
  }

  listOutbox(sellerId, limit = 100) {
    return this.state.messages
      .filter((message) =>
        message.direction === 'OUTGOING' &&
        (!sellerId || message.sellerId === sellerId) &&
        ['QUEUED', 'SENDING'].includes(message.status)
      )
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(0, limit);
  }

  updateOutgoing(id, payload) {
    const index = this.state.messages.findIndex((message) => message.id === id && message.direction === 'OUTGOING');
    if (index < 0) return null;
    const allowedStatuses = new Set(['QUEUED', 'SENDING', 'SENT', 'FAILED']);
    const current = this.state.messages[index];
    const status = allowedStatuses.has(payload.status) ? payload.status : current.status;
    const updated = {
      ...current,
      status,
      sentAt: status === 'SENT' ? (payload.sentAt || new Date().toISOString()) : current.sentAt,
      error: status === 'FAILED' ? String(payload.error || 'SMS 발송 실패') : undefined
    };
    this.state.messages[index] = updated;
    this.persist();
    return updated;
  }

  listPayments(sellerId, limit = 1000) {
    return this.state.payments
      .filter((payment) => !sellerId || payment.sellerId === sellerId)
      .sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime())
      .slice(0, limit);
  }

  addPayment(payload) {
    const sellerId = String(payload.sellerId || '').trim();
    const externalId = String(payload.externalId || '').trim();
    const duplicate = externalId && this.state.payments.find(
      (payment) => payment.sellerId === sellerId && payment.externalId === externalId
    );
    if (duplicate) return { payment: duplicate, created: false };
    const now = new Date().toISOString();
    const payment = {
      id: `bank-${crypto.randomUUID()}`,
      sellerId,
      externalId: externalId || undefined,
      payerName: String(payload.payerName || '').trim(),
      amount: Number(payload.amount),
      paidAt: payload.paidAt || now,
      memo: payload.memo ? String(payload.memo) : undefined,
      saleIds: [],
      invoiceId: payload.invoiceId ? String(payload.invoiceId) : undefined,
      matchStatus: 'UNMATCHED',
      createdAt: now
    };
    this.state.payments.unshift(payment);
    this.persist();
    return { payment, created: true };
  }
}

module.exports = { BridgeStore };

