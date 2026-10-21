import type { TouchComment } from '../types/touchSales.ts';
import { hasCommentPurchaseIntent } from './commentNicknameVerifier.ts';
import { commentWithdrawsPurchase } from './purchaseFirstSales.ts';
export const isTouchPurchase = (comment: Pick<TouchComment,'content'>) =>
  !commentWithdrawsPurchase(comment.content) && hasCommentPurchaseIntent(comment.content);
export const touchCommentKey = (comment: Pick<TouchComment,'id'|'platformMessageId'|'sessionId'>) =>
  `${comment.sessionId}:${comment.platformMessageId || comment.id}`;
export interface TouchSelectionState { selectedKey: string | null; acknowledged: ReadonlySet<string>; }
/** A purchase tap acknowledges the entire currently visible alert generation. New arrivals remain new. */
export function selectTouchComment(state: TouchSelectionState, selected: TouchComment, comments: readonly TouchComment[],sold:ReadonlySet<string>=new Set()): TouchSelectionState {
  const acknowledged = new Set(state.acknowledged);
  if (shouldFlashTouchComment(selected,state,sold)) for (const comment of comments) if(isTouchPurchase(comment)) acknowledged.add(touchCommentKey(comment));
  return {selectedKey:touchCommentKey(selected),acknowledged};
}
export const shouldFlashTouchComment = (comment: TouchComment,state:TouchSelectionState,sold:ReadonlySet<string>) =>
  isTouchPurchase(comment) && !state.acknowledged.has(touchCommentKey(comment)) && !sold.has(touchCommentKey(comment));
export function mergeTouchComments(previous: readonly TouchComment[], incoming: readonly TouchComment[], sessionId: string) {
  const map=new Map(previous.filter(c=>c.sessionId===sessionId).map(c=>[touchCommentKey(c),c]));
  for(const c of incoming) if(c.sessionId===sessionId && Number.isSafeInteger(c.sequence)) map.set(touchCommentKey(c),c);
  return [...map.values()].sort((a,b)=>a.sequence-b.sequence).slice(-500);
}
