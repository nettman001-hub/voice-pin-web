package com.voicecap.sms;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** 코드로 만드는 화면(탭·설정·온보딩)이 같이 쓰는 색과 위젯. 기존 SmsBridgeView와 같은 색을 쓴다. */
public final class Ui {
    public static final int BRAND_50 = Color.rgb(240, 247, 255);
    public static final int BRAND_200 = Color.rgb(186, 224, 253);
    public static final int BRAND_500 = Color.rgb(14, 140, 233);
    public static final int BRAND_600 = Color.rgb(2, 111, 199);
    public static final int BRAND_800 = Color.rgb(7, 75, 132);
    public static final int SLATE_50 = Color.rgb(248, 250, 252);
    public static final int SLATE_100 = Color.rgb(241, 245, 249);
    public static final int SLATE_200 = Color.rgb(226, 232, 240);
    public static final int SLATE_400 = Color.rgb(148, 163, 184);
    public static final int SLATE_500 = Color.rgb(100, 116, 139);
    public static final int SLATE_700 = Color.rgb(51, 65, 85);
    public static final int SLATE_900 = Color.rgb(15, 23, 42);
    public static final int EMERALD_500 = Color.rgb(16, 185, 129);
    public static final int AMBER_50 = Color.rgb(255, 251, 235);
    public static final int AMBER_200 = Color.rgb(253, 230, 138);
    public static final int AMBER_800 = Color.rgb(146, 64, 14);

    private Ui() { }

    /**
     * targetSdk 35+는 Android 15부터 화면이 상태 표시줄·내비게이션 바 아래까지 그려진다(edge-to-edge 강제).
     * 루트 뷰에 시스템 바와 키보드 높이만큼 안쪽 여백을 준다. 그보다 낮은 버전은 시스템이 이미 비켜 준다.
     */
    public static void applySystemBarInsets(android.view.View root) {
        if (android.os.Build.VERSION.SDK_INT < 35) return;
        int left = root.getPaddingLeft();
        int top = root.getPaddingTop();
        int right = root.getPaddingRight();
        int bottom = root.getPaddingBottom();
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout());
            android.graphics.Insets ime = insets.getInsets(android.view.WindowInsets.Type.ime());
            view.setPadding(left + bars.left, top + bars.top, right + bars.right, bottom + Math.max(bars.bottom, ime.bottom));
            return android.view.WindowInsets.CONSUMED;
        });
    }

    public static int dp(Context context, float value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    public static GradientDrawable roundRect(Context context, int fill, int stroke, float radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(context, radiusDp));
        if (stroke != Color.TRANSPARENT) drawable.setStroke(dp(context, 1), stroke);
        return drawable;
    }

    public static LinearLayout card(Context context) {
        LinearLayout card = new LinearLayout(context);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(context, 18), dp(context, 16), dp(context, 18), dp(context, 16));
        card.setBackground(roundRect(context, Color.WHITE, SLATE_200, 18));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.bottomMargin = dp(context, 12);
        card.setLayoutParams(params);
        return card;
    }

    /** 주의 띠 (노란 배경). */
    public static LinearLayout banner(Context context) {
        LinearLayout banner = card(context);
        banner.setBackground(roundRect(context, AMBER_50, AMBER_200, 16));
        return banner;
    }

    public static TextView title(Context context, String value, float size) {
        TextView text = new TextView(context);
        text.setText(value);
        text.setTextSize(size);
        text.setTextColor(SLATE_900);
        text.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return text;
    }

    public static TextView body(Context context, String value) {
        TextView text = new TextView(context);
        text.setText(value);
        text.setTextSize(14);
        text.setTextColor(SLATE_700);
        text.setLineSpacing(0, 1.2f);
        text.setPadding(0, dp(context, 6), 0, 0);
        return text;
    }

    public static Button button(Context context, String label, boolean primary) {
        Button button = new Button(context);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(15);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setGravity(Gravity.CENTER);
        button.setTextColor(primary ? Color.WHITE : BRAND_800);
        button.setBackground(primary ? roundRect(context, BRAND_500, BRAND_600, 12) : roundRect(context, BRAND_50, BRAND_200, 12));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(context, 48));
        params.topMargin = dp(context, 12);
        button.setLayoutParams(params);
        return button;
    }
}
