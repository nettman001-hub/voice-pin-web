export const MAX_LISTENING_STOP_DELAY_MS = 24 * 60 * 60 * 1000;

export interface ListeningStopOwner {
  userId: string;
  workspaceId: string;
  sessionId: string;
  listeningRunId: number;
}

export interface ListeningStopSchedule extends ListeningStopOwner {
  endsAt: number;
}

export type ListeningStopInput =
  | { mode: 'DURATION'; minutes: string }
  | { mode: 'AT_TIME'; datetime: string };

export function toLocalDateTimeInput(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function validateListeningStopAt(endsAt: number, now: number): void {
  if (!Number.isSafeInteger(endsAt) || endsAt <= now) {
    throw new Error('현재 시각보다 뒤의 종료 시간을 선택해 주세요.');
  }
  if (endsAt - now > MAX_LISTENING_STOP_DELAY_MS) {
    throw new Error('종료 예약은 현재부터 24시간 이내로 설정해 주세요.');
  }
}

export function resolveListeningStopAt(input: ListeningStopInput, now = Date.now()): number {
  let endsAt: number;
  if (input.mode === 'DURATION') {
    const minutes = Number(input.minutes);
    if (!input.minutes.trim() || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      throw new Error('종료까지 남은 시간을 1~1,440분 사이의 정수로 입력해 주세요.');
    }
    endsAt = now + minutes * 60_000;
  } else {
    endsAt = new Date(input.datetime).getTime();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(input.datetime)
      || !Number.isFinite(endsAt) || toLocalDateTimeInput(endsAt) !== input.datetime) {
      throw new Error('올바른 종료 날짜와 시각을 입력해 주세요.');
    }
  }
  validateListeningStopAt(endsAt, now);
  return endsAt;
}

export function isListeningStopBroadcast(schedule: ListeningStopOwner, owner: ListeningStopOwner): boolean {
  return schedule.userId === owner.userId && schedule.workspaceId === owner.workspaceId
    && schedule.sessionId === owner.sessionId;
}

export function isListeningStopOwner(schedule: ListeningStopOwner, owner: ListeningStopOwner): boolean {
  return isListeningStopBroadcast(schedule, owner) && schedule.listeningRunId === owner.listeningRunId;
}

export function remainingListeningStopSeconds(endsAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

export function formatListeningStopCountdown(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}
