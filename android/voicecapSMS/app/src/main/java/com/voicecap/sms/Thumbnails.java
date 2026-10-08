package com.voicecap.sms;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;
import android.widget.ImageView;

import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** MMS 이미지 파트를 줄여서 읽는다 (대화방 썸네일·전체 화면 보기). */
final class Thumbnails {
    private static final ExecutorService EXECUTOR = Executors.newFixedThreadPool(2);
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final LruCache<String, Bitmap> CACHE = new LruCache<String, Bitmap>(16 * 1024 * 1024) {
        @Override protected int sizeOf(String key, Bitmap value) { return value.getByteCount(); }
    };

    private Thumbnails() { }

    /** 비동기로 읽어 붙인다. 뷰가 그사이 다른 이미지로 바뀌었으면(tag 비교) 붙이지 않는다. */
    static void load(Context context, Uri uri, int maxPx, ImageView view) {
        String key = uri + "@" + maxPx;
        view.setTag(key);
        Bitmap cached = CACHE.get(key);
        if (cached != null) {
            view.setImageBitmap(cached);
            return;
        }
        view.setImageDrawable(null);
        Context app = context.getApplicationContext();
        EXECUTOR.execute(() -> {
            Bitmap bitmap = decode(app, uri, maxPx);
            if (bitmap == null) return;
            CACHE.put(key, bitmap);
            MAIN.post(() -> {
                if (key.equals(view.getTag())) view.setImageBitmap(bitmap);
            });
        });
    }

    static Bitmap decode(Context context, Uri uri, int maxPx) {
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            try (InputStream input = context.getContentResolver().openInputStream(uri)) {
                if (input == null) return null;
                BitmapFactory.decodeStream(input, null, bounds);
            }
            int sample = 1;
            while (bounds.outWidth / (sample * 2) >= maxPx || bounds.outHeight / (sample * 2) >= maxPx) sample *= 2;
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = sample;
            try (InputStream input = context.getContentResolver().openInputStream(uri)) {
                return input == null ? null : BitmapFactory.decodeStream(input, null, options);
            }
        } catch (Exception error) {
            return null;
        }
    }
}
