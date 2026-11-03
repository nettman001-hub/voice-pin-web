package com.voicecap.sales;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.UUID;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * PC 댓글도우미 연결 토큰 보관함. 토큰은 Android Keystore의 AES-GCM 키로 암호화해 앱 전용 저장소에 둔다.
 * 키는 기기 밖으로 나가지 않으며, 앱을 지우면 함께 사라진다(다시 PC 승인 필요).
 */
final class HelperLinkVault {
    private static final String KEY_ALIAS = "voicecap-helper-link";
    private static final String PREFS = "voicecap-helper-link";
    private static final String INSTALL_ID = "install-id";

    private final SharedPreferences prefs;

    HelperLinkVault(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String slot(String workspaceId) {
        String clean = workspaceId == null ? "" : workspaceId.replaceAll("[^A-Za-z0-9-]", "");
        return "link:" + clean;
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generator.generateKey();
    }

    synchronized boolean put(String workspaceId, String token) {
        if (token == null || token.isEmpty() || token.length() > 200) return false;
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] sealed = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
            String value = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(sealed, Base64.NO_WRAP);
            return prefs.edit().putString(slot(workspaceId), value).commit();
        } catch (Exception e) {
            return false;
        }
    }

    synchronized String get(String workspaceId) {
        String value = prefs.getString(slot(workspaceId), "");
        int split = value.indexOf(':');
        if (split <= 0) return "";
        try {
            byte[] iv = Base64.decode(value.substring(0, split), Base64.NO_WRAP);
            byte[] sealed = Base64.decode(value.substring(split + 1), Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(sealed), StandardCharsets.UTF_8);
        } catch (Exception e) {
            // 키가 사라졌거나 손상됨: 다시 연결하도록 지운다.
            prefs.edit().remove(slot(workspaceId)).apply();
            return "";
        }
    }

    synchronized void clear(String workspaceId) {
        prefs.edit().remove(slot(workspaceId)).apply();
    }

    /** 이 설치를 구분하는 값(비밀 아님). 앱을 지우면 바뀐다. */
    synchronized String installId() {
        String id = prefs.getString(INSTALL_ID, "");
        if (id.isEmpty()) {
            byte[] bytes = new byte[16];
            new SecureRandom().nextBytes(bytes);
            id = UUID.nameUUIDFromBytes(bytes).toString();
            prefs.edit().putString(INSTALL_ID, id).apply();
        }
        return id;
    }
}
