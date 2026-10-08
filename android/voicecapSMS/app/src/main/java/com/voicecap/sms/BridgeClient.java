package com.voicecap.sms;

import android.content.Context;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

public final class BridgeClient {
    public static final int MAX_IMAGE_BYTES = 4 * 1024 * 1024;

    public static final class ImageAttachment {
        public final String name;
        public final String mimeType;
        public final byte[] bytes;

        public ImageAttachment(String name, String mimeType, byte[] bytes) {
            this.name = name;
            this.mimeType = mimeType;
            this.bytes = bytes;
        }
    }

    private BridgeClient() { }

    public static boolean claimDevice(Context context, String code, String deviceName) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("action", "claim");
            payload.put("code", code.trim().toUpperCase());
            payload.put("deviceName", deviceName.trim());
            payload.put("appVersion", BuildConfig.VERSION_NAME);
            JSONObject result = requestText(context, false, "device-pair", payload);
            if (!result.optBoolean("ok")) return false;
            String deviceId = result.optString("deviceId");
            String token = result.optString("deviceToken");
            String workspaceId = result.optString("workspaceId");
            if (deviceId.isEmpty() || token.isEmpty() || workspaceId.isEmpty()) return false;
            BridgePreferences.get(context).edit()
                    .putString(BridgePreferences.DEVICE_ID, deviceId)
                    .putString(BridgePreferences.DEVICE_TOKEN, token)
                    .putString(BridgePreferences.WORKSPACE_ID, workspaceId)
                    .putString(BridgePreferences.DEVICE_NAME, deviceName.trim())
                    .apply();
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    /** 받은 문자 업로드. 서버가 이미 가진 externalId도 성공(REPORTED)으로 돌려준다. */
    public static ReportResult postIncoming(Context context, String externalId, String phoneNumber, String body, String category,
                                            long receivedAtMillis, List<ImageAttachment> images) {
        if (!BridgePreferences.configured(context)) return ReportResult.RETRY;
        try {
            JSONObject payload = new JSONObject();
            payload.put("action", "incoming");
            payload.put("externalId", externalId);
            payload.put("phoneNumber", phoneNumber);
            payload.put("body", body.isEmpty() ? "(이미지 첨부 문자)" : body);
            payload.put("category", category);
            payload.put("receivedAt", java.time.Instant.ofEpochMilli(receivedAtMillis > 0 ? receivedAtMillis : System.currentTimeMillis()).toString());
            JSONArray attachments = new JSONArray();
            for (ImageAttachment image : images) {
                if (image.bytes.length > MAX_IMAGE_BYTES) continue;
                JSONObject attachment = new JSONObject();
                attachment.put("fileName", image.name);
                attachment.put("mimeType", image.mimeType);
                attachment.put("dataUrl", "data:" + image.mimeType + ";base64," + Base64.encodeToString(image.bytes, Base64.NO_WRAP));
                attachments.put(attachment);
            }
            payload.put("attachments", attachments);
            int[] code = new int[1];
            JSONObject response = requestText(context, true, "sms-bridge", payload, code);
            return classify(response, code[0]);
        } catch (Exception ignored) {
            return ReportResult.RETRY;
        }
    }

    /**
     * 폰에서 직접 보낸 업무 문자 기록 (action: outgoing, PR #9). 서버가 이미 가진 externalId도 성공으로 돌려준다.
     * 서버가 아직 outgoing을 모르면 UNSUPPORTED (PENDING 유지, 백오프 후 다시).
     */
    public static ReportResult postOutgoing(Context context, String externalId, String phoneNumber, String body,
                                            long sentAtMillis, String status, String error) {
        if (!BridgePreferences.configured(context)) return ReportResult.RETRY;
        try {
            JSONObject payload = new JSONObject();
            payload.put("action", "outgoing");
            payload.put("externalId", externalId);
            payload.put("phoneNumber", phoneNumber);
            payload.put("body", body);
            payload.put("sentAt", java.time.Instant.ofEpochMilli(sentAtMillis > 0 ? sentAtMillis : System.currentTimeMillis()).toString());
            payload.put("status", "FAILED".equals(status) ? "FAILED" : "SENT");
            if ("FAILED".equals(status) && error != null && !error.isEmpty()) {
                payload.put("error", error.length() > 500 ? error.substring(0, 500) : error);
            }
            payload.put("category", "GENERAL");
            int[] code = new int[1];
            JSONObject response = requestText(context, true, "sms-bridge", payload, code);
            return ConversationLogic.classifyOutgoing(response.optBoolean("ok"), code[0], response.optString("error", null));
        } catch (Exception ignored) {
            return ReportResult.RETRY;
        }
    }

    /** payment-incoming 결과. matchStatus는 서버가 대조 결과를 돌려줄 때만 (MATCHED / NEEDS_REVIEW / UNMATCHED). */
    public static final class PaymentReport {
        public final ReportResult result;
        public final String matchStatus;

