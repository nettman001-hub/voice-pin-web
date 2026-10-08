package com.voicecap.sms;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;

import org.json.JSONObject;

public final class SmsSyncManager {
    /** 통신사 결과가 이 시간 안에 오지 않으면 실패로 확정한다. */
    private static final long STALE_SEND_MILLIS = 10 * 60 * 1000L;
    static final String STALE_SEND_ERROR = "발송 결과 확인 불가(앱 종료)";

    private SmsSyncManager() { }

    /** 화면의 "지금 동기화" 버튼: 백오프 중인 항목도 바로 시도한다. */
    public static String syncNow(Context context) {
        return syncNow(context, true);
    }

    /** @param force true면 앱 열기·부팅·네트워크 복구처럼 백오프를 무시하고 바로 다시 시도한다. */
    public static synchronized String syncNow(Context context, boolean force) {
        boolean defaultApp = SmsRoleUtils.isDefaultSmsApp(context);
        try {
            if (defaultApp) reconcileStaleSends(context);
            if (!isOnline(context)) {
                SyncScheduler.scheduleOnNetworkRecovery(context);
                return "네트워크 연결이 없어 연결되는 즉시 다시 시도합니다.";
            }
            // MMS 다시 받기는 서버 연결·전송 동의와 상관없이 기본 문자앱이면 항상 한다.
            if (defaultApp) MmsDownloads.retryDue(context, force);
            if (!BridgePreferences.hasDataTransferConsent(context)) return "문자 정보 전송 동의가 필요합니다.";
            if (!defaultApp) return "기본 SMS 앱으로 설정되어 있지 않아 동기화를 중단했습니다.";
            if (!SmsRoleUtils.hasSmsPermissions(context)) return "SMS/MMS 권한이 없어 동기화를 중단했습니다.";
            if (!BridgePreferences.configured(context)) return "웹앱에서 만든 기기 연결 코드를 먼저 입력해 주세요.";
            BridgeClient.refreshBusinessContacts(context);
            UploadQueue.recoveryScanIfDue(context);
            int uploaded = UploadQueue.uploadPending(context, force);
            int queued = sendOutbox(context);
            reportOutboxResults(context, force);
            return "문자 " + uploaded + "건 업로드, 웹 발송 " + queued + "건 요청";
        } finally {
            scheduleNextRetry(context);
        }
    }

    /** 백오프 중인 항목이 있으면 가장 이른 시각에 다시 동기화한다. */
    private static void scheduleNextRetry(Context context) {
        long now = System.currentTimeMillis();
        long next = LocalDb.get(context).nextRetryAt(now);
        if (next > 0) SyncScheduler.scheduleRetry(context, next - now);
    }

