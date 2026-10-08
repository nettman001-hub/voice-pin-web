package com.voicecap.sms;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.net.Uri;
import android.os.Bundle;
import android.telephony.SmsManager;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * 고른 사진을 통신사 MMS 크기에 맞게 JPEG로 다시 만든다 (EXIF 회전 반영, 위치 등 EXIF 정보는 빠진다).
 * 계산은 {@link MmsImageSizing}. 화면 스레드가 아닌 곳에서 호출한다.
 */
final class MmsImages {
    private MmsImages() { }

    /** 이 SIM의 통신사 MMS 최대 크기. 읽지 못하면 300KB. */
    static int maxMessageBytes(Context context, int subId) {
        try {
            Bundle config = SmsSender.smsManager(context, subId).getCarrierConfigValues();
            return MmsImageSizing.maxMessageBytes(config == null ? 0 : config.getInt(SmsManager.MMS_CONFIG_MAX_MESSAGE_SIZE, 0));
        } catch (RuntimeException error) {
            return MmsImageSizing.DEFAULT_MAX_MESSAGE_BYTES;
        }
    }

    /** 사진들을 한 통에 들어가게 줄인다. 하나라도 못 줄이면 예외 (메시지는 화면에 그대로 보여 준다). */
    static List<byte[]> prepare(Context context, List<Uri> images, String text, int subId) throws Exception {
        if (images.size() > MmsImageSizing.MAX_IMAGES) throw new IllegalArgumentException("사진은 한 번에 " + MmsImageSizing.MAX_IMAGES + "장까지 보낼 수 있습니다.");
        int textBytes = text == null ? 0 : text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
        int budget = MmsImageSizing.imageBudget(maxMessageBytes(context, subId), textBytes, images.size());
        if (budget <= 0) throw new IllegalArgumentException("글이 너무 길어 사진을 붙일 수 없습니다.");
        List<byte[]> result = new ArrayList<>();
        for (Uri image : images) result.add(shrink(context, image, budget));
        return result;
    }

    private static byte[] shrink(Context context, Uri uri, int budget) throws Exception {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream input = context.getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IllegalStateException("사진을 열지 못했습니다.");
            BitmapFactory.decodeStream(input, null, bounds);
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IllegalStateException("사진 형식을 읽지 못했습니다.");
        int rotation = rotation(context, uri);
        int longSide = MmsImageSizing.firstLongSide(bounds.outWidth, bounds.outHeight);
        while (longSide > 0) {
            Bitmap bitmap = decode(context, uri, bounds.outWidth, bounds.outHeight, longSide, rotation);
            try {
                for (int quality : MmsImageSizing.QUALITIES) {
                    ByteArrayOutputStream output = new ByteArrayOutputStream();
                    bitmap.compress(Bitmap.CompressFormat.JPEG, quality, output);
                    if (output.size() <= budget) return output.toByteArray();
                }
            } finally {
                bitmap.recycle();
            }
            longSide = MmsImageSizing.nextLongSide(longSide);
        }
        throw new IllegalArgumentException("사진을 통신사 MMS 크기(" + (budget / 1024) + "KB)에 맞게 줄이지 못했습니다.");
    }

    private static Bitmap decode(Context context, Uri uri, int width, int height, int longSide, int rotation) throws Exception {
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = MmsImageSizing.inSampleSize(width, height, longSide);
        Bitmap decoded;
        try (InputStream input = context.getContentResolver().openInputStream(uri)) {
            decoded = input == null ? null : BitmapFactory.decodeStream(input, null, options);
        }
        if (decoded == null) throw new IllegalStateException("사진을 읽지 못했습니다.");
        int[] size = MmsImageSizing.scaledSize(decoded.getWidth(), decoded.getHeight(), longSide);
        Matrix matrix = new Matrix();
        matrix.postScale((float) size[0] / decoded.getWidth(), (float) size[1] / decoded.getHeight());
        if (rotation != 0) matrix.postRotate(rotation);
        Bitmap result = Bitmap.createBitmap(decoded, 0, 0, decoded.getWidth(), decoded.getHeight(), matrix, true);
        if (result != decoded) decoded.recycle();
        return result;
    }

    // AndroidX를 쓰지 않는다. 프레임워크 ExifInterface는 API 24+에서 InputStream을 읽을 수 있고 minSdk는 26이다.
    @SuppressLint("ExifInterface")
    private static int rotation(Context context, Uri uri) {
        try (InputStream input = context.getContentResolver().openInputStream(uri)) {
            if (input == null) return 0;
            int orientation = new android.media.ExifInterface(input).getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION,
                    android.media.ExifInterface.ORIENTATION_NORMAL);
            switch (orientation) {
                case android.media.ExifInterface.ORIENTATION_ROTATE_90: return 90;
                case android.media.ExifInterface.ORIENTATION_ROTATE_180: return 180;
                case android.media.ExifInterface.ORIENTATION_ROTATE_270: return 270;
                default: return 0;
            }
        } catch (Exception ignored) {
            return 0;
        }
    }
}
