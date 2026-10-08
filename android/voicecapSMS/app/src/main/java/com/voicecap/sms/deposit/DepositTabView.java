package com.voicecap.sms.deposit;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import com.voicecap.sms.BridgePreferences;
import com.voicecap.sms.LocalDb;
import com.voicecap.sms.R;
import com.voicecap.sms.SyncScheduler;
import com.voicecap.sms.Ui;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 입금확인 탭 (설계 4.1): 알림 접근·배터리 안내, 입금 정보 전송 동의, 은행 선택(프리셋 + 최근 알림 앱),
 * 입금 피드(업로드 배지 + 서버 대조 결과), 샘플 수집 모드.
 */
public final class DepositTabView extends ScrollView {
    private static final int FEED_LIMIT = 50;
    private static final int SAMPLE_LIMIT = 20;

    private final Activity activity;
    private final LinearLayout column;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    public DepositTabView(Activity activity) {
        super(activity);
        this.activity = activity;
        column = new LinearLayout(activity);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(dp(16), dp(16), dp(16), dp(24));
        addView(column);
    }

    /** 탭을 열 때·앱으로 돌아올 때 다시 그린다. DB 읽기는 백그라운드에서. */
    public void refresh() {
        worker.execute(() -> {
            LocalDb db = LocalDb.get(activity);
            db.purgeSamplesBefore(System.currentTimeMillis() - DepositSettings.SAMPLE_RETENTION_MILLIS);
            List<LocalDb.DepositRow> deposits = db.recentDeposits(FEED_LIMIT);
            List<LocalDb.Sample> samples = DepositSettings.sampleMode(activity) ? db.recentSamples(SAMPLE_LIMIT) : new ArrayList<>();
            BankRules rules = DepositRecorder.rules(activity);
            activity.runOnUiThread(() -> render(deposits, samples, rules));
        });
    }

    private void render(List<LocalDb.DepositRow> deposits, List<LocalDb.Sample> samples, BankRules rules) {
        column.removeAllViews();
        column.addView(accessCard());
        column.addView(consentCard());
        if (DepositSettings.hasConsent(activity)) {
            column.addView(banksCard(rules));
            column.addView(recentAppsCard());
        }
        column.addView(feedCard(deposits));
        column.addView(sampleCard(samples));
    }

