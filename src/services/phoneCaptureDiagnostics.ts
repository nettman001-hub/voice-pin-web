export interface PhoneCaptureDiagnostic {
  saleId: string;
  generation: string;
  startedAt: string;
  status: 'CAPTURED' | 'FAILED' | 'CANCELLED';
  timings: {
    cameraMs: number;
    countdownMs: number;
    samplingMs: number;
    encodingMs: number;
    serializationMs: number;
    totalMs: number;
  };
}

const key = (workspaceId: string) => `voicecap-phone-capture-diagnostics:${workspaceId}`;

/** Local timing evidence only; never store camera images or customer nicknames. */
export function recordPhoneCaptureDiagnostic(workspaceId: string, value: PhoneCaptureDiagnostic) {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key(workspaceId)) || '[]');
    const history = Array.isArray(stored) ? stored : [];
    localStorage.setItem(key(workspaceId), JSON.stringify([...history.slice(-49), value]));
  } catch {
    // Diagnostics must not interrupt a sale when local storage is unavailable.
  }
}
