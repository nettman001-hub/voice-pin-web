package com.voicecap.deposit;

import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.concurrent.Executors;

/**
 * 웹앱 연결 카드. 문자 앱 ⚙ 설정의 "휴대폰 연결"과 같은 1회용 코드로 연결하지만, 문자 앱과는 따로 연결한다.
 * 연결 전에 읽은 입금은 휴대폰에만 쌓이고, 연결하면 바로 올린다.
 */
final class LinkCard {
    private final MainActivity activity;
    private final Runnable onChanged;
    private final LinearLayout card;
    private final TextView title;
    private final TextView body;
    private final LinearLayout pairing;
    private final EditText codeInput;
    private final Button revoke;
    private final TextView status;

    LinkCard(MainActivity activity, Runnable onChanged) {
        this.activity = activity;
        this.onChanged = onChanged;
        card = Ui.card(activity);
        title = Ui.title(activity, "", 16);
        card.addView(title);
        body = Ui.body(activity, "");
        card.addView(body);

        pairing = new LinearLayout(activity);
        pairing.setOrientation(LinearLayout.VERTICAL);
        Button openWeb = Ui.button(activity, "웹앱 열기 · 연결 코드 만들기", false);
        openWeb.setOnClickListener(v -> {
            try {
                activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.voicecap.shop/my")));
            } catch (RuntimeException error) {
                setStatus("브라우저를 열 수 없습니다. voicecap.shop을 직접 열어 주세요.");
            }
        });
        pairing.addView(openWeb);
        codeInput = codeInput();
        pairing.addView(codeInput);
        Button pair = Ui.button(activity, "이 휴대폰 연결", true);
        pair.setOnClickListener(v -> pair());
        pairing.addView(pair);
        card.addView(pairing);

        revoke = Ui.button(activity, "웹앱 연결 해제", false);
        revoke.setOnClickListener(v -> new AlertDialog.Builder(activity)
                .setTitle("웹앱 연결 해제")
                .setMessage("이후 읽은 입금은 VoiceCAP으로 올라가지 않고 휴대폰에만 쌓입니다. 다시 연결하려면 웹앱에서 새 연결 코드를 만들어야 합니다.")
                .setNegativeButton(android.R.string.cancel, null)
                .setPositiveButton("해제", (dialog, which) -> revoke())
                .show());
        card.addView(revoke);

        status = Ui.body(activity, "");
        status.setTextSize(13);
        status.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        status.setVisibility(View.GONE);
        card.addView(status);
        update();
    }

    View view() {
        return card;
    }

    /** 연결 상태에 맞게 카드 내용을 바꾼다. 입력 중인 코드는 그대로 둔다. */
    void update() {
        boolean linked = DeviceLink.configured(activity);
        if (linked) {
            String name = DeviceLink.deviceName(activity);
            title.setText("✅ VoiceCAP 웹앱에 연결됨");
            body.setText((name.isEmpty() ? "이 휴대폰" : name) + "에서 읽은 입금이 VoiceCAP으로 올라갑니다.");
        } else {
            title.setText("⚠️ 웹앱 연결 필요");
            body.setText("voicecap.shop → 마이페이지 → ‘voicecapSMS 휴대폰 연결’에서 연결 코드를 만들어 아래에 입력하세요. "
                    + "문자 앱을 이미 연결했어도 이 앱은 따로 한 번 더 연결해야 합니다. 연결 전에 읽은 입금은 휴대폰에만 쌓였다가 연결하면 올라갑니다.");
        }
        pairing.setVisibility(linked ? View.GONE : View.VISIBLE);
        revoke.setVisibility(linked ? View.VISIBLE : View.GONE);
    }

    private void pair() {
        String code = codeInput.getText().toString().trim();
        if (code.length() < 6) {
            setStatus("웹앱에서 만든 유효한 연결 코드를 입력해 주세요.");
            return;
        }
        setStatus("연결하는 중...");
        String deviceName = Build.MANUFACTURER + " " + Build.MODEL + " (입금확인)";
        Context app = activity.getApplicationContext();
        Executors.newSingleThreadExecutor().execute(() -> {
            boolean paired = DeviceLink.claim(app, code, deviceName);
            // 연결 전에 쌓인 입금을 바로 올린다.
            if (paired) DepositSync.scheduleNow(app, true);
            activity.runOnUiThread(() -> {
                if (paired) {
                    codeInput.setText("");
                    setStatus("연결했습니다.");
                } else {
                    setStatus("연결하지 못했습니다. 코드의 만료 여부(10분)와 인터넷 연결을 확인해 주세요.");
                }
                onChanged.run();
            });
        });
    }

    private void revoke() {
        setStatus("연결을 해제하는 중...");
        Context app = activity.getApplicationContext();
        Executors.newSingleThreadExecutor().execute(() -> {
            DeviceLink.revoke(app);
            activity.runOnUiThread(() -> {
                setStatus("연결을 해제했습니다. 이후 입금은 휴대폰에만 쌓입니다.");
                onChanged.run();
            });
        });
    }

    private void setStatus(String value) {
        status.setText(value);
        status.setVisibility(View.VISIBLE);
    }

    private EditText codeInput() {
        EditText view = new EditText(activity);
        view.setHint("10자리 연결 코드 입력");
        view.setHintTextColor(Ui.SLATE_400);
        view.setTextColor(Ui.SLATE_900);
        view.setTextSize(17);
        view.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        view.setGravity(Gravity.CENTER);
        view.setSingleLine(true);
        view.setAllCaps(true);
        view.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        view.setLetterSpacing(0.12f);
        view.setBackground(Ui.roundRect(activity, Ui.SLATE_50, Ui.SLATE_200, 12));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(activity, 52));
        params.topMargin = Ui.dp(activity, 12);
        view.setLayoutParams(params);
        return view;
    }
}
