package com.voicecap.sms;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.role.RoleManager;
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
    private static final int PERMISSION_REQUEST = 901;
    private static final int ROLE_REQUEST = 902;
    private EditText urlInput;
    private EditText keyInput;
    private EditText sellerInput;
    private TextView status;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(buildContent());
        loadValues();
        SyncScheduler.schedule(getApplicationContext());
    }

    @Override protected void onResume() {
        super.onResume();
        if (status != null) updateSetupStatus();
    }

    private View buildContent() {
        int padding = (int) (20 * getResources().getDisplayMetrics().density);
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(padding, padding, padding, padding);

        column.addView(text("VoiceCAP SMS Bridge", 24));
        column.addView(text("판매 고객이 보낸 구매정보 문자만 VoiceCAP 서버로 전송하고, 웹앱에서 판매자가 요청한 정산·배송·문의 문자를 발송합니다.", 14));
        column.addView(text("전송 조건: 문자에 닉네임, 주소, 상품 또는 금액 항목이 함께 있어야 합니다. 인증번호·은행·일반 개인 문자는 전송하지 않습니다.", 13));

        urlInput = input("서버 주소 (운영: HTTPS, 사내망 예: http://192.168.0.10:2137)");
        keyInput = input("VoiceCAP API 키");
        sellerInput = input("판매자 ID (웹앱과 동일, 예: u-seller-1)");
        column.addView(urlInput); column.addView(keyInput); column.addView(sellerInput);

        Button save = button("연동 정보 저장");
        save.setOnClickListener(v -> saveValues());
        column.addView(save);

        Button setup = button("동의 후 기본 SMS 앱·권한 설정");
        setup.setOnClickListener(v -> beginProtectedSetup());
        column.addView(setup);

        Button sync = button("지금 동기화 및 발송 처리");
        sync.setOnClickListener(v -> syncInBackground());
        column.addView(sync);

        Button privacy = button("개인정보 처리 안내 보기");
        privacy.setOnClickListener(v -> showDataUseNotice(false));
        column.addView(privacy);

        Button revoke = button("문자 정보 전송 동의 철회");
        revoke.setOnClickListener(v -> {
            BridgePreferences.get(this).edit().putBoolean(BridgePreferences.DATA_TRANSFER_CONSENT, false).apply();
            status.setText("전송 동의를 철회했습니다. 이후 문자 정보는 서버로 전송되지 않습니다.");
        });
        column.addView(revoke);

        Button settings = button("앱 권한 설정 열기");
        settings.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + getPackageName()))));
        column.addView(settings);

        status = text("설정 상태 확인 중...", 14);
        status.setPadding(0, padding, 0, 0);
        column.addView(status);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(column);
        return scroll;
    }

    private TextView text(String value, int size) {
        TextView view = new TextView(this);
        view.setText(value); view.setTextSize(size); view.setPadding(0, 0, 0, 14);
        return view;
    }

    private EditText input(String hint) {
        EditText view = new EditText(this);
        view.setHint(hint); view.setTextSize(15); view.setPadding(0, 10, 0, 10);
        return view;
    }

    private Button button(String label) {
        Button view = new Button(this); view.setText(label); return view;
    }

    private void loadValues() {
        urlInput.setText(BridgePreferences.value(this, BridgePreferences.URL));
        keyInput.setText(BridgePreferences.value(this, BridgePreferences.API_KEY));
        sellerInput.setText(BridgePreferences.value(this, BridgePreferences.SELLER_ID));
    }

    private boolean saveValues() {
        String url = urlInput.getText().toString().trim().replaceAll("/+$", "");
        String sellerId = sellerInput.getText().toString().trim();
        boolean privateDebugUrl = isDebugBuild() && url.matches("http://(10\\.|192\\.168\\.|172\\.(1[6-9]|2[0-9]|3[0-1])\\.).+");
        if (!(url.startsWith("https://") || privateDebugUrl)) {
            status.setText(isDebugBuild() ? R.string.status_debug_url_required : R.string.status_secure_url_required);
            return false;
        }
        if (sellerId.isEmpty()) {
            status.setText(R.string.status_seller_required);
            return false;
        }
        BridgePreferences.get(this).edit()
                .putString(BridgePreferences.URL, url)
                .putString(BridgePreferences.API_KEY, keyInput.getText().toString().trim())
                .putString(BridgePreferences.SELLER_ID, sellerId)
                .apply();
        SyncScheduler.schedule(getApplicationContext());
        status.setText("연동 정보를 저장했습니다.");
        return true;
    }

    private void beginProtectedSetup() {
        if (!saveValues()) return;
        if (BridgePreferences.hasDataTransferConsent(this)) {
            requestSmsRole();
            return;
        }
        showDataUseNotice(true);
    }

    private void showDataUseNotice(boolean continueSetup) {
        AlertDialog.Builder dialog = new AlertDialog.Builder(this)
                .setTitle(R.string.data_transfer_title)
                .setMessage(R.string.data_transfer_disclosure)
                .setCancelable(!continueSetup);
        if (continueSetup) {
            dialog.setNegativeButton(R.string.data_transfer_decline, (ignored, which) -> status.setText(R.string.status_consent_declined));
            dialog.setPositiveButton(R.string.data_transfer_accept, (ignored, which) -> {
                BridgePreferences.get(this).edit().putBoolean(BridgePreferences.DATA_TRANSFER_CONSENT, true).apply();
                requestSmsRole();
            });
        } else {
            dialog.setPositiveButton(android.R.string.ok, null);
        }
        dialog.show();
    }

    private void requestSmsRole() {
        if (SmsRoleUtils.isDefaultSmsApp(this)) {
            requestSmsPermissions();
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            RoleManager manager = getSystemService(RoleManager.class);
            if (manager != null && manager.isRoleAvailable(RoleManager.ROLE_SMS)) {
                startActivityForResult(manager.createRequestRoleIntent(RoleManager.ROLE_SMS), ROLE_REQUEST);
            } else {
                status.setText(R.string.status_role_unavailable);
            }
        } else {
            Intent intent = new Intent(Telephony.Sms.Intents.ACTION_CHANGE_DEFAULT);
            intent.putExtra(Telephony.Sms.Intents.EXTRA_PACKAGE_NAME, getPackageName());
            startActivityForResult(intent, ROLE_REQUEST);
        }
    }

    private void requestSmsPermissions() {
        if (!BridgePreferences.hasDataTransferConsent(this) || !SmsRoleUtils.isDefaultSmsApp(this)) {
            status.setText(R.string.status_setup_required);
            return;
        }
        if (SmsRoleUtils.hasSmsPermissions(this)) {
            status.setText(R.string.status_setup_complete);
            SyncScheduler.scheduleNow(getApplicationContext());
            return;
        }
        requestPermissions(new String[]{Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS, Manifest.permission.SEND_SMS, Manifest.permission.RECEIVE_MMS, Manifest.permission.RECEIVE_WAP_PUSH}, PERMISSION_REQUEST);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != ROLE_REQUEST) return;
        if (SmsRoleUtils.isDefaultSmsApp(this)) requestSmsPermissions();
        else status.setText(R.string.status_role_cancelled);
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != PERMISSION_REQUEST) return;
        if (SmsRoleUtils.hasSmsPermissions(this)) {
            status.setText(R.string.status_sync_ready);
            SyncScheduler.scheduleNow(getApplicationContext());
        } else {
            status.setText("문자 권한이 모두 허용되지 않아 연동을 시작할 수 없습니다.");
        }
    }

    private void updateSetupStatus() {
        if (!BridgePreferences.hasDataTransferConsent(this)) status.setText("문자 정보 전송 동의가 필요합니다.");
        else if (!SmsRoleUtils.isDefaultSmsApp(this)) status.setText(R.string.status_role_required);
        else if (!SmsRoleUtils.hasSmsPermissions(this)) status.setText(R.string.status_permission_required);
        else status.setText(R.string.status_bridge_ready);
    }

    private void syncInBackground() {
        if (!saveValues()) return;
        if (!BridgePreferences.hasDataTransferConsent(this) || !SmsRoleUtils.isDefaultSmsApp(this) || !SmsRoleUtils.hasSmsPermissions(this)) {
            beginProtectedSetup();
            return;
        }
        status.setText("구매정보 문자와 발송 대기 문자를 처리하는 중...");
        Executors.newSingleThreadExecutor().execute(() -> {
            String result = SmsSyncManager.syncNow(getApplicationContext());
            runOnUiThread(() -> status.setText(result));
        });
    }

    private boolean isDebugBuild() {
        return (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }
}
