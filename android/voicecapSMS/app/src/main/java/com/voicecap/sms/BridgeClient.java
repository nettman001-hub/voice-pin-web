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

    public static boolean postIncoming(Context context, String externalId, String phoneNumber, String body, String category, List<ImageAttachment> images) {
        if (!BridgePreferences.configured(context)) return false;
        try {
            JSONObject payload = new JSONObject();
            payload.put("action", "incoming");
            payload.put("externalId", externalId);
            payload.put("phoneNumber", phoneNumber);
            payload.put("body", body.isEmpty() ? "(이미지 첨부 문자)" : body);
            payload.put("category", category);
            payload.put("receivedAt", java.time.Instant.now().toString());
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
            return requestText(context, true, "sms-bridge", payload).optBoolean("ok");
        } catch (Exception ignored) {
            return false;
        }
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

    public static void updateOutboxStatus(Context context, String id, String status, String error) {
        try {
            JSONObject payload = new JSONObject().put("action", "outbox-status").put("id", id).put("status", status);
            if (error != null && !error.isEmpty()) payload.put("error", error);
            requestText(context, true, "sms-bridge", payload);
        } catch (Exception ignored) { }
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
        InputStream stream = connection.getResponseCode() < 400 ? connection.getInputStream() : connection.getErrorStream();
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
