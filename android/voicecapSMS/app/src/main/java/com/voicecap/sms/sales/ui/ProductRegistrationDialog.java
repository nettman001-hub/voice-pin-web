package com.voicecap.sms.sales.ui;

import android.app.AlertDialog;
import android.content.ContentValues;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.hardware.Camera;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.CountDownTimer;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.text.InputType;
import android.view.Gravity;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.ViewGroup;
import android.widget.*;
import com.voicecap.sms.MainActivity;
import com.voicecap.sms.sales.SalesRepository;
import com.voicecap.sms.sales.model.SalesModels.*;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.UUID;

public final class ProductRegistrationDialog {
    private ProductRegistrationDialog() {}

    public interface OnProductRegisteredListener {
        void onRegistered(Product product, LiveSession session);
    }

    public static void show(
        Context context,
        SalesRepository repository,
        LiveSession session,
        Settings settings,
        OnProductRegisteredListener listener
    ) {
        AlertDialog.Builder builder = new AlertDialog.Builder(context);
        builder.setTitle("신규 상품등록");

        LinearLayout layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (18 * context.getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad, pad, pad);

        TextView labelCode = new TextView(context);
        labelCode.setText("상품번호 또는 상품명");
        labelCode.setTextSize(14);
        labelCode.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        layout.addView(labelCode);

        EditText etCodeOrName = new EditText(context);
        etCodeOrName.setHint("예: 0007 또는 실크 스카프");
        etCodeOrName.setSingleLine(true);
        if (!settings.productNameInputEnabled) {
            etCodeOrName.setEnabled(false);
            etCodeOrName.setHint("자동 번호 발급 모드");
        }
        layout.addView(etCodeOrName);

        TextView labelPrice = new TextView(context);
        labelPrice.setText("판매 단가 (원)");
        labelPrice.setTextSize(14);
        labelPrice.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        labelPrice.setPadding(0, pad / 2, 0, 0);
        layout.addView(labelPrice);

        EditText etPrice = new EditText(context);
        etPrice.setHint("예: 35000 (미입력 가능)");
        etPrice.setInputType(InputType.TYPE_CLASS_NUMBER);
        etPrice.setSingleLine(true);
        layout.addView(etPrice);

        TextView photoInfo = new TextView(context);
        photoInfo.setText(settings.captureProductImageEnabled ? "등록 시 2초 카운트다운 후 상품사진을 촬영합니다." : "사진 OFF 모드: 번호이미지로 등록됩니다.");
        photoInfo.setTextSize(12);
        photoInfo.setTextColor(Color.rgb(100, 116, 139));
        photoInfo.setPadding(0, pad / 2, 0, 0);
        layout.addView(photoInfo);

        builder.setView(layout);
        builder.setPositiveButton("등록", null);
        builder.setNegativeButton("취소", (dialog, which) -> dialog.dismiss());

        AlertDialog dialog = builder.create();
        dialog.show();

        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String rawCodeOrName = etCodeOrName.getText().toString().trim();
            String rawPrice = etPrice.getText().toString().trim();

            Long price = null;
            if (!rawPrice.isEmpty()) {
                try {
                    price = Long.parseLong(rawPrice);
                } catch (NumberFormatException e) {
                    Toast.makeText(context, "올바른 금액을 입력해 주세요.", Toast.LENGTH_SHORT).show();
                    return;
                }
            }

            String requestedProductCode = null;
            String name = null;

            if (!rawCodeOrName.isEmpty()) {
                if (rawCodeOrName.matches("^\\d+$")) {
                    // All digits: preserve leading zeros (e.g. "0007")
                    requestedProductCode = rawCodeOrName;
                } else {
                    name = rawCodeOrName;
                }
            }

            dialog.dismiss();
            startRegistrationFlow(context, repository, session, settings, requestedProductCode, name, price, listener);
        });
    }

    private static void startRegistrationFlow(
        Context context,
        SalesRepository repository,
        LiveSession session,
        Settings settings,
        String requestedProductCode,
        String name,
        Long price,
        OnProductRegisteredListener listener
    ) {
        String prepareOpId = UUID.randomUUID().toString();
        String initialImageKind = settings.captureProductImageEnabled ? "PHOTO" : "NUMBER_IMAGE";

        Toast.makeText(context, "상품 초안을 준비하는 중...", Toast.LENGTH_SHORT).show();

        repository.prepareProduct(
            prepareOpId,
            session != null ? session.id : null,
            session != null ? session.revision : null,
            requestedProductCode,
            name,
            price,
            initialImageKind,
            new SalesRepository.Callback<PrepareProductResult>() {
                @Override
                public void onSuccess(PrepareProductResult prep) {
                    if (settings.captureProductImageEnabled) {
                        // 전면 카메라 실제 촬영 → 갤러리 저장 → 1초 미리보기 → 업로드
                        showCameraCountdown(context, repository, prep, session, listener);
                    } else {
                        switchToNumberImageAndCommit(context, repository, prep, session, listener);
                    }
                }

                @Override
                public void onError(SalesError error) {
                    Toast.makeText(context, "상품 등록 실패: " + error.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
        );
    }

    private static void showCameraCountdown(
        Context context,
        SalesRepository repository,
        PrepareProductResult prep,
        LiveSession session,
        OnProductRegisteredListener listener
    ) {
        if (!(context instanceof MainActivity)) {
            Toast.makeText(context, "카메라를 열 수 없어 번호이미지로 등록합니다.", Toast.LENGTH_LONG).show();
            switchToNumberImageAndCommit(context, repository, prep, session, listener);
            return;
        }

        MainActivity activity = (MainActivity) context;
        activity.requestProductCameraPermission(
            () -> openFrontCameraCountdown(activity, repository, prep, session, listener),
            () -> {
                Toast.makeText(context, "카메라 권한이 없어 번호이미지로 등록합니다.", Toast.LENGTH_LONG).show();
                switchToNumberImageAndCommit(context, repository, prep, session, listener);
            }
        );
    }

    private static void openFrontCameraCountdown(
        MainActivity activity,
        SalesRepository repository,
        PrepareProductResult prep,
        LiveSession session,
        OnProductRegisteredListener listener
    ) {
        Context context = activity;
        AlertDialog.Builder builder = new AlertDialog.Builder(context);
        builder.setCancelable(false);
        int pad = (int) (16 * context.getResources().getDisplayMetrics().density);
        FrameLayout cameraFrame = new FrameLayout(context);
        cameraFrame.setBackgroundColor(Color.BLACK);
        cameraFrame.setMinimumHeight((int) (440 * context.getResources().getDisplayMetrics().density));

        SurfaceView surfaceView = new SurfaceView(context);
        cameraFrame.addView(surfaceView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        LinearLayout overlay = new LinearLayout(context);
        overlay.setOrientation(LinearLayout.VERTICAL);
        overlay.setGravity(Gravity.CENTER_HORIZONTAL);
        overlay.setPadding(pad, pad, pad, pad);
        FrameLayout.LayoutParams overlayParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM
        );
        cameraFrame.addView(overlay, overlayParams);

        TextView countdownText = new TextView(context);
        countdownText.setText("2초 후 촬영합니다");
        countdownText.setTextSize(20);
        countdownText.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        countdownText.setGravity(Gravity.CENTER);
        countdownText.setTextColor(Color.WHITE);
        countdownText.setShadowLayer(8f, 0f, 2f, Color.BLACK);
        countdownText.setPadding(0, pad / 2, 0, pad / 2);
        overlay.addView(countdownText);

        Button fallbackBtn = new Button(context);
        fallbackBtn.setText("촬영 건너뛰고 번호이미지로 등록");
        fallbackBtn.setTextSize(13);
        overlay.addView(fallbackBtn);

        builder.setView(cameraFrame);
        AlertDialog countdownDialog = builder.create();
        countdownDialog.show();

        final Camera[] cameraRef = new Camera[1];
        final CountDownTimer[] timerRef = new CountDownTimer[1];
        final boolean[] completed = new boolean[]{false};

        Runnable releaseCamera = () -> {
            if (cameraRef[0] != null) {
                try { cameraRef[0].stopPreview(); } catch (Exception ignored) {}
                try { cameraRef[0].release(); } catch (Exception ignored) {}
                cameraRef[0] = null;
            }
        };

        surfaceView.getHolder().addCallback(new SurfaceHolder.Callback() {
            @Override
            public void surfaceCreated(SurfaceHolder holder) {
                try {
                    int cameraId = findFrontCameraId();
                    if (cameraId < 0) throw new IllegalStateException("전면 카메라가 없습니다.");

                    Camera camera = Camera.open(cameraId);
                    cameraRef[0] = camera;
                    Camera.Parameters parameters = camera.getParameters();
                    parameters.setJpegQuality(88);
                    parameters.setRotation(calculateJpegRotation(activity, cameraId));
                    Camera.Size pictureSize = choosePictureSize(parameters);
                    if (pictureSize != null) parameters.setPictureSize(pictureSize.width, pictureSize.height);
                    camera.setParameters(parameters);
                    camera.setDisplayOrientation(calculateDisplayOrientation(activity, cameraId));
                    camera.setPreviewDisplay(holder);
                    camera.startPreview();

                    timerRef[0] = new CountDownTimer(2000, 250) {
                        @Override
                        public void onTick(long millisUntilFinished) {
                            int sec = (int) Math.ceil(millisUntilFinished / 1000d);
                            countdownText.setText(sec + "초 후 전면 카메라 촬영...");
                        }

                        @Override
                        public void onFinish() {
                            countdownText.setText("촬영 중...");
                            try {
                                camera.takePicture(null, null, (jpegData, capturedCamera) -> {
                                    completed[0] = true;
                                    savePhotoToGallery(context, jpegData, prep.productCode);
                                    countdownDialog.dismiss();
                                    releaseCamera.run();
                                    showCapturedPhotoForOneSecond(
                                        context,
                                        jpegData,
                                        () -> uploadPhotoAndCommit(context, repository, prep, session, jpegData, listener)
                                    );
                                });
                            } catch (Exception error) {
                                completed[0] = true;
                                countdownDialog.dismiss();
                                releaseCamera.run();
                                Toast.makeText(context, "촬영 실패: " + error.getMessage(), Toast.LENGTH_LONG).show();
                                switchToNumberImageAndCommit(context, repository, prep, session, listener);
                            }
                        }
                    };
                    timerRef[0].start();
                } catch (Exception error) {
                    completed[0] = true;
                    countdownDialog.dismiss();
                    releaseCamera.run();
                    Toast.makeText(context, "전면 카메라 실행 실패: " + error.getMessage(), Toast.LENGTH_LONG).show();
                    switchToNumberImageAndCommit(context, repository, prep, session, listener);
                }
            }

            @Override
            public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {}

            @Override
            public void surfaceDestroyed(SurfaceHolder holder) {
                if (!completed[0] && timerRef[0] != null) timerRef[0].cancel();
                releaseCamera.run();
            }
        });

        fallbackBtn.setOnClickListener(v -> {
            completed[0] = true;
            if (timerRef[0] != null) timerRef[0].cancel();
            countdownDialog.dismiss();
            releaseCamera.run();
            switchToNumberImageAndCommit(context, repository, prep, session, listener);
        });

        countdownDialog.setOnDismissListener(ignored -> releaseCamera.run());
    }

    private static int findFrontCameraId() {
        Camera.CameraInfo info = new Camera.CameraInfo();
        for (int id = 0; id < Camera.getNumberOfCameras(); id++) {
            Camera.getCameraInfo(id, info);
            if (info.facing == Camera.CameraInfo.CAMERA_FACING_FRONT) return id;
        }
        return -1;
    }

    private static Camera.Size choosePictureSize(Camera.Parameters parameters) {
        Camera.Size best = null;
        for (Camera.Size size : parameters.getSupportedPictureSizes()) {
            long pixels = (long) size.width * size.height;
            if (pixels > 4_000_000L) continue;
            if (best == null || pixels > (long) best.width * best.height) best = size;
        }
        return best;
    }

    private static int displayRotationDegrees(MainActivity activity) {
        int rotation = activity.getWindowManager().getDefaultDisplay().getRotation();
        if (rotation == Surface.ROTATION_90) return 90;
        if (rotation == Surface.ROTATION_180) return 180;
        if (rotation == Surface.ROTATION_270) return 270;
        return 0;
    }

    private static int calculateDisplayOrientation(MainActivity activity, int cameraId) {
        Camera.CameraInfo info = new Camera.CameraInfo();
        Camera.getCameraInfo(cameraId, info);
        int degrees = displayRotationDegrees(activity);
        if (info.facing == Camera.CameraInfo.CAMERA_FACING_FRONT) {
            return (360 - ((info.orientation + degrees) % 360)) % 360;
        }
        return (info.orientation - degrees + 360) % 360;
    }

    private static int calculateJpegRotation(MainActivity activity, int cameraId) {
        Camera.CameraInfo info = new Camera.CameraInfo();
        Camera.getCameraInfo(cameraId, info);
        int degrees = displayRotationDegrees(activity);
        return info.facing == Camera.CameraInfo.CAMERA_FACING_FRONT
            ? (info.orientation + degrees) % 360
            : (info.orientation - degrees + 360) % 360;
    }

    private static void savePhotoToGallery(Context context, byte[] jpegData, String productCode) {
        String displayName = "VoiceCAP_" + productCode + "_" + System.currentTimeMillis() + ".jpg";
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, displayName);
                values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/VoiceCAP");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
                Uri uri = context.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IllegalStateException("갤러리 저장 위치를 만들지 못했습니다.");
                try (OutputStream output = context.getContentResolver().openOutputStream(uri)) {
                    if (output == null) throw new IllegalStateException("갤러리 파일을 열지 못했습니다.");
                    output.write(jpegData);
                }
                values.clear();
                values.put(MediaStore.Images.Media.IS_PENDING, 0);
                context.getContentResolver().update(uri, values, null, null);
            } else {
                File directory = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "VoiceCAP");
                if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("VoiceCAP 사진 폴더를 만들지 못했습니다.");
                File file = new File(directory, displayName);
                try (FileOutputStream output = new FileOutputStream(file)) {
                    output.write(jpegData);
                }
                MediaScannerConnection.scanFile(context, new String[]{file.getAbsolutePath()}, new String[]{"image/jpeg"}, null);
            }
            Toast.makeText(context, "사진이 갤러리의 VoiceCAP 앨범에 저장되었습니다.", Toast.LENGTH_SHORT).show();
        } catch (Exception error) {
            Toast.makeText(context, "사진 갤러리 저장 실패: " + error.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private static void showCapturedPhotoForOneSecond(Context context, byte[] jpegData, Runnable afterPreview) {
        ImageView preview = new ImageView(context);
        Bitmap bitmap = BitmapFactory.decodeByteArray(jpegData, 0, jpegData.length);
        preview.setImageBitmap(bitmap);
        preview.setScaleType(ImageView.ScaleType.CENTER_CROP);
        preview.setAdjustViewBounds(true);
        preview.setMinimumHeight((int) (420 * context.getResources().getDisplayMetrics().density));

        AlertDialog dialog = new AlertDialog.Builder(context)
            .setTitle("촬영된 상품 사진 · 1초 미리보기")
            .setView(preview)
            .setCancelable(false)
            .create();
        dialog.show();
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            dialog.dismiss();
            afterPreview.run();
        }, 1000);
    }

    private static void uploadPhotoAndCommit(
        Context context,
        SalesRepository repository,
        PrepareProductResult prep,
        LiveSession session,
        byte[] jpegData,
        OnProductRegisteredListener listener
    ) {
        Toast.makeText(context, "촬영 사진을 저장하는 중...", Toast.LENGTH_SHORT).show();
        repository.uploadProductImage(prep.uploadUrl, jpegData, new SalesRepository.Callback<Void>() {
            @Override
            public void onSuccess(Void ignored) {
                commitProductInternal(context, repository, prep.draftId, prep.draftRevision, session != null ? session.revision : 1, listener);
            }

            @Override
            public void onError(SalesError error) {
                new AlertDialog.Builder(context)
                    .setTitle("상품 사진 업로드 실패")
                    .setMessage(error.getMessage())
                    .setPositiveButton("다시 시도", (dialog, which) -> uploadPhotoAndCommit(context, repository, prep, session, jpegData, listener))
                    .setNegativeButton("번호이미지로 등록", (dialog, which) -> switchToNumberImageAndCommit(context, repository, prep, session, listener))
                    .show();
            }
        });
    }

    private static byte[] createNumberImageJpeg(String productCode) {
        Bitmap bitmap = Bitmap.createBitmap(720, 720, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        canvas.drawColor(Color.rgb(238, 242, 255));
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        paint.setColor(Color.rgb(30, 41, 59));
        paint.setTextSize(36f);
        canvas.drawText("VoiceCAP 임시 상품", 360f, 240f, paint);
        paint.setColor(Color.rgb(37, 99, 235));
        paint.setTextSize(Math.max(68f, Math.min(150f, 620f / Math.max(4, productCode.length()) * 1.2f)));
        canvas.drawText(productCode, 360f, 390f, paint);
        paint.setColor(Color.rgb(100, 116, 139));
        paint.setTextSize(25f);
        canvas.drawText("사진이 없어 자동 생성된 이미지입니다", 360f, 515f, paint);

        ByteArrayOutputStream output = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.JPEG, 88, output);
        bitmap.recycle();
        return output.toByteArray();
    }

    private static void switchToNumberImageAndCommit(
        Context context,
        SalesRepository repository,
        PrepareProductResult prep,
        LiveSession session,
        OnProductRegisteredListener listener
    ) {
        String updateOpId = UUID.randomUUID().toString();
        repository.updateProductDraft(
            updateOpId,
            prep.draftId,
            prep.draftRevision,
            "NUMBER_IMAGE",
            true,
            new SalesRepository.Callback<DraftData>() {
                @Override
                public void onSuccess(DraftData updatedDraft) {
                    byte[] placeholder = createNumberImageJpeg(prep.productCode);
                    repository.uploadProductImage(prep.uploadUrl, placeholder, new SalesRepository.Callback<Void>() {
                        @Override
                        public void onSuccess(Void ignored) {
                            Toast.makeText(context, "번호이미지가 저장되었습니다.", Toast.LENGTH_SHORT).show();
                            commitProductInternal(context, repository, updatedDraft.id, updatedDraft.draftRevision, session != null ? session.revision : 1, listener);
                        }

                        @Override
                        public void onError(SalesError error) {
                            Toast.makeText(context, "번호이미지 저장 실패: " + error.getMessage(), Toast.LENGTH_LONG).show();
                        }
                    });
                }

                @Override
                public void onError(SalesError error) {
                    Toast.makeText(context, "번호이미지 전환 실패: " + error.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
        );

    }

    private static void commitProductInternal(
        Context context,
        SalesRepository repository,
        String draftId,
        int draftRevision,
        int sessionRevision,
        OnProductRegisteredListener listener
    ) {
        String commitOpId = UUID.randomUUID().toString();
        repository.commitProduct(
            commitOpId,
            draftId,
            draftRevision,
            sessionRevision,
            new SalesRepository.Callback<CommitProductResult>() {
                @Override
                public void onSuccess(CommitProductResult result) {
                    Toast.makeText(context, "상품 '" + result.product.productCode + "'이(가) 등록되었습니다!", Toast.LENGTH_LONG).show();
                    if (listener != null) listener.onRegistered(result.product, result.session);
                }

                @Override
                public void onError(SalesError error) {
                    Toast.makeText(context, "상품 확정 실패: " + error.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
        );
    }
}