    static boolean isOnline(Context context) {
        ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
        if (manager == null) return true;
        Network network = manager.getActiveNetwork();
        NetworkCapabilities capabilities = network == null ? null : manager.getNetworkCapabilities(network);
        return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    /**
     * 웹 발송함의 문자를 보낸다. 통신사에 넘기자마자 SENDING을 보고해 서버가 점유를 늘리게 하고
     * (다른 휴대폰이 같은 문자를 다시 가져가 보내지 않게), 최종 SENT/FAILED는 통신사 콜백({@link SmsSentReceiver}) 뒤에
     * {@link #reportOutboxResults}가 보고한다. 이미 보낸 메시지가 다시 내려와도 중복 발송하지 않는다.
     */
    public static int sendOutbox(Context context) {
        int count = 0;
        LocalDb db = LocalDb.get(context);
        for (JSONObject message : BridgeClient.getOutbox(context)) {
            String id = message.optString("id");
            if (id.isEmpty() || db.exists(SmsSender.webExternalId(id))) continue;
            String phone = message.optString("phone_number", message.optString("phoneNumber"));
            try {
                String body = message.getString("body");
                BusinessContactStore.register(context, phone);
                SmsSender.send(context, phone, body, -1, LocalDb.ORIGIN_WEB, id);
                count++;
            } catch (Exception error) {
                if (!db.exists(SmsSender.webExternalId(id))) {
                    LocalDb.Item item = new LocalDb.Item();
                    item.externalId = SmsSender.webExternalId(id);
                    item.kind = LocalDb.KIND_SMS_OUT;
                    item.origin = LocalDb.ORIGIN_WEB;
                    item.serverId = id;
                    item.state = LocalDb.STATE_PENDING;
                    item.payload = new JSONObject();
                    try {
                        item.payload.put("phone", phone).put("status", "FAILED")
                                .put("error", error.getMessage() == null ? "SMS 발송 실패" : error.getMessage());
                    } catch (Exception ignored) { }
                    db.insert(item);
                }
                continue;
            }
            reportSending(context, id);
        }
        return count;
    }

    /** 통신사에 넘긴 직후의 SENDING 보고. 실패해도 발송은 이미 진행 중이므로 기록만 남긴다. */
    private static void reportSending(Context context, String serverId) {
        BridgeClient.ReportResult result = BridgeClient.updateOutboxStatus(context, serverId, "SENDING", null);
        String externalId = SmsSender.webExternalId(serverId);
        if (result == BridgeClient.ReportResult.CONFLICT) {
            LocalDb.get(context).setLastError(externalId, "SENDING 보고 충돌(409): 발송 점유권이 없음");
        } else if (result == BridgeClient.ReportResult.REJECTED) {
            LocalDb.get(context).setLastError(externalId, "서버가 SENDING 보고를 거절함");
        } else if (result == BridgeClient.ReportResult.RETRY) {
            LocalDb.get(context).setLastError(externalId, "SENDING 보고 실패 (네트워크·서버)");
        }
    }

    /**
     * 확정된 웹 발송 결과(SENT/FAILED)를 서버에 보고한다. 네트워크 오류는 백오프 후 재시도.
     * 409(점유권 없음)와 그 밖의 거절은 SYNCED로 숨기지 않고 FAILED + last_error로 남긴다.
     */
    public static void reportOutboxResults(Context context, boolean force) {
        LocalDb db = LocalDb.get(context);
        long now = System.currentTimeMillis();
        for (LocalDb.Item item : db.list(LocalDb.KIND_SMS_OUT, LocalDb.ORIGIN_WEB, LocalDb.STATE_PENDING)) {
            if (!force && item.nextAt > now) continue;
            String status = item.payload.optString("status", "FAILED");
            String error = "FAILED".equals(status) ? item.payload.optString("error", "SMS 발송 실패") : null;
            BridgeClient.ReportResult result = BridgeClient.updateOutboxStatus(context, item.serverId, status, error);
            if (result == BridgeClient.ReportResult.RETRY) {
                item.attempts++;
                item.nextAt = now + SyncBackoff.delayMillis(item.attempts);
                item.lastError = "서버 보고 실패";
            } else if (result == BridgeClient.ReportResult.CONFLICT) {
                item.state = LocalDb.STATE_FAILED;
                item.lastError = "서버 충돌(409): 발송 점유권이 없어 " + status + " 보고가 반영되지 않음";
            } else if (result == BridgeClient.ReportResult.REJECTED) {
                item.state = LocalDb.STATE_FAILED;
                item.lastError = "서버가 " + status + " 보고를 거절함";
            } else {
                item.state = LocalDb.STATE_SYNCED;
                item.lastError = null;
            }
            db.update(item);
        }
    }

    /**
     * 통신사 결과 콜백 없이 10분이 지난 발송은 실패로 확정한다. 기본 문자앱은 보낸편지함을 스스로 관리하므로
     * 앱이 강제 종료되면 OUTBOX 행만으로는 실제 결과를 알 수 없다. 보낸편지함 행을 실패로 바꿔 판매자가 다시 보내게 한다.
     */
    static void reconcileStaleSends(Context context) {
        LocalDb db = LocalDb.get(context);
        long cutoff = System.currentTimeMillis() - STALE_SEND_MILLIS;
        for (String origin : new String[]{LocalDb.ORIGIN_WEB, LocalDb.ORIGIN_DEVICE}) {
            for (LocalDb.Item item : db.list(LocalDb.KIND_SMS_OUT, origin, LocalDb.STATE_SENDING)) {
                if (item.createdAt > cutoff) continue;
                SmsSentReceiver.finish(context, item.externalId, false, STALE_SEND_ERROR);
            }
        }
    }
}
