package com.voicecap.sms;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.graphics.Color;
import android.text.InputType;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

/**
 * 입력창 + 보내기 버튼 (+ 듀얼 SIM이면 SIM 선택 칩). 사진 보내기(📷)는 MMS 발송 단계(Phase 6)까지 숨긴다.
 * 긴 문자는 {@link SmsSender}가 divideMessage로 나눠 보낸다.
 */
@SuppressLint("ViewConstructor") // 코드로만 만든다 (XML 레이아웃 없음).
final class SendBar extends LinearLayout {
    interface Listener {
        void onSend(String body, int subId);
    }

    private final MessagingActivity activity;
    private final EditText input;
    private final TextView send;
    private final TextView simChip;
    private List<SimChooser.Sim> sims = new ArrayList<>();
    private int subId = -1;
    private boolean locked;

    SendBar(MessagingActivity activity, Listener listener) {
        super(activity);
        this.activity = activity;
        setOrientation(VERTICAL);
        setBackgroundColor(Color.WHITE);
        setPadding(Ui.dp(activity, 10), Ui.dp(activity, 6), Ui.dp(activity, 10), Ui.dp(activity, 8));

        simChip = new TextView(activity);
        simChip.setTextSize(12);
        simChip.setTextColor(Ui.BRAND_800);
        simChip.setBackground(Ui.roundRect(activity, Ui.BRAND_50, Ui.BRAND_200, 12));
        simChip.setPadding(Ui.dp(activity, 10), Ui.dp(activity, 4), Ui.dp(activity, 10), Ui.dp(activity, 4));
        simChip.setVisibility(GONE);
        simChip.setOnClickListener(v -> chooseSim());
        LayoutParams chipParams = new LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        chipParams.bottomMargin = Ui.dp(activity, 6);
        addView(simChip, chipParams);

        LinearLayout row = new LinearLayout(activity);
        row.setOrientation(HORIZONTAL);
        row.setGravity(Gravity.BOTTOM);
        input = new EditText(activity);
        input.setHint("문자 입력");
        input.setTextSize(15);
        input.setMinHeight(Ui.dp(activity, 44));
        input.setMaxLines(5);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        input.setBackground(Ui.roundRect(activity, Ui.SLATE_100, Ui.SLATE_200, 20));
        input.setPadding(Ui.dp(activity, 14), Ui.dp(activity, 8), Ui.dp(activity, 14), Ui.dp(activity, 8));
        row.addView(input, new LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        send = new TextView(activity);
        send.setText("보내기");
        send.setTextSize(15);
        send.setTextColor(Color.WHITE);
        send.setGravity(Gravity.CENTER);
        send.setBackground(Ui.roundRect(activity, Ui.BRAND_500, Ui.BRAND_600, 20));
        send.setOnClickListener(v -> {
            String body = input.getText().toString();
            if (locked || body.trim().isEmpty()) return;
            listener.onSend(body, subId);
        });
        LayoutParams sendParams = new LayoutParams(Ui.dp(activity, 72), Ui.dp(activity, 44));
        sendParams.leftMargin = Ui.dp(activity, 8);
        row.addView(send, sendParams);
        addView(row);
    }

    void clear() { input.setText(""); }

    void setText(String text) {
        input.setText(text);
        input.setSelection(input.getText().length());
    }

    String text() { return input.getText().toString(); }

    void setLocked(boolean value) {
        locked = value;
        send.setAlpha(value ? 0.4f : 1f);
        input.setHint(value ? "기본 문자앱으로 설정해야 보낼 수 있습니다" : "문자 입력");
    }

    /** 켜진 SIM을 다시 읽는다. 2개 이상이면 칩을 보이고, 권한이 없으면 칩으로 권한을 요청한다. */
    void reloadSims() {
        sims = SimChooser.activeSims(activity);
        if (sims.size() >= 2) {
            subId = SimChooser.chosen(activity, sims);
            simChip.setText("보낼 SIM: " + SimChooser.label(sims, subId) + " ▾");
            simChip.setVisibility(VISIBLE);
        } else if (sims.isEmpty() && SimChooser.multiSimDevice(activity) && !SimChooser.hasPhoneStatePermission(activity)) {
            subId = -1;
            simChip.setText("듀얼 SIM 선택하기 (전화 상태 권한)");
            simChip.setVisibility(VISIBLE);
        } else {
            subId = -1;
            simChip.setVisibility(GONE);
        }
    }

    private void chooseSim() {
        if (sims.size() < 2) {
            activity.requestPhoneStatePermission();
            return;
        }
        String[] labels = new String[sims.size()];
        int checked = 0;
        for (int index = 0; index < sims.size(); index++) {
            labels[index] = sims.get(index).label;
            if (sims.get(index).subId == subId) checked = index;
        }
        new AlertDialog.Builder(activity)
                .setTitle("보낼 SIM")
                .setSingleChoiceItems(labels, checked, (dialog, which) -> {
                    subId = sims.get(which).subId;
                    SimChooser.remember(activity, subId);
                    simChip.setText("보낼 SIM: " + labels[which] + " ▾");
                    dialog.dismiss();
                })
                .show();
    }
}
