import type { LogicOpusClassification, LogicOpusCommentEvent, LogicOpusEvent } from "../../types/logicOpus";

export interface CommentFeedItem extends LogicOpusCommentEvent {
  classification: LogicOpusClassification["type"] | null;
  isSeller: boolean;
}

export const COMMENT_FEED_LIMIT = 300;

/**
 * 실시간 댓글창 목록. 도우미에서 받은 댓글(AI 판단 전)과 판단 루프의 이벤트를 id로 합쳐
 * 최신순으로 돌려준다. 같은 댓글이 두 곳에 있어도 한 번만 나온다.
 */
export function buildCommentFeed(
  liveComments: LogicOpusCommentEvent[],
  events: LogicOpusEvent[],
  classes: Map<string, LogicOpusClassification>,
  sellerNicknames: string[],
  limit = COMMENT_FEED_LIMIT,
): { items: CommentFeedItem[]; total: number } {
  const byId = new Map<string, LogicOpusCommentEvent>();
  for (const e of events) if (e.kind === "COMMENT") byId.set(e.id, e);
  for (const c of liveComments) if (!byId.has(c.id)) byId.set(c.id, c);
  const sellers = new Set(sellerNicknames);
  const all = [...byId.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? 1 : -1));
  return {
    total: all.length,
    items: all.slice(0, limit).map((c) => ({
      ...c,
      classification: classes.get(c.id)?.type ?? null,
      isSeller: sellers.has(c.nickname),
    })),
  };
}
