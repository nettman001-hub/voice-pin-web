package com.voicecap.sms;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * 첫 실행 안내: 앱 소개 → 채팅+(RCS) 안내 → 기본 문자앱 지정·문자 권한 → 알림 권한(Android 13+) → 문자 탭.
 * 서버 연결과 전송 동의는 여기서 받지 않는다 (⚙ 설정의 휴대폰 연결에서 따로 받는다).
 */
public final class OnboardingActivity extends Activity {
    static final String PREF_DONE = "onboarding_done";
    private static final String STATE_STEP = "step";
    private static final int ROLE_REQUEST = 1001;
    private static final int SMS_PERMISSION_REQUEST = 1002;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1003;

    private static final int STEP_WELCOME = 0;
    private static final int STEP_RCS = 1;
    private static final int STEP_DEFAULT_APP = 2;
    private static final int STEP_NOTIFICATIONS = 3;
    private static final int STEP_COUNT = 4;

    private int step;
    private LinearLayout page;
    private TextView progress;
    private Button next;
    private Button back;
    private TextView stepStatus;

    static boolean isDone(Context context) {
        return BridgePreferences.get(context).getBoolean(PREF_DONE, false);
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().setNavigationBarColor(Ui.SLATE_50);
        step = state == null ? STEP_WELCOME : state.getInt(STATE_STEP, STEP_WELCOME);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Ui.SLATE_50);
        root.setPadding(Ui.dp(this, 20), Ui.dp(this, 24), Ui.dp(this, 20), Ui.dp(this, 20));

        progress = new TextView(this);
        progress.setTextSize(13);
        progress.setTextColor(Ui.SLATE_500);
        root.addView(progress);

