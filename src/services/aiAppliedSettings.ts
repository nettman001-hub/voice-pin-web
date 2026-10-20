// Shared read-only loader for the exact applied settings snapshot.
export async function readOperationalAiSetting(admin: { from: (table: string) => any }): Promise<any | null> {
  const { data: setting, error } = await admin
    .from('ai_settings')
    .select('*')
    .eq('scope', 'GLOBAL')
    .maybeSingle();

  if (error) throw error;
  if (!setting) return null;
  if (!setting.is_draft || setting.version === setting.applied_version) return setting;

  const { data: history, error: historyError } = await admin
    .from('ai_settings_history')
    .select('snapshot')
    .eq('setting_id', setting.id)
    .eq('version', setting.applied_version)
    .order('created_at', { ascending: false })
    .limit(1);

  if (historyError) throw historyError;
  if (!history?.[0]?.snapshot) {
    // A legacy draft may predate the first history snapshot. Do not claim that
    // its unsaved priority is the applied priority.
    throw new Error('운영 중인 AI 설정 버전의 기록을 찾을 수 없습니다. 설정 화면에서 운영 환경에 다시 적용해 주세요.');
  }

  return history[0].snapshot;
}
