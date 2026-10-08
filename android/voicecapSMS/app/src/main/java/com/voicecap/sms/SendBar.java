package com.voicecap.sms;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.graphics.Color;
import android.net.Uri;
import android.text.InputType;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

/**
 * 입력창 + 📷 사진 첨부 + 보내기 버튼 (+ 듀얼 SIM이면 SIM 선택 칩). 사진이 있으면 {@link MmsSender}로 MMS를 보낸다.
 * 긴 문자는 {@link SmsSender}가 divideMessage로 나눠 보낸다.
 */
@SuppressLint("ViewConstructor") // 코드로만 만든다 (XML 레이아웃 없음).
final class SendBar extends LinearLayout {
    interface Listener {
        /** images가 비어 있으면 SMS, 있으면 MMS. */
        void onSend(String body, int subId, List<Uri> images);
    }

    private final MessagingActivity activity;
    private final EditText input;
    private final TextView send;
    private final TextView simChip;
    private final TextView attach;
    private final LinearLayout attachmentRow;
    private final HorizontalScrollView attachmentScroll;
    private final TextView mmsNotice;
    private final List<Uri> images = new ArrayList<>();
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

        attachmentScroll = new HorizontalScrollView(activity);
        attachmentScroll.setHorizontalScrollBarEnabled(false);
        attachmentRow = new LinearLayout(activity);
        attachmentRow.setOrientation(HORIZONTAL);
        attachmentScroll.addView(attachmentRow);
        attachmentScroll.setVisibility(GONE);
        LayoutParams scrollParams = new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        scrollParams.bottomMargin = Ui.dp(activity, 4);
        addView(attachmentScroll, scrollParams);

        // 설계 3.8: 보낸 사진 문자가 문자함에 기록되지 않을 수 있음을 미리 알린다.
        mmsNotice = new TextView(activity);
        mmsNotice.setText("사진은 MMS로 보냅니다 (모바일 데이터 필요, 통신사 크기에 맞게 줄임). 휴대폰에 따라 보낸 사진 문자가 문자함에 기록되지 않을 수 있습니다.");
        mmsNotice.setTextSize(11);
        mmsNotice.setTextColor(Ui.SLATE_500);
        mmsNotice.setVisibility(GONE);
        LayoutParams noticeParams = new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        noticeParams.bottomMargin = Ui.dp(activity, 6);
        addView(mmsNotice, noticeParams);

        LinearLayout row = new LinearLayout(activity);
        row.setOrientation(HORIZONTAL);
        row.setGravity(Gravity.BOTTOM);
        attach = new TextView(activity);
        attach.setText("📷");
        attach.setTextSize(20);
        attach.setGravity(Gravity.CENTER);
        attach.setContentDescription("사진 첨부");
        attach.setOnClickListener(v -> {
            if (locked) return;
            if (images.size() >= MmsImageSizing.MAX_IMAGES) {
                android.widget.Toast.makeText(activity, "사진은 한 번에 " + MmsImageSizing.MAX_IMAGES + "장까지 보낼 수 있습니다.", android.widget.Toast.LENGTH_SHORT).show();
                return;
            }
            activity.pickImages(MmsImageSizing.MAX_IMAGES - images.size());
        });
        LayoutParams attachParams = new LayoutParams(Ui.dp(activity, 40), Ui.dp(activity, 44));
        attachParams.rightMargin = Ui.dp(activity, 4);
        row.addView(attach, attachParams);
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
            if (locked || (body.trim().isEmpty() && images.isEmpty())) return;
            listener.onSend(body, subId, new ArrayList<>(images));
        });
        LayoutParams sendParams = new LayoutParams(Ui.dp(activity, 72), Ui.dp(activity, 44));
        sendParams.leftMargin = Ui.dp(activity, 8);
        row.addView(send, sendParams);
        addView(row);
    }

    /** 글과 첨부 사진을 모두 비운다. */
    void clear() {
        input.setText("");
        images.clear();
        renderImages();
    }

    List<Uri> images() { return new ArrayList<>(images); }

    /** 사진 선택기에서 고른 사진을 붙인다 (최대 {@link MmsImageSizing#MAX_IMAGES}장, 같은 사진은 한 번만). */
    void addImages(List<Uri> picked) {
        for (Uri uri : picked) {
            if (images.size() >= MmsImageSizing.MAX_IMAGES) break;
            if (!images.contains(uri)) images.add(uri);
        }
        renderImages();
    }

    private void renderImages() {
        attachmentRow.removeAllViews();
        int size = Ui.dp(activity, 64);
        for (Uri uri : new ArrayList<>(images)) {
            FrameLayout frame = new FrameLayout(activity);
            ImageView thumb = new ImageView(activity);
            thumb.setScaleType(ImageView.ScaleType.CENTER_CROP);
            thumb.setBackgroundColor(Ui.SLATE_100);
            thumb.setContentDescription("첨부한 사진");
            Thumbnails.load(activity, uri, size, thumb);
            frame.addView(thumb, new FrameLayout.LayoutParams(size, size));
            TextView remove = new TextView(activity);
            remove.setText("✕");
            remove.setTextSize(12);
            remove.setTextColor(Color.WHITE);
            remove.setGravity(Gravity.CENTER);
            remove.setBackground(Ui.roundRect(activity, Color.argb(160, 15, 23, 42), Color.TRANSPARENT, 11));
            remove.setContentDescription("사진 빼기");
            remove.setOnClickListener(v -> {
                images.remove(uri);
                renderImages();
            });
            FrameLayout.LayoutParams removeParams = new FrameLayout.LayoutParams(Ui.dp(activity, 22), Ui.dp(activity, 22), Gravity.TOP | Gravity.END);
            frame.addView(remove, removeParams);
            LayoutParams params = new LayoutParams(size, size);
            params.rightMargin = Ui.dp(activity, 6);
            attachmentRow.addView(frame, params);
        }
        attachmentScroll.setVisibility(images.isEmpty() ? GONE : VISIBLE);
        mmsNotice.setVisibility(images.isEmpty() ? GONE : VISIBLE);
    }

    void setText(String text) {
        input.setText(text);
        input.setSelection(input.getText().length());
    }

    String text() { return input.getText().toString(); }

    void setLocked(boolean value) {
        locked = value;
        send.setAlpha(value ? 0.4f : 1f);
        attach.setAlpha(value ? 0.4f : 1f);
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