    private LinearLayout accessCard() {
        LinearLayout card = Ui.card(activity);
        boolean access = DepositSettings.hasNotificationAccess(activity);
        card.addView(Ui.title(activity, access ? "✅ 알림 접근 허용됨" : "⚠️ 알림 접근이 꺼져 있음", 16));
        card.addView(Ui.body(activity, access
                ? "고른 은행 앱의 알림만 읽습니다. 고르지 않은 앱의 알림은 읽는 즉시 버립니다."
                : "입금 알림을 읽으려면 휴대폰 설정의 알림 접근에서 VoiceCAP을 켜 주세요."));
        Button open = Ui.button(activity, access ? "알림 접근 설정 보기" : "알림 접근 켜기", !access);
        open.setOnClickListener(v -> openSettings(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        card.addView(open);

        PowerManager power = activity.getSystemService(PowerManager.class);
        boolean unrestricted = power != null && power.isIgnoringBatteryOptimizations(activity.getPackageName());
        if (!unrestricted) {
            card.addView(Ui.body(activity, "절전(배터리 최적화) 때문에 알림 읽기가 멈출 수 있습니다. 배터리 설정에서 VoiceCAP을 '제한 없음' 또는 '최적화 안 함'으로 바꿔 주세요. (갤럭시: 설정 → 배터리 → 백그라운드 사용 제한 → 절전 예외 앱)"));
            Button battery = Ui.button(activity, "배터리 최적화 설정 열기", false);
            battery.setOnClickListener(v -> openSettings(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)));
            card.addView(battery);
        }
        if (!BridgePreferences.configured(activity)) {
            card.addView(Ui.body(activity, "웹앱과 이 휴대폰이 아직 연결되지 않았습니다. 문자 탭 ⚙ 설정에서 연결하면 입금이 VoiceCAP으로 올라갑니다. 그 전에는 휴대폰에만 쌓입니다."));
        }
        return card;
    }

    private LinearLayout consentCard() {
        LinearLayout card = Ui.card(activity);
        if (!DepositSettings.hasConsent(activity)) {
            card.addView(Ui.title(activity, "입금 정보 전송 동의", 16));
            card.addView(Ui.body(activity, "금액·입금자명·시각·은행·받는 계좌 별칭만 VoiceCAP 서버로 보냅니다. 알림 원문은 휴대폰 밖으로 나가지 않습니다."));
            Button agree = Ui.button(activity, "안내 읽고 동의하기", true);
            agree.setOnClickListener(v -> showDisclosure());
            card.addView(agree);
            return card;
        }
        card.addView(Ui.title(activity, "입금 정보 전송에 동의함", 15));
        card.addView(Ui.body(activity, "선택한 은행 앱의 입금 알림에서 금액·입금자명·시각·은행·받는 계좌 별칭만 보냅니다."));
        Button notice = Ui.button(activity, "안내 다시 보기", false);
        notice.setOnClickListener(v -> new AlertDialog.Builder(activity)
                .setTitle(R.string.deposit_disclosure_title)
                .setMessage(R.string.deposit_disclosure)
                .setPositiveButton(android.R.string.ok, null)
                .show());
        card.addView(notice);
        Button revoke = Ui.button(activity, "동의 철회 (입금 읽기 중단)", false);
        revoke.setOnClickListener(v -> new AlertDialog.Builder(activity)
                .setTitle("입금 정보 전송 동의 철회")
                .setMessage("고른 은행 앱을 모두 해제하고 입금 업로드를 멈춥니다. 알림 접근 권한 자체는 휴대폰 설정에서 끌 수 있습니다.")
                .setNegativeButton(android.R.string.cancel, null)
                .setPositiveButton("철회", (dialog, which) -> {
                    DepositSettings.setConsent(activity, false);
                    for (String packageName : DepositSettings.selectedPackages(activity)) DepositSettings.setSelected(activity, packageName, false);
                    refresh();
                })
                .show());
        card.addView(revoke);
        return card;
    }

    private void showDisclosure() {
        new AlertDialog.Builder(activity)
                .setTitle(R.string.deposit_disclosure_title)
                .setMessage(R.string.deposit_disclosure)
                .setNegativeButton(R.string.deposit_disclosure_decline, null)
                .setPositiveButton(R.string.deposit_disclosure_accept, (dialog, which) -> {
                    DepositSettings.setConsent(activity, true);
                    refresh();
                })
                .show();
    }

    private LinearLayout banksCard(BankRules rules) {
        LinearLayout card = Ui.card(activity);
        card.addView(Ui.title(activity, "입금 알림을 읽을 앱", 16));
        card.addView(Ui.body(activity, "입금 알림이 실제로 오는 앱을 고르세요. 은행에 따라 은행 앱이 아니라 별도 알림 앱·카카오톡 알림톡·문자로 오기도 합니다. 규칙이 아직 없는 앱은 샘플 수집 모드로 알림 모양을 먼저 모아야 합니다."));
        Set<String> selected = DepositSettings.selectedPackages(activity);
        int installed = 0;
        for (BankPresets.Preset preset : BankPresets.ALL) {
            if (!isInstalled(preset.packageName)) continue;
            installed++;
            card.addView(appToggle(preset.name, preset.packageName, selected.contains(preset.packageName), rules));
        }
        if (installed == 0) card.addView(caption("이 휴대폰에서 프리셋 은행 앱을 찾지 못했습니다. 아래 '최근 알림을 보낸 앱'에서 추가할 수 있습니다."));
        for (String packageName : selected) {
            if (BankPresets.find(packageName) != null && isInstalled(packageName)) continue;
            card.addView(appToggle(appLabel(packageName), packageName, true, rules));
        }
        return card;
    }

    private View appToggle(String name, String packageName, boolean checked, BankRules rules) {
        LinearLayout row = new LinearLayout(activity);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(0, dp(10), 0, 0);
        CheckBox box = new CheckBox(activity);
        box.setText(name);
        box.setTextSize(15);
        box.setTextColor(Ui.SLATE_900);
        box.setChecked(checked);
        box.setOnCheckedChangeListener((view, isChecked) -> DepositSettings.setSelected(activity, packageName, isChecked));
        row.addView(box);
        String ruleState = !rules.hasRuleFor(packageName) ? "규칙 없음 · 샘플 수집 필요"
                : verified(rules, packageName) ? "규칙 확인됨" : "규칙 있음 · 실제 알림으로 미확인";
        int failures = DepositSettings.failureCount(activity, packageName);
        row.addView(caption(packageName + " · " + ruleState + (failures > 0 ? " · 인식 못 한 알림 " + failures + "건" : "")));
        return row;
    }

    private static boolean verified(BankRules rules, String packageName) {
        for (BankRules.Rule rule : rules.forPackage(packageName)) if (!rule.verified) return false;
        return true;
    }

    private LinearLayout recentAppsCard() {
        LinearLayout card = Ui.card(activity);
        card.addView(Ui.title(activity, "최근 알림을 보낸 앱", 16));
        card.addView(Ui.body(activity, "목록에 없는 은행·알림 앱은 여기서 추가합니다. 앱 이름만 기억하며 알림 내용은 저장하지 않습니다. 앱을 다시 시작하면 목록이 비워집니다."));
        Set<String> selected = DepositSettings.selectedPackages(activity);
        int shown = 0;
        for (String packageName : BankNotificationListener.recentPackages()) {
            if (selected.contains(packageName)) continue;
            LinearLayout row = new LinearLayout(activity);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setPadding(0, dp(8), 0, 0);
            TextView label = Ui.body(activity, appLabel(packageName) + "\n" + packageName);
            label.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
            row.addView(label);
            Button add = new Button(activity);
            add.setText("추가");
            add.setAllCaps(false);
            add.setOnClickListener(v -> {
                DepositSettings.setSelected(activity, packageName, true);
                refresh();
            });
            row.addView(add);
            card.addView(row);
            shown++;
        }
        if (shown == 0) card.addView(caption("알림 접근을 켠 뒤 알림이 오면 여기에 보입니다."));
        return card;
    }

    private LinearLayout feedCard(List<LocalDb.DepositRow> deposits) {
        LinearLayout card = Ui.card(activity);
        card.addView(Ui.title(activity, "입금 내역", 16));
        if (deposits.isEmpty()) {
            card.addView(caption("아직 읽은 입금이 없습니다."));
            return card;
        }
        SimpleDateFormat format = new SimpleDateFormat("M/d HH:mm", Locale.KOREA);
        for (LocalDb.DepositRow deposit : deposits) {
            LinearLayout row = new LinearLayout(activity);
            row.setOrientation(LinearLayout.VERTICAL);
            row.setPadding(0, dp(10), 0, dp(10));
            TextView main = Ui.title(activity, DepositLabels.won(deposit.amount) + " · " + deposit.payer, 15);
            row.addView(main);
            String match = DepositLabels.matchLabel(deposit.matchState);
            row.addView(caption((deposit.bank == null ? "" : deposit.bank) + " · " + format.format(new Date(deposit.paidAt))
                    + (match == null ? "" : " · " + match)));
            String sync = DepositLabels.syncLabel(deposit.syncState);
            if (!sync.isEmpty()) {
                TextView badge = caption(sync);
                row.addView(badge);
                if (LocalDb.STATE_FAILED.equals(deposit.syncState)) {
                    badge.setOnClickListener(v -> worker.execute(() -> {
                        LocalDb.get(activity).retryNow(deposit.externalId);
                        SyncScheduler.scheduleNow(activity.getApplicationContext(), true);
                        activity.runOnUiThread(this::refresh);
                    }));
                }
            }
            card.addView(row);
        }
        return card;
    }

    private LinearLayout sampleCard(List<LocalDb.Sample> samples) {
        LinearLayout card = Ui.card(activity);
        card.addView(Ui.title(activity, "샘플 수집 모드", 16));
        card.addView(Ui.body(activity, "켜 두면 고른 앱의 알림 원문을 이 휴대폰에만 30일 보관합니다(서버로 보내지 않음). 입금 규칙을 만들 때는 숫자와 이름을 가린 샘플만 직접 내보냅니다."));
        CheckBox toggle = new CheckBox(activity);
        toggle.setText("샘플 수집 켜기");
        toggle.setChecked(DepositSettings.sampleMode(activity));
        toggle.setOnCheckedChangeListener((view, checked) -> {
            DepositSettings.setSampleMode(activity, checked);
            refresh();
        });
        card.addView(toggle);
        if (!DepositSettings.sampleMode(activity)) return card;
        if (samples.isEmpty()) {
            card.addView(caption("아직 모은 샘플이 없습니다. 고른 앱에서 알림이 오면 여기에 보입니다."));
            return card;
        }
        SimpleDateFormat format = new SimpleDateFormat("M/d HH:mm", Locale.KOREA);
        for (LocalDb.Sample sample : samples) {
            card.addView(caption(format.format(new Date(sample.createdAt)) + " · " + sample.packageName));
            TextView raw = Ui.body(activity, sample.rawText);
            raw.setTextIsSelectable(true);
            card.addView(raw);
            TextView masked = caption("내보낼 때: " + sample.maskedText);
            masked.setPadding(0, dp(2), 0, dp(10));
            card.addView(masked);
        }
        Button export = Ui.button(activity, "가린 샘플 내보내기", true);
        export.setOnClickListener(v -> exportMasked(samples));
        card.addView(export);
        Button clear = Ui.button(activity, "샘플 모두 삭제", false);
        clear.setOnClickListener(v -> worker.execute(() -> {
            LocalDb.get(activity).deleteAllSamples();
            activity.runOnUiThread(this::refresh);
        }));
        card.addView(clear);
        return card;
    }

    /** 가린 샘플만 공유 시트로 내보낸다. 원문은 절대 담지 않는다. */
    private void exportMasked(List<LocalDb.Sample> samples) {
        StringBuilder text = new StringBuilder("VoiceCAP 은행 알림 샘플 (숫자·이름 가림)\n");
        for (LocalDb.Sample sample : samples) {
            text.append("\n--- ").append(sample.packageName).append('\n').append(sample.maskedText).append('\n');
        }
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_SUBJECT, "VoiceCAP 은행 알림 샘플");
        send.putExtra(Intent.EXTRA_TEXT, text.toString());
        activity.startActivity(Intent.createChooser(send, "가린 샘플 내보내기"));
    }

