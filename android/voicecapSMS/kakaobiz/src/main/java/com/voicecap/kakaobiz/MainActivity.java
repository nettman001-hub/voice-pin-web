package com.voicecap.kakaobiz;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 카카오비즈 알림 테스트 화면. 위에서부터: 알림 접근 상태 → 읽을 앱 고르기 → 읽은 알림 목록.
 * 읽은 알림은 이 화면에만 보이며 서버로 보내지 않는다(이 앱엔 인터넷 권한이 없다).
 */
public final class MainActivity extends Activity {
    private LinearLayout content;
    private final SimpleDateFormat timeFormat = new SimpleDateFormat("MM-dd HH:mm:ss", Locale.KOREA);
    /** 상세 보기를 펼친 알림 (다시 그려도 유지). */
    private final java.util.Set<String> expanded = new java.util.HashSet<>();

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(16), dp(16), dp(16), dp(24));
        scroll.addView(content);
        setContentView(scroll);
        applyInsets(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        CaptureStore.setListener(this::render);
        render();
    }

    @Override
    protected void onPause() {
        super.onPause();
        CaptureStore.setListener(null);
    }

    private void render() {
        content.removeAllViews();
        content.addView(title("카카오비즈 알림 테스트"));
        content.addView(note("읽은 알림은 이 휴대폰 화면에만 표시합니다. 서버로 보내지 않습니다(이 앱에는 인터넷 권한이 없습니다)."));
        content.addView(accessCard());
        content.addView(appsCard());
        content.addView(listHeader());
        List<CapturedNotification> entries = CaptureStore.entries(this);
        if (entries.isEmpty()) {
            content.addView(note("아직 읽은 알림이 없습니다. 위에서 알림 접근을 켜고, 파트너센터 앱에 테스트 메시지를 보내 보세요."));
        }
        for (CapturedNotification entry : entries) content.addView(entryCard(entry));
    }

    // ── 알림 접근 ────────────────────────────────────────────────────────────

    private boolean accessEnabled() {
        String flat = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        if (TextUtils.isEmpty(flat)) return false;
        ComponentName mine = new ComponentName(this, NotificationCaptureService.class);
        for (String name : flat.split(":")) {
            ComponentName component = ComponentName.unflattenFromString(name);
            if (component != null && component.equals(mine)) return true;
        }
        return false;
    }

    private View accessCard() {
        LinearLayout card = card();
        boolean on = accessEnabled();
        card.addView(label(on ? "✅ 알림 접근이 켜져 있습니다" : "⚠️ 알림 접근이 꺼져 있습니다", 15, on ? Color.rgb(4, 120, 87) : Color.rgb(146, 64, 14), true));
        if (!on) {
            card.addView(note("알림 접근을 켜야 다른 앱의 알림을 읽을 수 있습니다."));
            card.addView(button("알림 접근 설정 열기", v -> startActivity(new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"))));
            if (Build.VERSION.SDK_INT >= 33) {
                card.addView(note("목록에서 이 앱이 회색이라 눌러지지 않으면: 설정 → 앱 → 카카오비즈 알림 테스트 → 오른쪽 위 ⋮ → \"제한된 설정 허용\"을 누른 뒤 다시 켜세요(직접 설치한 앱은 Android가 먼저 막습니다)."));
                card.addView(button("이 앱 정보 열기", v -> startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())))));
            }
        }
        return card;
    }

    // ── 읽을 앱 고르기 ───────────────────────────────────────────────────────

    private View appsCard() {
        LinearLayout card = card();
        card.addView(label("읽을 앱 고르기", 15, Ui.SLATE_900, true));
        card.addView(note("카카오비즈 파트너센터는 알림이 처음 오면 자동으로 선택됩니다. 선택하지 않은 앱은 이름만 기억하고 알림 내용은 읽지 않습니다."));
        Map<String, String> apps = CaptureStore.apps(this);
        if (apps.isEmpty()) {
            card.addView(note("알림을 보낸 앱이 아직 없습니다."));
            return card;
        }
        for (Map.Entry<String, String> app : apps.entrySet()) {
            String pkg = app.getKey();
            CheckBox box = new CheckBox(this);
            String name = app.getValue();
            box.setText(name.equals(pkg) ? pkg : name + "\n" + pkg);
            box.setTextSize(13);
            box.setChecked(CaptureStore.isSelected(this, pkg));
            box.setOnCheckedChangeListener((view, checked) -> CaptureStore.setSelected(this, pkg, checked));
            card.addView(box);
        }
        return card;
    }

    // ── 읽은 알림 ────────────────────────────────────────────────────────────

    private View listHeader() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.addView(label("읽은 알림 (최근 " + CaptureStore.MAX_ENTRIES + "건까지)", 15, Ui.SLATE_900, true), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        row.addView(smallButton("전체 복사", v -> copyAll()));
        row.addView(smallButton("지우기", v -> {
            expanded.clear();
            CaptureStore.clear(this);
        }));
        row.setPadding(0, dp(8), 0, dp(8));
        return row;
    }

    private View entryCard(CapturedNotification e) {
        LinearLayout card = card();
        String when = timeFormat.format(new Date(e.postedAt));
        card.addView(label(when + " · " + e.label, 12, Ui.SLATE_500, false));
        card.addView(label(e.title.isEmpty() ? "(제목 없음)" : e.title, 16, Ui.SLATE_900, true));
        card.addView(label(visibleBody(e), 14, Ui.SLATE_700, false));
        card.addView(label("본문 길이: text " + e.text.length() + "자 · bigText " + e.bigText.length() + "자"
            + (e.messages.isEmpty() ? "" : " · messages " + e.messages.length() + "자"), 12, Ui.SLATE_500, false));
        boolean replyBox = e.actions.contains("답장 입력칸 있음");
        card.addView(label(replyBox ? "💬 답장 입력칸이 있는 알림" : "답장 입력칸 없음", 12, replyBox ? Color.rgb(4, 120, 87) : Ui.SLATE_500, false));
        boolean open = expanded.contains(e.fingerprint());
        card.addView(smallButton(open ? "상세 접기" : "상세 보기", v -> {
            if (open) expanded.remove(e.fingerprint()); else expanded.add(e.fingerprint());
            render();
        }));
        if (open) {
            card.addView(section("버튼", e.actions));
            card.addView(section("메시지 목록(MessagingStyle)", e.messages));
            card.addView(section("여러 줄(textLines)", e.lines));
            card.addView(section("bigText", e.bigText));
            card.addView(section("subText", e.subText));
            card.addView(section("기타 정보", e.meta));
            card.addView(section("extras 전체", e.extrasDump));
        }
        return card;
    }

    /** 알림에서 가장 긴 본문을 보여 준다(bigText → 메시지 목록 → 여러 줄 → text 순). */
    private static String visibleBody(CapturedNotification e) {
        if (!e.bigText.isEmpty()) return e.bigText;
        if (!e.messages.isEmpty()) return e.messages;
        if (!e.lines.isEmpty()) return e.lines;
        return e.text.isEmpty() ? "(본문 없음)" : e.text;
    }

    private View section(String name, String value) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(0, dp(8), 0, 0);
        box.addView(label(name, 12, Ui.SLATE_500, true));
        TextView body = label(value.isEmpty() ? "(없음)" : value, 12, Ui.SLATE_700, false);
        body.setTypeface(Typeface.MONOSPACE);
        body.setTextIsSelectable(true);
        box.addView(body);
        return box;
    }

    private void copyAll() {
        StringBuilder out = new StringBuilder();
        for (CapturedNotification e : CaptureStore.entries(this)) {
            out.append("[").append(timeFormat.format(new Date(e.postedAt))).append("] ").append(e.label).append(" (").append(e.pkg).append(")\n")
                .append("제목: ").append(e.title).append('\n')
                .append("본문: ").append(visibleBody(e)).append('\n')
                .append("버튼: ").append(e.actions).append('\n')
                .append("본문 길이: text ").append(e.text.length()).append("자 · bigText ").append(e.bigText.length())
                .append("자 · textLines ").append(e.lines.length()).append("자 · messages ").append(e.messages.length()).append("자\n")
                .append(e.meta).append('\n');
            // 상세 보기에 나오는 내용을 빠짐없이 함께 복사한다.
            appendSection(out, "메시지 목록(MessagingStyle)", e.messages);
            appendSection(out, "여러 줄(textLines)", e.lines);
            appendSection(out, "bigText", e.bigText);
            appendSection(out, "subText", e.subText);
            appendSection(out, "extras 전체", e.extrasDump);
            out.append("\n");
        }
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(ClipData.newPlainText("kakaobiz", out.toString()));
        Toast.makeText(this, "이 휴대폰 클립보드에 복사했습니다", Toast.LENGTH_SHORT).show();
    }

    private static void appendSection(StringBuilder out, String name, String value) {
        out.append("── ").append(name).append(" ──\n").append(value.isEmpty() ? "(없음)" : value).append('\n');
    }

    // ── 화면 도구 ────────────────────────────────────────────────────────────

    private TextView title(String text) {
        return label(text, 22, Ui.SLATE_900, true);
    }

    private TextView note(String text) {
        TextView view = label(text, 13, Ui.SLATE_500, false);
        view.setPadding(0, dp(4), 0, dp(8));
        return view;
    }

    private TextView label(String text, int sp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(sp);
        view.setTextColor(color);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        view.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return view;
    }

    private Button button(String text, View.OnClickListener click) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setOnClickListener(click);
        return button;
    }

    private Button smallButton(String text, View.OnClickListener click) {
        Button button = button(text, click);
        button.setTextSize(12);
        button.setMinHeight(0);
        button.setMinimumHeight(dp(36));
        return button;
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(14), dp(16), dp(14));
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.WHITE);
        background.setCornerRadius(dp(16));
        background.setStroke(dp(1), Ui.SLATE_200);
        card.setBackground(background);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.bottomMargin = dp(12);
        card.setLayoutParams(params);
        return card;
    }

    /** targetSdk 35+는 시스템 바 아래까지 그려지므로 안쪽 여백을 준다. */
    private void applyInsets(View root) {
        if (Build.VERSION.SDK_INT < 35) return;
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return android.view.WindowInsets.CONSUMED;
        });
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
