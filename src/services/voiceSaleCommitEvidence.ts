import type { SaleRecord } from '../types/live.ts';
import type { CommentRecord } from '../types/comment.ts';
import type { SalesWorkflowProfile, WorkflowTranscript } from '../types/salesWorkflow.ts';
import { extractSpeechPrice } from './priceEvidence.ts';
import { extractSaleFromTranscript } from './salesExtractor.ts';
import { getPurchaseRequests, matchPurchaseRequest } from './purchaseFirstSales.ts';
import { replaySalesWorkflow } from './salesWorkflowEngine.ts';

// Used both by the server commit and the local test commit. The repository
// supplies the evidence; choosing/validating a buyer is never adapter-specific.
export function verifyVoiceSalePrice(sale: Pick<SaleRecord, 'rawTranscript' | 'amount' | 'unitPrice'>) {
  const extracted = extractSaleFromTranscript(sale.rawTranscript);
  const evidence = extracted?.allocationTranscript ? extractSpeechPrice(extracted.allocationTranscript) : null;
  return { extracted, evidence, valid: Boolean(evidence && evidence.amount === sale.amount
    && sale.unitPrice === sale.amount && extracted?.intent === 'ALLOCATION' && extracted.amount === sale.amount) };
}

export function verifyVoiceSaleBuyer(sale: SaleRecord, comments: CommentRecord[]) {
  const when = Date.parse(sale.recognizedAt);
  const window = comments.filter(c => c.sessionId === sale.sessionId
    && Date.parse(c.capturedAt) >= when - 300_000 && Date.parse(c.capturedAt) <= when + 10_000);
  if (window.length > 1000) return { valid: false, code: 'COMMENT_WINDOW_TOO_LARGE' };
  const { extracted } = verifyVoiceSalePrice(sale);
  const match = matchPurchaseRequest(extracted?.buyerNicknamePhrase || extracted?.buyerNickname || '',
    getPurchaseRequests(window, sale.sessionId), sale.recognizedAt);
  return { valid: match.kind === 'MATCH' && match.request.id === sale.purchaseRequestId,
    code: 'BUYER_AMBIGUOUS', match };
}

export function verifyWorkflowSale(sale: SaleRecord, profile: SalesWorkflowProfile, comments: CommentRecord[], transcripts: WorkflowTranscript[]) {
  const proof = sale.workflowEvidence;
  const decision = replaySalesWorkflow({ sessionId: sale.sessionId, profile, comments, transcripts })
    .find(d => d.id === proof?.decisionId && d.requestId === sale.purchaseRequestId);
  return { decision, valid: Boolean(decision && decision.status === 'CONFIRMED'
    && decision.amount === sale.amount && decision.unitPrice === sale.unitPrice
    && decision.quantity === (sale.quantity || 1) && decision.nickname === sale.buyerNickname) };
}