    private boolean isInstalled(String packageName) {
        try {
            activity.getPackageManager().getPackageInfo(packageName, 0);
            return true;
        } catch (PackageManager.NameNotFoundException missing) {
            return false;
        }
    }

    /** 앱 이름. &lt;queries&gt;에 없는 앱은 볼 수 없으므로 패키지명을 그대로 쓴다. */
    private String appLabel(String packageName) {
        BankPresets.Preset preset = BankPresets.find(packageName);
        if (preset != null) return preset.name;
        try {
            PackageManager manager = activity.getPackageManager();
            ApplicationInfo info = manager.getApplicationInfo(packageName, 0);
            return manager.getApplicationLabel(info).toString();
        } catch (PackageManager.NameNotFoundException missing) {
            return packageName;
        }
    }

    private void openSettings(Intent intent) {
        try {
            activity.startActivity(intent);
        } catch (RuntimeException error) {
            Toast.makeText(activity, "이 휴대폰에서 설정 화면을 열 수 없습니다.", Toast.LENGTH_LONG).show();
        }
    }

    private TextView caption(String value) {
        TextView text = new TextView(activity);
        text.setText(value);
        text.setTextSize(12);
        text.setTextColor(Ui.SLATE_500);
        text.setPadding(0, dp(4), 0, 0);
        return text;
    }

    private int dp(float value) {
        return Ui.dp(activity, value);
    }
}
