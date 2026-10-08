package com.voicecap.sms.deposit;

import android.app.Notification;
import android.os.Bundle;
import android.os.Parcelable;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 은행 알림 수집 (설계 4.2). 순서:
 * 1) 고르지 않은 앱의 알림은 즉시 버린다 (기록·전송 없음, "최근 알림을 보낸 앱" 목록에 패키지명만 메모리로 남김)
 * 2) 그룹 요약·진행 중 알림은 무시
 * 3) TITLE·TEXT·BIG_TEXT·SUB_TEXT·TEXT_LINES·MessagingStyle 글자를 모음
 * 4) 은행 규칙으로 파싱 → 실패하면 횟수만 기록(샘플 모드면 폰에 샘플 저장), 성공하면 업로드 큐에 넣음
 */
public final class BankNotificationListener extends NotificationListenerService {
    private static final int MAX_RECENT_PACKAGES = 30;
    /** 패키지명 → 마지막 알림 시각. 메모리에만 있고 앱이 꺼지면 사라진다. */
    private static final LinkedHashMap<String, Long> RECENT = new LinkedHashMap<>(16, 0.75f, true);
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();

    /** 최근에 알림을 보낸 앱 패키지명 (최근 순). 알림 내용은 담지 않는다. */
    public static synchronized List<String> recentPackages() {
        List<String> packages = new ArrayList<>(RECENT.keySet());
        java.util.Collections.reverse(packages);
        return packages;
    }

    private static synchronized void remember(String packageName) {
        RECENT.put(packageName, System.currentTimeMillis());
        Iterator<String> oldest = RECENT.keySet().iterator();
        while (RECENT.size() > MAX_RECENT_PACKAGES && oldest.hasNext()) {
            oldest.next();
            oldest.remove();
        }
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;
        String packageName = sbn.getPackageName();
        Notification notification = sbn.getNotification();
        if (packageName == null || notification == null || packageName.equals(getPackageName())) return;
        if ((notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0 || sbn.isOngoing()) return;
        remember(packageName);
        if (!DepositSettings.isSelected(this, packageName)) return;
        List<CharSequence> parts = collectText(notification.extras);
        long postTime = sbn.getPostTime();
        android.content.Context context = getApplicationContext();
        WORKER.execute(() -> DepositRecorder.handle(context, packageName, parts, postTime));
    }

    /** 알림 글자 조각. 순서는 제목 → 본문 → 큰 본문 → 보조 → 줄 목록 → 메시지. */
    static List<CharSequence> collectText(Bundle extras) {
        List<CharSequence> parts = new ArrayList<>();
        if (extras == null) return parts;
        parts.add(extras.getCharSequence(Notification.EXTRA_TITLE));
        parts.add(extras.getCharSequence(Notification.EXTRA_TEXT));
        parts.add(extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
        parts.add(extras.getCharSequence(Notification.EXTRA_SUB_TEXT));
        CharSequence[] lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
        if (lines != null) for (CharSequence line : lines) parts.add(line);
        Parcelable[] messages = messages(extras);
        if (messages != null) {
            for (Parcelable message : messages) {
                if (message instanceof Bundle) parts.add(((Bundle) message).getCharSequence("text"));
            }
        }
        return parts;
    }

    @SuppressWarnings("deprecation")
    private static Parcelable[] messages(Bundle extras) {
        try {
            return extras.getParcelableArray(Notification.EXTRA_MESSAGES);
        } catch (RuntimeException ignored) {
            return null;
        }
    }
}
