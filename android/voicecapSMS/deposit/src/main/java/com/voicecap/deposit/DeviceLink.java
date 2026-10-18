package com.voicecap.deposit;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * 웹앱 연결(1회용 코드)과 서버 요청. 문자 앱의 BridgePreferences·BridgeClient에서 입금확인에 필요한 것만 옮겼다.
 * 문자 앱과 따로 연결하므로 서버에는 기기가 하나 더 생긴다 (device-pair claim, 같은 판매자 작업공간).
 */
public final class DeviceLink {
    private static final String NAME = "voicecap_device_link";
    private static final String DEVICE_ID = "device_id";
    private static final String DEVICE_TOKEN = "device_token";
    private static final String WORKSPACE_ID = "workspace_id";
    private static final String DEVICE_NAME = "device_name";

    private DeviceLink() { }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(NAME, Context.MODE_PRIVATE);
    }

    private static String value(Context context, String key) {
        return prefs(context).getString(key, "").trim();
    }

    public static String apiBaseUrl() {
        return BuildConfig.VOICECAP_API_BASE_URL.replaceAll("/+$", "");
    }

    public static boolean configured(Context context) {
        return !value(context, DEVICE_ID).isEmpty()
                && !value(context, DEVICE_TOKEN).isEmpty()
                && !value(context, WORKSPACE_ID).isEmpty();
    }

    public static String deviceName(Context context) {
        return value(context, DEVICE_NAME);
    }

    /** 웹앱 마이페이지에서 만든 연결 코드로 연결한다. 네트워크를 쓰므로 백그라운드 스레드에서 부른다. */
    public static boolean claim(Context context, String code, String deviceName) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("action", "claim");
            payload.put("code", code.trim().toUpperCase());
            payload.put("deviceName", deviceName.trim());
            payload.put("appVersion", BuildConfig.VERSION_NAME);
            JSONObject result = request(context, false, "device-pair", payload, new int[1]);
            if (!result.optBoolean("ok")) return false;
            String deviceId = result.optString("deviceId");
            String token = result.optString("deviceToken");
            String workspaceId = result.optString("workspaceId");
            if (deviceId.isEmpty() || token.isEmpty() || workspaceId.isEmpty()) return false;
            prefs(context).edit()
                    .putString(DEVICE_ID, deviceId)
                    .putString(DEVICE_TOKEN, token)
                    .putString(WORKSPACE_ID, workspaceId)
                    .putString(DEVICE_NAME, deviceName.trim())
                    .apply();
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    /** 서버에서 이 기기 연결을 끊고 저장한 연결 정보를 지운다. 네트워크를 쓰므로 백그라운드 스레드에서 부른다. */
    public static void revoke(Context context) {
        try {
            request(context, true, "device-pair", new JSONObject().put("action", "revoke-self"), new int[1]);
        } catch (Exception ignored) { }
        prefs(context).edit()
                .remove(DEVICE_ID)
                .remove(DEVICE_TOKEN)
                .remove(WORKSPACE_ID)
                .remove(DEVICE_NAME)
                .apply();
    }

    /** REPORTED 성공, CONFLICT 409, REJECTED 그 밖의 4xx (다시 보내도 같음), RETRY 네트워크 오류·5xx. */
    public enum ReportResult { REPORTED, CONFLICT, REJECTED, RETRY }

    /** payment-incoming 결과. matchStatus는 서버가 대조 결과를 돌려줄 때만 (MATCHED / NEEDS_REVIEW / UNMATCHED). */
    public static final class PaymentReport {
        public final ReportResult result;
        public final String matchStatus;

        PaymentReport(ReportResult result, String matchStatus) {
            this.result = result;
            this.matchStatus = matchStatus;
        }
    }

    /** 입금 업로드 (sms-bridge action: payment-incoming). 금액·입금자명·시각·은행·받는 계좌 별칭만 보낸다. */
    public static PaymentReport postPayment(Context context, String externalId, long amount, String payerName, long paidAtMillis,
                                            String receiverName, String bank, String source) {
        if (!configured(context)) return new PaymentReport(ReportResult.RETRY, null);
        try {
            JSONObject payload = new JSONObject();
            payload.put("action", "payment-incoming");
            payload.put("externalId", externalId);
            payload.put("amount", amount);
            payload.put("payerName", payerName);
            payload.put("paidAt", java.time.Instant.ofEpochMilli(paidAtMillis > 0 ? paidAtMillis : System.currentTimeMillis()).toString());
            payload.put("receiverName", receiverName == null ? JSONObject.NULL : receiverName);
            payload.put("bank", bank == null ? JSONObject.NULL : bank);
            payload.put("source", source);
            int[] code = new int[1];
            JSONObject response = request(context, true, "sms-bridge", payload, code);
            return new PaymentReport(classify(response, code[0]), matchStatus(response));
        } catch (Exception ignored) {
            return new PaymentReport(ReportResult.RETRY, null);
        }
    }

    /**
     * 새 입금이면 응답의 match.status, 이미 올린 입금(duplicate)이면 저장된 payment.match_status.
     * PR #9 전 서버는 대조를 하지 않고 늘 UNMATCHED를 저장하므로, 새 칸(source)이 없는 응답은 결과로 쓰지 않는다.
     */
    static String matchStatus(JSONObject response) {
        JSONObject match = response.optJSONObject("match");
        if (match != null) return match.optString("status", null);
        JSONObject payment = response.optJSONObject("payment");
        if (response.optBoolean("duplicate") && payment != null && payment.has("source")) return payment.optString("match_status", null);
        return null;
    }

    private static ReportResult classify(JSONObject response, int code) {
        if (response.optBoolean("ok")) return ReportResult.REPORTED;
        if (code == 409) return ReportResult.CONFLICT;
        return code >= 400 && code < 500 ? ReportResult.REJECTED : ReportResult.RETRY;
    }

    private static JSONObject request(Context context, boolean deviceAuth, String functionName, JSONObject payload, int[] statusCode) throws Exception {
        String endpoint = apiBaseUrl() + "/" + functionName;
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(15000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        if (deviceAuth) connection.setRequestProperty("X-VoiceCAP-Device-Token", value(context, DEVICE_TOKEN));
        try (OutputStream output = connection.getOutputStream()) {
            output.write(payload.toString().getBytes(StandardCharsets.UTF_8));
        }
        statusCode[0] = connection.getResponseCode();
        InputStream stream = statusCode[0] < 400 ? connection.getInputStream() : connection.getErrorStream();
        StringBuilder text = new StringBuilder();
        if (stream != null) try (BufferedReader reader = new BufferedReader(new java.io.InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line; while ((line = reader.readLine()) != null) text.append(line);
        }
        connection.disconnect();
        return new JSONObject(text.toString());
    }
}
