package com.voicecap.sms;

import android.Manifest;
import android.app.Activity;
import android.app.role.RoleManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.provider.Telephony;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private EditText urlInput;
    private EditText keyInput;
    private EditText sellerInput;
    private TextView status;
    private static final int PERMISSION_REQUEST = 901;
    private static final int ROLE_REQUEST = 902;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(buildContent());
        loadValues();
        SyncScheduler.schedule(getApplicationContext());
    }

    private View buildContent() {
        int padding = (int) (20 * getResources().getDisplayMetrics().density);
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(padding, padding, padding, padding);

        TextView title = text("voicecapSMS", 24); column.addView(title);
        TextView description = text("수신 문자·MMS 이미지를 VoiceCAP 판매 대조 서버로 전송하고, 웹에서 요청한 SMS 발송을 처리합니다. HTTPS 또는 신뢰하는 동일 Wi‑Fi에서만 사용하세요.", 14); column.addView(description);
        urlInput = input("서버 주소 (예: http://192.168.0.10:2137)"); column.addView(urlInput);
        keyInput = input("VoiceCAP API 키"); column.addView(keyInput);
        sellerInput = input("판매자 ID (웹앱과 동일, 예: u-seller-1)"); column.addView(sellerInput);

        Button save = button("연동 정보 저장"); save.setOnClickListener(v -> saveValues()); column.addView(save);
        Button permissions = button("문자 권한 허용"); permissions.setOnClickListener(v -> requestSmsPermissions()); column.addView(permissions);
        Button role = button("기본 SMS 앱으로 설정"); role.setOnClickListener(v -> requestSmsRole()); column.addView(role);
        Button sync = button("지금 동기화 및 발송 처리"); sync.setOnClickListener(v -> syncInBackground()); column.addView(sync);
        Button settings = button("앱 권한 설정 열기"); settings.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + getPackageName())))); column.addView(settings);
        status = text("연결 정보를 저장한 뒤 문자 권한을 허용하세요.", 14); status.setPadding(0, padding, 0, 0); column.addView(status);
        ScrollView scroll = new ScrollView(this); scroll.addView(column); return scroll;
    }

    private TextView text(String value, int size) { TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setPadding(0, 0, 0, 14); return view; }
    private EditText input(String hint) { EditText view = new EditText(this); view.setHint(hint); view.setTextSize(15); view.setPadding(0, 10, 0, 10); return view; }
    private Button button(String label) { Button view = new Button(this); view.setText(label); return view; }

    private void loadValues() {
        urlInput.setText(BridgePreferences.value(this, BridgePreferences.URL));
        keyInput.setText(BridgePreferences.value(this, BridgePreferences.API_KEY));
        sellerInput.setText(BridgePreferences.value(this, BridgePreferences.SELLER_ID));
    }

    private void saveValues() {
        String url = urlInput.getText().toString().trim().replaceAll("/+$", "");
        BridgePreferences.get(this).edit().putString(BridgePreferences.URL, url).putString(BridgePreferences.API_KEY, keyInput.getText().toString().trim()).putString(BridgePreferences.SELLER_ID, sellerInput.getText().toString().trim()).apply();
        SyncScheduler.schedule(getApplicationContext());
        status.setText("연동 정보를 저장했습니다.");
    }

    private void requestSmsPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) requestPermissions(new String[]{Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS, Manifest.permission.SEND_SMS, Manifest.permission.RECEIVE_MMS, Manifest.permission.RECEIVE_WAP_PUSH}, PERMISSION_REQUEST);
    }

    private void requestSmsRole() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            RoleManager manager = getSystemService(RoleManager.class);
            if (manager != null && manager.isRoleAvailable(RoleManager.ROLE_SMS)) startActivityForResult(manager.createRequestRoleIntent(RoleManager.ROLE_SMS), ROLE_REQUEST);
            else status.setText("이 기기에서 SMS 역할을 사용할 수 없습니다.");
        } else {
            Intent intent = new Intent(Telephony.Sms.Intents.ACTION_CHANGE_DEFAULT);
            intent.putExtra(Telephony.Sms.Intents.EXTRA_PACKAGE_NAME, getPackageName()); startActivity(intent);
        }
    }

    private void syncInBackground() {
        saveValues(); status.setText("수신 문자와 발송 대기 문자를 처리하는 중...");
        Executors.newSingleThreadExecutor().execute(() -> {
            String result = SmsSyncManager.syncNow(getApplicationContext());
            runOnUiThread(() -> status.setText(result));
        });
    }
}
