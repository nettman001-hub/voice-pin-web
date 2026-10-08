package com.voicecap.sms;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.widget.ImageView;

/** MMS 사진 전체 화면 보기. 누르면 닫힌다. */
public final class ImageViewerActivity extends Activity {
    private static final String EXTRA_URI = "uri";

    static Intent intent(Context context, Uri uri) {
        return new Intent(context, ImageViewerActivity.class).putExtra(EXTRA_URI, uri.toString());
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);
        ImageView image = new ImageView(this);
        image.setBackgroundColor(Color.BLACK);
        image.setScaleType(ImageView.ScaleType.FIT_CENTER);
        image.setContentDescription("받은 사진");
        image.setOnClickListener(v -> finish());
        Ui.applySystemBarInsets(image);
        setContentView(image);
        String uri = getIntent().getStringExtra(EXTRA_URI);
        if (uri == null) {
            finish();
            return;
        }
        int maxPx = Math.max(getResources().getDisplayMetrics().widthPixels, getResources().getDisplayMetrics().heightPixels);
        Thumbnails.load(this, Uri.parse(uri), maxPx, image);
    }
}
