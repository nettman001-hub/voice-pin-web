import { isSupabaseConfigured, requireSupabase } from './supabaseClient';

export interface PairingCode {
  code: string;
  expiresAt: string;
}

export const devicePairingService = {
  async createCode(workspaceId: string): Promise<PairingCode> {
    if (!isSupabaseConfigured) throw new Error('수파베이스 연결을 먼저 완료해 주세요.');
    const { data, error } = await requireSupabase().functions.invoke('device-pair', {
      body: { action: 'create-code', workspaceId },
    });
    if (error) throw error;
    if (!data?.ok || !data.code || !data.expiresAt) throw new Error(data?.error || '연결 코드를 만들지 못했습니다.');
    return { code: String(data.code), expiresAt: String(data.expiresAt) };
  },
};
