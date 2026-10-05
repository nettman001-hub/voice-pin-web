import test from "node:test";
import assert from "node:assert/strict";
import { buildCommentFeed } from "../src/services/logicOpus/opusCommentFeed.ts";

const c = (id, sec, nickname, text) => ({ id, kind: "COMMENT", at: `2026-10-05T12:00:${String(sec).padStart(2, "0")}.000Z`, nickname, text });

test("실시간 댓글창: AI 판단 전 댓글도 바로 보이고, 판단된 댓글과 겹치지 않으며 최신순", () => {
  const judged = [c("c_1", 1, "체리나무", "저요"), { id: "s_1", kind: "SPEECH", at: "2026-10-05T12:00:02.000Z", text: "체리 나무 언니" }];
  const live = [c("c_1", 1, "체리나무", "저요"), c("c_2", 3, "네네", "공지 확인"), c("c_3", 5, "루비", "5")];
  const classes = new Map([["c_1", { eventId: "c_1", type: "PURCHASE_INTENT", confidence: 0.9 }]]);
  const feed = buildCommentFeed(live, judged, classes, ["네네"]);
  assert.equal(feed.total, 3);
  assert.deepEqual(feed.items.map((i) => i.id), ["c_3", "c_2", "c_1"]);
  assert.equal(feed.items[2].classification, "PURCHASE_INTENT");
  assert.equal(feed.items[0].classification, null, "아직 판단 전");
  assert.equal(feed.items[1].isSeller, true);
});

test("실시간 댓글창: 표시 개수를 넘으면 최근 것만 보여 주고 누적 수는 그대로", () => {
  const live = Array.from({ length: 10 }, (_, i) => c(`c_${i}`, i, `n${i}`, "hi"));
  const feed = buildCommentFeed(live, [], new Map(), [], 4);
  assert.equal(feed.total, 10);
  assert.deepEqual(feed.items.map((i) => i.id), ["c_9", "c_8", "c_7", "c_6"]);
});
