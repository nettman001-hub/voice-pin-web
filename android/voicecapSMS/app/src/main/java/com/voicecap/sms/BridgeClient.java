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

    public static boolean postIncoming(Context context, String externalId, String phoneNumber, String body, List<ImageAttachment> images) {
        if (!BridgePreferences.configured(context)) return false;
        try {
            JSONObject payload = new JSONObject();
            payload.put("sellerId", BridgePreferences.value(context, BridgePreferences.SELLER_ID));
            payload.put("externalId", externalId);
            payload.put("phoneNumber", phoneNumber);
            payload.put("body", body.isEmpty() ? "(이미지 첨부 문자)" : body);
            payload.put("category", "PURCHASE_INFO");
            payload.put("receivedAt", java.time.Instant.now().toString());
            JSONArray attachments = new JSONArray();
            for (ImageAttachment image : images) {
                if (image.bytes.length > MAX_IMAGE_BYTES) continue;
                JSONObject attachment = new JSONObject();
                attachment.put("name", image.name);
                attachment.put("mimeType", image.mimeType);
                attachment.put("dataUrl", "data:" + image.mimeType + ";base64," + Base64.encodeToString(image.bytes, Base64.NO_WRAP));
                attachments.put(attachment);
            }
            payload.put("attachments", attachments);
            return request(context, "POST", "/api/sms/incoming", payload.toString()) >= 200;
        } catch (Exception ignored) {
            return false;
        }
    }

    public static List<JSONObject> getOutbox(Context context) {
        List<JSONObject> result = new ArrayList<>();
        if (!BridgePreferences.configured(context)) return result;
        try {
            String seller = java.net.URLEncoder.encode(BridgePreferences.value(context, BridgePreferences.SELLER_ID), "UTF-8");
            String response = requestText(context, "GET", "/api/sms/outbox?sellerId=" + seller, null);
            JSONObject root = new JSONObject(response);
            JSONArray messages = root.optJSONArray("messages");
            if (messages == null) return result;
            for (int index = 0; index < messages.length(); index++) result.add(messages.getJSONObject(index));
        } catch (Exception ignored) { }
        return result;
    }

    public static void updateOutboxStatus(Context context, String id, String status, String error) {
        try {
            JSONObject payload = new JSONObject().put("status", status);
            if (error != null && !error.isEmpty()) payload.put("error", error);
            request(context, "PATCH", "/api/sms/outbox/" + id + "/status", payload.toString());
        } catch (Exception ignored) { }
    }

    private static int request(Context context, String method, String path, String payload) throws Exception {
        HttpURLConnection connection = open(context, method, path);
        if (payload != null) {
            connection.setDoOutput(true);
            try (OutputStream output = connection.getOutputStream()) { output.write(payload.getBytes(StandardCharsets.UTF_8)); }
        }
        int code = connection.getResponseCode();
        connection.disconnect();
        return code;
    }

    private static String requestText(Context context, String method, String path, String payload) throws Exception {
        HttpURLConnection connection = open(context, method, path);
        if (payload != null) {
            connection.setDoOutput(true);
            try (OutputStream output = connection.getOutputStream()) { output.write(payload.getBytes(StandardCharsets.UTF_8)); }
        }
        InputStream stream = connection.getResponseCode() < 400 ? connection.getInputStream() : connection.getErrorStream();
        StringBuilder text = new StringBuilder();
        if (stream != null) try (BufferedReader reader = new BufferedReader(new java.io.InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line; while ((line = reader.readLine()) != null) text.append(line);
        }
        connection.disconnect();
        return text.toString();
    }

    private static HttpURLConnection open(Context context, String method, String path) throws Exception {
        String base = BridgePreferences.value(context, BridgePreferences.URL).replaceAll("/+$", "");
        HttpURLConnection connection = (HttpURLConnection) new URL(base + path).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(12000);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        String key = BridgePreferences.value(context, BridgePreferences.API_KEY);
        if (!key.isEmpty()) connection.setRequestProperty("X-VoiceCAP-Key", key);
        return connection;
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
