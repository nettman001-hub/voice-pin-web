package com.voicecap.sms;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.role.RoleManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.provider.Telephony;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import com.voicecap.sms.sales.FakeSalesRepository;
import com.voicecap.sms.sales.RealSalesRepository;
import com.voicecap.sms.sales.SalesRepository;
import com.voicecap.sms.sales.ui.ProductSalesView;
import java.util.ArrayList;
import java.util.List;

public final class MainActivity extends Activity {
    private static final int PERMISSION_REQUEST = 901;
    private static final int ROLE_REQUEST = 902;
    private static final int CAMERA_PERMISSION_REQUEST = 903;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 904;
    private static final String STATE_SELECTED_TAB = "state_selected_tab";

    private FrameLayout contentContainer;
    private ProductSalesView productSalesView;
    private SmsBridgeView smsBridgeView;
    private Button tabSalesBtn;
    private Button tabSmsBtn;
    private int currentTab = 0; // 0 = Sales, 1 = SMS Bridge

    private SalesRepository salesRepository;
    private Runnable pendingCameraGranted;
    private Runnable pendingCameraDenied;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().setNavigationBarColor(Color.rgb(248, 250, 252));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }

        salesRepository = BridgePreferences.configured(this)
            ? new RealSalesRepository(this)
            : new FakeSalesRepository();

        if (state != null) {
            currentTab = state.getInt(STATE_SELECTED_TAB, 0);
        }

        setContentView(buildRootLayout());
        selectTab(currentTab);
        SyncScheduler.schedule(getApplicationContext());
        if (state == null && SmsRoleUtils.isDefaultSmsApp(this)) requestNotificationPermission();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        outState.putInt(STATE_SELECTED_TAB, currentTab);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // 앱을 열면 백오프 중인 업로드·MMS 다운로드도 바로 다시 시도한다.
        SyncScheduler.scheduleNow(getApplicationContext(), true);
        if (currentTab == 0 && productSalesView != null) {
            productSalesView.start();
        } else if (currentTab == 1 && smsBridgeView != null) {
            smsBridgeView.updateSetupStatus();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (productSalesView != null) {
            productSalesView.stop();
        }
    }

    private View buildRootLayout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(248, 250, 252));

        // Top Navigation Tab Bar
        LinearLayout tabBar = new LinearLayout(this);
        tabBar.setOrientation(LinearLayout.HORIZONTAL);
        tabBar.setPadding(dp(12), dp(8), dp(12), dp(8));
        tabBar.setBackgroundColor(Color.WHITE);
        tabBar.setElevation(dp(4));

        tabSalesBtn = new Button(this);
        tabSalesBtn.setText("🛍 판매관리");
        tabSalesBtn.setTextSize(14);
        tabSalesBtn.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        LinearLayout.LayoutParams salesParams = new LinearLayout.LayoutParams(0, dp(44), 1f);
        salesParams.rightMargin = dp(4);
        tabSalesBtn.setLayoutParams(salesParams);
        tabSalesBtn.setOnClickListener(v -> selectTab(0));
        tabBar.addView(tabSalesBtn);

        tabSmsBtn = new Button(this);
        tabSmsBtn.setText("💬 문자연동");
        tabSmsBtn.setTextSize(14);
        tabSmsBtn.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        LinearLayout.LayoutParams smsParams = new LinearLayout.LayoutParams(0, dp(44), 1f);
        smsParams.leftMargin = dp(4);
        tabSmsBtn.setLayoutParams(smsParams);
        tabSmsBtn.setOnClickListener(v -> selectTab(1));
        tabBar.addView(tabSmsBtn);

        root.addView(tabBar);

        // Content Container
        contentContainer = new FrameLayout(this);
        LinearLayout.LayoutParams cParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        contentContainer.setLayoutParams(cParams);

        productSalesView = new ProductSalesView(this, salesRepository);
        smsBridgeView = new SmsBridgeView(this);

        contentContainer.addView(productSalesView);
        contentContainer.addView(smsBridgeView);
        root.addView(contentContainer);

        return root;
    }

    public void selectTab(int tabIndex) {
        currentTab = tabIndex;
        if (tabIndex == 0) {
            // Tab 0: Product Sales
            tabSalesBtn.setTextColor(Color.WHITE);
            tabSalesBtn.setBackground(roundRect(Color.rgb(14, 140, 233), Color.rgb(2, 111, 199), dp(10)));

            tabSmsBtn.setTextColor(Color.rgb(100, 116, 139));
            tabSmsBtn.setBackground(roundRect(Color.rgb(241, 245, 249), Color.TRANSPARENT, dp(10)));

            productSalesView.setVisibility(View.VISIBLE);
            smsBridgeView.setVisibility(View.GONE);
            productSalesView.start();
        } else {
            // Tab 1: SMS Bridge
            tabSalesBtn.setTextColor(Color.rgb(100, 116, 139));
            tabSalesBtn.setBackground(roundRect(Color.rgb(241, 245, 249), Color.TRANSPARENT, dp(10)));

            tabSmsBtn.setTextColor(Color.WHITE);
            tabSmsBtn.setBackground(roundRect(Color.rgb(14, 140, 233), Color.rgb(2, 111, 199), dp(10)));

            productSalesView.stop();
            productSalesView.setVisibility(View.GONE);
            smsBridgeView.setVisibility(View.VISIBLE);
            smsBridgeView.updateSetupStatus();
        }
    }

    public void beginProtectedSetup() {
        if (!BridgePreferences.configured(this)) {
            smsBridgeView.setStatus("먼저 웹앱에서 만든 기기 연결 코드로 이 휴대폰을 연결해 주세요.", SmsBridgeView.TONE_WARNING);
            return;
        }
        if (BridgePreferences.hasDataTransferConsent(this)) {
            requestSmsRole();
            return;
        }
        showDataUseNotice(true);
    }

    public void showDataUseNotice(boolean continueSetup) {
        AlertDialog.Builder dialog = new AlertDialog.Builder(this)
            .setTitle(R.string.data_transfer_title)
            .setMessage(R.string.data_transfer_disclosure)
            .setCancelable(!continueSetup);
        if (continueSetup) {
            dialog.setNegativeButton(R.string.data_transfer_decline, (ignored, which) -> smsBridgeView.setStatus(R.string.status_consent_declined, SmsBridgeView.TONE_WARNING));
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
                smsBridgeView.setStatus(R.string.status_role_unavailable, SmsBridgeView.TONE_ERROR);
            }
        } else {
            Intent intent = new Intent(Telephony.Sms.Intents.ACTION_CHANGE_DEFAULT);
            intent.putExtra(Telephony.Sms.Intents.EXTRA_PACKAGE_NAME, getPackageName());
            startActivityForResult(intent, ROLE_REQUEST);
        }
    }

    private void requestSmsPermissions() {
        if (!BridgePreferences.hasDataTransferConsent(this) || !SmsRoleUtils.isDefaultSmsApp(this)) {
            smsBridgeView.setStatus(R.string.status_setup_required, SmsBridgeView.TONE_WARNING);
            return;
        }
        if (SmsRoleUtils.hasSmsPermissions(this)) {
            smsBridgeView.setStatus(R.string.status_setup_complete, SmsBridgeView.TONE_SUCCESS);
            SyncScheduler.scheduleNow(getApplicationContext());
            // 문자 권한이 이미 있어도 알림 권한은 따로 확인한다.
            requestNotificationPermission();
            return;
        }
        List<String> wanted = new ArrayList<>(java.util.Arrays.asList(Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS, Manifest.permission.SEND_SMS, Manifest.permission.RECEIVE_MMS, Manifest.permission.RECEIVE_WAP_PUSH));
        // 기본 문자앱은 새 문자 알림을 직접 띄워야 한다 (Android 13+ 알림 권한).
        if (needsNotificationPermission()) wanted.add(Manifest.permission.POST_NOTIFICATIONS);
        requestPermissions(wanted.toArray(new String[0]), PERMISSION_REQUEST);
    }

    private boolean needsNotificationPermission() {
        return Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED;
    }

    /** Android 13+: 새 문자 알림 권한을 SMS 권한과 별개로 확인·요청한다. */
    private void requestNotificationPermission() {
        if (needsNotificationPermission()) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
        }
    }

    public void requestProductCameraPermission(Runnable onGranted, Runnable onDenied) {
        List<String> missing = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.CAMERA);
        }
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P
            && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
        }

        if (missing.isEmpty()) {
            onGranted.run();
            return;
        }

        pendingCameraGranted = onGranted;
        pendingCameraDenied = onDenied;
        requestPermissions(missing.toArray(new String[0]), CAMERA_PERMISSION_REQUEST);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != ROLE_REQUEST) return;
        if (SmsRoleUtils.isDefaultSmsApp(this)) requestSmsPermissions();
        else smsBridgeView.setStatus(R.string.status_role_cancelled, SmsBridgeView.TONE_WARNING);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == CAMERA_PERMISSION_REQUEST) {
            boolean granted = grantResults.length > 0;
            for (int result : grantResults) granted &= result == PackageManager.PERMISSION_GRANTED;
            Runnable callback = granted ? pendingCameraGranted : pendingCameraDenied;
            pendingCameraGranted = null;
            pendingCameraDenied = null;
            if (callback != null) callback.run();
            return;
        }
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST) {
            if (needsNotificationPermission()) smsBridgeView.setStatus("알림 권한이 없으면 새 문자 알림이 표시되지 않습니다.", SmsBridgeView.TONE_WARNING);
            return;
        }
        if (requestCode != PERMISSION_REQUEST) return;
        if (SmsRoleUtils.hasSmsPermissions(this)) {
            smsBridgeView.setStatus(R.string.status_sync_ready, SmsBridgeView.TONE_SUCCESS);
            SyncScheduler.scheduleNow(getApplicationContext());
        } else {
            smsBridgeView.setStatus("문자 권한이 모두 허용되지 않아 연동을 시작할 수 없습니다.", SmsBridgeView.TONE_ERROR);
        }
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private GradientDrawable roundRect(int fill, int stroke, float radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(radius);
        if (stroke != Color.TRANSPARENT) drawable.setStroke(dp(1), stroke);
        return drawable;
    }
}
