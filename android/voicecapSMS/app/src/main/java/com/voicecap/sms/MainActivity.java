package com.voicecap.sms;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.role.RoleManager;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.provider.Telephony;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int PERMISSION_REQUEST = 901;
    private static final int ROLE_REQUEST = 902;
    private static final int BUTTON_PRIMARY = 1;
    private static final int BUTTON_SECONDARY = 2;
    private static final int BUTTON_NEUTRAL = 3;
    private static final int BUTTON_DANGER = 4;
    private static final int TONE_INFO = 1;
    private static final int TONE_SUCCESS = 2;
    private static final int TONE_WARNING = 3;
    private static final int TONE_ERROR = 4;
    private static final int BRAND_50 = Color.rgb(240, 247, 255);
    private static final int BRAND_200 = Color.rgb(186, 224, 253);
    private static final int BRAND_500 = Color.rgb(14, 140, 233);
    private static final int BRAND_600 = Color.rgb(2, 111, 199);
    private static final int BRAND_800 = Color.rgb(7, 75, 132);
    private static final int SLATE_50 = Color.rgb(248, 250, 252);
    private static final int SLATE_100 = Color.rgb(241, 245, 249);
    private static final int SLATE_200 = Color.rgb(226, 232, 240);
    private static final int SLATE_500 = Color.rgb(100, 116, 139);
    private static final int SLATE_700 = Color.rgb(51, 65, 85);
    private static final int SLATE_900 = Color.rgb(15, 23, 42);
    private static final int ROSE_500 = Color.rgb(244, 63, 94);
    private EditText pairingCodeInput;
    private TextView status;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().setNavigationBarColor(SLATE_50);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }
        setContentView(buildContent());
        SyncScheduler.schedule(getApplicationContext());
    }

    @Override protected void onResume() {
        super.onResume();
        if (status != null) updateSetupStatus();
    }

    private View buildContent() {
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(dp(18), dp(18), dp(18), dp(28));
        column.setBackgroundColor(SLATE_50);

        LinearLayout header = card();
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        TextView logo = new TextView(this);
        logo.setText("🎙");
        logo.setTextSize(22);
        logo.setGravity(Gravity.CENTER);
        logo.setBackground(gradient(new int[]{BRAND_600, BRAND_500, ROSE_500}, 15));
        logo.setElevation(dp(3));
        logo.setLayoutParams(new LinearLayout.LayoutParams(dp(52), dp(52)));
        header.addView(logo);

        LinearLayout brandCopy = new LinearLayout(this);
        brandCopy.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams brandCopyParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        brandCopyParams.leftMargin = dp(14);
        brandCopy.setLayoutParams(brandCopyParams);
        TextView appTitle = titleText("VoiceCAP");
        appTitle.setTextSize(24);
        brandCopy.addView(appTitle);
        brandCopy.addView(captionText("SMS Bridge · 판매자 휴대폰 연동"));
        header.addView(brandCopy);

        TextView version = badge("v1.3");
        header.addView(version);
        column.addView(header);

        LinearLayout statusCard = card();
        statusCard.addView(sectionTitle("●  연결 상태"));
        status = bodyText("설정 상태 확인 중...", 14);
        status.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        status.setPadding(dp(14), dp(13), dp(14), dp(13));
        statusCard.addView(status);
        applyStatusTone(TONE_INFO);
        column.addView(statusCard);

        LinearLayout pairingCard = card();
        pairingCard.addView(sectionTitle("1. 휴대폰 연결"));
        pairingCard.addView(bodyText("웹앱에서 만든 일회용 코드로 이 휴대폰을 판매자 계정에 안전하게 연결합니다.", 14));

        LinearLayout guide = new LinearLayout(this);
        guide.setOrientation(LinearLayout.VERTICAL);
        guide.setPadding(dp(15), dp(15), dp(15), dp(5));
        guide.setBackground(roundRect(BRAND_50, BRAND_200, 18));
        LinearLayout.LayoutParams guideParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        guideParams.topMargin = dp(14);
        guide.setLayoutParams(guideParams);
        TextView guideTitle = bodyText("기기 연결 코드 만드는 방법", 15);
        guideTitle.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        guideTitle.setTextColor(BRAND_800);
        guide.addView(guideTitle);
        guide.addView(stepRow("1", "voicecap.shop에 로그인합니다."));
        guide.addView(stepRow("2", "‘마이페이지 & 백업’을 엽니다."));
        guide.addView(stepRow("3", "‘voicecapSMS 휴대폰 연결’에서 ‘휴대폰 연결 코드 만들기’를 누릅니다."));
        guide.addView(stepRow("4", "표시된 10자리 코드를 아래에 입력합니다."));
        TextView expiry = captionText("연결 코드는 10분 동안 유효하며 한 번만 사용할 수 있습니다.");
        expiry.setTextColor(BRAND_800);
        expiry.setPadding(0, dp(2), 0, dp(8));
        guide.addView(expiry);
        pairingCard.addView(guide);

        Button openWeb = button("웹앱 열기 · 연결 코드 만들기", BUTTON_SECONDARY);
        openWeb.setOnClickListener(v -> {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.voicecap.shop/my")));
            } catch (Exception ignored) {
                setStatus("브라우저를 열 수 없습니다. voicecap.shop을 직접 열어 주세요.", TONE_ERROR);
            }
        });
        pairingCard.addView(openWeb);

        TextView inputLabel = labelText("기기 연결 코드");
        pairingCard.addView(inputLabel);
        pairingCodeInput = input("10자리 연결 코드 입력");
        pairingCard.addView(pairingCodeInput);

        Button pair = button("이 휴대폰 연결", BUTTON_PRIMARY);
        pair.setOnClickListener(v -> pairDevice());
        pairingCard.addView(pair);
        column.addView(pairingCard);

        LinearLayout setupCard = card();
        setupCard.addView(sectionTitle("2. 문자 연동 설정"));
        setupCard.addView(bodyText("휴대폰 연결 후 기본 SMS 앱과 문자 권한을 설정하면 고객 문의 수신과 판매자 답변 발송을 처리할 수 있습니다.", 14));

        Button setup = button("기본 SMS 앱 · 권한 설정", BUTTON_PRIMARY);
        setup.setOnClickListener(v -> beginProtectedSetup());
        setupCard.addView(setup);

        Button sync = button("지금 동기화 및 발송 처리", BUTTON_SECONDARY);
        sync.setOnClickListener(v -> syncInBackground());
        setupCard.addView(sync);
        column.addView(setupCard);

        LinearLayout privacyCard = card();
        privacyCard.addView(sectionTitle("개인정보 보호"));
        TextView privacyCopy = bodyText("구매정보 문자 또는 판매자가 먼저 문자를 보낸 고객의 거래 문의만 동기화합니다. 인증번호, 은행 알림, 일반 개인 문자는 서버로 보내지 않습니다.", 14);
        privacyCopy.setPadding(dp(14), dp(13), dp(14), dp(13));
        privacyCopy.setBackground(roundRect(Color.rgb(236, 253, 245), Color.rgb(167, 243, 208), 16));
        privacyCopy.setTextColor(Color.rgb(6, 95, 70));
        privacyCard.addView(privacyCopy);

        Button privacy = button("개인정보 처리 안내 보기", BUTTON_NEUTRAL);
        privacy.setOnClickListener(v -> showDataUseNotice(false));
        privacyCard.addView(privacy);
        column.addView(privacyCard);

        LinearLayout managementCard = card();
        managementCard.addView(sectionTitle("기타 설정"));

        Button settings = button("앱 권한 설정 열기", BUTTON_NEUTRAL);
        settings.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))));
        managementCard.addView(settings);

        Button revoke = button("이 휴대폰 연결 해제", BUTTON_DANGER);
        revoke.setOnClickListener(v -> {
            BridgeClient.revokeDevice(this);
            setStatus("휴대폰 연결을 해제했습니다. 이후 문자 정보는 서버로 전송되지 않습니다.", TONE_WARNING);
        });
        managementCard.addView(revoke);
        column.addView(managementCard);

        TextView footer = captionText("VoiceCAP 보안 연결 · " + BridgePreferences.apiBaseUrl());
        footer.setGravity(Gravity.CENTER);
        footer.setPadding(dp(8), dp(4), dp(8), dp(8));
        column.addView(footer);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setClipToPadding(false);
        scroll.setBackgroundColor(SLATE_50);
        scroll.addView(column, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return scroll;
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private GradientDrawable roundRect(int fill, int stroke, float radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(radius));
        if (stroke != Color.TRANSPARENT) drawable.setStroke(dp(1), stroke);
        return drawable;
    }

    private GradientDrawable gradient(int[] colors, float radius) {
        GradientDrawable drawable = new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, colors);
        drawable.setCornerRadius(dp(radius));
        return drawable;
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(18), dp(18), dp(18), dp(18));
        card.setBackground(roundRect(Color.WHITE, SLATE_200, 22));
        card.setElevation(dp(2));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.bottomMargin = dp(14);
        card.setLayoutParams(params);
        return card;
    }

    private TextView titleText(String value) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(22);
        view.setTextColor(SLATE_900);
        view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private TextView sectionTitle(String value) {
        TextView view = titleText(value);
        view.setTextSize(17);
        view.setPadding(0, 0, 0, dp(10));
        return view;
    }

    private TextView bodyText(String value, int size) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(SLATE_700);
        view.setLineSpacing(0, 1.2f);
        return view;
    }

    private TextView captionText(String value) {
        TextView view = bodyText(value, 12);
        view.setTextColor(SLATE_500);
        return view;
    }

    private TextView labelText(String value) {
        TextView view = bodyText(value, 13);
        view.setTextColor(SLATE_700);
        view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        view.setPadding(0, dp(18), 0, dp(7));
        return view;
    }

    private TextView badge(String value) {
        TextView view = bodyText(value, 11);
        view.setTextColor(BRAND_800);
        view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        view.setGravity(Gravity.CENTER);
        view.setPadding(dp(9), dp(5), dp(9), dp(5));
        view.setBackground(roundRect(BRAND_50, BRAND_200, 9));
        return view;
    }

    private LinearLayout stepRow(String number, String value) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.TOP);
        row.setPadding(0, dp(12), 0, 0);

        TextView numberView = new TextView(this);
        numberView.setText(number);
        numberView.setTextSize(12);
        numberView.setTextColor(Color.WHITE);
        numberView.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        numberView.setGravity(Gravity.CENTER);
        numberView.setBackground(roundRect(BRAND_600, Color.TRANSPARENT, 10));
        numberView.setLayoutParams(new LinearLayout.LayoutParams(dp(26), dp(26)));
        row.addView(numberView);

        TextView copy = bodyText(value, 13);
        LinearLayout.LayoutParams copyParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        copyParams.leftMargin = dp(10);
        copy.setLayoutParams(copyParams);
        row.addView(copy);
        return row;
    }

    private EditText input(String hint) {
        EditText view = new EditText(this);
        view.setHint(hint);
        view.setHintTextColor(Color.rgb(148, 163, 184));
        view.setTextColor(SLATE_900);
        view.setTextSize(17);
        view.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        view.setGravity(Gravity.CENTER);
        view.setSingleLine(true);
        view.setAllCaps(true);
        view.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        view.setLetterSpacing(0.12f);
        view.setPadding(dp(14), 0, dp(14), 0);
        view.setBackground(roundRect(SLATE_50, SLATE_200, 14));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54));
        view.setLayoutParams(params);
        return view;
    }

    private Button button(String label, int style) {
        Button view = new Button(this);
        view.setText(label);
        view.setTextSize(14);
        view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        view.setAllCaps(false);
        view.setGravity(Gravity.CENTER);
        view.setMinHeight(0);
        view.setMinimumHeight(0);
        view.setPadding(dp(14), 0, dp(14), 0);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) view.setStateListAnimator(null);

        if (style == BUTTON_PRIMARY) {
            view.setTextColor(Color.WHITE);
            view.setBackground(gradient(new int[]{BRAND_600, BRAND_500, ROSE_500}, 14));
            view.setElevation(dp(2));
        } else if (style == BUTTON_SECONDARY) {
            view.setTextColor(BRAND_600);
            view.setBackground(roundRect(Color.WHITE, BRAND_200, 14));
        } else if (style == BUTTON_DANGER) {
            view.setTextColor(Color.rgb(190, 18, 60));
            view.setBackground(roundRect(Color.rgb(255, 241, 242), Color.rgb(254, 205, 211), 14));
        } else {
            view.setTextColor(SLATE_700);
            view.setBackground(roundRect(SLATE_50, SLATE_200, 14));
        }

        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
        params.topMargin = dp(10);
        view.setLayoutParams(params);
        return view;
    }

    private void applyStatusTone(int tone) {
        if (status == null) return;
        int fill = BRAND_50;
        int stroke = BRAND_200;
        int textColor = BRAND_800;
        if (tone == TONE_SUCCESS) {
            fill = Color.rgb(236, 253, 245);
            stroke = Color.rgb(167, 243, 208);
            textColor = Color.rgb(6, 95, 70);
        } else if (tone == TONE_WARNING) {
            fill = Color.rgb(255, 251, 235);
            stroke = Color.rgb(253, 230, 138);
            textColor = Color.rgb(146, 64, 14);
        } else if (tone == TONE_ERROR) {
            fill = Color.rgb(255, 241, 242);
            stroke = Color.rgb(254, 205, 211);
            textColor = Color.rgb(190, 18, 60);
        }
        status.setTextColor(textColor);
        status.setBackground(roundRect(fill, stroke, 14));
    }

    private void setStatus(String value, int tone) {
        if (status == null) return;
        status.setText(value);
        applyStatusTone(tone);
    }

    private void setStatus(int stringResource, int tone) {
        setStatus(getString(stringResource), tone);
    }

    private void pairDevice() {
        String code = pairingCodeInput.getText().toString().trim();
        if (code.length() < 6) {
            setStatus("웹앱에서 만든 유효한 기기 연결 코드를 입력해 주세요.", TONE_WARNING);
            return;
        }
        setStatus("휴대폰을 판매자 계정에 연결하는 중...", TONE_INFO);
        String deviceName = Build.MANUFACTURER + " " + Build.MODEL;
        Executors.newSingleThreadExecutor().execute(() -> {
            boolean paired = BridgeClient.claimDevice(getApplicationContext(), code, deviceName);
            runOnUiThread(() -> {
                if (paired) {
                    pairingCodeInput.setText("");
                    setStatus("휴대폰 연결이 완료되었습니다. 이제 문자 전송 동의와 권한 설정을 진행해 주세요.", TONE_SUCCESS);
                } else {
                    setStatus("연결하지 못했습니다. 코드의 만료 여부와 인터넷 연결을 확인해 주세요.", TONE_ERROR);
                }
            });
        });
    }

    private void beginProtectedSetup() {
        if (!BridgePreferences.configured(this)) {
            setStatus("먼저 웹앱에서 만든 기기 연결 코드로 이 휴대폰을 연결해 주세요.", TONE_WARNING);
            return;
        }
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
            dialog.setNegativeButton(R.string.data_transfer_decline, (ignored, which) -> setStatus(R.string.status_consent_declined, TONE_WARNING));
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
                setStatus(R.string.status_role_unavailable, TONE_ERROR);
            }
        } else {
            Intent intent = new Intent(Telephony.Sms.Intents.ACTION_CHANGE_DEFAULT);
            intent.putExtra(Telephony.Sms.Intents.EXTRA_PACKAGE_NAME, getPackageName());
            startActivityForResult(intent, ROLE_REQUEST);
        }
    }

    private void requestSmsPermissions() {
        if (!BridgePreferences.hasDataTransferConsent(this) || !SmsRoleUtils.isDefaultSmsApp(this)) {
            setStatus(R.string.status_setup_required, TONE_WARNING);
            return;
        }
        if (SmsRoleUtils.hasSmsPermissions(this)) {
            setStatus(R.string.status_setup_complete, TONE_SUCCESS);
            SyncScheduler.scheduleNow(getApplicationContext());
            return;
        }
        requestPermissions(new String[]{Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS, Manifest.permission.SEND_SMS, Manifest.permission.RECEIVE_MMS, Manifest.permission.RECEIVE_WAP_PUSH}, PERMISSION_REQUEST);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != ROLE_REQUEST) return;
        if (SmsRoleUtils.isDefaultSmsApp(this)) requestSmsPermissions();
        else setStatus(R.string.status_role_cancelled, TONE_WARNING);
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != PERMISSION_REQUEST) return;
        if (SmsRoleUtils.hasSmsPermissions(this)) {
            setStatus(R.string.status_sync_ready, TONE_SUCCESS);
            SyncScheduler.scheduleNow(getApplicationContext());
        } else {
            setStatus("문자 권한이 모두 허용되지 않아 연동을 시작할 수 없습니다.", TONE_ERROR);
        }
    }

    private void updateSetupStatus() {
        if (!BridgePreferences.configured(this)) setStatus("웹앱에서 기기 연결 코드를 만든 뒤 이 휴대폰을 연결해 주세요.", TONE_WARNING);
        else if (!BridgePreferences.hasDataTransferConsent(this)) setStatus("문자 정보 전송 동의가 필요합니다.", TONE_WARNING);
        else if (!SmsRoleUtils.isDefaultSmsApp(this)) setStatus(R.string.status_role_required, TONE_WARNING);
        else if (!SmsRoleUtils.hasSmsPermissions(this)) setStatus(R.string.status_permission_required, TONE_WARNING);
        else setStatus(R.string.status_bridge_ready, TONE_SUCCESS);
    }

    private void syncInBackground() {
        if (!BridgePreferences.configured(this)) {
            setStatus("먼저 이 휴대폰을 판매자 계정에 연결해 주세요.", TONE_WARNING);
            return;
        }
        if (!BridgePreferences.hasDataTransferConsent(this) || !SmsRoleUtils.isDefaultSmsApp(this) || !SmsRoleUtils.hasSmsPermissions(this)) {
            beginProtectedSetup();
            return;
        }
        setStatus("구매정보 문자와 발송 대기 문자를 처리하는 중...", TONE_INFO);
        Executors.newSingleThreadExecutor().execute(() -> {
            String result = SmsSyncManager.syncNow(getApplicationContext());
            runOnUiThread(() -> setStatus(result, TONE_INFO));
        });
    }
}
