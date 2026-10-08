package com.voicecap.sms;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.Toast;
import com.voicecap.sms.deposit.DepositTabView;
import com.voicecap.sms.sales.FakeSalesRepository;
import com.voicecap.sms.sales.RealSalesRepository;
import com.voicecap.sms.sales.SalesRepository;
import com.voicecap.sms.sales.ui.ProductSalesView;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 탭 3개: 판매관리 / 문자연동(기본) / 입금확인. 첫 실행이면 {@link OnboardingActivity}로 보낸다.
 * 판매관리는 {@link BuildConfig#SALES_TAB_ENABLED}가 false인 동안 회색으로만 보이고,
 * 판매 저장소·화면을 만들지도 시작하지도 않는다.
 */
public final class MainActivity extends Activity {
    static final int TAB_SALES = 0;
    static final int TAB_SMS = 1;
    static final int TAB_DEPOSIT = 2;

    private static final int SMS_PERMISSION_REQUEST = 901;
    private static final int ROLE_REQUEST = 902;
    private static final int CAMERA_PERMISSION_REQUEST = 903;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 904;
    private static final int CONTACTS_PERMISSION_REQUEST = 905;
    private static final String STATE_SELECTED_TAB = "state_selected_tab";

    private FrameLayout contentContainer;
    /** 판매관리 탭이 꺼져 있으면 null (판매 코드를 실행하지 않음). */
    private ProductSalesView productSalesView;
    private SmsHomeView smsHomeView;
    private DepositTabView depositView;
    private Button tabSalesBtn;
    private Button tabSmsBtn;
    private Button tabDepositBtn;
    private int currentTab = TAB_SMS;

    /** 즉시 발송(FCM)이 켜지지 않은 동안 화면이 떠 있으면 30초마다 웹 발송함을 확인한다. */
    private static final long OUTBOX_POLL_MILLIS = 30_000L;
    private static final ExecutorService BACKGROUND = Executors.newSingleThreadExecutor();
    private final Handler outboxPoller = new Handler(Looper.getMainLooper());
    private final Runnable outboxPoll = new Runnable() {
        @Override public void run() {
            Context app = getApplicationContext();
            if (PushRegistration.status(app) != PushLogic.Status.ON) BACKGROUND.execute(() -> SmsSyncManager.sendOutboxIfAllowed(app));
            outboxPoller.postDelayed(this, OUTBOX_POLL_MILLIS);
        }
    };

    private Runnable pendingCameraGranted;
    private Runnable pendingCameraDenied;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        if (!OnboardingActivity.isDone(this)) {
            startActivity(new Intent(this, OnboardingActivity.class));
            finish();
            return;
        }
        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().setNavigationBarColor(Color.rgb(248, 250, 252));
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);

        if (state != null) currentTab = state.getInt(STATE_SELECTED_TAB, TAB_SMS);
        if (currentTab == TAB_SALES && !BuildConfig.SALES_TAB_ENABLED) currentTab = TAB_SMS;

        View root = buildRootLayout();
        Ui.applySystemBarInsets(root);
        setContentView(root);
        selectTab(currentTab);
        SyncScheduler.schedule(getApplicationContext());
        // 앱 시작: 알림 토큰을 확인해 서버 등록과 다르면 다시 등록한다.
        Context app = getApplicationContext();
        BACKGROUND.execute(() -> PushRegistration.refreshAndRegister(app));
        if (state == null) openComposeFromIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openComposeFromIntent(intent);
    }

    /** 다른 앱의 "문자 보내기"(sms:/smsto: 링크)는 받는 사람·내용을 채운 새 문자 화면으로 연다. */
    private void openComposeFromIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SENDTO.equals(intent.getAction()) || intent.getData() == null) return;
        String part = intent.getData().getSchemeSpecificPart();
        if (part == null) return;
        int query = part.indexOf('?');
        String recipients = query >= 0 ? part.substring(0, query) : part;
        String body = intent.getStringExtra("sms_body");
        if (body == null) body = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (body == null && query >= 0) {
            String bodyParam = android.net.Uri.parse("sms:?" + part.substring(query + 1)).getQueryParameter("body");
            if (bodyParam != null) body = bodyParam;
        }
        startActivity(ComposeActivity.intent(this, recipients, body));
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        outState.putInt(STATE_SELECTED_TAB, currentTab);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (smsHomeView == null) return;
        // 앱을 열면 백오프 중인 업로드·MMS 다운로드도 바로 다시 시도한다.
        SyncScheduler.scheduleNow(getApplicationContext(), true);
        smsHomeView.refresh();
        if (currentTab == TAB_DEPOSIT) depositView.refresh();
        if (currentTab == TAB_SALES && productSalesView != null) productSalesView.start();
        outboxPoller.removeCallbacks(outboxPoll);
        outboxPoller.postDelayed(outboxPoll, OUTBOX_POLL_MILLIS);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (smsHomeView != null) smsHomeView.stop();
        if (productSalesView != null) productSalesView.stop();
        outboxPoller.removeCallbacks(outboxPoll);
    }

    private View buildRootLayout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(248, 250, 252));

        LinearLayout tabBar = new LinearLayout(this);
        tabBar.setOrientation(LinearLayout.HORIZONTAL);
        tabBar.setPadding(dp(12), dp(8), dp(12), dp(8));
        tabBar.setBackgroundColor(Color.WHITE);
        tabBar.setElevation(dp(4));

        tabSalesBtn = tabButton("🛍 판매관리", TAB_SALES);
        tabSmsBtn = tabButton("💬 문자연동", TAB_SMS);
        tabDepositBtn = tabButton("💰 입금확인", TAB_DEPOSIT);
        tabBar.addView(tabSalesBtn);
        tabBar.addView(tabSmsBtn);
        tabBar.addView(tabDepositBtn);
        if (!BuildConfig.SALES_TAB_ENABLED) {
            // 꺼진 동안 회색 + 안내. 숨기려면 이 줄을 tabSalesBtn.setVisibility(View.GONE)으로 바꾼다.
            tabSalesBtn.setAlpha(0.4f);
        }
        root.addView(tabBar);

        contentContainer = new FrameLayout(this);
        contentContainer.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        if (BuildConfig.SALES_TAB_ENABLED) {
            SalesRepository salesRepository = BridgePreferences.configured(this)
                ? new RealSalesRepository(this)
                : new FakeSalesRepository();
            productSalesView = new ProductSalesView(this, salesRepository);
            contentContainer.addView(productSalesView);
        }
        smsHomeView = new SmsHomeView(this);
        depositView = new DepositTabView(this);
        contentContainer.addView(smsHomeView);
        contentContainer.addView(depositView);
        root.addView(contentContainer);
        return root;
    }

    private Button tabButton(String label, int tab) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(13);
        button.setAllCaps(false);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(44), 1f);
        params.leftMargin = dp(3);
        params.rightMargin = dp(3);
        button.setLayoutParams(params);
        button.setOnClickListener(v -> selectTab(tab));
        return button;
    }

    public void selectTab(int tabIndex) {
        if (tabIndex == TAB_SALES && !BuildConfig.SALES_TAB_ENABLED) {
            Toast.makeText(this, R.string.sales_coming_soon, Toast.LENGTH_SHORT).show();
            return;
        }
        currentTab = tabIndex;
        styleTab(tabSalesBtn, tabIndex == TAB_SALES);
        styleTab(tabSmsBtn, tabIndex == TAB_SMS);
        styleTab(tabDepositBtn, tabIndex == TAB_DEPOSIT);
        smsHomeView.setVisibility(tabIndex == TAB_SMS ? View.VISIBLE : View.GONE);
        depositView.setVisibility(tabIndex == TAB_DEPOSIT ? View.VISIBLE : View.GONE);
        if (productSalesView != null) {
            productSalesView.setVisibility(tabIndex == TAB_SALES ? View.VISIBLE : View.GONE);
            if (tabIndex == TAB_SALES) productSalesView.start();
            else productSalesView.stop();
        }
        if (tabIndex == TAB_SMS) smsHomeView.refresh();
        if (tabIndex == TAB_DEPOSIT) depositView.refresh();
    }

    private void styleTab(Button button, boolean selected) {
        if (selected) {
            button.setTextColor(Color.WHITE);
            button.setBackground(roundRect(Color.rgb(14, 140, 233), Color.rgb(2, 111, 199), dp(10)));
        } else {
            button.setTextColor(Color.rgb(100, 116, 139));
            button.setBackground(roundRect(Color.rgb(241, 245, 249), Color.TRANSPARENT, dp(10)));
        }
    }

    /** 문자 탭 경고 띠: 기본 문자앱 다시 지정 → 문자 권한. */
    void requestDefaultSmsApp() {
        if (SmsRoleUtils.isDefaultSmsApp(this)) {
            requestSmsPermissions();
            return;
        }
        Intent intent = SmsRoleUtils.roleRequestIntent(this);
        if (intent == null) Toast.makeText(this, R.string.status_role_unavailable, Toast.LENGTH_LONG).show();
        else startActivityForResult(intent, ROLE_REQUEST);
    }

    private void requestSmsPermissions() {
        if (!SmsRoleUtils.hasSmsPermissions(this)) requestPermissions(SmsRoleUtils.SMS_PERMISSIONS, SMS_PERMISSION_REQUEST);
    }

    /** Android 13+: 새 문자 알림 권한을 SMS 권한과 별개로 요청한다. */
    void requestNotificationPermission() {
        if (SmsRoleUtils.needsNotificationPermission(this)) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
        }
    }

    /** 대화 목록에 연락처 이름을 보여 주기 위한 선택 권한. 거절해도 번호로 보여 준다. */
    void requestContactsPermission() {
        requestPermissions(new String[]{Manifest.permission.READ_CONTACTS}, CONTACTS_PERMISSION_REQUEST);
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
        smsHomeView.refresh();
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
        if (requestCode == SMS_PERMISSION_REQUEST && SmsRoleUtils.hasSmsPermissions(this)) {
            SyncScheduler.scheduleNow(getApplicationContext(), true);
        }
        if (requestCode == CONTACTS_PERMISSION_REQUEST) smsHomeView.onContactsPermissionChanged();
        else smsHomeView.refresh();
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