        PaymentReport(ReportResult result, String matchStatus) {
            this.result = result;
            this.matchStatus = matchStatus;
        }
    }

    /**
     * 은행 알림 입금 업로드 (action: payment-incoming). 금액·입금자명·시각·은행·받는 계좌 별칭만 보낸다.
     * receiverName·bank·source와 서버 대조(match)는 PR #9 배포 뒤부터 쓰인다. 그 전 서버는 이 칸들을 무시하고 저장만 한다.
     */
    public static PaymentReport postPayment(Context context, String externalId, long amount, String payerName, long paidAtMillis,
                                            String receiverName, String bank, String source) {
        if (!BridgePreferences.configured(context)) return new PaymentReport(ReportResult.RETRY, null);
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
            JSONObject response = requestText(context, true, "sms-bridge", payload, code);
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

    public static List<JSONObject> getOutbox(Context context) {
        List<JSONObject> result = new ArrayList<>();
        if (!BridgePreferences.configured(context)) return result;
        try {
            JSONObject response = requestText(context, true, "sms-bridge", new JSONObject().put("action", "outbox-claim").put("limit", 20));
            JSONArray messages = response.optJSONArray("messages");
            if (messages == null) return result;
            for (int index = 0; index < messages.length(); index++) result.add(messages.getJSONObject(index));
        } catch (Exception ignored) { }
        return result;
    }

    public static void refreshBusinessContacts(Context context) {
        if (!BridgePreferences.configured(context)) return;
        try {
            JSONObject response = requestText(context, true, "sms-bridge", new JSONObject().put("action", "messages").put("limit", 2000));
            JSONArray messages = response.optJSONArray("messages");
            if (messages == null) return;
            for (int index = 0; index < messages.length(); index++) {
                JSONObject message = messages.optJSONObject(index);
                if (message == null) continue;
                String direction = message.optString("direction");
                String category = message.optString("category");
                if ("OUTGOING".equals(direction) || "PURCHASE_INFO".equals(category)) {
                    BusinessContactStore.register(context, message.optString("phone_number", message.optString("phoneNumber")));
                }
            }
        } catch (Exception ignored) { }
    }

    /**
     * REPORTED 성공, CONFLICT 409(발송 점유권 없음: 다른 휴대폰이 맡았거나 취소됨), REJECTED 그 밖의 4xx
     * (다시 보내도 같음), RETRY 네트워크 오류·5xx, UNSUPPORTED 서버가 아직 그 액션을 모름(outgoing 전용, 나중에 다시).
     */
    public enum ReportResult { REPORTED, CONFLICT, REJECTED, RETRY, UNSUPPORTED }

    private static ReportResult classify(JSONObject response, int code) {
        if (response.optBoolean("ok")) return ReportResult.REPORTED;
        if (code == 409) return ReportResult.CONFLICT;
        return code >= 400 && code < 500 ? ReportResult.REJECTED : ReportResult.RETRY;
    }

    /** status는 SENDING(통신사에 넘김) / SENT / FAILED. */
    public static ReportResult updateOutboxStatus(Context context, String id, String status, String error) {
        if (!BridgePreferences.configured(context)) return ReportResult.RETRY;
        try {
            JSONObject payload = new JSONObject().put("action", "outbox-status").put("id", id).put("status", status);
            if (error != null && !error.isEmpty()) payload.put("error", error.length() > 500 ? error.substring(0, 500) : error);
            int[] code = new int[1];
            JSONObject response = requestText(context, true, "sms-bridge", payload, code);
            return classify(response, code[0]);
        } catch (Exception ignored) {
            return ReportResult.RETRY;
        }
    }

    public static boolean getStatus(Context context) {
        try {
            return requestText(context, true, "sms-bridge", new JSONObject().put("action", "status")).optBoolean("ok");
        } catch (Exception ignored) {
            return false;
        }
    }

    public static void revokeDevice(Context context) {
        try {
            requestText(context, true, "device-pair", new JSONObject().put("action", "revoke-self"));
        } catch (Exception ignored) { }
        BridgePreferences.clearDevice(context);
    }

    private static JSONObject requestText(Context context, boolean deviceAuth, String functionName, JSONObject payload) throws Exception {
        return requestText(context, deviceAuth, functionName, payload, new int[1]);
    }

    private static JSONObject requestText(Context context, boolean deviceAuth, String functionName, JSONObject payload, int[] statusCode) throws Exception {
        String endpoint = BridgePreferences.apiBaseUrl() + "/" + functionName;
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(15000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        if (deviceAuth) connection.setRequestProperty("X-VoiceCAP-Device-Token", BridgePreferences.value(context, BridgePreferences.DEVICE_TOKEN));
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

    public static byte[] readLimited(InputStream input) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (output.size() + count > MAX_IMAGE_BYTES) throw new IllegalArgumentException("image too large");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }
}