        ScrollView scroll = new ScrollView(this);
        page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(0, Ui.dp(this, 12), 0, Ui.dp(this, 12));
        scroll.addView(page, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        LinearLayout nav = new LinearLayout(this);
        nav.setOrientation(LinearLayout.HORIZONTAL);
        back = Ui.button(this, "이전", false);
        back.setLayoutParams(weighted(1f, 0));
        back.setOnClickListener(v -> show(step - 1));
        next = Ui.button(this, "다음", true);
        next.setLayoutParams(weighted(2f, Ui.dp(this, 10)));
        next.setOnClickListener(v -> {
            if (step >= STEP_COUNT - 1) finishOnboarding();
            else show(step + 1);
        });
        nav.addView(back);
        nav.addView(next);
        root.addView(nav);

        Ui.applySystemBarInsets(root);
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, () -> {
                if (step > STEP_WELCOME) show(step - 1);
                else finish();
            });
        }
        show(step);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        outState.putInt(STATE_STEP, step);
    }

    @Override
    protected void onResume() {
        super.onResume();
        refreshStepStatus();
    }

    /** Android 12 이하용. 13+는 onCreate에서 등록한 뒤로 가기 콜백이 처리한다 (targetSdk 36에서는 이 메서드가 불리지 않음). */
    @Override
    @SuppressWarnings("deprecation")
    @SuppressLint("GestureBackNavigation") // 13+ 뒤로 가기(제스처 포함)는 OnBackInvokedCallback이 처리한다.
    public void onBackPressed() {
        if (step > STEP_WELCOME) show(step - 1);
        else super.onBackPressed();
    }

    private LinearLayout.LayoutParams weighted(float weight, int leftMargin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, Ui.dp(this, 52), weight);
        params.leftMargin = leftMargin;
        params.topMargin = Ui.dp(this, 8);
        return params;
    }

    private void show(int target) {
        step = Math.max(STEP_WELCOME, Math.min(STEP_COUNT - 1, target));
        page.removeAllViews();
        stepStatus = null;
        progress.setText(String.format(java.util.Locale.ROOT, "%d / %d", step + 1, STEP_COUNT));
        back.setVisibility(step == STEP_WELCOME ? View.INVISIBLE : View.VISIBLE);
        next.setText(step == STEP_COUNT - 1 ? "시작하기" : "다음");
        switch (step) {
            case STEP_WELCOME: buildWelcome(); break;
            case STEP_RCS: buildRcs(); break;
            case STEP_DEFAULT_APP: buildDefaultApp(); break;
            default: buildNotifications(); break;
        }
        refreshStepStatus();
    }

    private void buildWelcome() {
        page.addView(Ui.title(this, "VoiceCAP 문자", 26));
        LinearLayout card = Ui.card(this);
        card.addView(Ui.title(this, "고객 문자를 놓치지 않게", 17));
        card.addView(Ui.body(this, "• 받은 문자와 사진 문자를 휴대폰 문자함에 저장합니다.\n"
                + "• 새 문자가 오면 알림을 띄우고, 알림에서 바로 답장할 수 있습니다.\n"
                + "• 휴대폰을 VoiceCAP 웹앱에 연결하고 동의하면, 구매정보 문자와 업무 고객의 문자만 VoiceCAP에 올립니다. 개인 문자는 올리지 않습니다."));
        page.addView(spaced(card));
    }

    private void buildRcs() {
        page.addView(Ui.title(this, getString(R.string.rcs_notice_title), 24));
        LinearLayout card = isSamsung() ? Ui.banner(this) : Ui.card(this);
        if (isSamsung()) card.addView(Ui.title(this, "갤럭시 사용자는 꼭 읽어 주세요", 16));
        card.addView(Ui.body(this, getString(R.string.rcs_notice_body)));
        page.addView(spaced(card));
    }

    private void buildDefaultApp() {
        page.addView(Ui.title(this, "기본 문자앱으로 설정", 24));
        LinearLayout card = Ui.card(this);
        card.addView(Ui.body(this, "VoiceCAP이 문자를 받고 보내려면 기본 문자앱이어야 합니다. 이어서 문자(SMS/MMS) 권한을 허용해 주세요.\n\n"
                + "나중에 ⚙ 설정에서 다시 할 수도 있습니다."));
        stepStatus = Ui.body(this, "");
        card.addView(stepStatus);
        Button action = Ui.button(this, "기본 문자앱으로 설정", true);
        action.setOnClickListener(v -> requestDefaultApp());
        card.addView(action);
        page.addView(spaced(card));
    }

    private void buildNotifications() {
        page.addView(Ui.title(this, "새 문자 알림", 24));
        LinearLayout card = Ui.card(this);
        card.addView(Ui.body(this, "새 문자가 오면 알림으로 알려 드리고, 알림에서 바로 답장하거나 읽음으로 표시할 수 있습니다."));
        stepStatus = Ui.body(this, "");
        card.addView(stepStatus);
        if (Build.VERSION.SDK_INT >= 33) {
            Button action = Ui.button(this, "알림 허용", true);
            action.setOnClickListener(v -> {
                if (SmsRoleUtils.needsNotificationPermission(this)) {
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
                }
            });
            card.addView(action);
        }
        page.addView(spaced(card));
    }

    private void refreshStepStatus() {
        if (stepStatus == null) return;
        String text;
        if (step == STEP_DEFAULT_APP) {
            if (!SmsRoleUtils.isDefaultSmsApp(this)) text = "아직 기본 문자앱이 아닙니다.";
            else if (!SmsRoleUtils.hasSmsPermissions(this)) text = "기본 문자앱 ✓  ·  문자 권한 허용이 필요합니다.";
            else text = "✓ 기본 문자앱 · 문자 권한 설정 완료";
        } else {
            text = SmsRoleUtils.needsNotificationPermission(this) ? "알림 권한이 아직 없습니다." : "✓ 알림을 받을 수 있습니다.";
        }
        stepStatus.setText(text);
        stepStatus.setTextColor(text.startsWith("✓") ? Ui.EMERALD_500 : Ui.AMBER_800);
        stepStatus.setTypeface(null, android.graphics.Typeface.BOLD);
    }

    private void requestDefaultApp() {
        if (SmsRoleUtils.isDefaultSmsApp(this)) {
            requestSmsPermissions();
            return;
        }
        Intent intent = SmsRoleUtils.roleRequestIntent(this);
        if (intent == null) {
            stepStatus.setText(R.string.status_role_unavailable);
            return;
        }
        startActivityForResult(intent, ROLE_REQUEST);
    }

    private void requestSmsPermissions() {
        if (SmsRoleUtils.hasSmsPermissions(this)) {
            refreshStepStatus();
            return;
        }
        requestPermissions(SmsRoleUtils.SMS_PERMISSIONS, SMS_PERMISSION_REQUEST);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != ROLE_REQUEST) return;
        if (SmsRoleUtils.isDefaultSmsApp(this)) requestSmsPermissions();
        refreshStepStatus();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        refreshStepStatus();
        if (requestCode == SMS_PERMISSION_REQUEST && SmsRoleUtils.hasSmsPermissions(this)) {
            SyncScheduler.scheduleNow(getApplicationContext(), true);
        }
    }

    private void finishOnboarding() {
        BridgePreferences.get(this).edit().putBoolean(PREF_DONE, true).apply();
        startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP));
        finish();
    }

    private View spaced(View view) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.topMargin = Ui.dp(this, 16);
        view.setLayoutParams(params);
        return view;
    }

    private static boolean isSamsung() {
        return "samsung".equalsIgnoreCase(Build.MANUFACTURER);
    }
}
