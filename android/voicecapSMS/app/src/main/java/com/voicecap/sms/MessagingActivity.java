package com.voicecap.sms;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * 대화방·새 문자 화면의 공통 틀: 상단 바(뒤로·제목), 기본 문자앱 해제 경고 띠 + 다시 요청 버튼, 발송 잠금,
 * 선택 권한(연락처·전화 상태) 요청.
 */
abstract class MessagingActivity extends Activity {
    private static final int ROLE_REQUEST = 911;
    private static final int SMS_PERMISSION_REQUEST = 912;
    private static final int PHONE_STATE_REQUEST = 913;
    private static final int CONTACTS_REQUEST = 914;

    protected LinearLayout root;
    protected TextView titleView;
    protected TextView subtitleView;
    protected SendBar sendBar;
    private LinearLayout roleBanner;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().setNavigationBarColor(Ui.SLATE_50);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Ui.SLATE_50);
        root.addView(topBar());

        roleBanner = Ui.banner(this);
        roleBanner.addView(Ui.title(this, "VoiceCAP이 기본 문자앱이 아닙니다", 15));
        roleBanner.addView(Ui.body(this, "기본 문자앱으로 다시 설정하기 전까지 문자를 보낼 수 없습니다."));
        Button role = Ui.button(this, "기본 문자앱으로 다시 설정", true);
        role.setOnClickListener(v -> requestDefaultSmsApp());
        roleBanner.addView(role);
        LinearLayout.LayoutParams bannerParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        bannerParams.setMargins(Ui.dp(this, 12), Ui.dp(this, 10), Ui.dp(this, 12), 0);
        root.addView(roleBanner, bannerParams);
        Ui.applySystemBarInsets(root);
        setContentView(root);
    }

    private View topBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(Ui.dp(this, 4), Ui.dp(this, 6), Ui.dp(this, 12), Ui.dp(this, 6));
        bar.setBackgroundColor(Color.WHITE);
        bar.setElevation(Ui.dp(this, 2));
        TextView back = new TextView(this);
        back.setText("←");
        back.setTextSize(22);
        back.setTextColor(Ui.SLATE_700);
        back.setGravity(Gravity.CENTER);
        back.setContentDescription("뒤로");
        back.setOnClickListener(v -> finish());
        bar.addView(back, new LinearLayout.LayoutParams(Ui.dp(this, 48), Ui.dp(this, 48)));
        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        titleView = Ui.title(this, "", 17);
        titleView.setSingleLine(true);
        subtitleView = new TextView(this);
        subtitleView.setTextSize(12);
        subtitleView.setTextColor(Ui.SLATE_500);
        subtitleView.setSingleLine(true);
        subtitleView.setVisibility(View.GONE);
        copy.addView(titleView);
        copy.addView(subtitleView);
        bar.addView(copy, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        return bar;
    }

    /** 화면 아래에 붙는 입력창. 하위 화면이 본문을 다 넣은 뒤 호출한다. */
    protected void addSendBar(SendBar.Listener listener) {
        sendBar = new SendBar(this, listener);
        root.addView(sendBar);
    }

    @Override
    protected void onResume() {
        super.onResume();
        updateSendLock();
    }

    /** 기본 문자앱이 아니거나 문자 권한이 없으면 경고 띠를 보이고 보내기를 잠근다. */
    protected void updateSendLock() {
        boolean canSend = canSend();
        roleBanner.setVisibility(canSend ? View.GONE : View.VISIBLE);
        if (sendBar != null) {
            sendBar.setLocked(!canSend);
            sendBar.reloadSims();
        }
    }

    protected boolean canSend() {
        return SmsRoleUtils.isDefaultSmsApp(this) && SmsRoleUtils.hasSmsPermissions(this);
    }

    void requestDefaultSmsApp() {
        if (SmsRoleUtils.isDefaultSmsApp(this)) {
            if (!SmsRoleUtils.hasSmsPermissions(this)) requestPermissions(SmsRoleUtils.SMS_PERMISSIONS, SMS_PERMISSION_REQUEST);
            return;
        }
        Intent intent = SmsRoleUtils.roleRequestIntent(this);
        if (intent == null) Toast.makeText(this, R.string.status_role_unavailable, Toast.LENGTH_LONG).show();
        else startActivityForResult(intent, ROLE_REQUEST);
    }

    void requestPhoneStatePermission() {
        requestPermissions(new String[]{Manifest.permission.READ_PHONE_STATE}, PHONE_STATE_REQUEST);
    }

    void requestContactsPermission() {
        requestPermissions(new String[]{Manifest.permission.READ_CONTACTS}, CONTACTS_REQUEST);
    }

    /** 연락처 권한 결과 (허용했으면 이름을 다시 읽는다). */
    protected void onContactsPermissionResult(boolean granted) { }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != ROLE_REQUEST) return;
        if (SmsRoleUtils.isDefaultSmsApp(this) && !SmsRoleUtils.hasSmsPermissions(this)) {
            requestPermissions(SmsRoleUtils.SMS_PERMISSIONS, SMS_PERMISSION_REQUEST);
        }
        updateSendLock();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == CONTACTS_REQUEST) onContactsPermissionResult(ConversationStore.canReadContacts(this));
        updateSendLock();
    }
}
