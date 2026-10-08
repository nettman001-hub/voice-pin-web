package com.voicecap.sms;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 문자연동 탭(기본 탭). 상단 바: 연결 상태 점(초록/회색) + 미동기화 건수 + ⚙ 설정.
 * 기본 문자앱이 아니거나 알림 권한이 없으면 경고 띠와 다시 요청 버튼을 보여 준다.
 * 대화 목록·대화방은 Phase 2에서 이 탭에 들어온다.
 */
@SuppressLint("ViewConstructor") // 코드로만 만든다 (XML 레이아웃 없음).
final class SmsHomeView extends LinearLayout {
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    private final MainActivity activity;
    private final GradientDrawable dot = new GradientDrawable();
    private final TextView connection;
    private final TextView unsynced;
    private final LinearLayout roleBanner;
    private final LinearLayout notificationBanner;

    SmsHomeView(MainActivity activity) {
        super(activity);
        this.activity = activity;
        setOrientation(VERTICAL);
        setBackgroundColor(Ui.SLATE_50);

        LinearLayout bar = new LinearLayout(activity);
        bar.setOrientation(HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(Ui.dp(activity, 18), Ui.dp(activity, 10), Ui.dp(activity, 6), Ui.dp(activity, 10));
        bar.setBackgroundColor(Color.WHITE);

        dot.setShape(GradientDrawable.OVAL);
        View dotView = new View(activity);
        dotView.setBackground(dot);
        LayoutParams dotParams = new LayoutParams(Ui.dp(activity, 10), Ui.dp(activity, 10));
        dotParams.rightMargin = Ui.dp(activity, 8);
        bar.addView(dotView, dotParams);

        LinearLayout copy = new LinearLayout(activity);
        copy.setOrientation(VERTICAL);
        connection = Ui.title(activity, "", 15);
        unsynced = new TextView(activity);
        unsynced.setTextSize(12);
        unsynced.setTextColor(Ui.SLATE_500);
        copy.addView(connection);
        copy.addView(unsynced);
        bar.addView(copy, new LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView settings = new TextView(activity);
        settings.setText("⚙");
        settings.setTextSize(22);
        settings.setTextColor(Ui.SLATE_700);
        settings.setGravity(Gravity.CENTER);
        settings.setContentDescription("문자 연동 설정");
        settings.setOnClickListener(v -> activity.startActivity(new Intent(activity, SettingsActivity.class)));
        bar.addView(settings, new LayoutParams(Ui.dp(activity, 48), Ui.dp(activity, 48)));
        addView(bar, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        ScrollView scroll = new ScrollView(activity);
        LinearLayout column = new LinearLayout(activity);
        column.setOrientation(VERTICAL);
        column.setPadding(Ui.dp(activity, 16), Ui.dp(activity, 16), Ui.dp(activity, 16), Ui.dp(activity, 24));
        scroll.addView(column, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        addView(scroll, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        roleBanner = Ui.banner(activity);
        roleBanner.addView(Ui.title(activity, "VoiceCAP이 기본 문자앱이 아닙니다", 15));
        roleBanner.addView(Ui.body(activity, "받은 문자 저장, 새 문자 알림, 답장과 웹 발송이 멈춰 있습니다."));
        Button role = Ui.button(activity, "기본 문자앱으로 다시 설정", true);
        role.setOnClickListener(v -> activity.requestDefaultSmsApp());
        roleBanner.addView(role);
        column.addView(roleBanner);

        notificationBanner = Ui.banner(activity);
        notificationBanner.addView(Ui.title(activity, "알림 권한이 꺼져 있습니다", 15));
        notificationBanner.addView(Ui.body(activity, "새 문자가 와도 알림이 표시되지 않습니다."));
        Button notify = Ui.button(activity, "알림 허용", true);
        notify.setOnClickListener(v -> activity.requestNotificationPermission());
        notificationBanner.addView(notify);
        column.addView(notificationBanner);

        LinearLayout info = Ui.card(activity);
        info.addView(Ui.title(activity, "대화 목록은 다음 업데이트에서 제공됩니다", 16));
        info.addView(Ui.body(activity, "받은 문자는 휴대폰 문자함에 저장됩니다. 새 문자는 알림에서 확인하고, 알림의 \"답장\"으로 바로 보낼 수 있습니다."));
        column.addView(info);
    }

    void refresh() {
        boolean configured = BridgePreferences.configured(activity);
        boolean consent = BridgePreferences.hasDataTransferConsent(activity);
        boolean defaultApp = SmsRoleUtils.isDefaultSmsApp(activity);
        boolean connected = configured && consent && defaultApp;
        dot.setColor(connected ? Ui.EMERALD_500 : Ui.SLATE_400);
        connection.setText(connected ? "VoiceCAP 연결됨" : !configured ? "웹앱과 연결 안 됨" : !consent ? "전송 동의 필요" : "기본 문자앱 아님");
        roleBanner.setVisibility(defaultApp ? GONE : VISIBLE);
        notificationBanner.setVisibility(SmsRoleUtils.needsNotificationPermission(activity) ? VISIBLE : GONE);
        EXECUTOR.execute(() -> {
            int count = LocalDb.get(activity).unsyncedCount();
            post(() -> unsynced.setText(count == 0 ? "미동기화 없음" : "미동기화 " + count + "건"));
        });
    }
}
