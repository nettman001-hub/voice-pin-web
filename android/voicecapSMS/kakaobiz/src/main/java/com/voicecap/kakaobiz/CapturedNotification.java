package com.voicecap.kakaobiz;

import org.json.JSONException;
import org.json.JSONObject;

/** 화면에 보여 줄 알림 한 건. 휴대폰 안(SharedPreferences)에만 저장하고 어디로도 보내지 않는다. */
final class CapturedNotification {
    final String key;
    final long postedAt;
    final String pkg;
    final String label;
    final String title;
    final String text;
    final String bigText;
    final String subText;
    final String lines;
    final String messages;
    final String actions;
    final String meta;
    final String extrasDump;

    CapturedNotification(String key, long postedAt, String pkg, String label, String title, String text, String bigText,
                         String subText, String lines, String messages, String actions, String meta, String extrasDump) {
        this.key = key;
        this.postedAt = postedAt;
        this.pkg = pkg;
        this.label = label;
        this.title = title;
        this.text = text;
        this.bigText = bigText;
        this.subText = subText;
        this.lines = lines;
        this.messages = messages;
        this.actions = actions;
        this.meta = meta;
        this.extrasDump = extrasDump;
    }

    /** 같은 알림이 같은 내용으로 다시 올라오면 한 건으로 본다. */
    String fingerprint() {
        return key + "|" + postedAt + "|" + (title + "\u0001" + text + "\u0001" + bigText + "\u0001" + messages).hashCode();
    }

    /** 알림 안에 들어 있는 가장 긴 본문 글자 수 (화면에 보이는 글보다 긴지 확인하는 용도). */
    int longestTextLength() {
        int longest = Math.max(text.length(), bigText.length());
        longest = Math.max(longest, lines.length());
        return Math.max(longest, messages.length());
    }

    JSONObject toJson() throws JSONException {
        return new JSONObject()
            .put("key", key).put("postedAt", postedAt).put("pkg", pkg).put("label", label)
            .put("title", title).put("text", text).put("bigText", bigText).put("subText", subText)
            .put("lines", lines).put("messages", messages).put("actions", actions)
            .put("meta", meta).put("extrasDump", extrasDump);
    }

    static CapturedNotification fromJson(JSONObject o) {
        return new CapturedNotification(
            o.optString("key"), o.optLong("postedAt"), o.optString("pkg"), o.optString("label"),
            o.optString("title"), o.optString("text"), o.optString("bigText"), o.optString("subText"),
            o.optString("lines"), o.optString("messages"), o.optString("actions"),
            o.optString("meta"), o.optString("extrasDump"));
    }
}
