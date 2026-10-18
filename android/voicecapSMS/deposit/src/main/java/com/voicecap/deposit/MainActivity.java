package com.voicecap.deposit;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/** 입금확인 앱의 한 화면: 위 제목 줄 + {@link DepositHomeView}. */
public final class MainActivity extends Activity {
    private static final int SMS_PERMISSION_REQUEST = 801;

    private DepositHomeView home;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().setNavigationBarColor(Ui.SLATE_50);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Ui.SLATE_50);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.WHITE);
        bar.setElevation(Ui.dp(this, 3));
        bar.setPadding(Ui.dp(this, 16), Ui.dp(this, 12), Ui.dp(this, 16), Ui.dp(this, 12));
        TextView title = Ui.title(this, "💰 VoiceCAP 입금확인", 18);
        bar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView version = new TextView(this);
        version.setText("v" + BuildConfig.VERSION_NAME);
        version.setTextSize(11);
        version.setTextColor(Ui.BRAND_800);
        version.setPadding(Ui.dp(this, 9), Ui.dp(this, 5), Ui.dp(this, 9), Ui.dp(this, 5));
        version.setBackground(Ui.roundRect(this, Ui.BRAND_50, Ui.BRAND_200, 9));
        bar.addView(version);
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        home = new DepositHomeView(this);
        root.addView(home, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        Ui.applySystemBarInsets(root);
        setContentView(root);
        DepositSync.schedule(getApplicationContext());
    }

    @Override
    protected void onResume() {
        super.onResume();
        // 앱을 열면 백오프 중인 업로드도 바로 다시 시도한다.
        DepositSync.scheduleNow(getApplicationContext(), true);
        home.refresh();
    }

    /** "은행 입금 문자도 읽기"를 켤 때. 허용하면 스위치를 켠다. */
    void requestBankSmsPermission() {
        requestPermissions(new String[]{Manifest.permission.RECEIVE_SMS}, SMS_PERMISSION_REQUEST);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != SMS_PERMISSION_REQUEST) return;
        Context app = getApplicationContext();
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (granted) DepositSettings.setBankSmsEnabled(app, true);
        else Toast.makeText(this, "문자 수신 권한이 없어 은행 입금 문자를 읽을 수 없습니다.", Toast.LENGTH_LONG).show();
        home.refresh();
    }
}
