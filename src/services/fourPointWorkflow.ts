import type { WorkflowTranscript } from '../types/salesWorkflow.ts';
import { extractSaleFromTranscript } from './salesExtractor.ts';
import { hasCaptureInstructionText } from './saleCapturePairing.ts';

/** Apply the same four-point rule when a seller workflow owns final STT processing. */
export function collectFourPointWorkflowSales(transcripts: WorkflowTranscript[]) {
  const sales: Array<{ key: string; transcriptIds: string[]; recognizedAt: string;
    result: NonNullable<ReturnType<typeof extractSaleFromTranscript>> }> = [];
  for (let index = 0; index < transcripts.length; index++) {
    const current = transcripts[index];
    if (!hasCaptureInstructionText(current.text)) continue;
    const direct = extractSaleFromTranscript(current.text);
    let parts = [current];
    if (!direct?.isFourPointConfirmed) {
      const at = Date.parse(current.recognizedAt);
      parts = transcripts.slice(Math.max(0, index - 2), index + 1)
        .filter((row) => at - Date.parse(row.recognizedAt) >= 0 && at - Date.parse(row.recognizedAt) <= 3000);
    }
    const result = direct?.isFourPointConfirmed ? direct : extractSaleFromTranscript(parts.map((row) => row.text).join('\n'));
    if (!result?.isFourPointConfirmed) continue;
    // Retain only this buyer's allocation and following price/capture fragments.
    let allocationIndex = -1;
    for (let i = parts.length - 1; i >= 0; i--) {
      const parsed = extractSaleFromTranscript(parts[i].text);
      if (parsed?.buyerNickname === result.buyerNickname && parsed.intent === 'ALLOCATION') { allocationIndex = i; break; }
    }
    if (allocationIndex >= 0) parts = parts.slice(allocationIndex);
    sales.push({ key: `four-point:${current.id}`, transcriptIds: parts.map((row) => row.id),
      recognizedAt: parts[0].recognizedAt, result });
  }
  return sales;
}
