package com.voicecap.kakaobiz;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import java.util.Set;
import java.util.TreeSet;

/**
 * 알림 접근으로 다른 앱의 알림을 읽는다. 고른 앱(기본: 카카오비즈 파트너센터)의 알림만 내용을 저장하고
 * 휴대폰 화면에만 보여 준다. 이 앱에는 INTERNET 권한이 없어 어디로도 보낼 수 없다.
 */
public final class NotificationCaptureService extends NotificationListenerService {
    private static final int EXTRA_VALUE_LIMIT = 4000;

    @Override
    public void onListenerConnected() {
        // 이미 떠 있는 알림도 한 번 읽는다(앱을 켜기 전에 온 알림 확인용).
        try {
            StatusBarNotification[] active = getActiveNotifications();
            if (active != null) for (StatusBarNotification sbn : active) handle(sbn);
        } catch (RuntimeException ignored) {
            // 연결 직후 일시 오류는 무시
        }
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        handle(sbn);
    }

    private void handle(StatusBarNotification sbn) {
        if (sbn == null || getPackageName().equals(sbn.getPackageName())) return;
        Notification n = sbn.getNotification();
        if (n == null) return;
        String pkg = sbn.getPackageName();
        String label = labelOf(sbn, n);
        // 고르지 않은 앱은 앱 이름만 기억하고 알림 내용은 읽지도 저장하지도 않는다.
        if (!CaptureStore.seenApp(this, pkg, label)) return;
        CaptureStore.add(this, build(sbn, n, label));
    }

    private String labelOf(StatusBarNotification sbn, Notification n) {
        Bundle extras = n.extras;
        if (extras != null) {
            ApplicationInfo info = extras.getParcelable("android.appInfo");
            if (info != null) {
                CharSequence label = info.loadLabel(getPackageManager());
                if (label != null && label.length() > 0) return label.toString();
            }
        }
        return sbn.getPackageName();
    }

    private CapturedNotification build(StatusBarNotification sbn, Notification n, String label) {
        Bundle e = n.extras != null ? n.extras : new Bundle();
        return new CapturedNotification(
            sbn.getKey(), sbn.getPostTime(), sbn.getPackageName(), label,
            str(e.getCharSequence(Notification.EXTRA_TITLE)),
            str(e.getCharSequence(Notification.EXTRA_TEXT)),
            str(e.getCharSequence(Notification.EXTRA_BIG_TEXT)),
            str(e.getCharSequence(Notification.EXTRA_SUB_TEXT)),
            lines(e), messages(e), actions(n), meta(sbn, n, e), dump(e));
    }

    private static String str(CharSequence value) {
        return value == null ? "" : value.toString();
    }

    private static String lines(Bundle e) {
        CharSequence[] lines = e.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
        if (lines == null) return "";
        StringBuilder out = new StringBuilder();
        for (CharSequence line : lines) out.append(line).append('\n');
        return out.toString().trim();
    }

    /** MessagingStyle 알림이면 보낸 사람과 메시지를 한 줄씩. */
    @SuppressWarnings("deprecation")
    private static String messages(Bundle e) {
        android.os.Parcelable[] array = e.getParcelableArray(Notification.EXTRA_MESSAGES);
        if (array == null) return "";
        StringBuilder out = new StringBuilder();
        for (android.os.Parcelable item : array) {
            if (!(item instanceof Bundle)) continue;
            Bundle message = (Bundle) item;
            CharSequence sender = message.getCharSequence("sender");
            out.append(sender != null ? sender : "(보낸 사람 없음)").append(": ").append(str(message.getCharSequence("text"))).append('\n');
        }
        return out.toString().trim();
    }

    /** 알림에 붙은 버튼과 "답장 입력칸(RemoteInput)" 유무. 보이기만 하고 누르지는 않는다. */
    private static String actions(Notification n) {
        if (n.actions == null || n.actions.length == 0) return "(버튼 없음)";
        StringBuilder out = new StringBuilder();
        for (Notification.Action action : n.actions) {
            boolean reply = action.getRemoteInputs() != null && action.getRemoteInputs().length > 0;
            out.append("• ").append(str(action.title)).append(reply ? "  [답장 입력칸 있음]" : "  [버튼]").append('\n');
        }
        return out.toString().trim();
    }

    private static String meta(StatusBarNotification sbn, Notification n, Bundle e) {
        Set<String> flags = new TreeSet<>();
        if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) flags.add("그룹요약");
        if ((n.flags & Notification.FLAG_ONGOING_EVENT) != 0) flags.add("진행중");
        String template = e.getString(Notification.EXTRA_TEMPLATE);
        return "key=" + sbn.getKey()
            + "\nid=" + sbn.getId() + " tag=" + sbn.getTag()
            + "\nchannel=" + n.getChannelId() + " category=" + n.category
            + "\nshortcutId=" + n.getShortcutId() + " group=" + n.getGroup()
            + "\ntemplate=" + template
            + "\nflags=" + flags
            + "\ncontentIntent=" + (n.contentIntent != null ? describe(n.contentIntent) : "없음");
    }

    private static String describe(PendingIntent intent) {
        return intent.getCreatorPackage();
    }

    /** extras의 모든 항목을 글자로. 큰 값은 잘라서 길이를 같이 적는다. */
    private static String dump(Bundle e) {
        StringBuilder out = new StringBuilder();
        for (String key : new TreeSet<>(e.keySet())) {
            Object value = e.get(key);
            String text;
            if (value instanceof CharSequence) text = value.toString();
            else if (value instanceof Object[]) text = java.util.Arrays.deepToString((Object[]) value);
            else text = String.valueOf(value);
            out.append(key).append(" (").append(value == null ? "null" : value.getClass().getSimpleName());
            if (value instanceof CharSequence) out.append(", ").append(text.length()).append("자");
            out.append(") = ");
            out.append(text.length() > EXTRA_VALUE_LIMIT ? text.substring(0, EXTRA_VALUE_LIMIT) + "…" : text).append('\n');
        }
        return out.toString().trim();
    }
}
