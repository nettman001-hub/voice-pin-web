package com.voicecap.sms;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * 시스템 MMS 서비스가 다운로드한 PDU를 쓰고, 보낼 PDU를 읽어 가는 임시 파일 통로.
 * exported=false + grantUriPermissions: SmsManager가 호출 시 전화 프로세스에 일회성 권한을 준다.
 */
public final class MmsFileProvider extends ContentProvider {
    private static final String DIRECTORY = "mms";
    private static final long STALE_MILLIS = 24L * 60 * 60 * 1000;

    static String authority(Context context) { return context.getPackageName() + ".mmsfiles"; }

    static File directory(Context context) {
        File dir = new File(context.getCacheDir(), DIRECTORY);
        if (!dir.exists() && !dir.mkdirs()) android.util.Log.w("VoiceCAP", "mms cache dir not created");
        return dir;
    }

    static Uri uriFor(Context context, File file) {
        return new Uri.Builder().scheme("content").authority(authority(context)).appendPath(file.getName()).build();
    }

    /** 하루 넘은 임시 PDU 파일 정리. */
    static void cleanup(Context context) {
        File[] files = directory(context).listFiles();
        if (files == null) return;
        long cutoff = System.currentTimeMillis() - STALE_MILLIS;
        for (File file : files) {
            if (file.lastModified() < cutoff && !file.delete()) android.util.Log.w("VoiceCAP", "stale mms file not deleted");
        }
    }

    @Override public boolean onCreate() { return true; }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if (name == null || !name.matches("[A-Za-z0-9._-]+")) throw new FileNotFoundException("invalid name");
        Context context = getContext();
        if (context == null) throw new FileNotFoundException("no context");
        return ParcelFileDescriptor.open(new File(directory(context), name), ParcelFileDescriptor.parseMode(mode));
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) { return null; }
    @Override public String getType(Uri uri) { return "application/vnd.wap.mms-message"; }
    @Override public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override public int delete(Uri uri, String selection, String[] selectionArgs) { return 0; }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) { return 0; }
}
