'use strict';
/**
 * 안드로이드 전달용 댓글 디스크 대기열.
 * - 댓글은 넣는 순간의 회차(sessionId)와 전송 세대(generation)를 붙인 불변 레코드다. 재시도에도 바뀌지 않는다.
 * - 같은 배치는 재시도해도 같은 batchId와 같은 메시지 ID로 보낸다.
 * - 서버가 확인(acked)한 항목만 지운다. 세대가 바뀌었거나 연결이 꺼져 거절된 항목은 "버림"으로 집계해 보여 준다.
 * - 파일 쓰기 실패와 한도 초과는 조용히 넘기지 않고 error로 노출한다.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_LIMIT = 20000;
const BATCH_SIZE = 100;

class CommentOutbox {
  constructor({ file, limit = DEFAULT_LIMIT, fsImpl = fs, now = () => Date.now() } = {}) {
    this.file = file;
    this.limit = limit;
    this.fs = fsImpl;
    this.now = now;
    this.items = [];
    this.seen = new Set();
    this.dropped = 0;
    this.overflow = 0;
    this.error = '';
    this.saveTimer = null;
    this.load();
  }

  load() {
    if (!this.file) return;
    try {
      if (!this.fs.existsSync(this.file)) return;
      const data = JSON.parse(this.fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(data.items)) {
        this.items = data.items.filter((i) => i && i.platformMessageId && i.sessionId && Number.isInteger(i.generation));
        for (const i of this.items) this.seen.add(this.key(i));
      }
      this.dropped = Number(data.dropped) || 0;
    } catch (e) {
      this.error = `대기열 파일을 읽지 못했습니다: ${e.message}`;
    }
  }

  key(i) {
    return `${i.sessionId}|${i.platformMessageId}`;
  }

  /** 디스크에 바로 쓴다(원자적 교체). 실패하면 error를 남기고 false. */
  saveNow() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.file) return true;
    const tmp = `${this.file}.tmp`;
    try {
      this.fs.mkdirSync(path.dirname(this.file), { recursive: true });
      this.fs.writeFileSync(tmp, JSON.stringify({ v: 1, items: this.items, dropped: this.dropped }), 'utf8');
      this.fs.renameSync(tmp, this.file);
      if (this.error.startsWith('대기열 저장 실패')) this.error = '';
      return true;
    } catch (e) {
      this.error = `대기열 저장 실패: ${e.message}`;
      return false;
    }
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.saveNow(), 200);
    if (this.saveTimer.unref) this.saveTimer.unref();
  }

  /** 댓글 1건을 현재 회차·세대로 넣는다. 같은 회차의 같은 메시지 ID는 한 번만. */
  enqueue(comment, sessionId, generation) {
    const id = String(comment && (comment.id || comment.platformMessageId) || '').trim();
    const content = String(comment && comment.content || '').trim();
    if (!id || !content || !sessionId || !Number.isInteger(generation)) return false;
    const item = {
      platformMessageId: id,
      platformUserId: comment.userId != null ? String(comment.userId) : comment.platformUserId || undefined,
      uniqueId: comment.uniqueId ? String(comment.uniqueId) : undefined,
      nickname: String(comment.nickname || comment.uniqueId || '알 수 없음'),
      content,
      capturedAt: comment.receivedAt || comment.capturedAt || new Date(this.now()).toISOString(),
      sessionId,
      generation,
      enqueuedAt: this.now(),
      batchId: null,
    };
    if (this.seen.has(this.key(item))) return false;
    if (this.items.length >= this.limit) {
      this.overflow += 1;
      this.error = `미전송 댓글이 ${this.limit.toLocaleString()}건을 넘어 새 댓글을 보관하지 못했습니다.`;
      return false;
    }
    this.items.push(item);
    this.seen.add(this.key(item));
    if (this.seen.size > this.limit * 3) this.seen = new Set(this.items.map((i) => this.key(i)));
    this.scheduleSave();
    return true;
  }

  /** 다음에 보낼 배치. 앞 항목과 같은 회차·세대만 묶고, 이미 정해진 batchId는 그대로 쓴다. */
  nextBatch() {
    if (!this.items.length) return null;
    const head = this.items[0];
    const group = [];
    for (const i of this.items) {
      if (i.sessionId !== head.sessionId || i.generation !== head.generation) break;
      if (head.batchId ? i.batchId !== head.batchId : i.batchId) break;
      group.push(i);
      if (group.length >= BATCH_SIZE) break;
    }
    if (!head.batchId) {
      const batchId = crypto.randomUUID();
      for (const i of group) i.batchId = batchId;
      // 배치 번호를 디스크에 먼저 남겨, 재시작 뒤에도 같은 번호로 재전송한다.
      this.saveNow();
    }
    return {
      batchId: head.batchId,
      sessionId: head.sessionId,
      generation: head.generation,
      comments: group.map(({ sessionId, generation, enqueuedAt, batchId, ...c }) => c),
    };
  }

  /** 서버가 확인한 메시지만 지운다. 확인 안 된 항목은 다음 배치로 다시 보낸다. */
  ack(batch, ackedIds) {
    const acked = new Set(ackedIds || []);
    const before = this.items.length;
    this.items = this.items.filter((i) => !(i.batchId === batch.batchId && acked.has(i.platformMessageId)));
    // 확인 못 받은 나머지는 새 배치로 다시 묶는다.
    for (const i of this.items) if (i.batchId === batch.batchId) i.batchId = null;
    if (this.items.length !== before) this.saveNow();
    return before - this.items.length;
  }

  /** 세대·회차가 끝나 서버가 받지 않는 항목을 버린다(꺼진 동안의 댓글을 나중에 몰아 보내지 않는다). */
  dropWhere(predicate, reason) {
    const before = this.items.length;
    this.items = this.items.filter((i) => !predicate(i));
    const n = before - this.items.length;
    if (n) {
      this.dropped += n;
      this.lastDropReason = reason || '';
      this.saveNow();
    }
    return n;
  }

  /** 현재 회차·세대가 아닌 항목 버리기. */
  dropStale(sessionId, generation, reason) {
    return this.dropWhere((i) => i.sessionId !== sessionId || i.generation !== generation, reason);
  }

  clear(reason) {
    return this.dropWhere(() => true, reason);
  }

  stats() {
    return {
      pending: this.items.length,
      dropped: this.dropped,
      overflow: this.overflow,
      error: this.error,
      oldestAt: this.items.length ? this.items[0].enqueuedAt : null,
    };
  }

  /** 한도 초과 오류는 대기열이 줄면 풀린다. */
  clearOverflowIfRoom() {
    if (this.error.startsWith('미전송 댓글이') && this.items.length < this.limit * 0.9) this.error = '';
  }
}

module.exports = { CommentOutbox, BATCH_SIZE };
